use anyhow::{anyhow, Context, Result};
use std::{
    ffi::OsStr,
    fs::{self, File},
    io::Cursor,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::OnceLock,
};
use symphonia::{
    core::{
        audio::SampleBuffer,
        codecs::{DecoderOptions, CODEC_TYPE_NULL},
        errors::Error as SymphoniaError,
        formats::FormatOptions,
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
    },
    default::{get_codecs, get_probe},
};

pub const AUDIO_MODALITY: &str = "audio";
pub const VIDEO_MODALITY: &str = "video";
pub const AUDIO_EXTRACTOR_NAME: &str = "media-segments";
pub const VIDEO_EXTRACTOR_NAME: &str = "media-segments-video-v2";

const AUDIO_SEGMENT_MIME_TYPE: &str = "audio/wav";
const VIDEO_SEGMENT_MIME_TYPE: &str = "video/mp4";
const FFMPEG_BINARY: &str = "ffmpeg";
const FFPROBE_BINARY: &str = "ffprobe";
const VIDEO_MAX_WIDTH: &str = "1280";
const VIDEO_MAX_HEIGHT: &str = "720";
const VIDEO_ENCODING_PRESET: &str = "veryfast";
const VIDEO_ENCODING_CRF: &str = "32";

static VIDEO_TOOLING_READY: OnceLock<()> = OnceLock::new();

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaSegment {
    pub file_id: i64,
    pub segment_index: i64,
    pub modality: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMediaSegment {
    pub segment_index: i64,
    pub modality: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaSegmentWindow {
    pub segment_index: i64,
    pub modality: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MediaChunkPreset {
    pub segment_ms: i64,
    pub overlap_ms: i64,
}

#[derive(Debug, Clone)]
pub struct PreparedMediaSegment {
    pub window: MediaSegmentWindow,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

pub trait MediaChunkStrategy {
    fn preset_for_modality(&self, modality: &str) -> Option<MediaChunkPreset>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultMediaChunkStrategy;

impl MediaChunkStrategy for DefaultMediaChunkStrategy {
    fn preset_for_modality(&self, modality: &str) -> Option<MediaChunkPreset> {
        match modality {
            AUDIO_MODALITY => Some(MediaChunkPreset {
                segment_ms: 90_000,
                overlap_ms: 15_000,
            }),
            VIDEO_MODALITY => Some(MediaChunkPreset {
                segment_ms: 30_000,
                overlap_ms: 5_000,
            }),
            _ => None,
        }
    }
}

pub fn default_chunk_strategy() -> DefaultMediaChunkStrategy {
    DefaultMediaChunkStrategy
}

pub fn expected_media_extractor(kind: &str) -> Option<&'static str> {
    match kind {
        AUDIO_MODALITY => Some(AUDIO_EXTRACTOR_NAME),
        VIDEO_MODALITY => Some(VIDEO_EXTRACTOR_NAME),
        _ => None,
    }
}

pub fn build_segment_windows(
    modality: &str,
    duration_ms: i64,
    strategy: &impl MediaChunkStrategy,
) -> Result<Vec<MediaSegmentWindow>> {
    let preset = strategy
        .preset_for_modality(modality)
        .ok_or_else(|| anyhow!("unsupported media modality: {modality}"))?;
    if duration_ms <= 0 {
        return Ok(Vec::new());
    }
    if preset.segment_ms <= 0 {
        return Err(anyhow!("segment duration must be positive"));
    }
    if preset.overlap_ms < 0 || preset.overlap_ms >= preset.segment_ms {
        return Err(anyhow!("overlap must be between 0 and segment duration"));
    }

    let mut windows = Vec::new();
    let mut start_ms = 0_i64;
    let mut segment_index = 0_i64;
    while start_ms < duration_ms {
        let end_ms = (start_ms + preset.segment_ms).min(duration_ms);
        windows.push(MediaSegmentWindow {
            segment_index,
            modality: modality.to_string(),
            start_ms,
            end_ms,
            label: format_timestamp_label(start_ms, end_ms),
        });

        if end_ms >= duration_ms {
            break;
        }

        let next_start = end_ms - preset.overlap_ms;
        if next_start <= start_ms {
            break;
        }
        start_ms = next_start;
        segment_index += 1;
    }

    Ok(windows)
}

pub fn format_timestamp_label(start_ms: i64, end_ms: i64) -> String {
    format!(
        "{}-{}",
        format_timestamp_boundary(start_ms, false),
        format_timestamp_boundary(end_ms, true)
    )
}

pub fn plan_media_segments(path: &Path, modality: &str) -> Result<Vec<MediaSegmentWindow>> {
    match modality {
        AUDIO_MODALITY => plan_audio_segments(path),
        VIDEO_MODALITY => plan_video_segments(path),
        _ => Err(anyhow!("unsupported media modality: {modality}")),
    }
}

pub fn prepare_media_segments(path: &Path, modality: &str) -> Result<Vec<PreparedMediaSegment>> {
    match modality {
        AUDIO_MODALITY => prepare_audio_segments(path),
        VIDEO_MODALITY => prepare_video_segments(path),
        _ => Err(anyhow!("unsupported media modality: {modality}")),
    }
}

pub fn prepare_media_segment(
    path: &Path,
    window: &MediaSegmentWindow,
) -> Result<PreparedMediaSegment> {
    match window.modality.as_str() {
        AUDIO_MODALITY => prepare_audio_segment(path, window),
        VIDEO_MODALITY => prepare_video_segment(path, window),
        _ => Err(anyhow!("unsupported media modality: {}", window.modality)),
    }
}

pub fn ensure_video_tooling_available() -> Result<()> {
    if VIDEO_TOOLING_READY.get().is_some() {
        return Ok(());
    }

    ensure_command_available(FFPROBE_BINARY, "probe video duration")?;
    ensure_command_available(FFMPEG_BINARY, "extract video clips")?;
    let _ = VIDEO_TOOLING_READY.set(());
    Ok(())
}

fn plan_audio_segments(path: &Path) -> Result<Vec<MediaSegmentWindow>> {
    let decoded = decode_audio_mono(path)?;
    let duration_ms = ((decoded.samples.len() as u128) * 1000 / decoded.sample_rate as u128) as i64;
    build_segment_windows(AUDIO_MODALITY, duration_ms, &default_chunk_strategy())
}

fn prepare_audio_segments(path: &Path) -> Result<Vec<PreparedMediaSegment>> {
    let decoded = decode_audio_mono(path)?;
    let duration_ms = ((decoded.samples.len() as u128) * 1000 / decoded.sample_rate as u128) as i64;
    let windows = build_segment_windows(AUDIO_MODALITY, duration_ms, &default_chunk_strategy())?;
    prepare_audio_segments_from_windows(&decoded, windows)
}

fn prepare_audio_segment(path: &Path, window: &MediaSegmentWindow) -> Result<PreparedMediaSegment> {
    let decoded = decode_audio_mono(path)?;
    slice_audio_segment(&decoded, window)?.ok_or_else(|| {
        anyhow!(
            "empty audio segment {} for {}",
            window.label,
            path.display()
        )
    })
}

fn prepare_audio_segments_from_windows(
    decoded: &DecodedAudio,
    windows: Vec<MediaSegmentWindow>,
) -> Result<Vec<PreparedMediaSegment>> {
    let mut segments = Vec::with_capacity(windows.len());
    for window in windows {
        if let Some(segment) = slice_audio_segment(decoded, &window)? {
            segments.push(segment);
        }
    }
    Ok(segments)
}

fn slice_audio_segment(
    decoded: &DecodedAudio,
    window: &MediaSegmentWindow,
) -> Result<Option<PreparedMediaSegment>> {
    let start_index = ((window.start_ms as u128 * decoded.sample_rate as u128) / 1000) as usize;
    let mut end_index =
        (window.end_ms as u128 * decoded.sample_rate as u128).div_ceil(1000) as usize;
    end_index = end_index.min(decoded.samples.len());
    if end_index <= start_index {
        return Ok(None);
    }

    let bytes = encode_wav_bytes(
        decoded.sample_rate,
        &decoded.samples[start_index..end_index],
    )?;
    Ok(Some(PreparedMediaSegment {
        window: window.clone(),
        mime_type: AUDIO_SEGMENT_MIME_TYPE.to_string(),
        bytes,
    }))
}

fn plan_video_segments(path: &Path) -> Result<Vec<MediaSegmentWindow>> {
    ensure_video_tooling_available()?;
    let duration_ms = probe_video_duration_ms(path)?;
    build_segment_windows(VIDEO_MODALITY, duration_ms, &default_chunk_strategy())
}

fn prepare_video_segments(path: &Path) -> Result<Vec<PreparedMediaSegment>> {
    let windows = plan_video_segments(path)?;
    let mut segments = Vec::with_capacity(windows.len());
    for window in windows {
        segments.push(prepare_video_segment(path, &window)?);
    }
    Ok(segments)
}

fn prepare_video_segment(path: &Path, window: &MediaSegmentWindow) -> Result<PreparedMediaSegment> {
    ensure_video_tooling_available()?;
    let output_path = temp_video_clip_path(path, window.segment_index);
    let args = build_video_clip_command_args(path, &output_path, window);
    let output = run_command_capture_output(
        FFMPEG_BINARY,
        args.iter().map(String::as_str),
        "clip extraction",
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!(
                "ffmpeg failed to extract video clip {} for {}",
                window.label,
                path.display()
            )
        } else {
            format!("clip extraction failed for {}: {}", path.display(), stderr)
        };
        let _ = fs::remove_file(&output_path);
        return Err(anyhow!(message));
    }

    let bytes = fs::read(&output_path).with_context(|| {
        format!(
            "failed to read generated video clip {}",
            output_path.display()
        )
    })?;
    let _ = fs::remove_file(&output_path);
    Ok(PreparedMediaSegment {
        window: window.clone(),
        mime_type: VIDEO_SEGMENT_MIME_TYPE.to_string(),
        bytes,
    })
}

fn probe_video_duration_ms(path: &Path) -> Result<i64> {
    let args = build_video_probe_command_args(path);
    let output = run_command_capture_output(
        FFPROBE_BINARY,
        args.iter().map(String::as_str),
        "video probe",
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            format!("ffprobe failed for {}", path.display())
        } else {
            format!("video probe failed for {}: {}", path.display(), stderr)
        };
        return Err(anyhow!(detail));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let seconds = stdout
        .trim()
        .parse::<f64>()
        .with_context(|| format!("failed to parse video duration for {}", path.display()))?;
    if !seconds.is_finite() || seconds <= 0.0 {
        return Err(anyhow!("video duration missing for {}", path.display()));
    }

    Ok((seconds * 1000.0).round() as i64)
}

fn ensure_command_available(program: &str, purpose: &str) -> Result<()> {
    let output = Command::new(program)
        .arg("-version")
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                anyhow!("{program} unavailable; install ffmpeg to {purpose}")
            } else {
                anyhow!("failed to start {program}: {error}")
            }
        })?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(anyhow!(
                "{program} failed to start while checking availability"
            ))
        } else {
            Err(anyhow!(
                "{program} failed to start while checking availability: {stderr}"
            ))
        }
    }
}

