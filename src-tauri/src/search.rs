use crate::{
    gemini::{self, QueryKindIntent},
    models::{
        ContentMatch, FileCandidate, ScoreBreakdown, SearchMode, SearchQueryIntent, SearchResponse,
        SearchResult, SemanticMatch,
    },
    preview::preview_path_for_kind,
    semantic, storage,
    utils::unix_timestamp,
};
use anyhow::Result;
use rusqlite::Connection;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

pub fn search_files(
    conn: &Connection,
    vector_db_path: &Path,
    model_cache_dir: &Path,
    query: &str,
    root_ids: Option<&[i64]>,
    kinds: Option<&[String]>,
    mode: SearchMode,
    limit: usize,
    offset: usize,
    ignore_metadata: bool,
) -> Result<SearchResponse> {
    let effective_limit = offset + limit + 1;
    let expanded_kinds = expand_kind_filters(kinds);

    if query.is_empty() {
        let recent_candidates = storage::fetch_candidates(
            conn,
            query,
            root_ids,
            expanded_kinds.as_deref(),
            effective_limit,
        )?;
        let all: Vec<SearchResult> = recent_candidates
            .into_iter()
            .take(effective_limit)
            .map(|candidate| {
                let preview_path =
                    preview_path_for_kind(&candidate.path, &candidate.kind, &candidate.extension);
                SearchResult {
                    file_id: candidate.file_id,
                    root_id: candidate.root_id,
                    name: candidate.name,
                    path: candidate.path,
                    extension: candidate.extension,
                    kind: candidate.kind,
                    size: candidate.size,
                    modified_at: candidate.modified_at,
                    indexed_at: candidate.indexed_at,
                    score: 0,
                    semantic_score: None,
                    score_breakdown: ScoreBreakdown::default(),
                    match_reasons: vec!["recent file".to_string()],
                    snippet: None,
                    snippet_source: None,
                    segment_modality: None,
                    segment_label: None,
                    segment_start_ms: None,
                    segment_end_ms: None,
                    preview_path,
                }
            })
            .collect();

        let has_more = all.len() > offset + limit;
        let page = all.into_iter().skip(offset).take(limit).collect();
        return Ok(SearchResponse {
            results: page,
            has_more,
            query_intent: None,
        });
    }

    let settings = storage::settings::load_settings(conn).unwrap_or_default();
    let provider = settings.embedding_provider.as_str();
    let api_key = settings.gemini_api_key.as_deref();
    let tokens = tokenize(query);
    let query_kind_intent = classify_query_intent(mode, query, &tokens, api_key);

    let mut combined = HashMap::<i64, SearchResult>::new();

    if !ignore_metadata {
        let metadata_candidates = storage::fetch_candidates(
            conn,
            query,
            root_ids,
            expanded_kinds.as_deref(),
            effective_limit,
        )?;
        for candidate in metadata_candidates {
            let scored = score_candidate(candidate, query, &tokens);
            combined.insert(scored.file_id, scored);
        }
    }

    if let Some(fts_query) = build_fts_query(&tokens) {
        let content_matches = storage::search_content_matches(
            conn,
            &fts_query,
            root_ids,
            expanded_kinds.as_deref(),
            effective_limit * 8,
        )?;

        for (rank, content_match) in content_matches.into_iter().enumerate() {
            merge_content_match(&mut combined, content_match, &tokens, rank);
        }
    }

    if mode == SearchMode::Full && (tokens.len() >= 2 || query.len() >= 3) {
        if let Ok(semantic_matches) = semantic::search_semantic(
            vector_db_path,
            model_cache_dir,
            query,
            root_ids,
            limit * 3,
            provider,
            api_key,
        ) {
            merge_semantic_matches(conn, &mut combined, semantic_matches);
        }
    }

    let mut results = combined.into_values().collect::<Vec<_>>();
    if let Some(intent) = query_kind_intent
        .as_ref()
        .and_then(search_query_intent_to_ranking_intent)
    {
        apply_query_kind_intent(&mut results, &intent);
    }
    if let Some(kinds) = kinds {
        if !kinds.is_empty() {
            let allowed_kinds = kinds.iter().map(String::as_str).collect::<HashSet<_>>();
            results.retain(|result| {
                let grouped = filter_kind_for_result(&result.kind);
                allowed_kinds.contains(grouped)
            });
        }
    }
    results.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| compare_semantic_score(right.semantic_score, left.semantic_score))
            .then(right.modified_at.cmp(&left.modified_at))
            .then_with(|| left.name.cmp(&right.name))
    });

    let has_more = results.len() > offset + limit;
    let page = results.into_iter().skip(offset).take(limit).collect();
    Ok(SearchResponse {
        results: page,
        has_more,
        query_intent: query_kind_intent,
    })
}

