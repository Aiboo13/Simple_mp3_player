use serde::{Deserialize, Serialize};
use tauri::State;
use rusqlite::params;

use crate::db::DbState;
use crate::scanner;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Song {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i64>,
    pub duration_secs: Option<f64>,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub has_cover: bool,
    pub has_lyrics: bool,
    pub file_size: Option<i64>,
    pub added_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub song_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MusicDir {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
}

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_directory(
    path: String,
    state: State<'_, DbState>,
) -> Result<usize, String> {
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO music_dirs (path) VALUES (?1)",
            params![path],
        ).map_err(|e| e.to_string())?;
    }
    scanner::scan_dir(&state, &path)
}

#[tauri::command]
pub async fn get_music_dirs(state: State<'_, DbState>) -> Result<Vec<MusicDir>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, path, added_at FROM music_dirs ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?;

    let dirs = stmt.query_map([], |row| {
        Ok(MusicDir {
            id: row.get(0)?,
            path: row.get(1)?,
            added_at: row.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect::<Vec<_>>();

    Ok(dirs)
}

#[tauri::command]
pub async fn remove_music_dir(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM music_dirs WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_all_songs(
    sort_by: Option<String>,
    sort_order: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Song>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let sort_col = match sort_by.as_deref() {
        Some("title") => "title COLLATE NOCASE",
        Some("artist") => "artist COLLATE NOCASE",
        Some("album") => "album COLLATE NOCASE",
        Some("date_added") => "added_at",
        Some("duration") => "duration_secs",
        _ => "title COLLATE NOCASE",
    };

    let order = match sort_order.as_deref() {
        Some("desc") | Some("DESC") => "DESC",
        _ => "ASC",
    };

    let sql = format!(
        "SELECT id, path, title, artist, album, album_artist, track_number,
                duration_secs, year, genre, has_cover, has_lyrics, file_size, added_at
         FROM songs ORDER BY {} {}",
        sort_col, order
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let songs = stmt.query_map([], |row| {
        Ok(Song {
            id: row.get(0)?,
            path: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            album_artist: row.get(5)?,
            track_number: row.get(6)?,
            duration_secs: row.get(7)?,
            year: row.get(8)?,
            genre: row.get(9)?,
            has_cover: row.get::<_, i64>(10)? != 0,
            has_lyrics: row.get::<_, i64>(11)? != 0,
            file_size: row.get(12)?,
            added_at: row.get(13)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect::<Vec<_>>();

    Ok(songs)
}

#[tauri::command]
pub async fn search_songs(query: String, state: State<'_, DbState>) -> Result<Vec<Song>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query);

    let mut stmt = conn.prepare(
        "SELECT id, path, title, artist, album, album_artist, track_number,
                duration_secs, year, genre, has_cover, has_lyrics, file_size, added_at
         FROM songs
         WHERE title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1
         ORDER BY title COLLATE NOCASE ASC",
    ).map_err(|e| e.to_string())?;

    let songs = stmt.query_map(params![pattern], |row| {
        Ok(Song {
            id: row.get(0)?,
            path: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            album_artist: row.get(5)?,
            track_number: row.get(6)?,
            duration_secs: row.get(7)?,
            year: row.get(8)?,
            genre: row.get(9)?,
            has_cover: row.get::<_, i64>(10)? != 0,
            has_lyrics: row.get::<_, i64>(11)? != 0,
            file_size: row.get(12)?,
            added_at: row.get(13)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect::<Vec<_>>();

    Ok(songs)
}

#[tauri::command]
pub async fn get_playlists(state: State<'_, DbState>) -> Result<Vec<Playlist>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, COUNT(ps.song_id) as song_count, p.created_at
         FROM playlists p
         LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
         GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
    ).map_err(|e| e.to_string())?;

    let playlists = stmt.query_map([], |row| {
        Ok(Playlist {
            id: row.get(0)?,
            name: row.get(1)?,
            song_count: row.get(2)?,
            created_at: row.get(3)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect::<Vec<_>>();

    Ok(playlists)
}

#[tauri::command]
pub async fn create_playlist(name: String, state: State<'_, DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO playlists (name) VALUES (?1)", params![name])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn delete_playlist(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_songs_to_playlist(
    playlist_id: i64,
    song_ids: Vec<i64>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM playlist_songs WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (i, song_id) in song_ids.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, song_id, max_pos + i as i64 + 1],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_song_from_playlist(
    playlist_id: i64,
    song_id: i64,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_songs WHERE playlist_id = ?1 AND song_id = ?2",
        params![playlist_id, song_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_playlist_songs(
    playlist_id: i64,
    state: State<'_, DbState>,
) -> Result<Vec<Song>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.path, s.title, s.artist, s.album, s.album_artist,
                s.track_number, s.duration_secs, s.year, s.genre,
                s.has_cover, s.has_lyrics, s.file_size, s.added_at
         FROM songs s
         JOIN playlist_songs ps ON s.id = ps.song_id
         WHERE ps.playlist_id = ?1
         ORDER BY ps.position ASC",
    ).map_err(|e| e.to_string())?;

    let songs = stmt.query_map(params![playlist_id], |row| {
        Ok(Song {
            id: row.get(0)?,
            path: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            album_artist: row.get(5)?,
            track_number: row.get(6)?,
            duration_secs: row.get(7)?,
            year: row.get(8)?,
            genre: row.get(9)?,
            has_cover: row.get::<_, i64>(10)? != 0,
            has_lyrics: row.get::<_, i64>(11)? != 0,
            file_size: row.get(12)?,
            added_at: row.get(13)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect::<Vec<_>>();

    Ok(songs)
}

#[tauri::command]
pub async fn get_lyrics(path: String) -> Result<Option<String>, String> {
    Ok(scanner::get_lyrics_data(&path))
}

#[tauri::command]
pub async fn get_album_art(path: String) -> Result<Option<String>, String> {
    Ok(scanner::get_album_art_data(&path))
}

#[tauri::command]
pub async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read audio file: {}", e))
}