fn run_command_capture_output<'a>(
    program: &str,
    args: impl IntoIterator<Item = &'a str>,
    purpose: &str,
) -> Result<Output> {
    Command::new(program).args(args).output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            anyhow!("{program} unavailable; install ffmpeg to {purpose}")
        } else {
            anyhow!("failed to start {program} for {purpose}: {error}")
        }
    })
}

fn build_video_probe_command_args(path: &Path) -> Vec<String> {
    vec![
        "-v".to_string(),
        "error".to_string(),
        "-show_entries".to_string(),
        "format=duration".to_string(),
        "-of".to_string(),
        "default=noprint_wrappers=1:nokey=1".to_string(),
        path_to_arg(path),
    ]
}

fn build_video_clip_command_args(
    input_path: &Path,
    output_path: &Path,
    window: &MediaSegmentWindow,
) -> Vec<String> {
    let duration_ms = (window.end_ms - window.start_ms).max(1);
    vec![
        "-v".to_string(),
        "error".to_string(),
        "-y".to_string(),
        "-ss".to_string(),
        format_ffmpeg_seconds(window.start_ms),
        "-i".to_string(),
        path_to_arg(input_path),
        "-t".to_string(),
        format_ffmpeg_seconds(duration_ms),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a?".to_string(),
        "-vf".to_string(),
        format!(
            "scale={VIDEO_MAX_WIDTH}:{VIDEO_MAX_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2"
        ),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        VIDEO_ENCODING_PRESET.to_string(),
        "-crf".to_string(),
        VIDEO_ENCODING_CRF.to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "96k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        path_to_arg(output_path),
    ]
}