fn classify_query_intent(
    mode: SearchMode,
    query: &str,
    tokens: &[String],
    api_key: Option<&str>,
) -> Option<SearchQueryIntent> {
    if query.trim().is_empty() {
        return None;
    }

    if mode != SearchMode::Full {
        eprintln!("[intent] waiting for full search query={:?}", query);
        return Some(SearchQueryIntent {
            status: "waiting".to_string(),
            model: Some(gemini::GEMINI_QUERY_KIND_MODEL.to_string()),
            kind: None,
            confidence: None,
            message: Some("Waiting for full search.".to_string()),
        });
    }

    if tokens.len() < 2 && query.len() < 3 {
        eprintln!("[intent] skipped short query={:?}", query);
        return Some(SearchQueryIntent {
            status: "too_short".to_string(),
            model: Some(gemini::GEMINI_QUERY_KIND_MODEL.to_string()),
            kind: None,
            confidence: None,
            message: Some("Type at least 3 characters or 2 words.".to_string()),
        });
    }

    let Some(api_key) = api_key else {
        eprintln!(
            "[intent] skipped missing_key model={} query={:?}",
            gemini::GEMINI_QUERY_KIND_MODEL,
            query
        );
        return Some(SearchQueryIntent {
            status: "missing_key".to_string(),
            model: Some(gemini::GEMINI_QUERY_KIND_MODEL.to_string()),
            kind: None,
            confidence: None,
            message: Some("No Gemini API key configured.".to_string()),
        });
    };

    match gemini::classify_query_kind(api_key, query) {
        Ok(intent) => Some(SearchQueryIntent {
            status: "success".to_string(),
            model: Some(gemini::GEMINI_QUERY_KIND_MODEL.to_string()),
            kind: Some(intent.kind),
            confidence: Some(intent.confidence),
            message: None,
        }),
        Err(error) => {
            let message = error.to_string();
            eprintln!(
                "[intent] classify error model={} query={:?} error={}",
                gemini::GEMINI_QUERY_KIND_MODEL,
                query,
                message
            );
            Some(SearchQueryIntent {
                status: "error".to_string(),
                model: Some(gemini::GEMINI_QUERY_KIND_MODEL.to_string()),
                kind: None,
                confidence: None,
                message: Some(message),
            })
        }
    }
}

fn search_query_intent_to_ranking_intent(intent: &SearchQueryIntent) -> Option<QueryKindIntent> {
    if intent.status != "success" {
        return None;
    }

    Some(QueryKindIntent {
        kind: intent.kind.clone()?,
        confidence: intent.confidence?,
    })
}

fn merge_semantic_matches(
    conn: &Connection,
    combined: &mut HashMap<i64, SearchResult>,
    semantic_matches: Vec<SemanticMatch>,
) {
    if semantic_matches.is_empty() {
        return;
    }

    let existing_ids = combined.keys().copied().collect::<HashSet<_>>();
    let missing_ids = semantic_matches
        .iter()
        .map(|hit| hit.file_id)
        .filter(|file_id| !existing_ids.contains(file_id))
        .collect::<Vec<_>>();

    let mut candidates_by_id = storage::fetch_candidates_by_ids(conn, &missing_ids)
        .unwrap_or_default()
        .into_iter()
        .map(|candidate| (candidate.file_id, candidate))
        .collect::<HashMap<_, _>>();

    for (rank, semantic_match) in semantic_matches.into_iter().enumerate() {
        let fallback_candidate = candidates_by_id.remove(&semantic_match.file_id);
        merge_semantic_match(combined, semantic_match, fallback_candidate, rank);
    }
}

