use crate::{
    extractors::ExtractionOutput,
    gemini, media,
    models::{SemanticMatch, SemanticMediaSource, SemanticSourceFile},
};
use anyhow::{anyhow, Context, Result};
use arrow_array::{
    Array, FixedSizeListArray, Float32Array, Int64Array, RecordBatch, RecordBatchIterator,
    StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use fastembed::{
    EmbeddingModel, ImageEmbedding, ImageEmbeddingModel, ImageInitOptions, InitOptions,
    TextEmbedding,
};
use futures::TryStreamExt;
use lancedb::{
    connect,
    query::{ExecutableQuery, QueryBase},
    Connection, Table,
};
use once_cell::sync::Lazy;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const TABLE_NAME: &str = "file_embeddings";
pub const LOCAL_MODEL_NAME: &str = "nomic-embed-v1.5";
pub const GEMINI_MODEL_NAME: &str = "gemini-embedding-2-preview";
pub const SEMANTIC_SCHEMA_VERSION: &str = "media-embeddings-v2";
pub const VECTOR_DIMENSIONS: i32 = 768;
const MAX_TEXT_CHARS: usize = 1_600;
pub const SEMANTIC_TEXT_BATCH_SIZE: usize = 96;
pub const SEMANTIC_IMAGE_BATCH_SIZE: usize = 12;
pub const SEMANTIC_MEDIA_BATCH_SIZE: usize = 6;

#[derive(Debug, Clone)]
pub enum SemanticPayload {
    Text(String),
    Image(PathBuf),
    Media { mime_type: String, bytes: Vec<u8> },
}

#[derive(Debug, Clone)]
pub struct SemanticPlan {
    pub status: String,
    pub modality: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SemanticIndexItem {
    pub file_id: i64,
    pub root_id: i64,
    pub kind: String,
    pub modality: String,
    pub summary: Option<String>,
    pub segment_index: Option<i64>,
    pub segment_label: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub payload: SemanticPayload,
}

#[derive(Debug, Clone)]
pub struct IndexedSemanticRecord {
    pub file_id: i64,
    pub status: String,
    pub modality: Option<String>,
    pub model: Option<String>,
    pub summary: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone)]
pub struct SemanticIndexHandle {
    connection: Connection,
    table: Option<Table>,
}

#[derive(Default)]
struct SemanticModels {
    cache_dir: Option<PathBuf>,
    text: Option<TextEmbedding>,
    image: Option<ImageEmbedding>,
}

static MODELS: Lazy<Mutex<SemanticModels>> = Lazy::new(|| Mutex::new(SemanticModels::default()));

pub fn semantic_model_name(provider: &str) -> &'static str {
    match provider {
        "gemini" => GEMINI_MODEL_NAME,
        _ => LOCAL_MODEL_NAME,
    }
}

pub fn prepare_semantic_plan(kind: &str, provider: &str) -> SemanticPlan {
    if kind == "image" {
        return SemanticPlan {
            status: "pending".to_string(),
            modality: Some("image".to_string()),
            summary: Some("Visual features".to_string()),
        };
    }

    if matches!(kind, "document" | "text" | "code") {
        return SemanticPlan {
            status: "pending".to_string(),
            modality: Some("text".to_string()),
            summary: Some("Semantic text preview".to_string()),
        };
    }

    if matches!(kind, media::AUDIO_MODALITY | media::VIDEO_MODALITY) && provider == "gemini" {
        return SemanticPlan {
            status: "pending".to_string(),
            modality: Some(kind.to_string()),
            summary: Some(default_summary_for_kind(kind).to_string()),
        };
    }

    SemanticPlan {
        status: "unsupported".to_string(),
        modality: None,
        summary: None,
    }
}

pub fn open_index_handle(vector_db_path: &Path) -> Result<SemanticIndexHandle> {
    tauri::async_runtime::block_on(async move {
        let connection = connect_to_db(vector_db_path).await?;
        let table = connection.open_table(TABLE_NAME).execute().await.ok();
        Ok::<SemanticIndexHandle, anyhow::Error>(SemanticIndexHandle { connection, table })
    })
}

