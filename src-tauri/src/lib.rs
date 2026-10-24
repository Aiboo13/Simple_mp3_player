pub mod db;
pub mod scanner;
pub mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
            let db_path = app_dir.join("music.db");
            db::initialize_db(&db_path).expect("Failed to initialize database");
            app.manage(db::DbState::new(db_path));

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.open_devtools();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::get_all_songs,
            commands::search_songs,
            commands::get_playlists,
            commands::create_playlist,
            commands::delete_playlist,
            commands::add_songs_to_playlist,
            commands::remove_song_from_playlist,
            commands::get_playlist_songs,
            commands::get_lyrics,
            commands::get_album_art,
            commands::get_music_dirs,
            commands::remove_music_dir,
            commands::read_audio_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
