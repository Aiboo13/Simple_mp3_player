use serde::{Deserialize, Serialize};
use tauri::State;
use rusqlite::params;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};

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
    pub has_metadata: bool,
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

// Dedicated high-priority thread pool for audio I/O to ensure zero stutter during disk contention
static AUDIO_IO_POOL: once_cell::sync::Lazy<tokio::runtime::Runtime> = once_cell::sync::Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("high-prio-audio")
        .enable_all()
        .build()
        .expect("Failed to initialize dedicated audio IO runtime")
});

// ─── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_directory(
    app: tauri::AppHandle,
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
    scanner::scan_dir_progressive(&app, &state, &path).await
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

/// Helper to filter out missing files on disk and purge their records from SQLite
fn prune_missing_songs(conn: &mut rusqlite::Connection, raw_songs: Vec<Song>) -> Vec<Song> {
    let mut songs = Vec::with_capacity(raw_songs.len());
    let mut missing_ids = Vec::new();

    for s in raw_songs {
        if std::path::Path::new(&s.path).is_file() {
            songs.push(s);
        } else {
            missing_ids.push(s.id);
        }
    }

    if !missing_ids.is_empty() {
        if let Ok(tx) = conn.transaction() {
            if let (Ok(mut dpl), Ok(mut ds)) = (
                tx.prepare("DELETE FROM playlist_songs WHERE song_id = ?1"),
                tx.prepare("DELETE FROM songs WHERE id = ?1"),
            ) {
                for id in &missing_ids {
                    let _ = dpl.execute(params![id]);
                    let _ = ds.execute(params![id]);
                }
            }
            let _ = tx.commit();
        }
    }

    songs
}

#[tauri::command]
pub async fn get_all_songs(
    sort_by: Option<String>,
    sort_order: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Song>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;

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
                duration_secs, year, genre, has_cover, has_lyrics, has_metadata, file_size, added_at
         FROM songs ORDER BY {} {}",
        sort_col, order
    );

    let raw_songs = {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
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
                has_metadata: row.get::<_, i64>(12)? != 0,
                file_size: row.get(13)?,
                added_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    Ok(prune_missing_songs(&mut conn, raw_songs))
}

