use anyhow::{anyhow, Context, Result};
use once_cell::sync::Lazy;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, sync::Mutex, thread, time::Duration};

use crate::semantic::VECTOR_DIMENSIONS;

pub const GEMINI_EMBED_MODEL: &str = "gemini-embedding-2-preview";
pub const GEMINI_QUERY_KIND_MODEL: &str = "gemini-2.5-flash-lite";

const EMBED_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent";
const BATCH_EMBED_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents";
const GENERATE_URL_PREFIX: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_BATCH_SIZE: usize = 100;
const MAX_RETRY_ATTEMPTS: usize = 4;
const BASE_BACKOFF_SECS: f64 = 2.0;
const MAX_BACKOFF_SECS: f64 = 60.0;
const QUERY_KIND_CACHE_LIMIT: usize = 256;

static QUERY_KIND_CACHE: Lazy<Mutex<HashMap<String, QueryKindIntent>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Task kind controls how text is prefixed for gemini-embedding-2-preview.
/// The model does NOT accept a `taskType` field; instead the task goes into
/// the text itself as a structured prefix.
#[derive(Clone, Copy)]
pub enum TaskKind {
    Document,
    Query,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QueryKindIntent {
    pub kind: String,
    pub confidence: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GeminiErrorKind {
    Quota,
    RateLimited,
    Temporary,
    Other,
}

#[derive(Serialize)]
struct EmbedRequest {
    content: ContentBody,
    output_dimensionality: i32,
}

#[derive(Serialize)]
struct ContentBody {
    parts: Vec<ContentPart>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ContentPart {
    Text { text: String },
    InlineData { inline_data: InlineData },
}

#[derive(Serialize)]
struct InlineData {
    mime_type: String,
    data: String,
}

#[derive(Serialize)]
struct BatchEmbedRequest {
    requests: Vec<BatchRequestItem>,
}

#[derive(Serialize)]
struct BatchRequestItem {
    model: String,
    content: ContentBody,
    output_dimensionality: i32,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embedding: Option<EmbeddingValues>,
}

#[derive(Deserialize)]
struct EmbeddingValues {
    values: Vec<f32>,
}

#[derive(Deserialize)]
struct BatchEmbedResponse {
    embeddings: Option<Vec<EmbeddingValues>>,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    candidates: Option<Vec<GenerateCandidate>>,
}

#[derive(Deserialize)]
struct GenerateCandidate {
    content: Option<GeneratedContent>,
}

#[derive(Deserialize)]
struct GeneratedContent {
    parts: Option<Vec<GeneratedPart>>,
}

#[derive(Deserialize)]
struct GeneratedPart {
    text: Option<String>,
}

/// Format raw text with the task prefix required by gemini-embedding-2-preview.
fn prefixed_text(raw: &str, task: TaskKind) -> String {
    match task {
        TaskKind::Document => format!("title: none | text: {raw}"),
        TaskKind::Query => format!("task: search result | query: {raw}"),
    }
}

pub fn embed_texts(api_key: &str, texts: &[String], task: TaskKind) -> Result<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    if texts.len() == 1 {
        return embed_single(api_key, &texts[0], task).map(|v| vec![v]);
    }

    let mut all_embeddings = Vec::with_capacity(texts.len());
    for chunk in texts.chunks(MAX_BATCH_SIZE) {
        let batch = embed_batch(api_key, chunk, task)?;
        all_embeddings.extend(batch);
    }
    Ok(all_embeddings)
}

pub fn classify_query_kind(api_key: &str, query: &str) -> Result<QueryKindIntent> {
    let normalized = query.trim().to_lowercase();
    if normalized.is_empty() {
        eprintln!("[intent] skip empty query");
        return Ok(QueryKindIntent {
            kind: "other".to_string(),
            confidence: 0,
        });
    }

    if let Ok(cache) = QUERY_KIND_CACHE.lock() {
        if let Some(cached) = cache.get(&normalized) {
            eprintln!(
                "[intent] cache hit model={} query={:?} kind={} confidence={}",
                GEMINI_QUERY_KIND_MODEL, normalized, cached.kind, cached.confidence
            );
            return Ok(cached.clone());
        }
    }

    eprintln!(
        "[intent] classify start model={} query={:?}",
        GEMINI_QUERY_KIND_MODEL, normalized
    );

    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["document", "image", "text", "code", "audio", "video", "other"],
                "description": "The single best matching result kind for this search query."
            },
            "confidence": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": "Confidence from 0 to 100. Use a low score when the query is ambiguous."
            }
        },
        "required": ["kind", "confidence"],
        "propertyOrdering": ["kind", "confidence"]
    });

    let prompt = format!(
        "Classify the user's desktop file search query into exactly one result kind.\n\
Kinds:\n\
- document: PDFs, slides, spreadsheets, office docs, rich documents.\n\
- image: photos, screenshots, graphics, scans, diagrams.\n\
- text: plain text, markdown, logs, config/data text files.\n\
- code: source code or developer project files.\n\
- audio: spoken audio, podcasts, interviews, voice notes, songs, or recordings.\n\
- video: videos or movies when the user is clearly asking for moving image content.\n\
- other: archives or no clear preferred kind.\n\
Return 'other' when the query does not clearly imply a preferred kind.\n\
Query: {normalized}"
    );

    let body = serde_json::json!({
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 32,
            "responseMimeType": "application/json",
            "responseJsonSchema": schema
        }
    });

    let url = format!("{GENERATE_URL_PREFIX}/{GEMINI_QUERY_KIND_MODEL}:generateContent");
    let response: GenerateContentResponse = serde_json::from_value(post_json_with_retries(
        &url,
        &body,
        Some(("x-goog-api-key", api_key)),
        "query classification",
    )?)
    .context("failed to parse Gemini query intent response")?;

    let payload = response
        .candidates
        .and_then(|candidates| candidates.into_iter().next())
        .and_then(|candidate| candidate.content)
        .and_then(|content| content.parts)
        .and_then(|parts| parts.into_iter().find_map(|part| part.text))
        .ok_or_else(|| anyhow!("Gemini returned no query intent payload"))?;

    let mut intent: QueryKindIntent =
        serde_json::from_str(&payload).context("failed to parse Gemini query intent JSON")?;
    if !matches!(
        intent.kind.as_str(),
        "document" | "image" | "text" | "code" | "audio" | "video" | "other"
    ) {
        return Err(anyhow!("Gemini returned unsupported query kind"));
    }
    intent.confidence = intent.confidence.min(100);

    if let Ok(mut cache) = QUERY_KIND_CACHE.lock() {
        if cache.len() >= QUERY_KIND_CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(normalized, intent.clone());
    }

    eprintln!(
        "[intent] classify success model={} kind={} confidence={}",
        GEMINI_QUERY_KIND_MODEL, intent.kind, intent.confidence
    );

    Ok(intent)
}