pub fn index_batch_with_handle(
    handle: &mut SemanticIndexHandle,
    model_cache_dir: &Path,
    items: &[SemanticIndexItem],
    provider: &str,
    api_key: Option<&str>,
) -> Result<Vec<IndexedSemanticRecord>> {
    if items.is_empty() {
        return Ok(Vec::new());
    }

    let model_name = semantic_model_name(provider);
    let mut vectors_by_item = HashMap::<usize, Vec<f32>>::new();

    let text_items = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| match &item.payload {
            SemanticPayload::Text(text) => Some((index, text.clone())),
            SemanticPayload::Image(_) | SemanticPayload::Media { .. } => None,
        })
        .collect::<Vec<_>>();
    if !text_items.is_empty() {
        let inputs: Vec<String> = text_items.iter().map(|(_, t)| t.clone()).collect();
        let embeddings = match provider {
            "gemini" => {
                let key = api_key.ok_or_else(|| anyhow!("Gemini API key is required"))?;
                gemini::embed_texts(key, &inputs, gemini::TaskKind::Document)?
            }
            _ => with_models(model_cache_dir, |models| {
                let model = ensure_text_model(models, model_cache_dir)?;
                model.embed(inputs, None)
            })?,
        };

        for ((item_index, _), embedding) in text_items.into_iter().zip(embeddings) {
            validate_dimensions(&embedding)?;
            vectors_by_item.insert(item_index, embedding);
        }
    }

    let image_items = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| match &item.payload {
            SemanticPayload::Image(path) => Some((index, path.clone())),
            SemanticPayload::Text(_) | SemanticPayload::Media { .. } => None,
        })
        .collect::<Vec<_>>();
    if !image_items.is_empty() {
        match provider {
            "gemini" => {
                let key = api_key.ok_or_else(|| anyhow!("Gemini API key is required"))?;
                let paths: Vec<PathBuf> = image_items.iter().map(|(_, p)| p.clone()).collect();
                let embeddings = gemini::embed_images(key, &paths)?;
                for ((item_index, _), embedding) in image_items.into_iter().zip(embeddings) {
                    if !embedding.is_empty() {
                        validate_dimensions(&embedding)?;
                        vectors_by_item.insert(item_index, embedding);
                    }
                }
            }
            _ => {
                let embeddings = with_models(model_cache_dir, |models| {
                    let model = ensure_image_model(models, model_cache_dir)?;
                    let inputs = image_items
                        .iter()
                        .map(|(_, path)| path.to_string_lossy().into_owned())
                        .collect::<Vec<_>>();
                    model.embed(inputs, None)
                })?;

                for ((item_index, _), embedding) in image_items.into_iter().zip(embeddings) {
                    validate_dimensions(&embedding)?;
                    vectors_by_item.insert(item_index, embedding);
                }
            }
        }
    }

    let media_items = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| match &item.payload {
            SemanticPayload::Media { mime_type, bytes } => Some((
                index,
                mime_type.clone(),
                bytes.clone(),
                item.modality.clone(),
            )),
            SemanticPayload::Text(_) | SemanticPayload::Image(_) => None,
        })
        .collect::<Vec<_>>();
    if !media_items.is_empty() {
        let key = api_key.ok_or_else(|| anyhow!("Gemini API key is required"))?;
        for (item_index, mime_type, bytes, modality) in media_items {
            let embedding = match modality.as_str() {
                media::AUDIO_MODALITY => {
                    gemini::embed_media_bytes(key, &mime_type, &bytes, "audio")?
                }
                media::VIDEO_MODALITY => {
                    gemini::embed_media_bytes(key, &mime_type, &bytes, "video")?
                }
                _ => continue,
            };
            validate_dimensions(&embedding)?;
            vectors_by_item.insert(item_index, embedding);
        }
    }

    let enriched_items = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            vectors_by_item.get(&index).map(|vector| IndexedRow {
                file_id: item.file_id,
                root_id: item.root_id,
                kind: item.kind.clone(),
                modality: item.modality.clone(),
                summary: item
                    .summary
                    .clone()
                    .unwrap_or_else(|| item.modality.clone()),
                segment_index: item.segment_index,
                segment_label: item.segment_label.clone(),
                start_ms: item.start_ms,
                end_ms: item.end_ms,
                vector: vector.clone(),
            })
        })
        .collect::<Vec<_>>();

    tauri::async_runtime::block_on(async {
        handle.upsert_rows(&enriched_items).await?;
        Ok::<(), anyhow::Error>(())
    })?;

    let mut records_by_file = HashMap::<i64, IndexedSemanticRecord>::new();
    for (index, item) in items.iter().enumerate() {
        let next_record = if vectors_by_item.contains_key(&index) {
            IndexedSemanticRecord {
                file_id: item.file_id,
                status: "indexed".to_string(),
                modality: Some(item.modality.clone()),
                model: Some(model_name.to_string()),
                summary: item.summary.clone(),
                error_message: None,
            }
        } else {
            IndexedSemanticRecord {
                file_id: item.file_id,
                status: "error".to_string(),
                modality: Some(item.modality.clone()),
                model: Some(model_name.to_string()),
                summary: item.summary.clone(),
                error_message: Some("embedding was not generated".to_string()),
            }
        };

        records_by_file
            .entry(item.file_id)
            .and_modify(|record| {
                if next_record.status == "indexed" {
                    *record = next_record.clone();
                }
            })
            .or_insert(next_record);
    }

    Ok(records_by_file.into_values().collect())
}

