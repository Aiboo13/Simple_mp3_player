use lofty::prelude::*;
use lofty::probe::Probe;
use rusqlite::params;
use std::path::Path;
use walkdir::WalkDir;

use crate::db::DbState;

/// Scan a directory recursively for MP3 files and index them into SQLite
pub fn scan_dir(db_state: &DbState, dir_path: &str) -> Result<usize, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let mut count = 0usize;

    for entry in WalkDir::new(dir_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

        if ext != "mp3" && ext != "flac" && ext != "ogg" && ext != "m4a" && ext != "wav" {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        let file_size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);

        let (title, artist, album, album_artist, track_number, duration_secs, year, genre, has_cover, has_lyrics) =
            extract_metadata(path).unwrap_or_else(|| {
                let fallback_title = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                (fallback_title, None, None, None, None, None, None, None, false, false)
            });

        conn.execute(
            "INSERT OR REPLACE INTO songs
                (path, title, artist, album, album_artist, track_number, duration_secs, year, genre, has_cover, has_lyrics, file_size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                path_str, title, artist, album, album_artist,
                track_number, duration_secs, year, genre,
                has_cover as i64, has_lyrics as i64, file_size
            ],
        ).map_err(|e| e.to_string())?;

        count += 1;
    }

    Ok(count)
}

type MetadataResult = Option<(
    String,              // title
    Option<String>,      // artist
    Option<String>,      // album
    Option<String>,      // album_artist
    Option<i64>,         // track_number
    Option<f64>,         // duration_secs
    Option<i64>,         // year
    Option<String>,      // genre
    bool,                // has_cover
    bool,                // has_lyrics
)>;

fn extract_metadata(path: &Path) -> MetadataResult {
    let tagged_file = Probe::open(path)
        .ok()?
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string()
        });

    let artist = tag.and_then(|t| t.artist().map(|s| s.to_string()));
    let album = tag.and_then(|t| t.album().map(|s| s.to_string()));
    let album_artist = tag
        .and_then(|t| t.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()));
    let track_number = tag.and_then(|t| t.track().map(|n| n as i64));
    let year = tag.and_then(|t| t.year().map(|n| n as i64));
    let genre = tag.and_then(|t| t.genre().map(|s| s.to_string()));

    let duration_secs = tagged_file.properties().duration().as_secs_f64();
    let duration_secs = if duration_secs > 0.0 { Some(duration_secs) } else { None };

    let has_cover = tag
        .map(|t| !t.pictures().is_empty())
        .unwrap_or(false);

    let has_lyrics = tag
        .map(|t| {
            t.get_string(&ItemKey::Lyrics).is_some()
                || t.get(&ItemKey::Lyrics).is_some()
        })
        .unwrap_or(false);

    Some((title, artist, album, album_artist, track_number, duration_secs, year, genre, has_cover, has_lyrics))
}

/// Extract album art from audio file, returns base64 PNG/JPEG string
pub fn get_album_art_data(path: &str) -> Option<String> {
    let tagged_file = Probe::open(Path::new(path))
        .ok()?
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let pictures = tag.pictures();

    if pictures.is_empty() {
        return None;
    }

    let pic = &pictures[0];
    let data = pic.data();
    let mime = match pic.mime_type() {
        Some(m) => m.to_string(),
        None => "image/jpeg".to_string(),
    };

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    Some(format!("data:{};base64,{}", mime, encoded))
}

/// Extract lyrics from audio file
pub fn get_lyrics_data(path: &str) -> Option<String> {
    let tagged_file = Probe::open(Path::new(path))
        .ok()?
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;

    // Try USLT (unsynchronized lyrics) first
    if let Some(lyrics) = tag.get_string(&ItemKey::Lyrics) {
        return Some(lyrics.to_string());
    }

    None
}
