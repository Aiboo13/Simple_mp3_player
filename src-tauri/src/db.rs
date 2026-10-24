use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    pub fn new(db_path: PathBuf) -> Self {
        let conn = Connection::open(db_path).expect("Failed to open database");
        DbState(Mutex::new(conn))
    }
}

pub fn initialize_db(db_path: &PathBuf) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("
        PRAGMA journal_mode = WAL;
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

    Ok(())
}
