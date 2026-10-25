use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    pub fn new(db_path: PathBuf) -> Self {
        let conn = Connection::open(db_path).expect("Failed to open database");
        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA foreign_keys = ON;
        ").expect("Failed to initialize database connection pragmas");
        DbState(Mutex::new(conn))
    }
}

pub fn initialize_db(db_path: &PathBuf) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS music_dirs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            album_artist TEXT,
            track_number INTEGER,
            duration_secs REAL,
            year INTEGER,
            genre TEXT,
            has_cover INTEGER NOT NULL DEFAULT 0,
            has_lyrics INTEGER NOT NULL DEFAULT 0,
            has_metadata INTEGER NOT NULL DEFAULT 1,
            file_size INTEGER,
            added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            UNIQUE(playlist_id, song_id)
        );

        CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
        CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
        CREATE INDEX IF NOT EXISTS idx_songs_added_at ON songs(added_at);
    ")?;

    // Migration for existing databases that were created before has_metadata was added
    let has_col = conn
        .prepare("SELECT has_metadata FROM songs LIMIT 1")
        .is_ok();
    if !has_col {
        let _ = conn.execute(
            "ALTER TABLE songs ADD COLUMN has_metadata INTEGER NOT NULL DEFAULT 1",
            [],
        );
    }

    // Safely create index after column is guaranteed to exist
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_songs_has_metadata ON songs(has_metadata)",
        [],
    );

    // PRD v1.5 §1: Pure Audio is strictly raw .mp3 without ID3 headers.
    // Non-mp3 formats (.m4a, .flac, .ogg, .wav) have structured container headers (ftyp, STREAMINFO)
    // and must never be classified as pure audio.
    let _ = conn.execute(
        "UPDATE songs SET has_metadata = 1 WHERE path NOT LIKE '%.mp3' AND has_metadata = 0",
        [],
    );

    // Retroactively update legacy pure audio .mp3 tracks to has_metadata = 0
    let _ = conn.execute(
        "UPDATE songs SET has_metadata = 0 
         WHERE path LIKE '%.mp3'
           AND (artist IS NULL OR trim(artist) = '' OR lower(trim(artist)) = 'unknown') 
           AND (album IS NULL OR trim(album) = '' OR lower(trim(album)) = 'unknown') 
           AND has_cover = 0 
           AND has_lyrics = 0",
        [],
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_db_and_has_metadata_column() {
        let temp_dir = std::env::temp_dir().join(format!("test_music_db_{}.db", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        initialize_db(&temp_dir).expect("Database initialization should succeed");

        let conn = Connection::open(&temp_dir).unwrap();
        // Check that has_metadata exists in table
        let mut stmt = conn.prepare("SELECT has_metadata FROM songs").unwrap();
        let _ = stmt.query([]).unwrap();

        let _ = std::fs::remove_file(temp_dir);
    }
}