fn score_candidate(candidate: FileCandidate, query: &str, tokens: &[String]) -> SearchResult {
    let lower_name = candidate.name.to_lowercase();
    let lower_path = candidate.path.to_lowercase();
    let lower_ext = candidate.extension.to_lowercase();

    let mut reasons = Vec::new();
    let mut breakdown = ScoreBreakdown::default();

    if lower_name == query {
        breakdown.metadata += 220;
        reasons.push("exact filename match".to_string());
    }

    if lower_path == query {
        breakdown.metadata += 180;
        reasons.push("exact path match".to_string());
    }

    if lower_ext == query {
        breakdown.metadata += 130;
        reasons.push("file type match".to_string());
    }

    if lower_name.contains(query) {
        breakdown.metadata += 110;
        reasons.push("filename match".to_string());
    }

    if lower_path.contains(query) {
        breakdown.metadata += 70;
        reasons.push("path match".to_string());
    }

    let mut token_hits = 0;
    for token in tokens {
        if lower_name.contains(token) {
            breakdown.metadata += 32;
            token_hits += 1;
        } else if lower_path.contains(token) {
            breakdown.metadata += 16;
            token_hits += 1;
        } else if lower_ext == *token {
            breakdown.metadata += 24;
            token_hits += 1;
        }
    }

    breakdown.recency = recency_boost(candidate.modified_at.or(Some(candidate.indexed_at)));
    let score = total_score(&breakdown);

    if token_hits > 0 {
        reasons.push("keyword match".to_string());
    }

    if reasons.is_empty() {
        reasons.push("metadata match".to_string());
    } else {
        reasons.sort();
        reasons.dedup();
    }

    let preview_path =
        preview_path_for_kind(&candidate.path, &candidate.kind, &candidate.extension);

    SearchResult {
        file_id: candidate.file_id,
        root_id: candidate.root_id,
        name: candidate.name,
        path: candidate.path,
        extension: candidate.extension,
        kind: candidate.kind,
        size: candidate.size,
        modified_at: candidate.modified_at,
        indexed_at: candidate.indexed_at,
        score,
        semantic_score: None,
        score_breakdown: finalize_breakdown(breakdown),
        match_reasons: reasons,
        snippet: None,
        snippet_source: None,
        segment_modality: None,
        segment_label: None,
        segment_start_ms: None,
        segment_end_ms: None,
        preview_path,
    }
}

fn merge_content_match(
    combined: &mut HashMap<i64, SearchResult>,
    content_match: ContentMatch,
    tokens: &[String],
    rank: usize,
) {
    let snippet = build_snippet(&content_match.text, tokens);
    let content_score = (280_i64 - (rank as i64 * 7)).max(90);

    let entry = combined.entry(content_match.file_id).or_insert_with(|| {
        let recency = recency_boost(content_match.modified_at.or(Some(content_match.indexed_at)));
        let preview_path = preview_path_for_kind(
            &content_match.path,
            &content_match.kind,
            &content_match.extension,
        );
        SearchResult {
            file_id: content_match.file_id,
            root_id: content_match.root_id,
            name: content_match.name,
            path: content_match.path,
            extension: content_match.extension,
            kind: content_match.kind,
            size: content_match.size,
            modified_at: content_match.modified_at,
            indexed_at: content_match.indexed_at,
            score: recency,
            semantic_score: None,
            score_breakdown: finalize_breakdown(ScoreBreakdown {
                recency,
                ..ScoreBreakdown::default()
            }),
            match_reasons: Vec::new(),
            snippet: None,
            snippet_source: None,
            segment_modality: None,
            segment_label: None,
            segment_start_ms: None,
            segment_end_ms: None,
            preview_path,
        }
    });

    entry.score_breakdown.lexical += content_score;
    entry.score_breakdown.total = total_score(&entry.score_breakdown);
    entry.score = entry.score_breakdown.total;
    entry.match_reasons.push("text match".to_string());

    if entry.snippet.is_none() {
        entry.snippet = snippet;
        entry.snippet_source = content_match.source_label;
        entry.segment_modality = content_match.segment_modality;
        entry.segment_label = content_match.segment_label;
        entry.segment_start_ms = content_match.segment_start_ms;
        entry.segment_end_ms = content_match.segment_end_ms;
    }

    entry.match_reasons.sort();
    entry.match_reasons.dedup();
}