fn temp_video_clip_path(source_path: &Path, segment_index: i64) -> PathBuf {
    let stem = source_path
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|stem| !stem.is_empty())
        .unwrap_or("clip");
    let unique = format!(
        "mira-{stem}-{segment_index}-{}-{}.mp4",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("unix timestamp")
            .as_nanos()
    );
    std::env::temp_dir().join(unique)
}

fn path_to_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn format_ffmpeg_seconds(milliseconds: i64) -> String {
    format!("{:.3}", milliseconds.max(0) as f64 / 1000.0)
}

struct DecodedAudio {
    sample_rate: u32,
    samples: Vec<i16>,
}

fn decode_audio_mono(path: &Path) -> Result<DecodedAudio> {
    let file = File::open(path)
        .with_context(|| format!("failed to open audio file {}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(extension);
    }

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .with_context(|| format!("failed to probe audio file {}", path.display()))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| {
            track.codec_params.codec != CODEC_TYPE_NULL
                && (track.codec_params.channels.is_some()
                    || track.codec_params.sample_rate.is_some())
        })
        .or_else(|| {
            format
                .default_track()
                .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        })
        .ok_or_else(|| anyhow!("no supported audio track found in {}", path.display()))?;

    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .with_context(|| format!("failed to create audio decoder for {}", path.display()))?;

    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut samples = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => {
                return Err(anyhow!(
                    "audio reset required while decoding {}",
                    path.display()
                ))
            }
            Err(error) => {
                return Err(error).with_context(|| format!("failed to read {}", path.display()))
            }
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => {
                return Err(error).with_context(|| format!("failed to decode {}", path.display()))
            }
        };

        let spec = *decoded.spec();
        if sample_rate == 0 {
            sample_rate = spec.rate;
        }
        let channel_count = spec.channels.count();
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_interleaved_ref(decoded);
        let interleaved = buffer.samples();

        if channel_count <= 1 {
            samples.extend(interleaved.iter().copied().map(float_sample_to_i16));
            continue;
        }

        for frame in interleaved.chunks(channel_count) {
            let total = frame.iter().copied().sum::<f32>();
            samples.push(float_sample_to_i16(total / channel_count as f32));
        }
    }

    if sample_rate == 0 {
        return Err(anyhow!("missing audio sample rate for {}", path.display()));
    }

    Ok(DecodedAudio {
        sample_rate,
        samples,
    })
}

