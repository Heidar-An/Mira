use crate::{storage, watchers::RootWatchService};
use anyhow::{Context, Result};
use rusqlite::Connection;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};

const DATABASE_NAME: &str = "mira.db";
const VECTOR_DATABASE_DIR: &str = "semantic-index.lancedb";
const MODEL_CACHE_DIR: &str = "semantic-models";

#[derive(Clone)]
pub struct AppState {
    pub app: AppHandle,
    pub db_path: Arc<PathBuf>,
    pub vector_db_path: Arc<PathBuf>,
    pub model_cache_dir: Arc<PathBuf>,
    pub watch_service: Arc<RootWatchService>,
    refresh_cancel: Arc<Mutex<Option<std::sync::mpsc::Sender<()>>>>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_local_data_dir()
            .context("failed to resolve app data directory")?;
        fs::create_dir_all(&app_dir).context("failed to create app data directory")?;

        let db_path = app_dir.join(DATABASE_NAME);
        let vector_db_path = app_dir.join(VECTOR_DATABASE_DIR);
        let model_cache_dir = app_dir.join(MODEL_CACHE_DIR);
        fs::create_dir_all(&vector_db_path).context("failed to create vector index directory")?;
        fs::create_dir_all(&model_cache_dir).context("failed to create model cache directory")?;
        storage::initialize_database(&db_path)?;
        let watch_service = Arc::new(RootWatchService::new(
            db_path.clone(),
            vector_db_path.clone(),
            model_cache_dir.clone(),
        )?);

        let conn = storage::open_connection(&db_path)?;
        for (root_id, path) in storage::list_root_watch_entries(&conn)? {
            app.asset_protocol_scope()
                .allow_directory(&path, true)
                .with_context(|| format!("failed to allow asset access for {}", path))?;
            watch_service.watch_root(root_id, path);
        }

        let state = Self {
            app: app.clone(),
            db_path: Arc::new(db_path.clone()),
            vector_db_path: Arc::new(vector_db_path),
            model_cache_dir: Arc::new(model_cache_dir),
            watch_service,
            refresh_cancel: Arc::new(Mutex::new(None)),
        };

        let settings = storage::settings::load_settings(&conn).unwrap_or_default();

        let current_model = crate::semantic::semantic_model_name(&settings.embedding_provider);
        let needs_rebuild = settings
            .embedding_model_version
            .as_deref()
            .map(|v| v != current_model)
            .unwrap_or(true);

        if needs_rebuild {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = crate::semantic::drop_embeddings_table(&state.vector_db_path);
            }));
            let _ = storage::settings::reset_all_semantic_status(&conn);
            let mut migrated = settings.clone();
            migrated.embedding_model_version = Some(current_model.to_string());
            let _ = storage::settings::save_settings(&conn, &migrated);
        }

        if settings.index_refresh_minutes > 0 {
            state.start_refresh_timer(settings.index_refresh_minutes);
        }

        Ok(state)
    }

    pub fn connection(&self) -> Result<Connection> {
        storage::open_connection(&self.db_path)
    }

    pub fn allow_preview_root(&self, path: &str) -> Result<()> {
        self.app
            .asset_protocol_scope()
            .allow_directory(path, true)
            .with_context(|| format!("failed to allow preview access for {}", path))
    }

    pub fn update_refresh_interval(&self, minutes: i64) {
        self.stop_refresh_timer();
        if minutes > 0 {
            self.start_refresh_timer(minutes);
        }
    }

    fn start_refresh_timer(&self, minutes: i64) {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        if let Ok(mut cancel) = self.refresh_cancel.lock() {
            *cancel = Some(tx);
        }

        let db_path = (*self.db_path).clone();
        let vector_db_path = (*self.vector_db_path).clone();
        let model_cache_dir = (*self.model_cache_dir).clone();
        let interval = std::time::Duration::from_secs(minutes as u64 * 60);

        std::thread::spawn(move || loop {
            match rx.recv_timeout(interval) {
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    let conn = match storage::open_connection(&db_path) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let roots = match storage::fetch_roots(&conn) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };
                    drop(conn);
                    for root in roots {
                        let conn = match storage::open_connection(&db_path) {
                            Ok(c) => c,
                            Err(_) => continue,
                        };
                        let root_path =
                            match storage::lookup_root_path(&conn, root.id) {
                                Ok(Some(p)) => p,
                                _ => continue,
                            };
                        let ts = crate::utils::unix_timestamp();
                        let job_id = match storage::create_index_job(&conn, root.id, ts) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        drop(conn);
                        crate::indexing::spawn_index_job(
                            db_path.clone(),
                            vector_db_path.clone(),
                            model_cache_dir.clone(),
                            root.id,
                            job_id,
                            root_path,
                        );
                    }
                }
                _ => break,
            }
        });
    }

    fn stop_refresh_timer(&self) {
        if let Ok(mut cancel) = self.refresh_cancel.lock() {
            cancel.take();
        }
    }
}