fn embed_single(api_key: &str, text: &str, task: TaskKind) -> Result<Vec<f32>> {
    let body = EmbedRequest {
        content: ContentBody {
            parts: vec![ContentPart::Text {
                text: prefixed_text(text, task),
            }],
        },
        output_dimensionality: VECTOR_DIMENSIONS,
    };

    let url = format!("{EMBED_URL}?key={api_key}");
    let response = post_json_with_retries(&url, &body, None, "semantic text embeddings")?;

    let parsed: EmbedResponse =
        serde_json::from_value(response).context("unexpected Gemini response format")?;
    parsed
        .embedding
        .map(|e| e.values)
        .ok_or_else(|| anyhow!("Gemini returned no embedding"))
}

fn embed_batch(api_key: &str, texts: &[String], task: TaskKind) -> Result<Vec<Vec<f32>>> {
    let requests: Vec<BatchRequestItem> = texts
        .iter()
        .map(|text| BatchRequestItem {
            model: format!("models/{GEMINI_EMBED_MODEL}"),
            content: ContentBody {
                parts: vec![ContentPart::Text {
                    text: prefixed_text(text, task),
                }],
            },
            output_dimensionality: VECTOR_DIMENSIONS,
        })
        .collect();

    let body = BatchEmbedRequest { requests };

    let url = format!("{BATCH_EMBED_URL}?key={api_key}");
    let response = post_json_with_retries(&url, &body, None, "semantic text embeddings")?;

    let parsed: BatchEmbedResponse =
        serde_json::from_value(response).context("unexpected Gemini batch response format")?;
    let embeddings = parsed
        .embeddings
        .ok_or_else(|| anyhow!("Gemini batch returned no embeddings"))?;

    Ok(embeddings.into_iter().map(|e| e.values).collect())
}