pub fn build_index_item(source: &SemanticSourceFile) -> Option<SemanticIndexItem> {
    if source.kind == "image" {
        return Some(SemanticIndexItem {
            file_id: source.file_id,
            root_id: source.root_id,
            kind: source.kind.clone(),
            modality: "image".to_string(),
            summary: source
                .summary
                .clone()
                .or_else(|| Some("Visual features".to_string())),
            segment_index: None,
            segment_label: None,
            start_ms: None,
            end_ms: None,
            payload: SemanticPayload::Image(PathBuf::from(&source.path)),
        });
    }

    if matches!(source.kind.as_str(), "document" | "text" | "code") {
        let text = source.content_text.as_ref()?.trim();
        if text.is_empty() {
            return None;
        }

        return Some(SemanticIndexItem {
            file_id: source.file_id,
            root_id: source.root_id,
            kind: source.kind.clone(),
            modality: "text".to_string(),
            summary: source
                .summary
                .clone()
                .or_else(|| Some("Semantic text preview".to_string())),
            segment_index: None,
            segment_label: None,
            start_ms: None,
            end_ms: None,
            payload: SemanticPayload::Text(truncate_chars(text, MAX_TEXT_CHARS)),
        });
    }

    None
}

pub fn build_index_item_for_file(
    file_id: i64,
    root_id: i64,
    path: &Path,
    kind: &str,
    content: Option<&ExtractionOutput>,
) -> Option<SemanticIndexItem> {
    let summary = content
        .and_then(|output| output.chunks.first())
        .and_then(|chunk| chunk.source_label.clone())
        .or_else(|| Some(default_summary_for_kind(kind).to_string()));

    let content_text = content.and_then(|output| {
        let text = output
            .chunks
            .iter()
            .take(6)
            .map(|chunk| chunk.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    });

    let source = SemanticSourceFile {
        file_id,
        root_id,
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        summary,
        content_text,
    };

    build_index_item(&source)
}

pub fn build_media_index_items(sources: &[SemanticMediaSource]) -> Result<Vec<SemanticIndexItem>> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }

    let mut grouped = HashMap::<i64, Vec<&SemanticMediaSource>>::new();
    for source in sources {
        grouped.entry(source.file_id).or_default().push(source);
    }

    let mut items = Vec::new();
    for file_sources in grouped.into_values() {
        let first = file_sources[0];
        match first.modality.as_str() {
            media::AUDIO_MODALITY => {
                let prepared_segments =
                    media::prepare_media_segments(Path::new(&first.path), &first.modality)
                        .with_context(|| format!("failed to prepare media file {}", first.path))?;
                let persisted_by_segment = file_sources
                    .into_iter()
                    .map(|source| (source.segment_index, source))
                    .collect::<HashMap<_, _>>();

                for prepared in prepared_segments {
                    let Some(persisted) = persisted_by_segment.get(&prepared.window.segment_index)
                    else {
                        continue;
                    };

                    items.push(SemanticIndexItem {
                        file_id: persisted.file_id,
                        root_id: persisted.root_id,
                        kind: persisted.kind.clone(),
                        modality: persisted.modality.clone(),
                        summary: Some(persisted.label.clone()),
                        segment_index: Some(persisted.segment_index),
                        segment_label: Some(persisted.label.clone()),
                        start_ms: Some(persisted.start_ms),
                        end_ms: Some(persisted.end_ms),
                        payload: SemanticPayload::Media {
                            mime_type: prepared.mime_type,
                            bytes: prepared.bytes,
                        },
                    });
                }
            }
            media::VIDEO_MODALITY => {
                for persisted in file_sources {
                    let window = media::MediaSegmentWindow {
                        segment_index: persisted.segment_index,
                        modality: persisted.modality.clone(),
                        start_ms: persisted.start_ms,
                        end_ms: persisted.end_ms,
                        label: persisted.label.clone(),
                    };
                    let prepared =
                        media::prepare_media_segment(Path::new(&persisted.path), &window)
                            .with_context(|| {
                                format!(
                                    "failed to prepare video segment {} for {}",
                                    persisted.label, persisted.path
                                )
                            })?;

                    items.push(SemanticIndexItem {
                        file_id: persisted.file_id,
                        root_id: persisted.root_id,
                        kind: persisted.kind.clone(),
                        modality: persisted.modality.clone(),
                        summary: Some(persisted.label.clone()),
                        segment_index: Some(persisted.segment_index),
                        segment_label: Some(persisted.label.clone()),
                        start_ms: Some(persisted.start_ms),
                        end_ms: Some(persisted.end_ms),
                        payload: SemanticPayload::Media {
                            mime_type: prepared.mime_type,
                            bytes: prepared.bytes,
                        },
                    });
                }
            }
            _ => continue,
        }
    }

    Ok(items)
}