#[tauri::command]
pub async fn search_songs(query: String, state: State<'_, DbState>) -> Result<Vec<Song>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query);

    let raw_songs = {
        let mut stmt = conn.prepare(
            "SELECT id, path, title, artist, album, album_artist, track_number,
                    duration_secs, year, genre, has_cover, has_lyrics, has_metadata, file_size, added_at
             FROM songs
             WHERE title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1
             ORDER BY title COLLATE NOCASE ASC",
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![pattern], |row| {
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
                has_metadata: row.get::<_, i64>(12)? != 0,
                file_size: row.get(13)?,
                added_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    Ok(prune_missing_songs(&mut conn, raw_songs))
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
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let raw_songs = {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.path, s.title, s.artist, s.album, s.album_artist,
                    s.track_number, s.duration_secs, s.year, s.genre,
                    s.has_cover, s.has_lyrics, s.has_metadata, s.file_size, s.added_at
             FROM songs s
             JOIN playlist_songs ps ON s.id = ps.song_id
             WHERE ps.playlist_id = ?1
             ORDER BY ps.position ASC",
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![playlist_id], |row| {
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
                has_metadata: row.get::<_, i64>(12)? != 0,
                file_size: row.get(13)?,
                added_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    Ok(prune_missing_songs(&mut conn, raw_songs))
}

#[tauri::command]
pub async fn get_lyrics(path: String) -> Result<Option<String>, String> {
    if path.is_empty() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || {
        Ok(scanner::get_lyrics_data(&path))
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

#[tauri::command]
pub async fn get_album_art(path: String) -> Result<Option<String>, String> {
    if path.is_empty() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || {
        Ok(scanner::get_album_art_data(&path))
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

/// PRD v1.5 §4.B §4.C: `is_pure_audio` flag allows the backend to take the fast-path for
/// pure audio files (no ID3 header). When `true` AND the file genuinely starts with an MPEG
/// sync word (0xFF 0xE?), any overhead is bypassed entirely, eliminating the 1-second stutter.
///
/// IMPORTANT: Some files have extension .mp3 but are actually MP4 containers (ftyp header).
/// Those files must always go through the standard path with fMP4 remux detection, regardless
/// of the `is_pure_audio` DB flag.
///
/// `Option<bool>` is the correct Tauri v2 pattern: when the JS caller sends `is_pure_audio: false`
/// the value is `Some(false)`; when the key is omitted it is `None` (treated as false below).
#[tauri::command]
pub async fn read_audio_file(
    path: String,
    is_pure_audio: Option<bool>,
    state: State<'_, DbState>,
) -> Result<tauri::ipc::Response, String> {
    if path.is_empty() {
        return Err("Audio path is empty".into());
    }

    let pure_audio_hint = is_pure_audio.unwrap_or(false);
    let path_clone = path.clone();

    let res = AUDIO_IO_POOL
        .spawn_blocking(move || {
            let file = match File::open(&path_clone) {
                Ok(f) => f,
                Err(e) => {
                    let is_not_found = e.kind() == std::io::ErrorKind::NotFound;
                    return Err((is_not_found, format!("Failed to open file: {}", e)));
                }
            };
            let metadata = file.metadata()
                .map_err(|e| (false, format!("Metadata error: {}", e)))?;
            let size = metadata.len() as usize;

            // Read a small magic header to verify actual file type
            let mut reader = BufReader::with_capacity(256 * 1024, file);
            let mut magic = [0u8; 8];
            let magic_read = reader.read(&mut magic).unwrap_or(0);

            // Reset reader to start of file
            reader.seek(SeekFrom::Start(0))
                .map_err(|e| (false, format!("Seek error: {}", e)))?;

            // Detect if this is truly a raw MPEG frame (pure MP3):
            // Byte 0 = 0xFF, top 3 bits of byte 1 = 111 (MPEG sync word)
            // This excludes MP4 containers (ftyp at offset 4) disguised as .mp3
            let is_mpeg_sync = magic_read >= 2
                && magic[0] == 0xFF
                && (magic[1] & 0xE0) == 0xE0;

            // PRD v1.5 §4.B: True pure audio fast-path — only when:
            // 1. Frontend signals is_pure_audio = true (from DB has_metadata = false), AND
            // 2. File genuinely starts with MPEG sync word (not an MP4-in-MP3 disguise)
            if pure_audio_hint && is_mpeg_sync {
                let mut buffer = Vec::with_capacity(size);
                reader.read_to_end(&mut buffer)
                    .map_err(|e| (false, format!("[PureAudio] Failed to read audio: {}", e)))?;
                // Genuine raw MPEG stream — no fMP4 check needed, safe to return directly
                return Ok(tauri::ipc::Response::new(buffer));
            }

            // Standard path: read full file then run fMP4 detection + remux if needed
            let mut buffer = Vec::with_capacity(size);
            reader.read_to_end(&mut buffer)
                .map_err(|e| (false, format!("Failed to read audio: {}", e)))?;

            // If the audio file is a fragmented DASH MP4, unfragment/remux it so GStreamer plays it smoothly
            let buffer = scanner::get_or_remux_fragmented_mp4(&path_clone, buffer);
            // If the audio file is FLAC, remux into OGG container to avoid GStreamer push-mode assertion crashes
            let final_buffer = scanner::get_or_remux_flac(&path_clone, buffer);
            Ok(tauri::ipc::Response::new(final_buffer))
        })
        .await
        .map_err(|e| format!("Audio task execution error: {}", e))?;

    match res {
        Ok(resp) => Ok(resp),
        Err((is_not_found, err_msg)) => {
            if is_not_found {
                if let Ok(conn) = state.0.lock() {
                    let _ = conn.execute("DELETE FROM playlist_songs WHERE song_id IN (SELECT id FROM songs WHERE path = ?1)", params![path]);
                    let _ = conn.execute("DELETE FROM songs WHERE path = ?1", params![path]);
                }
            }
            Err(err_msg)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_db;
    use std::io::Write;

    #[test]
    fn test_prune_missing_songs() {
        let temp_dir = std::env::temp_dir().join(format!("test_prune_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let real_file = temp_dir.join("exists.mp3");
        {
            let mut f = File::create(&real_file).unwrap();
            f.write_all(b"exists").unwrap();
        }
        let missing_file = temp_dir.join("missing.mp3");

        let db_path = temp_dir.join("test.db");
        initialize_db(&db_path).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();

        conn.execute("INSERT INTO songs (path, title) VALUES (?1, ?2)", params![real_file.to_str().unwrap(), "Real Song"]).unwrap();
        let real_id = conn.last_insert_rowid();

        conn.execute("INSERT INTO songs (path, title) VALUES (?1, ?2)", params![missing_file.to_str().unwrap(), "Missing Song"]).unwrap();
        let missing_id = conn.last_insert_rowid();

        let raw_songs = vec![
            Song {
                id: real_id,
                path: real_file.to_str().unwrap().to_string(),
                title: "Real Song".to_string(),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                duration_secs: None,
                year: None,
                genre: None,
                has_cover: false,
                has_lyrics: false,
                has_metadata: true,
                file_size: None,
                added_at: 0,
            },
            Song {
                id: missing_id,
                path: missing_file.to_str().unwrap().to_string(),
                title: "Missing Song".to_string(),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                duration_secs: None,
                year: None,
                genre: None,
                has_cover: false,
                has_lyrics: false,
                has_metadata: true,
                file_size: None,
                added_at: 0,
            },
        ];

        let pruned = prune_missing_songs(&mut conn, raw_songs);
        assert_eq!(pruned.len(), 1);
        assert_eq!(pruned[0].id, real_id);

        // Verify missing song was deleted from DB
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM songs WHERE id = ?1", params![missing_id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
