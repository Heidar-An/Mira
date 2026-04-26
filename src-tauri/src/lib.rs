mod commands;
mod extractors;
mod gemini;
mod indexing;
mod models;
mod preview;
mod search;
mod semantic;
mod shell;
mod state;
mod storage;
mod utils;
mod watchers;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::add_index_root,
            commands::get_file_details,
            commands::get_file_details_by_path,
            commands::get_index_statuses,
            commands::get_settings,
            commands::list_index_roots,
            commands::open_file,
            commands::rebuild_all_embeddings,
            commands::remove_index_root,
            commands::reveal_file,
            commands::save_settings,
            commands::search_files,
            commands::start_index,
            commands::test_gemini_key,
            commands::diagnose_embeddings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