pub fn drop_embeddings_table(vector_db_path: &Path) -> Result<()> {
    tauri::async_runtime::block_on(async move {
        let connection = connect_to_db(vector_db_path).await?;
        let _ = connection.drop_table(TABLE_NAME, &[]).await;
        Ok::<(), anyhow::Error>(())
    })
}

pub fn remove_root_embeddings(vector_db_path: &Path, root_id: i64) -> Result<()> {
    tauri::async_runtime::block_on(async move {
        let connection = connect_to_db(vector_db_path).await?;
        if let Ok(table) = connection.open_table(TABLE_NAME).execute().await {
            let filter = format!("root_id = {root_id}");
            table.delete(&filter).await.map_err(anyhow::Error::from)?;
        }
        Ok::<(), anyhow::Error>(())
    })
}

pub fn remove_embeddings_for_files(vector_db_path: &Path, file_ids: &[i64]) -> Result<()> {
    if file_ids.is_empty() {
        return Ok(());
    }

    tauri::async_runtime::block_on(async move {
        let connection = connect_to_db(vector_db_path).await?;
        if let Ok(table) = connection.open_table(TABLE_NAME).execute().await {
            for chunk in file_ids.chunks(200) {
                let filter = format!(
                    "file_id IN ({})",
                    chunk
                        .iter()
                        .map(|file_id| file_id.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                table.delete(&filter).await.map_err(anyhow::Error::from)?;
            }
        }
        Ok::<(), anyhow::Error>(())
    })
}

pub fn search_semantic(
    vector_db_path: &Path,
    model_cache_dir: &Path,
    query: &str,
    root_ids: Option<&[i64]>,
    limit: usize,
    provider: &str,
    api_key: Option<&str>,
) -> Result<Vec<SemanticMatch>> {
    let query_embedding = match provider {
        "gemini" => {
            let key = api_key.ok_or_else(|| anyhow!("Gemini API key is required"))?;
            let mut embeddings =
                gemini::embed_texts(key, &[query.to_string()], gemini::TaskKind::Query)?;
            embeddings
                .pop()
                .ok_or_else(|| anyhow!("Gemini returned no query embedding"))?
        }
        _ => with_models(model_cache_dir, |models| {
            let model = ensure_text_model(models, model_cache_dir)?;
            let mut embeddings = model.embed(vec![query.to_string()], None)?;
            embeddings
                .pop()
                .ok_or_else(|| anyhow!("semantic model returned no query embedding"))
        })?,
    };
    validate_dimensions(&query_embedding)?;

    let allowed_roots = root_ids
        .map(|ids| ids.iter().copied().collect::<HashSet<_>>())
        .unwrap_or_default();

    tauri::async_runtime::block_on(async move {
        let connection = connect_to_db(vector_db_path).await?;
        let table = match connection.open_table(TABLE_NAME).execute().await {
            Ok(table) => table,
            Err(_) => return Ok(Vec::new()),
        };

        let batches: Vec<RecordBatch> = table
            .query()
            .nearest_to(query_embedding.as_slice())?
            .limit(limit.max(8) * 6)
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut matches = Vec::new();
        let mut seen = HashSet::new();

        for batch in batches {
            let file_ids = batch
                .column_by_name("file_id")
                .and_then(|column| as_int64_array(column.as_ref()))
                .ok_or_else(|| anyhow!("semantic results missing file_id column"))?;
            let root_ids_array = batch
                .column_by_name("root_id")
                .and_then(|column| as_int64_array(column.as_ref()))
                .ok_or_else(|| anyhow!("semantic results missing root_id column"))?;
            let modalities = batch
                .column_by_name("modality")
                .and_then(|column| as_string_array(column.as_ref()))
                .ok_or_else(|| anyhow!("semantic results missing modality column"))?;
            let summaries = batch
                .column_by_name("summary")
                .and_then(|column| as_string_array(column.as_ref()))
                .ok_or_else(|| anyhow!("semantic results missing summary column"))?;
            let labels = batch
                .column_by_name("segment_label")
                .and_then(|column| as_string_array(column.as_ref()));
            let start_ms = batch
                .column_by_name("start_ms")
                .and_then(|column| as_int64_array(column.as_ref()));
            let end_ms = batch
                .column_by_name("end_ms")
                .and_then(|column| as_int64_array(column.as_ref()));
            let distances = batch
                .column_by_name("_distance")
                .and_then(|column| as_float32_array(column.as_ref()))
                .ok_or_else(|| anyhow!("semantic results missing distance column"))?;

            for row in 0..batch.num_rows() {
                let file_id = file_ids.value(row);
                let root_id = root_ids_array.value(row);
                if !allowed_roots.is_empty() && !allowed_roots.contains(&root_id) {
                    continue;
                }
                if !seen.insert(file_id) {
                    continue;
                }

                let distance = distances.value(row);
                matches.push(SemanticMatch {
                    file_id,
                    modality: modalities.value(row).to_string(),
                    similarity: 1.0 / (1.0 + distance),
                    summary: value_at_string(summaries, row),
                    segment_label: labels.and_then(|column| value_at_string(column, row)),
                    segment_start_ms: start_ms.and_then(|column| value_at_int64(column, row)),
                    segment_end_ms: end_ms.and_then(|column| value_at_int64(column, row)),
                });

                if matches.len() >= limit {
                    return Ok(matches);
                }
            }
        }

        Ok(matches)
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingDiagnostics {
    pub total_vectors: usize,
    pub text_vectors: usize,
    pub image_vectors: usize,
    pub audio_vectors: usize,
    pub video_vectors: usize,
    pub other_vectors: usize,
    pub sample_entries: Vec<EmbeddingDiagEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingDiagEntry {
    pub file_id: i64,
    pub modality: String,
    pub kind: String,
    pub summary: String,
}

use serde::Serialize;

pub fn diagnose_embeddings(vector_db_path: &Path) -> Result<EmbeddingDiagnostics> {
    tauri::async_runtime::block_on(async move {
        let connection = connect_to_db(vector_db_path).await?;
        let table = match connection.open_table(TABLE_NAME).execute().await {
            Ok(table) => table,
            Err(_) => {
                return Ok(EmbeddingDiagnostics {
                    total_vectors: 0,
                    text_vectors: 0,
                    image_vectors: 0,
                    audio_vectors: 0,
                    video_vectors: 0,
                    other_vectors: 0,
                    sample_entries: Vec::new(),
                });
            }
        };

        let batches: Vec<RecordBatch> = table
            .query()
            .select(lancedb::query::Select::Columns(vec![
                "file_id".to_string(),
                "modality".to_string(),
                "kind".to_string(),
                "summary".to_string(),
            ]))
            .execute()
            .await?
            .try_collect::<Vec<_>>()
            .await?;

        let mut total = 0usize;
        let mut text_count = 0usize;
        let mut image_count = 0usize;
        let mut audio_count = 0usize;
        let mut video_count = 0usize;
        let mut other_count = 0usize;
        let mut samples = Vec::new();

        for batch in &batches {
            let file_ids = batch
                .column_by_name("file_id")
                .and_then(|c| as_int64_array(c.as_ref()));
            let modalities = batch
                .column_by_name("modality")
                .and_then(|c| as_string_array(c.as_ref()));
            let kinds = batch
                .column_by_name("kind")
                .and_then(|c| as_string_array(c.as_ref()));
            let summaries = batch
                .column_by_name("summary")
                .and_then(|c| as_string_array(c.as_ref()));

            let (Some(file_ids), Some(modalities), Some(kinds), Some(summaries)) =
                (file_ids, modalities, kinds, summaries)
            else {
                continue;
            };

            for row in 0..batch.num_rows() {
                total += 1;
                let modality = modalities.value(row);
                match modality {
                    "text" => text_count += 1,
                    "image" => image_count += 1,
                    "audio" => audio_count += 1,
                    "video" => video_count += 1,
                    _ => other_count += 1,
                }
                if samples.len() < 50 {
                    samples.push(EmbeddingDiagEntry {
                        file_id: file_ids.value(row),
                        modality: modality.to_string(),
                        kind: kinds.value(row).to_string(),
                        summary: summaries.value(row).to_string(),
                    });
                }
            }
        }

        Ok(EmbeddingDiagnostics {
            total_vectors: total,
            text_vectors: text_count,
            image_vectors: image_count,
            audio_vectors: audio_count,
            video_vectors: video_count,
            other_vectors: other_count,
            sample_entries: samples,
        })
    })
}

#[derive(Debug, Clone)]
struct IndexedRow {
    file_id: i64,
    root_id: i64,
    kind: String,
    modality: String,
    summary: String,
    segment_index: Option<i64>,
    segment_label: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    vector: Vec<f32>,
}

fn with_models<T>(
    model_cache_dir: &Path,
    run: impl FnOnce(&mut SemanticModels) -> Result<T>,
) -> Result<T> {
    let mut guard = MODELS
        .lock()
        .map_err(|_| anyhow!("semantic model lock was poisoned"))?;

    if guard.cache_dir.as_deref() != Some(model_cache_dir) {
        *guard = SemanticModels {
            cache_dir: Some(model_cache_dir.to_path_buf()),
            text: None,
            image: None,
        };
    }

    run(&mut guard)
}

fn ensure_text_model<'a>(
    models: &'a mut SemanticModels,
    model_cache_dir: &Path,
) -> Result<&'a mut TextEmbedding> {
    if models.text.is_none() {
        models.text = Some(
            TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::NomicEmbedTextV15)
                    .with_cache_dir(model_cache_dir.to_path_buf())
                    .with_show_download_progress(false),
            )
            .context("failed to initialize Nomic text embedding model")?,
        );
    }

    models
        .text
        .as_mut()
        .ok_or_else(|| anyhow!("semantic text model is unavailable"))
}

fn ensure_image_model<'a>(
    models: &'a mut SemanticModels,
    model_cache_dir: &Path,
) -> Result<&'a mut ImageEmbedding> {
    if models.image.is_none() {
        models.image = Some(
            ImageEmbedding::try_new(
                ImageInitOptions::new(ImageEmbeddingModel::NomicEmbedVisionV15)
                    .with_cache_dir(model_cache_dir.to_path_buf())
                    .with_show_download_progress(false),
            )
            .context("failed to initialize Nomic vision embedding model")?,
        );
    }

    models
        .image
        .as_mut()
        .ok_or_else(|| anyhow!("semantic image model is unavailable"))
}