pub fn embed_images(api_key: &str, paths: &[std::path::PathBuf]) -> Result<Vec<Vec<f32>>> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut embeddings = Vec::with_capacity(paths.len());
    for path in paths {
        match embed_single_image(api_key, path) {
            Ok(embedding) => embeddings.push(embedding),
            Err(e) => {
                eprintln!("Gemini image embed failed for {}: {e}", path.display());
                embeddings.push(Vec::new());
            }
        }
    }
    Ok(embeddings)
}

pub fn embed_media_bytes(
    api_key: &str,
    mime_type: &str,
    bytes: &[u8],
    modality_label: &str,
) -> Result<Vec<f32>> {
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    let body = EmbedRequest {
        content: ContentBody {
            parts: vec![ContentPart::InlineData {
                inline_data: InlineData {
                    mime_type: mime_type.to_string(),
                    data: encoded,
                },
            }],
        },
        output_dimensionality: VECTOR_DIMENSIONS,
    };

    let url = format!("{EMBED_URL}?key={api_key}");
    let response = post_json_with_retries(
        &url,
        &body,
        None,
        &format!("semantic {modality_label} embeddings"),
    )?;
    let parsed: EmbedResponse =
        serde_json::from_value(response).context("unexpected Gemini media response format")?;
    parsed
        .embedding
        .map(|e| e.values)
        .ok_or_else(|| anyhow!("Gemini returned no media embedding"))
}

fn embed_single_image(api_key: &str, path: &Path) -> Result<Vec<f32>> {
    let data = std::fs::read(path)
        .with_context(|| format!("failed to read image file: {}", path.display()))?;
    let mime_type = mime_from_extension(path);
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);

    let body = EmbedRequest {
        content: ContentBody {
            parts: vec![ContentPart::InlineData {
                inline_data: InlineData {
                    mime_type,
                    data: encoded,
                },
            }],
        },
        output_dimensionality: VECTOR_DIMENSIONS,
    };

    let url = format!("{EMBED_URL}?key={api_key}");
    let response = post_json_with_retries(&url, &body, None, "semantic image embeddings")?;

    let parsed: EmbedResponse =
        serde_json::from_value(response).context("unexpected Gemini image response format")?;
    parsed
        .embedding
        .map(|e| e.values)
        .ok_or_else(|| anyhow!("Gemini returned no image embedding"))
}

fn mime_from_extension(path: &Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
    .to_string()
}

pub fn test_api_key(api_key: &str) -> Result<bool> {
    match embed_single(api_key, "test", TaskKind::Query) {
        Ok(v) => Ok(!v.is_empty()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("API key") || msg.contains("401") || msg.contains("403") {
                Ok(false)
            } else {
                Err(e)
            }
        }
    }
}

fn post_json_with_retries<T: Serialize>(
    url: &str,
    body: &T,
    header: Option<(&str, &str)>,
    operation: &str,
) -> Result<serde_json::Value> {
    let client = reqwest::Client::new();

    for attempt in 0..=MAX_RETRY_ATTEMPTS {
        let response = tauri::async_runtime::block_on(async {
            let mut request = client.post(url).json(body);
            if let Some((name, value)) = header {
                request = request.header(name, value);
            }

            let response = request
                .send()
                .await
                .with_context(|| format!("failed to call Gemini {operation} API"))?;
            let status = response.status();
            let text = response
                .text()
                .await
                .with_context(|| format!("failed to read Gemini {operation} response"))?;
            Ok::<(StatusCode, String), anyhow::Error>((status, text))
        });

        let (status, text) = match response {
            Ok(result) => result,
            Err(error) => {
                if attempt < MAX_RETRY_ATTEMPTS {
                    let delay_secs =
                        (BASE_BACKOFF_SECS * 2_f64.powi(attempt as i32)).min(MAX_BACKOFF_SECS);
                    eprintln!(
                        "[gemini] {} transport retry {}/{} in {:.1}s: {}",
                        operation,
                        attempt + 1,
                        MAX_RETRY_ATTEMPTS + 1,
                        delay_secs,
                        error
                    );
                    thread::sleep(Duration::from_secs_f64(delay_secs));
                    continue;
                }

                return Err(error);
            }
        };

        if status.is_success() {
            return serde_json::from_str(&text)
                .with_context(|| format!("failed to parse Gemini {operation} response"));
        }

        let message = extract_api_message(status, &text);
        let error_kind = classify_error(status, &message, &text);
        let delay_secs = retry_delay_secs(error_kind, &message, &text, attempt);

        if let Some(delay_secs) = delay_secs {
            eprintln!(
                "[gemini] {} retry {}/{} in {:.1}s: {}",
                operation,
                attempt + 1,
                MAX_RETRY_ATTEMPTS + 1,
                delay_secs,
                message
            );
            thread::sleep(Duration::from_secs_f64(delay_secs));
            continue;
        }

        return Err(anyhow!(format_error_message(
            operation, &message, error_kind
        )));
    }

    Err(anyhow!(format_error_message(
        operation,
        "Gemini kept asking Mira to retry",
        GeminiErrorKind::Temporary,
    )))
}

