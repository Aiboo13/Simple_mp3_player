use lofty::prelude::*;
use lofty::probe::Probe;
use rusqlite::params;
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::Duration;
use tauri::Emitter;
use walkdir::WalkDir;

use crate::commands::Song;
use crate::db::DbState;

#[derive(Debug, Clone)]
pub struct ExtractedSong {
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
    pub file_size: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ScanProgressPayload {
    pub count: usize,
    pub current_file: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ScanCompletePayload {
    pub total: usize,
}

const BATCH_SIZE: usize = 50;

/// Progressive asynchronous directory scan with batch inserts and live event emission
pub async fn scan_dir_progressive(
    app: &tauri::AppHandle,
    db_state: &DbState,
    dir_path: &str,
) -> Result<usize, String> {
    let dir_path_owned = dir_path.to_string();

    // Collect all candidate file paths in a separate blocking task to keep async executor responsive
    let file_paths: Vec<std::path::PathBuf> = tokio::task::spawn_blocking(move || {
        WalkDir::new(&dir_path_owned)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .filter(|path| {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                ext == "mp3" || ext == "flac" || ext == "ogg" || ext == "m4a" || ext == "wav"
            })
            .collect()
    })
    .await
    .map_err(|e| format!("Failed to walk directory: {}", e))?;

    let mut batch: Vec<ExtractedSong> = Vec::with_capacity(BATCH_SIZE);
    let mut total_count = 0usize;

    for path in file_paths {
        let extracted = tokio::task::spawn_blocking(move || extract_metadata(&path))
            .await
            .map_err(|e| format!("Task execution error: {}", e))?;

        batch.push(extracted);

        if batch.len() >= BATCH_SIZE {
            let inserted_songs = insert_batch_and_query(db_state, &batch)?;
            total_count += inserted_songs.len();

            let last_file_name = inserted_songs
                .last()
                .map(|s| s.title.clone())
                .unwrap_or_default();

            // Emit progressive batch and progress events to UI
            let _ = app.emit("scan-batch", &inserted_songs);
            let _ = app.emit(
                "scan-progress",
                ScanProgressPayload {
                    count: total_count,
                    current_file: last_file_name,
                },
            );

            batch.clear();

            // Yield execution briefly so UI and audio threads remain unblocked and buttery smooth
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }

    // Process remaining songs in final batch
    if !batch.is_empty() {
        let inserted_songs = insert_batch_and_query(db_state, &batch)?;
        total_count += inserted_songs.len();

        let _ = app.emit("scan-batch", &inserted_songs);
        let _ = app.emit(
            "scan-progress",
            ScanProgressPayload {
                count: total_count,
                current_file: "Finalizing...".into(),
            },
        );
        batch.clear();
    }

    let _ = app.emit("scan-complete", ScanCompletePayload { total: total_count });
    Ok(total_count)
}

/// Helper function to perform a transactional batch insert into SQLite and retrieve inserted records
fn insert_batch_and_query(
    db_state: &DbState,
    batch: &[ExtractedSong],
) -> Result<Vec<Song>, String> {
    let mut conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut insert_stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO songs
                    (path, title, artist, album, album_artist, track_number, duration_secs, year, genre, has_cover, has_lyrics, has_metadata, file_size)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            )
            .map_err(|e| e.to_string())?;

        for s in batch {
            insert_stmt
                .execute(params![
                    s.path,
                    s.title,
                    s.artist,
                    s.album,
                    s.album_artist,
                    s.track_number,
                    s.duration_secs,
                    s.year,
                    s.genre,
                    s.has_cover as i64,
                    s.has_lyrics as i64,
                    s.has_metadata as i64,
                    s.file_size,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    let mut result = Vec::with_capacity(batch.len());
    {
        let mut query_stmt = tx
            .prepare(
                "SELECT id, path, title, artist, album, album_artist, track_number,
                        duration_secs, year, genre, has_cover, has_lyrics, has_metadata, file_size, added_at
                 FROM songs WHERE path = ?1",
            )
            .map_err(|e| e.to_string())?;

        for s in batch {
            if let Ok(song) = query_stmt.query_row(params![s.path], |row| {
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
            }) {
                result.push(song);
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

/// Check if a file starts with an ID3v2 header (first 3 bytes == b"ID3")
pub fn check_has_id3_header(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 3];
    if file.read_exact(&mut magic).is_ok() {
        &magic == b"ID3"
    } else {
        false
    }
}

/// Check if a file starts with an ID3v2 header or MP4 container header
pub fn check_has_id3_or_mp4_header(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 8];
    if file.read_exact(&mut magic).is_ok() {
        &magic[..3] == b"ID3" || &magic[4..8] == b"ftyp"
    } else {
        false
    }
}


/// Fast duration estimation for pure MP3 without scanning the full file.
/// Parses the first valid MPEG frame header within the first 4KB to read bitrate.
pub fn quick_estimate_mp3_duration(path: &Path, file_size: i64) -> Option<f64> {
    if file_size <= 0 {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut buf = [0u8; 4096];
    let bytes_read = file.read(&mut buf).ok()?;
    if bytes_read < 4 {
        return None;
    }

    // Scan for MPEG sync word (11 consecutive 1s: 0xFF followed by high 3 bits 111)
    for i in 0..(bytes_read.saturating_sub(3)) {
        if buf[i] == 0xFF && (buf[i + 1] & 0xE0) == 0xE0 {
            let b1 = buf[i + 1];
            let b2 = buf[i + 2];
            let version = (b1 >> 3) & 0x03; // 00: 2.5, 01: reserved, 10: 2, 11: 1
            let layer = (b1 >> 1) & 0x03;   // 01: Layer III, 02: Layer II, 03: Layer I
            let bitrate_idx = ((b2 >> 4) & 0x0F) as usize;

            if version != 0x01 && layer != 0x00 && bitrate_idx != 0x00 && bitrate_idx != 0x0F {
                let bitrate_kbps = match (version, layer) {
                    (3, 1) => { // MPEG 1, Layer III
                        const BITRATES: [u32; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
                        BITRATES.get(bitrate_idx).copied()
                    }
                    (3, 2) => { // MPEG 1, Layer II
                        const BITRATES: [u32; 15] = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
                        BITRATES.get(bitrate_idx).copied()
                    }
                    (3, 3) => { // MPEG 1, Layer I
                        const BITRATES: [u32; 15] = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
                        BITRATES.get(bitrate_idx).copied()
                    }
                    _ => { // MPEG 2 / 2.5, Layer III
                        const BITRATES: [u32; 15] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
                        BITRATES.get(bitrate_idx).copied()
                    }
                };

                if let Some(kbps) = bitrate_kbps {
                    if kbps > 0 {
                        let duration = (file_size as f64 * 8.0) / (kbps as f64 * 1000.0);
                        return Some(duration);
                    }
                }
            }
        }
    }

    // Default fallback: 128 kbps
    Some((file_size as f64 * 8.0) / 128_000.0)
}

fn extract_metadata(path: &Path) -> ExtractedSong {
    let file_size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);
    let path_str = path.to_string_lossy().to_string();
    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let has_lrc = path.with_extension("lrc").is_file() || path.with_extension("LRC").is_file();

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let tagged_file = match Probe::open(path)
        .ok()
        .and_then(|p| p.guess_file_type().ok())
        .and_then(|p| p.read().ok())
    {
        Some(f) => f,
        None => {
            let duration_secs = if ext == "mp3" {
                quick_estimate_mp3_duration(path, file_size)
            } else {
                None
            };
            return ExtractedSong {
                path: path_str,
                title: fallback_title,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                duration_secs,
                year: None,
                genre: None,
                has_cover: false,
                has_lyrics: has_lrc,
                has_metadata: false,
                file_size,
            };
        }
    };

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let (title, artist, album, album_artist, track_number, year, genre, has_cover, has_tag_lyrics, has_tag_meta) = match tag {
        Some(t) => {
            let t_title = t.title().map(|s| s.to_string());
            let t_artist = t.artist().map(|s| s.to_string());
            let t_album = t.album().map(|s| s.to_string());
            let t_album_artist = t.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());
            let t_track = t.track().map(|n| n as i64);
            let t_year = t.year().map(|n| n as i64);
            let t_genre = t.genre().map(|s| s.to_string());
            let t_cover = !t.pictures().is_empty();
            let t_lyrics = t.get_string(&ItemKey::Lyrics).is_some() || t.get(&ItemKey::Lyrics).is_some();

            // Detect whether this file contains authentic metadata or is "pure audio"
            let has_meaningful_meta = t_artist.is_some()
                || t_album.is_some()
                || t_album_artist.is_some()
                || t_cover
                || t_lyrics
                || t_genre.is_some()
                || t_year.is_some()
                || (t_title.is_some() && t_title.as_deref() != Some(&fallback_title));

            let final_title = t_title.unwrap_or(fallback_title);
            (final_title, t_artist, t_album, t_album_artist, t_track, t_year, t_genre, t_cover, t_lyrics, has_meaningful_meta)
        }
        None => (fallback_title, None, None, None, None, None, None, false, false, false),
    };

    let duration_secs = tagged_file.properties().duration().as_secs_f64();
    let duration_secs = if duration_secs > 0.0 { Some(duration_secs) } else { None };

    let has_lyrics = has_lrc || has_tag_lyrics;
    let has_metadata = has_tag_meta || has_lrc;

    ExtractedSong {
        path: path_str,
        title,
        artist,
        album,
        album_artist,
        track_number,
        duration_secs,
        year,
        genre,
        has_cover,
        has_lyrics,
        has_metadata,
        file_size,
    }
}

/// Extract album art from audio file, returns base64 PNG/JPEG string
pub fn get_album_art_data(path: &str) -> Option<String> {
    let p = Path::new(path);
    if !p.is_file() {
        return None;
    }

    // Fast-fail: MP3 without ID3 header or MP4 container cannot have album art
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext == "mp3" && !check_has_id3_or_mp4_header(p) {
        return None;
    }

    let tagged_file = Probe::open(p)
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

/// Extract lyrics from audio file or adjacent .lrc file
pub fn get_lyrics_data(path: &str) -> Option<String> {
    let p = Path::new(path);
    if !p.is_file() {
        return None;
    }

    // 1. Check sidecar .lrc / .LRC file first
    let lrc_path = p.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&lrc_path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    let lrc_upper = p.with_extension("LRC");
    if lrc_upper.is_file() {
        if let Ok(content) = std::fs::read_to_string(&lrc_upper) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    // Fast-fail: MP3 without ID3 header or MP4 container cannot have embedded lyrics
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext == "mp3" && !check_has_id3_or_mp4_header(p) {
        return None;
    }

    // 2. Fall back to embedded tag in audio file
    let tagged_file = Probe::open(p)
        .ok()?
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;

    // Try USLT (unsynchronized lyrics) or generic Lyrics item
    if let Some(lyrics) = tag.get_string(&ItemKey::Lyrics) {
        let trimmed = lyrics.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_insert_with_pure_audio_and_metadata() {
        let temp_dir = std::env::temp_dir().join(format!("test_scanner_db_{}.db", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        crate::db::initialize_db(&temp_dir).expect("Db init should succeed");
        let db_state = DbState::new(temp_dir.clone());

        let batch = vec![
            ExtractedSong {
                path: "/music/pure_audio.mp3".into(),
                title: "pure_audio".into(),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                duration_secs: Some(180.5),
                year: None,
                genre: None,
                has_cover: false,
                has_lyrics: false,
                has_metadata: false,
                file_size: 1024 * 1024,
            },
            ExtractedSong {
                path: "/music/tagged_song.mp3".into(),
                title: "Tagged Title".into(),
                artist: Some("Artist 1".into()),
                album: Some("Album 1".into()),
                album_artist: None,
                track_number: Some(1),
                duration_secs: Some(210.0),
                year: Some(2025),
                genre: Some("Pop".into()),
                has_cover: true,
                has_lyrics: true,
                has_metadata: true,
                file_size: 2 * 1024 * 1024,
            },
        ];

        let inserted = insert_batch_and_query(&db_state, &batch).expect("Batch insert must succeed");
        assert_eq!(inserted.len(), 2);

        let pure_song = inserted.iter().find(|s| s.path == "/music/pure_audio.mp3").unwrap();
        assert!(!pure_song.has_metadata);
        assert!(!pure_song.has_cover);
        assert!(!pure_song.has_lyrics);

        let tagged_song = inserted.iter().find(|s| s.path == "/music/tagged_song.mp3").unwrap();
        assert!(tagged_song.has_metadata);
        assert!(tagged_song.has_cover);
        assert!(tagged_song.has_lyrics);

        let _ = std::fs::remove_file(temp_dir);
    }

    #[test]
    fn test_fast_fail_id3_detection_and_bypass() {
        use std::io::Write;
        let temp_dir = std::env::temp_dir();

        // 1. Create a mock Pure Audio MP3 file without ID3 header (starts with MPEG syncword 0xFF 0xFB)
        let pure_path = temp_dir.join(format!("test_pure_audio_{}.mp3", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let mut f = File::create(&pure_path).unwrap();
            // MPEG 1 Layer III 128kbps 44.1kHz frame header
            let frame_header = [0xFF, 0xFB, 0x90, 0x64];
            f.write_all(&frame_header).unwrap();
            f.write_all(&vec![0u8; 1000]).unwrap();
        }

        // Must detect NO ID3 header
        assert!(!check_has_id3_header(&pure_path));

        // Album art and lyrics must return None without probing
        assert_eq!(get_album_art_data(pure_path.to_str().unwrap()), None);
        assert_eq!(get_lyrics_data(pure_path.to_str().unwrap()), None);

        // Metadata extraction must fast-fail to Pure Audio
        let extracted = extract_metadata(&pure_path);
        assert!(!extracted.has_metadata);
        assert!(!extracted.has_cover);
        assert!(!extracted.has_lyrics);
        assert!(extracted.duration_secs.is_some());

        // 2. Create a mock ID3-tagged file (starts with "ID3")
        let tagged_path = temp_dir.join(format!("test_tagged_audio_{}.mp3", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let mut f = File::create(&tagged_path).unwrap();
            let id3_header = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20];
            f.write_all(&id3_header).unwrap();
            f.write_all(&vec![0u8; 500]).unwrap();
        }

        // Must detect ID3 header
        assert!(check_has_id3_header(&tagged_path));

        let _ = std::fs::remove_file(pure_path);
        let _ = std::fs::remove_file(tagged_path);
    }

    #[test]
    fn test_pure_audio_and_mp4_lofty_detection() {
        use std::io::Write;
        let temp_dir = std::env::temp_dir();

        // 1. Mock pure MP3 (no ID3 tag, just MPEG frame)
        let pure_path = temp_dir.join(format!("test_pure_{}.mp3", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let mut f = File::create(&pure_path).unwrap();
            let frame = [0xFF, 0xFB, 0x90, 0x64];
            f.write_all(&frame).unwrap();
            f.write_all(&vec![0u8; 1000]).unwrap();
        }

        let extracted_pure = extract_metadata(&pure_path);
        assert!(!extracted_pure.has_metadata);
        assert!(!extracted_pure.has_cover);
        assert!(extracted_pure.duration_secs.is_some());

        // 2. Mock MP4/M4A file named .mp3
        let mp4_path = temp_dir.join(format!("test_aac_{}.mp3", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        {
            let mut f = File::create(&mp4_path).unwrap();
            // MP4 box header: size (32 bytes), type 'ftyp', major brand 'M4A '
            let header = [
                0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
                0x4D, 0x34, 0x41, 0x20, 0x00, 0x00, 0x02, 0x00,
                0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32,
            ];
            f.write_all(&header).unwrap();
            f.write_all(&vec![0u8; 500]).unwrap();
        }

        assert!(check_has_id3_or_mp4_header(&mp4_path));
        let extracted_mp4 = extract_metadata(&mp4_path);
        assert!(!extracted_mp4.has_metadata); // no metadata tags inside mock

        let _ = std::fs::remove_file(pure_path);
        let _ = std::fs::remove_file(mp4_path);
    }
}


