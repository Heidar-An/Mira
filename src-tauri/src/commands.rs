use crate::{
    indexing,
    models::{FileDetails, IndexStatus, IndexedRoot, SearchRequest, SearchResponse},
    semantic, shell,
    state::AppState,
    storage,
    storage::settings::AppSettings,
    utils::{err_to_string, unix_timestamp},
};
use tauri::State;

#[tauri::command]
pub fn list_index_roots(state: State<'_, AppState>) -> Result<Vec<IndexedRoot>, String> {
    let conn = state.connection().map_err(err_to_string)?;
    storage::fetch_roots(&conn).map_err(err_to_string)
}

#[tauri::command]
pub fn add_index_root(path: String, state: State<'_, AppState>) -> Result<IndexedRoot, String> {
    let normalized = indexing::normalize_root_path(&path).map_err(err_to_string)?;
    let conn = state.connection().map_err(err_to_string)?;
    let root = storage::insert_or_update_root(&conn, &normalized, unix_timestamp())
        .map_err(err_to_string)?;
    state
        .allow_preview_root(&normalized)
        .map_err(err_to_string)?;
    state.watch_service.watch_root(root.id, normalized);
    Ok(root)
}

#[tauri::command]
pub fn remove_index_root(root_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.connection().map_err(err_to_string)?;
    if let Some(path) = storage::lookup_root_path(&conn, root_id).map_err(err_to_string)? {
        state.watch_service.unwatch_root(root_id, path);
    }
    let _ = semantic::remove_root_embeddings(&state.vector_db_path, root_id);
    storage::remove_root(&conn, root_id).map_err(err_to_string)
}

#[tauri::command]
pub fn start_index(root_id: i64, state: State<'_, AppState>) -> Result<IndexStatus, String> {
    let conn = state.connection().map_err(err_to_string)?;
    let root_path = storage::lookup_root_path(&conn, root_id)
        .map_err(err_to_string)?
        .ok_or_else(|| "Indexed folder not found".to_string())?;

    let current_status = storage::lookup_root_status(&conn, root_id).map_err(err_to_string)?;
    if matches!(current_status.as_deref(), Some("indexing")) {
        let latest = storage::fetch_latest_job(&conn, root_id).map_err(err_to_string)?;
        return latest.ok_or_else(|| "Folder is already indexing".to_string());
    }

    let job_id =
        storage::create_index_job(&conn, root_id, unix_timestamp()).map_err(err_to_string)?;
    drop(conn);

    indexing::spawn_index_job(
        (*state.db_path).clone(),
        (*state.vector_db_path).clone(),
        (*state.model_cache_dir).clone(),
        root_id,
        job_id,
        root_path,
    );

    let conn = state.connection().map_err(err_to_string)?;
    storage::fetch_job_by_id(&conn, job_id)
        .map_err(err_to_string)?
        .ok_or_else(|| "Failed to create index job".to_string())
}

#[tauri::command]
pub fn get_index_statuses(state: State<'_, AppState>) -> Result<Vec<IndexStatus>, String> {
    let conn = state.connection().map_err(err_to_string)?;
    storage::fetch_latest_jobs(&conn).map_err(err_to_string)
}

#[tauri::command]
pub async fn search_files(
    request: SearchRequest,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let query = request.query.trim().to_lowercase();
    let limit = request.limit.unwrap_or(10).clamp(1, 200);
    let offset = request.offset.unwrap_or(0);
    let mode = request.mode;
    let root_ids = request.root_ids;
    let kinds = request.kinds;
    let db_path = (*state.db_path).clone();
    let vector_db_path = (*state.vector_db_path).clone();
    let model_cache_dir = (*state.model_cache_dir).clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = storage::open_connection(&db_path)?;
        crate::search::search_files(
            &conn,
            &vector_db_path,
            &model_cache_dir,
            &query,
            root_ids.as_deref(),
            kinds.as_deref(),
            mode,
            limit,
            offset,
        )
    })
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)
}

#[tauri::command]
pub fn get_file_details(file_id: i64, state: State<'_, AppState>) -> Result<FileDetails, String> {
    let conn = state.connection().map_err(err_to_string)?;
    storage::fetch_file_details(&conn, file_id).map_err(err_to_string)
}

#[tauri::command]
pub fn get_file_details_by_path(
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<FileDetails>, String> {
    let conn = state.connection().map_err(err_to_string)?;
    storage::fetch_file_details_by_path(&conn, &path).map_err(err_to_string)
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    shell::open_file(&path).map_err(err_to_string)
}

#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    shell::reveal_file(&path).map_err(err_to_string)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.connection().map_err(err_to_string)?;
    storage::settings::load_settings(&conn).map_err(err_to_string)
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let conn = state.connection().map_err(err_to_string)?;
    let old = storage::settings::load_settings(&conn).map_err(err_to_string)?;

    let provider_changed = old.embedding_provider != settings.embedding_provider;

    let mut to_save = settings;
    if provider_changed {
        let new_model = semantic::semantic_model_name(&to_save.embedding_provider);
        to_save.embedding_model_version = Some(new_model.to_string());
    }

    storage::settings::save_settings(&conn, &to_save).map_err(err_to_string)?;

    let saved = storage::settings::load_settings(&conn).map_err(err_to_string)?;

    if provider_changed {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = semantic::drop_embeddings_table(&state.vector_db_path);
        }));
        let _ = storage::settings::reset_all_semantic_status(&conn);
    }

    let refresh_changed = old.index_refresh_minutes != to_save.index_refresh_minutes;
    if refresh_changed {
        state.update_refresh_interval(to_save.index_refresh_minutes);
    }

    Ok(saved)
}

#[tauri::command]
pub fn test_gemini_key(api_key: String) -> Result<bool, String> {
    crate::gemini::test_api_key(&api_key).map_err(err_to_string)
}

#[tauri::command]
pub fn rebuild_all_embeddings(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.connection().map_err(err_to_string)?;
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = semantic::drop_embeddings_table(&state.vector_db_path);
    }));
    storage::settings::reset_all_semantic_status(&conn).map_err(err_to_string)?;
    let roots = storage::fetch_roots(&conn).map_err(err_to_string)?;
    drop(conn);
    for root in roots {
        let _ = commands_start_index(root.id, &state);
    }
    Ok(())
}

#[tauri::command]
pub fn diagnose_embeddings(
    state: State<'_, AppState>,
) -> Result<semantic::EmbeddingDiagnostics, String> {
    semantic::diagnose_embeddings(&state.vector_db_path).map_err(err_to_string)
}

fn commands_start_index(root_id: i64, state: &AppState) -> Result<(), String> {
    let conn = state.connection().map_err(err_to_string)?;
    let root_path = storage::lookup_root_path(&conn, root_id)
        .map_err(err_to_string)?
        .ok_or_else(|| "Indexed folder not found".to_string())?;
    let job_id =
        storage::create_index_job(&conn, root_id, unix_timestamp()).map_err(err_to_string)?;
    drop(conn);
    indexing::spawn_index_job(
        (*state.db_path).clone(),
        (*state.vector_db_path).clone(),
        (*state.model_cache_dir).clone(),
        root_id,
        job_id,
        root_path,
    );
    Ok(())
}