fn extract_api_message(status: StatusCode, text: &str) -> String {
    let err: ErrorResponse = serde_json::from_str(text).unwrap_or(ErrorResponse { error: None });
    err.error
        .and_then(|e| e.message)
        .unwrap_or_else(|| format!("HTTP {status}: {text}"))
}

fn classify_error(status: StatusCode, message: &str, body: &str) -> GeminiErrorKind {
    let lowered = format!("{message}\n{body}").to_lowercase();

    if lowered.contains("quota exceeded") || lowered.contains("billing details") {
        return GeminiErrorKind::Quota;
    }

    if status == StatusCode::TOO_MANY_REQUESTS
        || lowered.contains("rate limit")
        || lowered.contains("resource exhausted")
        || lowered.contains("retry in ")
    {
        return GeminiErrorKind::RateLimited;
    }

    if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT {
        return GeminiErrorKind::Temporary;
    }

    GeminiErrorKind::Other
}

fn retry_delay_secs(
    error_kind: GeminiErrorKind,
    message: &str,
    body: &str,
    attempt: usize,
) -> Option<f64> {
    if attempt >= MAX_RETRY_ATTEMPTS {
        return None;
    }

    if !matches!(
        error_kind,
        GeminiErrorKind::Quota | GeminiErrorKind::RateLimited | GeminiErrorKind::Temporary
    ) {
        return None;
    }

    parse_retry_after_seconds(message)
        .or_else(|| parse_retry_after_seconds(body))
        .map(|seconds| seconds.clamp(1.0, MAX_BACKOFF_SECS))
        .or_else(|| Some((BASE_BACKOFF_SECS * 2_f64.powi(attempt as i32)).min(MAX_BACKOFF_SECS)))
}

fn parse_retry_after_seconds(input: &str) -> Option<f64> {
    let lowered = input.to_lowercase();

    for marker in ["retry in ", "retry after "] {
        let Some(index) = lowered.find(marker) else {
            continue;
        };
        let start = index + marker.len();
        let remainder = &input[start..];
        let digits = remainder
            .chars()
            .skip_while(|ch| ch.is_whitespace())
            .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
            .collect::<String>();

        if let Ok(value) = digits.parse::<f64>() {
            return Some(value);
        }
    }

    None
}

fn format_error_message(operation: &str, message: &str, error_kind: GeminiErrorKind) -> String {
    match error_kind {
        GeminiErrorKind::Quota => format!(
            "Gemini quota exceeded while preparing {operation}. Mira retried several times but is still over quota. Wait a minute, check Gemini rate limits or billing, or switch to Local embeddings in Settings. Original error: {message}"
        ),
        GeminiErrorKind::RateLimited => format!(
            "Gemini rate limited Mira while preparing {operation}. Mira retried with backoff but is still being throttled. Wait a minute and try again, or switch to Local embeddings in Settings. Original error: {message}"
        ),
        GeminiErrorKind::Temporary => format!(
            "Gemini is temporarily unavailable for {operation}. Mira retried with backoff but the service is still unavailable. Original error: {message}"
        ),
        GeminiErrorKind::Other => format!("Gemini API error while preparing {operation}: {message}"),
    }
}