async fn connect_to_db(vector_db_path: &Path) -> Result<Connection> {
    connect(vector_db_path.to_string_lossy().as_ref())
        .execute()
        .await
        .map_err(Into::into)
}

impl SemanticIndexHandle {
    async fn upsert_rows(&mut self, items: &[IndexedRow]) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }

        let table = self.ensure_table(items).await?;
        let batch = build_record_batch(items)?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        table.add(reader).execute().await?;
        Ok(())
    }

    async fn ensure_table(&mut self, seed_items: &[IndexedRow]) -> Result<Table> {
        if let Some(table) = &self.table {
            return Ok(table.clone());
        }

        let batch = build_record_batch(seed_items)?;
        let schema = batch.schema();
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        let table = self
            .connection
            .create_table(TABLE_NAME, reader)
            .execute()
            .await?;
        self.table = Some(table.clone());
        Ok(table)
    }
}

fn build_record_batch(items: &[IndexedRow]) -> Result<RecordBatch> {
    let schema = Arc::new(Schema::new(vec![
        Field::new("file_id", DataType::Int64, false),
        Field::new("root_id", DataType::Int64, false),
        Field::new("kind", DataType::Utf8, false),
        Field::new("modality", DataType::Utf8, false),
        Field::new("summary", DataType::Utf8, false),
        Field::new("segment_index", DataType::Int64, true),
        Field::new("segment_label", DataType::Utf8, true),
        Field::new("start_ms", DataType::Int64, true),
        Field::new("end_ms", DataType::Int64, true),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                VECTOR_DIMENSIONS,
            ),
            false,
        ),
    ]));

    let file_ids = Int64Array::from(items.iter().map(|item| item.file_id).collect::<Vec<_>>());
    let root_ids = Int64Array::from(items.iter().map(|item| item.root_id).collect::<Vec<_>>());
    let kinds = StringArray::from(
        items
            .iter()
            .map(|item| item.kind.as_str())
            .collect::<Vec<_>>(),
    );
    let modalities = StringArray::from(
        items
            .iter()
            .map(|item| item.modality.as_str())
            .collect::<Vec<_>>(),
    );
    let summaries = StringArray::from(
        items
            .iter()
            .map(|item| item.summary.as_str())
            .collect::<Vec<_>>(),
    );
    let segment_indices = Int64Array::from(
        items
            .iter()
            .map(|item| item.segment_index)
            .collect::<Vec<_>>(),
    );
    let labels = StringArray::from(
        items
            .iter()
            .map(|item| item.segment_label.as_deref())
            .collect::<Vec<_>>(),
    );
    let start_ms = Int64Array::from(items.iter().map(|item| item.start_ms).collect::<Vec<_>>());
    let end_ms = Int64Array::from(items.iter().map(|item| item.end_ms).collect::<Vec<_>>());
    let vectors = FixedSizeListArray::from_iter_primitive::<arrow_array::types::Float32Type, _, _>(
        items
            .iter()
            .map(|item| Some(item.vector.iter().copied().map(Some))),
        VECTOR_DIMENSIONS,
    );

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(file_ids),
            Arc::new(root_ids),
            Arc::new(kinds),
            Arc::new(modalities),
            Arc::new(summaries),
            Arc::new(segment_indices),
            Arc::new(labels),
            Arc::new(start_ms),
            Arc::new(end_ms),
            Arc::new(vectors),
        ],
    )
    .map_err(Into::into)
}

