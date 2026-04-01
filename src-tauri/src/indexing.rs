use crate::{extractors, storage, utils::unix_timestamp};
use anyhow::{anyhow, Context, Result};
use rayon::prelude::*;
use std::{
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

const PROGRESS_UPDATE_EVERY: u64 = 25;
const EXTRACTION_BATCH_SIZE: usize = 8;

struct PreparedFile {
    path: PathBuf,
    indexed_at: i64,
    content: extractors::ExtractionOutput,
}

pub fn normalize_root_path(path: &str) -> Result<String> {
    let input = PathBuf::from(path);
    let canonical = fs::canonicalize(&input)
        .with_context(|| format!("failed to open folder {}", input.display()))?;
    if !canonical.is_dir() {
        return Err(anyhow!("selected path is not a folder"));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

pub fn spawn_index_job(db_path: PathBuf, root_id: i64, job_id: i64, root_path: String) {
    std::thread::spawn(move || {
        if let Err(error) = run_index_job(&db_path, root_id, job_id, &root_path) {
            let _ = storage::mark_job_failed(&db_path, root_id, job_id, &error.to_string());
        }
    });
}

pub fn run_index_job(db_path: &Path, root_id: i64, job_id: i64, root_path: &str) -> Result<()> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err(anyhow!("folder does not exist anymore"));
    }

    let files = collect_files(&root)?;
    let total = files.len() as u64;
    storage::update_job_progress(db_path, root_id, job_id, 0, total, None)?;

    let mut conn = storage::open_connection(db_path)?;
    {
        let tx = conn.transaction()?;
        storage::clear_content_for_root(&tx, root_id)?;
        storage::delete_files_for_root(&tx, root_id)?;
        tx.commit()?;
    }

    let mut processed = 0_u64;
    let mut last_error: Option<String> = None;

    for batch in files.chunks(EXTRACTION_BATCH_SIZE) {
        let prepared_batch = batch
            .par_iter()
            .map(|path| prepare_file(path))
            .collect::<Vec<_>>();

        let tx = conn.transaction()?;
        for prepared in &prepared_batch {
            match storage::index_file(&tx, root_id, &prepared.path, prepared.indexed_at) {
                Ok(stored_file) => {
                    if let Err(error) = storage::replace_file_content(
                        &tx,
                        stored_file.file_id,
                        &prepared.content,
                        prepared.indexed_at,
                    ) {
                        last_error = Some(error.to_string());
                    }
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                }
            }
        }
        tx.commit()?;

        processed += prepared_batch.len() as u64;
        let should_update_progress =
            processed % PROGRESS_UPDATE_EVERY <= prepared_batch.len() as u64 || processed == total;
        if should_update_progress {
            let current_path = prepared_batch
                .last()
                .map(|prepared| prepared.path.to_string_lossy().into_owned());
            storage::update_job_progress(db_path, root_id, job_id, processed, total, current_path)?;
        }
    }

    storage::update_root_ready(&conn, root_id, job_id, processed, total, last_error)?;
    Ok(())
}

pub fn classify_kind(extension: &str) -> &'static str {
    match extension {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "bmp" | "tiff" => "image",
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" | "rtf" | "pages" => "document",
        "md" | "txt" | "json" | "csv" | "log" | "yaml" | "yml" | "toml" | "xml" => "text",
        "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "go" | "java" | "rb" | "css" | "html"
        | "sql" | "sh" => "code",
        "zip" | "tar" | "gz" | "rar" | "7z" => "archive",
        "mp3" | "wav" | "aac" | "m4a" | "flac" => "audio",
        "mp4" | "mov" | "mkv" | "avi" | "webm" => "video",
        _ => "other",
    }
}

fn prepare_file(path: &Path) -> PreparedFile {
    let indexed_at = unix_timestamp();
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());
    let kind = classify_kind(&extension);
    let content = extractors::extract_file_text(path, kind, &extension);

    PreparedFile {
        path: path.to_path_buf(),
        indexed_at,
        content,
    }
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !is_ignored(entry.path()))
    {
        match entry {
            Ok(entry) if entry.file_type().is_file() => files.push(entry.into_path()),
            Ok(_) => {}
            Err(error) => return Err(error.into()),
        }
    }

    Ok(files)
}

fn is_ignored(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| matches!(name, ".git" | "node_modules" | "target" | ".DS_Store"))
        .unwrap_or(false)
}