fn merge_semantic_match(
    combined: &mut HashMap<i64, SearchResult>,
    semantic_match: SemanticMatch,
    fallback_candidate: Option<FileCandidate>,
    rank: usize,
) {
    let modality = semantic_match.modality.clone();
    let reason = match modality.as_str() {
        "image" => "visual match",
        "audio" | "video" => "media match",
        _ => "semantic match",
    };
    let semantic_score =
        (semantic_match.similarity * 240.0).round() as i64 - (rank as i64 * 4).min(40);

    if !combined.contains_key(&semantic_match.file_id) && fallback_candidate.is_none() {
        return;
    }

    let entry =
        combined
            .entry(semantic_match.file_id)
            .or_insert_with(|| match fallback_candidate {
                Some(candidate) => {
                    let recency =
                        recency_boost(candidate.modified_at.or(Some(candidate.indexed_at)));
                    let preview_path = preview_path_for_kind(
                        &candidate.path,
                        &candidate.kind,
                        &candidate.extension,
                    );
                    SearchResult {
                        file_id: candidate.file_id,
                        root_id: candidate.root_id,
                        name: candidate.name,
                        path: candidate.path,
                        extension: candidate.extension,
                        kind: candidate.kind,
                        size: candidate.size,
                        modified_at: candidate.modified_at,
                        indexed_at: candidate.indexed_at,
                        score: recency,
                        semantic_score: None,
                        score_breakdown: finalize_breakdown(ScoreBreakdown {
                            recency,
                            ..ScoreBreakdown::default()
                        }),
                        match_reasons: Vec::new(),
                        snippet: None,
                        snippet_source: None,
                        segment_modality: None,
                        segment_label: None,
                        segment_start_ms: None,
                        segment_end_ms: None,
                        preview_path,
                    }
                }
                None => unreachable!("semantic result without fallback candidate"),
            });

    if modality == "image" {
        entry.score_breakdown.semantic_image += semantic_score.max(60);
    } else if matches!(modality.as_str(), "audio" | "video") {
        entry.score_breakdown.semantic_media += semantic_score.max(60);
    } else {
        entry.score_breakdown.semantic_text += semantic_score.max(60);
    }
    entry.score_breakdown.total = total_score(&entry.score_breakdown);
    entry.score = entry.score_breakdown.total;
    entry.semantic_score = Some(
        entry
            .semantic_score
            .map(|score| score.max(semantic_match.similarity))
            .unwrap_or(semantic_match.similarity),
    );
    entry.match_reasons.push(reason.to_string());
    if matches!(modality.as_str(), "audio" | "video") {
        if entry.snippet.is_none() {
            entry.snippet = semantic_match.summary.clone();
            entry.snippet_source = semantic_match.segment_label.clone();
        }
        entry.segment_modality = Some(modality.clone());
        entry.segment_label = semantic_match.segment_label.clone();
        entry.segment_start_ms = semantic_match.segment_start_ms;
        entry.segment_end_ms = semantic_match.segment_end_ms;
    }

    entry.match_reasons.sort();
    entry.match_reasons.dedup();
}