fn float_sample_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

fn encode_wav_bytes(sample_rate: u32, samples: &[i16]) -> Result<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::new(&mut cursor, spec).context("failed to create wav writer")?;
    for sample in samples {
        writer
            .write_sample(*sample)
            .context("failed to write wav sample")?;
    }
    writer
        .finalize()
        .context("failed to finalize wav segment")?;
    Ok(cursor.into_inner())
}

fn format_timestamp_boundary(milliseconds: i64, ceil_seconds: bool) -> String {
    let seconds = if ceil_seconds {
        ((milliseconds.max(0) + 999) / 1000) as u64
    } else {
        (milliseconds.max(0) / 1000) as u64
    };
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let remainder_seconds = seconds % 60;

    if hours > 0 {
        format!("{hours}:{minutes:02}:{remainder_seconds:02}")
    } else {
        format!("{minutes:02}:{remainder_seconds:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn given_exact_boundary_audio_duration_when_building_segment_windows_then_segments_are_stable()
    {
        let windows = build_segment_windows(AUDIO_MODALITY, 90_000, &default_chunk_strategy())
            .expect("audio windows");

        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].start_ms, 0);
        assert_eq!(windows[0].end_ms, 90_000);
        assert_eq!(windows[0].label, "00:00-01:30");
    }

    #[test]
    fn given_long_audio_when_building_segment_windows_then_overlap_math_matches_preset() {
        let windows = build_segment_windows(AUDIO_MODALITY, 210_000, &default_chunk_strategy())
            .expect("audio windows");

        let actual = windows
            .iter()
            .map(|window| (window.start_ms, window.end_ms))
            .collect::<Vec<_>>();
        assert_eq!(
            actual,
            vec![(0, 90_000), (75_000, 165_000), (150_000, 210_000)]
        );
    }

    #[test]
    fn given_timestamp_bounds_when_formatting_label_then_minutes_and_hours_are_readable() {
        assert_eq!(format_timestamp_label(5_000, 65_000), "00:05-01:05");
        assert_eq!(
            format_timestamp_label(3_600_000, 3_661_000),
            "1:00:00-1:01:01"
        );
    }

    #[test]
    fn given_modality_when_loading_default_preset_then_audio_and_video_use_distinct_values() {
        let strategy = default_chunk_strategy();
        assert_eq!(
            strategy.preset_for_modality(AUDIO_MODALITY),
            Some(MediaChunkPreset {
                segment_ms: 90_000,
                overlap_ms: 15_000,
            })
        );
        assert_eq!(
            strategy.preset_for_modality(VIDEO_MODALITY),
            Some(MediaChunkPreset {
                segment_ms: 30_000,
                overlap_ms: 5_000,
            })
        );
        assert_eq!(strategy.preset_for_modality("other"), None);
    }

    #[test]
    fn given_media_kind_when_loading_expected_extractor_then_video_uses_new_version_only() {
        assert_eq!(
            expected_media_extractor(AUDIO_MODALITY),
            Some(AUDIO_EXTRACTOR_NAME)
        );
        assert_eq!(
            expected_media_extractor(VIDEO_MODALITY),
            Some(VIDEO_EXTRACTOR_NAME)
        );
        assert_eq!(expected_media_extractor("other"), None);
    }

    #[test]
    fn given_video_window_when_building_ffmpeg_args_then_command_keeps_video_and_optional_audio() {
        let window = MediaSegmentWindow {
            segment_index: 2,
            modality: VIDEO_MODALITY.to_string(),
            start_ms: 5_000,
            end_ms: 35_000,
            label: "00:05-00:35".to_string(),
        };
        let args = build_video_clip_command_args(
            Path::new("/tmp/input clip.mp4"),
            Path::new("/tmp/output clip.mp4"),
            &window,
        );

        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a?"]));
        assert!(args.windows(2).any(|pair| pair == ["-ss", "5.000"]));
        assert!(args.windows(2).any(|pair| pair == ["-t", "30.000"]));
        assert!(args.iter().any(|arg| arg.contains("force_divisible_by=2")));
        assert_eq!(
            args.last().map(String::as_str),
            Some("/tmp/output clip.mp4")
        );
    }

    #[test]
    fn given_video_path_when_building_ffprobe_args_then_duration_only_is_requested() {
        let args = build_video_probe_command_args(Path::new("/tmp/demo.mp4"));
        assert_eq!(
            args,
            vec![
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                "/tmp/demo.mp4",
            ]
        );
    }

    #[test]
    fn given_audio_wav_when_preparing_segments_then_wav_bytes_are_generated() {
        let wav_path = temp_media_path("audio-segment", "wav");
        write_test_wav(&wav_path, 16_000, 1.0).expect("write wav");

        let segments = prepare_media_segments(&wav_path, AUDIO_MODALITY).expect("audio segments");
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].mime_type, AUDIO_SEGMENT_MIME_TYPE);
        assert_eq!(&segments[0].bytes[..4], b"RIFF");

        let _ = fs::remove_file(wav_path);
    }

    #[test]
    fn given_silent_video_when_planning_segments_then_video_windows_are_created_without_audio_track(
    ) {
        if !video_tooling_available_for_tests() {
            return;
        }

        let video_path = temp_media_path("silent-video", "mp4");
        create_silent_video(&video_path, 1).expect("create silent video");

        let windows = plan_media_segments(&video_path, VIDEO_MODALITY).expect("video windows");
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].modality, VIDEO_MODALITY);
        assert_eq!(windows[0].label, "00:00-00:01");

        let _ = fs::remove_file(video_path);
    }

    #[test]
    fn given_video_with_audio_when_preparing_segment_then_mp4_bytes_are_generated() {
        if !video_tooling_available_for_tests() {
            return;
        }

        let video_path = temp_media_path("video-with-audio", "mp4");
        create_video_with_audio(&video_path, 1).expect("create video with audio");

        let windows = plan_media_segments(&video_path, VIDEO_MODALITY).expect("video windows");
        let segment = prepare_media_segment(&video_path, &windows[0]).expect("video segment");
        assert_eq!(segment.mime_type, VIDEO_SEGMENT_MIME_TYPE);
        assert!(segment.bytes.len() > 8);
        assert_eq!(&segment.bytes[4..8], b"ftyp");

        let _ = fs::remove_file(video_path);
    }

    fn write_test_wav(path: &Path, sample_rate: u32, duration_seconds: f32) -> Result<()> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).context("create test wav")?;
        let total_samples = (sample_rate as f32 * duration_seconds) as usize;
        for index in 0..total_samples {
            let phase = index as f32 * 440.0 * 2.0 * PI / sample_rate as f32;
            writer.write_sample(float_sample_to_i16(phase.sin()))?;
        }
        writer.finalize().context("finalize test wav")?;
        Ok(())
    }

    fn create_silent_video(path: &Path, duration_seconds: u32) -> Result<()> {
        let args = vec![
            "-v".to_string(),
            "error".to_string(),
            "-y".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "color=c=black:s=320x240:r=24".to_string(),
            "-t".to_string(),
            duration_seconds.to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            path_to_arg(path),
        ];
        let output = run_command_capture_output(
            FFMPEG_BINARY,
            args.iter().map(String::as_str),
            "create silent test video",
        )?;
        if output.status.success() {
            Ok(())
        } else {
            Err(anyhow!(
                "failed to create silent test video: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }

    fn create_video_with_audio(path: &Path, duration_seconds: u32) -> Result<()> {
        let args = vec![
            "-v".to_string(),
            "error".to_string(),
            "-y".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "testsrc=size=320x240:rate=24".to_string(),
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "sine=frequency=440:sample_rate=44100".to_string(),
            "-t".to_string(),
            duration_seconds.to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-shortest".to_string(),
            path_to_arg(path),
        ];
        let output = run_command_capture_output(
            FFMPEG_BINARY,
            args.iter().map(String::as_str),
            "create video+audio test video",
        )?;
        if output.status.success() {
            Ok(())
        } else {
            Err(anyhow!(
                "failed to create video+audio test video: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }

    fn temp_media_path(prefix: &str, extension: &str) -> PathBuf {
        let unique = format!(
            "mira-{prefix}-{}-{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("unix timestamp")
                .as_nanos(),
            extension
        );
        std::env::temp_dir().join(unique)
    }

    fn video_tooling_available_for_tests() -> bool {
        Command::new(FFPROBE_BINARY)
            .arg("-version")
            .output()
            .is_ok()
            && Command::new(FFMPEG_BINARY).arg("-version").output().is_ok()
    }
}