fn validate_dimensions(embedding: &[f32]) -> Result<()> {
    if embedding.len() != VECTOR_DIMENSIONS as usize {
        return Err(anyhow!(
            "semantic embedding dimension mismatch: expected {}, got {}",
            VECTOR_DIMENSIONS,
            embedding.len()
        ));
    }
    Ok(())
}

fn default_summary_for_kind(kind: &str) -> &'static str {
    match kind {
        "image" => "Visual features",
        "document" | "text" | "code" => "Semantic text preview",
        "audio" => "Audio segments",
        "video" => "Video segments",
        _ => "Semantic preview",
    }
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }

    let mut truncated = text.chars().take(limit).collect::<String>();
    truncated.push('…');
    truncated
}

fn as_int64_array(column: &dyn Array) -> Option<&Int64Array> {
    column.as_any().downcast_ref::<Int64Array>()
}

fn as_string_array(column: &dyn Array) -> Option<&StringArray> {
    column.as_any().downcast_ref::<StringArray>()
}

fn as_float32_array(column: &dyn Array) -> Option<&Float32Array> {
    column.as_any().downcast_ref::<Float32Array>()
}

fn value_at_int64(column: &Int64Array, row: usize) -> Option<i64> {
    (!column.is_null(row)).then(|| column.value(row))
}

fn value_at_string(column: &StringArray, row: usize) -> Option<String> {
    (!column.is_null(row)).then(|| column.value(row).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_media_row_when_building_record_batch_then_segment_metadata_is_preserved() {
        let batch = build_record_batch(&[IndexedRow {
            file_id: 11,
            root_id: 2,
            kind: "audio".to_string(),
            modality: "audio".to_string(),
            summary: "Audio summary".to_string(),
            segment_index: Some(3),
            segment_label: Some("03:45-05:15".to_string()),
            start_ms: Some(225_000),
            end_ms: Some(315_000),
            vector: vec![0.5; VECTOR_DIMENSIONS as usize],
        }])
        .expect("record batch");

        let labels = batch
            .column_by_name("segment_label")
            .and_then(|column| as_string_array(column.as_ref()))
            .expect("segment labels");
        let start_ms = batch
            .column_by_name("start_ms")
            .and_then(|column| as_int64_array(column.as_ref()))
            .expect("segment start");

        assert_eq!(labels.value(0), "03:45-05:15");
        assert_eq!(start_ms.value(0), 225_000);
    }
}