fn compare_semantic_score(left: Option<f32>, right: Option<f32>) -> std::cmp::Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left
            .partial_cmp(&right)
            .unwrap_or(std::cmp::Ordering::Equal),
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn apply_query_kind_intent(results: &mut [SearchResult], intent: &QueryKindIntent) {
    if intent.kind == "other" || intent.confidence < 55 {
        return;
    }

    for result in results {
        let factor = kind_intent_factor(intent, &result.kind);
        if (factor - 1.0).abs() < f32::EPSILON {
            continue;
        }

        let previous_total = result.score_breakdown.total.max(1);
        let adjusted_total = ((previous_total as f32) * factor).round() as i64;
        let delta = adjusted_total - previous_total;
        if delta == 0 {
            continue;
        }

        result.score_breakdown.intent += delta;
        result.score_breakdown.total = total_score(&result.score_breakdown);
        result.score = result.score_breakdown.total;

        if delta > 0 {
            result
                .match_reasons
                .push(format!("{} intent", intent.kind.replace('-', " ")));
            result.match_reasons.sort();
            result.match_reasons.dedup();
        }
    }
}

fn kind_intent_factor(intent: &QueryKindIntent, result_kind: &str) -> f32 {
    let result_filter_kind = intent_kind_for_result(result_kind);
    let confidence = intent.confidence as f32 / 100.0;
    let strength = 0.08 + (confidence * 0.2);

    if result_filter_kind == intent.kind {
        return 1.0 + strength;
    }

    if is_related_kind(&intent.kind, result_filter_kind) {
        return 1.0 - (strength * 0.12);
    }

    if result_filter_kind == "other" {
        return 1.0 - (strength * 0.18);
    }

    1.0 - (strength * 0.24)
}

fn is_related_kind(intent_kind: &str, result_kind: &str) -> bool {
    matches!(
        (intent_kind, result_kind),
        ("document", "text")
            | ("text", "document")
            | ("text", "code")
            | ("code", "text")
            | ("audio", "video")
            | ("video", "audio")
    )
}

fn expand_kind_filters(kinds: Option<&[String]>) -> Option<Vec<String>> {
    let kinds = kinds?;
    if kinds.is_empty() {
        return None;
    }

    let mut expanded = Vec::new();
    for kind in kinds {
        match kind.as_str() {
            "other" => expanded.extend(["other".to_string(), "archive".to_string()]),
            _ => expanded.push(kind.clone()),
        }
    }

    expanded.sort();
    expanded.dedup();
    Some(expanded)
}

fn filter_kind_for_result(kind: &str) -> &'static str {
    match kind {
        "document" => "document",
        "image" => "image",
        "text" => "text",
        "code" => "code",
        "audio" => "audio",
        "video" => "video",
        _ => "other",
    }
}

fn intent_kind_for_result(kind: &str) -> &'static str {
    match kind {
        "document" => "document",
        "image" => "image",
        "text" => "text",
        "code" => "code",
        "audio" => "audio",
        "video" => "video",
        _ => "other",
    }
}

fn recency_boost(timestamp: Option<i64>) -> i64 {
    let Some(timestamp) = timestamp else {
        return 0;
    };

    let age_seconds = unix_timestamp().saturating_sub(timestamp).max(0);
    let age_days = age_seconds / 86_400;

    match age_days {
        0..=1 => 36,
        2..=7 => 24,
        8..=30 => 12,
        31..=120 => 6,
        _ => 0,
    }
}

fn total_score(breakdown: &ScoreBreakdown) -> i64 {
    breakdown.metadata
        + breakdown.lexical
        + breakdown.semantic_text
        + breakdown.semantic_image
        + breakdown.semantic_media
        + breakdown.intent
        + breakdown.recency
}

fn finalize_breakdown(mut breakdown: ScoreBreakdown) -> ScoreBreakdown {
    breakdown.total = total_score(&breakdown);
    breakdown
}

