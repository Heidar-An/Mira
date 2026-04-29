use crate::{
    media::{self, PendingMediaSegment},
    models::SemanticMediaSource,
};
use anyhow::Result;
use rusqlite::{params, Connection};

#[cfg(test)]
use crate::media::MediaSegment;

pub fn replace_media_segments(
    conn: &Connection,
    file_id: i64,
    segments: &[PendingMediaSegment],
) -> Result<()> {
    conn.execute(
        "DELETE FROM media_segments WHERE file_id = ?1",
        params![file_id],
    )?;

    if segments.is_empty() {
        return Ok(());
    }

    let mut insert = conn.prepare_cached(
        "INSERT INTO media_segments (
            file_id,
            segment_index,
            modality,
            start_ms,
            end_ms,
            label
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;

    for segment in segments {
        insert.execute(params![
            file_id,
            segment.segment_index,
            segment.modality,
            segment.start_ms,
            segment.end_ms,
            segment.label,
        ])?;
    }

    Ok(())
}

#[cfg(test)]
pub fn fetch_media_segments_for_file(conn: &Connection, file_id: i64) -> Result<Vec<MediaSegment>> {
    let mut stmt = conn.prepare(
        "SELECT file_id,
                segment_index,
                modality,
                start_ms,
                end_ms,
                label
         FROM media_segments
         WHERE file_id = ?1
         ORDER BY segment_index ASC",
    )?;

    let rows = stmt.query_map(params![file_id], |row| {
        Ok(MediaSegment {
            file_id: row.get(0)?,
            segment_index: row.get(1)?,
            modality: row.get(2)?,
            start_ms: row.get(3)?,
            end_ms: row.get(4)?,
            label: row.get(5)?,
        })
    })?;

    let mut segments = Vec::new();
    for row in rows {
        segments.push(row?);
    }
    Ok(segments)
}

pub fn fetch_semantic_media_sources(
    conn: &Connection,
    root_id: i64,
    modality: &str,
) -> Result<Vec<SemanticMediaSource>> {
    let mut stmt = conn.prepare(
        "SELECT f.id,
                f.root_id,
                f.path,
                f.kind,
                m.segment_index,
                m.modality,
                m.start_ms,
                m.end_ms,
                m.label
         FROM files f
         JOIN file_semantic_index s ON s.file_id = f.id
         JOIN media_segments m ON m.file_id = f.id
         WHERE f.root_id = ?1
           AND s.status = 'pending'
           AND m.modality = ?2
         ORDER BY f.id ASC, m.segment_index ASC",
    )?;

    let rows = stmt.query_map(params![root_id, modality], |row| {
        Ok(SemanticMediaSource {
            file_id: row.get(0)?,
            root_id: row.get(1)?,
            path: row.get(2)?,
            kind: row.get(3)?,
            segment_index: row.get(4)?,
            modality: row.get(5)?,
            start_ms: row.get(6)?,
            end_ms: row.get(7)?,
            label: row.get(8)?,
        })
    })?;

    let mut sources = Vec::new();
    for row in rows {
        sources.push(row?);
    }
    Ok(sources)
}

pub fn sync_media_content_status(conn: &Connection, updated_at: i64) -> Result<usize> {
    let mut stale_files = Vec::<(i64, String)>::new();
    let mut stmt = conn.prepare(
        "SELECT e.file_id, f.kind, e.extractor, e.status
         FROM file_extracts e
         JOIN files f ON f.id = e.file_id
         WHERE f.kind IN ('audio', 'video')",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    for row in rows {
        let (file_id, kind, extractor, status) = row?;
        let Some(expected_extractor) = media::expected_media_extractor(&kind) else {
            continue;
        };
        let should_requeue = extractor.as_deref() != Some(expected_extractor)
            || matches!(status.as_str(), "unsupported" | "error");
        if should_requeue {
            stale_files.push((file_id, expected_extractor.to_string()));
        }
    }
    drop(stmt);

    if stale_files.is_empty() {
        return Ok(0);
    }

    let mut delete_chunks =
        conn.prepare_cached("DELETE FROM file_text_chunks WHERE file_id = ?1")?;
    let mut delete_segments =
        conn.prepare_cached("DELETE FROM media_segments WHERE file_id = ?1")?;
    let mut reset_extract = conn.prepare_cached(
        "UPDATE file_extracts
         SET status = 'pending',
             extractor = ?2,
             text_length = 0,
             chunk_count = 0,
             error_message = NULL,
             updated_at = ?3
         WHERE file_id = ?1",
    )?;

    for (file_id, extractor) in &stale_files {
        delete_chunks.execute(params![file_id])?;
        delete_segments.execute(params![file_id])?;
        reset_extract.execute(params![file_id, extractor, updated_at])?;
    }

    Ok(stale_files.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{extractors::ExtractionOutput, storage};
    use std::{fs, path::PathBuf};

    #[test]
    fn given_media_segments_when_replacing_file_content_then_segments_are_persisted() {
        let db_path = temp_db_path("media-segments");
        storage::initialize_database(&db_path).expect("database initialized");
        let conn = storage::open_connection(&db_path).expect("database opened");
        conn.execute(
            "INSERT INTO indexed_roots (id, path, status, sync_status, file_count, created_at, updated_at)
             VALUES (1, '/tmp/root', 'ready', 'watching', 1, 1, 1)",
            [],
        )
        .expect("root inserted");
        conn.execute(
            "INSERT INTO files (id, root_id, path, name, extension, kind, size, modified_at, indexed_at)
             VALUES (1, 1, '/tmp/root/sample.mp3', 'sample.mp3', 'mp3', 'audio', 10, NULL, 1)",
            [],
        )
        .expect("file inserted");

        let output = ExtractionOutput {
            status: "indexed".to_string(),
            extractor: Some("media-segments".to_string()),
            text_length: 0,
            chunks: Vec::new(),
            media_segments: vec![PendingMediaSegment {
                segment_index: 0,
                modality: "audio".to_string(),
                start_ms: 0,
                end_ms: 90_000,
                label: "00:00-01:30".to_string(),
            }],
            error_message: None,
        };

        crate::storage::replace_file_content(&conn, 1, &output, 123).expect("content replaced");

        let segments = fetch_media_segments_for_file(&conn, 1).expect("segments loaded");
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].segment_index, 0);
        assert_eq!(segments[0].label, "00:00-01:30");

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn given_segment_indexed_media_when_syncing_status_then_existing_segments_are_preserved() {
        let db_path = temp_db_path("media-sync-preserve");
        storage::initialize_database(&db_path).expect("database initialized");
        let conn = storage::open_connection(&db_path).expect("database opened");
        conn.execute(
            "INSERT INTO indexed_roots (id, path, status, sync_status, file_count, created_at, updated_at)
             VALUES (1, '/tmp/root', 'ready', 'watching', 1, 1, 1)",
            [],
        )
        .expect("root inserted");
        conn.execute(
            "INSERT INTO files (id, root_id, path, name, extension, kind, size, modified_at, indexed_at)
             VALUES (1, 1, '/tmp/root/sample.mp3', 'sample.mp3', 'mp3', 'audio', 10, NULL, 1)",
            [],
        )
        .expect("file inserted");

        let output = ExtractionOutput {
            status: "indexed".to_string(),
            extractor: Some("media-segments".to_string()),
            text_length: 0,
            chunks: Vec::new(),
            media_segments: vec![PendingMediaSegment {
                segment_index: 0,
                modality: "audio".to_string(),
                start_ms: 0,
                end_ms: 90_000,
                label: "00:00-01:30".to_string(),
            }],
            error_message: None,
        };

        crate::storage::replace_file_content(&conn, 1, &output, 123).expect("content replaced");

        let updated = sync_media_content_status(&conn, 456).expect("sync succeeded");
        assert_eq!(updated, 0);

        let segments = fetch_media_segments_for_file(&conn, 1).expect("segments loaded");
        assert_eq!(segments.len(), 1);

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn given_legacy_media_when_syncing_status_then_file_is_requeued_for_media_segments() {
        let db_path = temp_db_path("media-sync-requeue");
        storage::initialize_database(&db_path).expect("database initialized");
        let conn = storage::open_connection(&db_path).expect("database opened");
        conn.execute(
            "INSERT INTO indexed_roots (id, path, status, sync_status, file_count, created_at, updated_at)
             VALUES (1, '/tmp/root', 'ready', 'watching', 1, 1, 1)",
            [],
        )
        .expect("root inserted");
        conn.execute(
            "INSERT INTO files (id, root_id, path, name, extension, kind, size, modified_at, indexed_at)
             VALUES (1, 1, '/tmp/root/sample.mp3', 'sample.mp3', 'mp3', 'audio', 10, NULL, 1)",
            [],
        )
        .expect("file inserted");

        let output = ExtractionOutput {
            status: "indexed".to_string(),
            extractor: Some("media-segments".to_string()),
            text_length: 0,
            chunks: Vec::new(),
            media_segments: vec![PendingMediaSegment {
                segment_index: 0,
                modality: "audio".to_string(),
                start_ms: 0,
                end_ms: 90_000,
                label: "00:00-01:30".to_string(),
            }],
            error_message: None,
        };

        crate::storage::replace_file_content(&conn, 1, &output, 123).expect("content replaced");
        conn.execute(
            "UPDATE file_extracts SET extractor = 'gemini-audio' WHERE file_id = 1",
            [],
        )
        .expect("legacy extractor set");

        let updated = sync_media_content_status(&conn, 456).expect("sync succeeded");
        assert_eq!(updated, 1);

        let (status, extractor, chunk_count): (String, Option<String>, i64) = conn
            .query_row(
                "SELECT status, extractor, chunk_count FROM file_extracts WHERE file_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("extract row");
        assert_eq!(status, "pending");
        assert_eq!(extractor.as_deref(), Some("media-segments"));
        assert_eq!(chunk_count, 0);

        let segments = fetch_media_segments_for_file(&conn, 1).expect("segments loaded");
        assert!(segments.is_empty());

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn given_legacy_video_segments_when_syncing_status_then_file_is_requeued_for_video_clip_extractor(
    ) {
        let db_path = temp_db_path("media-sync-video-requeue");
        storage::initialize_database(&db_path).expect("database initialized");
        let conn = storage::open_connection(&db_path).expect("database opened");
        conn.execute(
            "INSERT INTO indexed_roots (id, path, status, sync_status, file_count, created_at, updated_at)
             VALUES (1, '/tmp/root', 'ready', 'watching', 1, 1, 1)",
            [],
        )
        .expect("root inserted");
        conn.execute(
            "INSERT INTO files (id, root_id, path, name, extension, kind, size, modified_at, indexed_at)
             VALUES (1, 1, '/tmp/root/sample.mp4', 'sample.mp4', 'mp4', 'video', 10, NULL, 1)",
            [],
        )
        .expect("file inserted");

        let output = ExtractionOutput {
            status: "indexed".to_string(),
            extractor: Some(media::AUDIO_EXTRACTOR_NAME.to_string()),
            text_length: 0,
            chunks: Vec::new(),
            media_segments: vec![PendingMediaSegment {
                segment_index: 0,
                modality: "video".to_string(),
                start_ms: 0,
                end_ms: 30_000,
                label: "00:00-00:30".to_string(),
            }],
            error_message: None,
        };

        crate::storage::replace_file_content(&conn, 1, &output, 123).expect("content replaced");

        let updated = sync_media_content_status(&conn, 456).expect("sync succeeded");
        assert_eq!(updated, 1);

        let (status, extractor): (String, Option<String>) = conn
            .query_row(
                "SELECT status, extractor FROM file_extracts WHERE file_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("extract row");
        assert_eq!(status, "pending");
        assert_eq!(extractor.as_deref(), Some(media::VIDEO_EXTRACTOR_NAME));

        let segments = fetch_media_segments_for_file(&conn, 1).expect("segments loaded");
        assert!(segments.is_empty());

        let _ = fs::remove_file(db_path);
    }

    fn temp_db_path(prefix: &str) -> PathBuf {
        let unique = format!(
            "mira-{prefix}-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("unix timestamp")
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }
}