fn tokenize(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|token| token.trim_matches(|char: char| !char.is_alphanumeric()))
        .filter(|token| !token.is_empty())
        .map(|token| token.to_lowercase())
        .collect()
}

fn build_fts_query(tokens: &[String]) -> Option<String> {
    if tokens.is_empty() {
        return None;
    }

    Some(
        tokens
            .iter()
            .map(|token| format!("{token}*"))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

fn build_snippet(text: &str, tokens: &[String]) -> Option<String> {
    const SNIPPET_CHARS: usize = 220;

    if text.trim().is_empty() {
        return None;
    }

    let lowercase = text.to_lowercase();
    let first_match = tokens
        .iter()
        .filter_map(|token| lowercase.find(token))
        .min()
        .unwrap_or(0);

    let snippet_start = first_match.saturating_sub(70);
    let snippet_end = (snippet_start + SNIPPET_CHARS).min(text.len());
    let mut snippet = text
        .get(snippet_start..snippet_end)
        .unwrap_or(text)
        .trim()
        .to_string();

    if snippet_start > 0 {
        snippet.insert(0, '…');
    }
    if snippet_end < text.len() {
        snippet.push('…');
    }

    Some(snippet)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_audio_semantic_match_when_merging_then_result_keeps_best_segment_context() {
        let mut combined = HashMap::new();
        merge_semantic_match(
            &mut combined,
            SemanticMatch {
                file_id: 7,
                modality: "audio".to_string(),
                similarity: 0.91,
                summary: Some("Interview about distributed systems".to_string()),
                segment_label: Some("00:00-01:30".to_string()),
                segment_start_ms: Some(0),
                segment_end_ms: Some(90_000),
            },
            Some(FileCandidate {
                file_id: 7,
                root_id: 3,
                name: "episode.mp3".to_string(),
                path: "/tmp/episode.mp3".to_string(),
                extension: "mp3".to_string(),
                kind: "audio".to_string(),
                size: 10,
                modified_at: Some(unix_timestamp()),
                indexed_at: unix_timestamp(),
            }),
            0,
        );

        let result = combined.get(&7).expect("result");
        assert_eq!(
            result.snippet.as_deref(),
            Some("Interview about distributed systems")
        );
        assert_eq!(result.snippet_source.as_deref(), Some("00:00-01:30"));
        assert_eq!(result.segment_modality.as_deref(), Some("audio"));
        assert_eq!(result.segment_start_ms, Some(0));
        assert_eq!(result.segment_end_ms, Some(90_000));
        assert!(result.score_breakdown.semantic_media > 0);
        assert!(result
            .match_reasons
            .iter()
            .any(|reason| reason == "media match"));
    }

    #[test]
    fn given_audio_content_match_when_merging_then_timestamp_label_is_preserved() {
        let mut combined = HashMap::new();
        merge_content_match(
            &mut combined,
            ContentMatch {
                file_id: 9,
                root_id: 4,
                name: "memo.m4a".to_string(),
                path: "/tmp/memo.m4a".to_string(),
                extension: "m4a".to_string(),
                kind: "audio".to_string(),
                size: 10,
                modified_at: Some(unix_timestamp()),
                indexed_at: unix_timestamp(),
                source_label: Some("02:00-03:30".to_string()),
                text: "audio segment about release planning".to_string(),
                segment_modality: Some("audio".to_string()),
                segment_label: Some("02:00-03:30".to_string()),
                segment_start_ms: Some(120_000),
                segment_end_ms: Some(210_000),
            },
            &["release".to_string()],
            0,
        );

        let result = combined.get(&9).expect("result");
        assert_eq!(result.snippet_source.as_deref(), Some("02:00-03:30"));
        assert_eq!(result.segment_modality.as_deref(), Some("audio"));
        assert_eq!(result.segment_label.as_deref(), Some("02:00-03:30"));
        assert_eq!(result.segment_start_ms, Some(120_000));
        assert_eq!(result.segment_end_ms, Some(210_000));
    }
}
