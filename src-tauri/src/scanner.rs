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

    // Synchronize SQLite: Purge any deleted, replaced, or non-existent songs
    let deleted_ids = {
        let mut conn = db_state.0.lock().map_err(|e| e.to_string())?;
        clean_missing_and_deleted_songs(&mut conn, dir_path, &file_paths)?
    };

    if !deleted_ids.is_empty() {
        let _ = app.emit("scan-deleted", &deleted_ids);
    }

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

/// Synchronize SQLite database with the current files in the scanned directory.
/// Deletes rows from `songs` (and `playlist_songs`) if:
/// 1. The file was in `scanned_dir` previously, but is no longer found in `scanned_file_paths` (deleted/replaced).
/// 2. The file path recorded in the DB does not exist on disk anywhere.
pub fn clean_missing_and_deleted_songs(
    conn: &mut rusqlite::Connection,
    scanned_dir: &str,
    scanned_file_paths: &[std::path::PathBuf],
) -> Result<Vec<i64>, String> {
    let scanned_dir_path = std::path::PathBuf::from(scanned_dir);
    let scanned_dir_canon = scanned_dir_path.canonicalize().unwrap_or_else(|_| scanned_dir_path.clone());

    let mut found_str_set = std::collections::HashSet::new();
    let mut found_canon_set = std::collections::HashSet::new();
    for p in scanned_file_paths {
        found_str_set.insert(p.to_string_lossy().to_string());
        if let Ok(c) = p.canonicalize() {
            found_canon_set.insert(c);
        }
    }

    let existing_songs = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM songs")
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    let mut to_delete_ids = Vec::new();

    for (id, path_str) in existing_songs {
        let p = std::path::PathBuf::from(&path_str);
        let exists = p.is_file();

        if !exists {
            to_delete_ids.push(id);
            continue;
        }

        let is_in_scanned_dir = if let Ok(p_canon) = p.canonicalize() {
            p_canon.starts_with(&scanned_dir_canon)
        } else {
            p.starts_with(&scanned_dir_path)
        };

        if is_in_scanned_dir {
            let is_found = found_str_set.contains(&path_str)
                || p.canonicalize().map(|c| found_canon_set.contains(&c)).unwrap_or(false);

            if !is_found {
                to_delete_ids.push(id);
            }
        }
    }

    if !to_delete_ids.is_empty() {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut del_playlist_stmt = tx
                .prepare("DELETE FROM playlist_songs WHERE song_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut del_song_stmt = tx
                .prepare("DELETE FROM songs WHERE id = ?1")
                .map_err(|e| e.to_string())?;

            for id in &to_delete_ids {
                let _ = del_playlist_stmt.execute(params![id]);
                let _ = del_song_stmt.execute(params![id]);
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    Ok(to_delete_ids)
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

/// Check if a byte slice corresponds to a fragmented, non-faststart, or video-carrying MP4 / M4A audio file.
/// In WebKitGTK / GStreamer push mode (Blobs):
/// 1. 'sidx' / 'moof' / 'dash' segment boundaries cause premature EOS signals and skips.
/// 2. If 'moov' is at the end of the file (after 'mdat'), GStreamer push mode must buffer the entire file
///    before decoding, causing heavy initial lag ("ngeload banyak") and playback desync.
/// 3. Embedded MJPEG video streams (attached pictures) can cork the audio sink, causing the timer to run with no sound.
pub fn is_problematic_mp4(data: &[u8]) -> bool {
    if data.len() < 16 || &data[4..8] != b"ftyp" {
        return false;
    }

    // 1. Detect DASH / fragmented MP4 markers
    let inspect_len = data.len().min(8192);
    let sample = &data[..inspect_len];
    if sample.windows(4).any(|w| w == b"dash" || w == b"sidx" || w == b"moof") {
        return true;
    }

    // 2. Detect non-faststart container (moov atom placed after mdat or at end of file)
    let ftyp_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if ftyp_size >= 8 && ftyp_size + 8 <= data.len() {
        let next_box_type = &data[ftyp_size + 4..ftyp_size + 8];
        // In a proper faststart streamable file, the box directly after ftyp must be 'moov'.
        // If it is 'mdat', 'free', 'wide', etc., 'moov' is delayed and requires remuxing.
        if next_box_type != b"moov" {
            return true;
        }
    }

    false
}

/// Backward-compatible alias for fragmented MP4 check
pub fn is_fragmented_mp4(data: &[u8]) -> bool {
    is_problematic_mp4(data)
}

/// Check if an MP4 / M4A file should be remuxed into a clean faststart streamable container.
/// On WebKitGTK / GStreamer:
/// 1. Fragmented DASH MP4 files fail to play or skip prematurely.
/// 2. Non-faststart containers (moov at end) cause huge buffer pauses.
/// 3. Embedded video tracks / cover art (JPEG/PNG/MJPEG) cork the audio pipeline and cause audio frame skipping.
/// 4. Non-standard atoms (such as 'free' inside 'meta' or proprietary dref boxes) crash avdec_aac with error code 4.
pub fn should_remux_mp4(path_str: &str, data: &[u8]) -> bool {
    let p = Path::new(path_str);
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let is_mp4 = ext == "m4a" || ext == "mp4" || (data.len() >= 8 && &data[4..8] == b"ftyp");
    if !is_mp4 {
        return false;
    }
    true
}

/// If the audio file is an MP4 / M4A container (fragmented, delayed moov, attached video track, or non-standard atoms),
/// remux it into a clean, unfragmented MP4 container (moov at start, -vn stripped, contiguous mdat)
/// using fast stream copy (`-vn -c:a copy -movflags +faststart`).
/// Results are cached in the temp directory so the remux operation (~30ms) occurs only once per track.
pub fn get_or_remux_fragmented_mp4(path_str: &str, original_bytes: Vec<u8>) -> Vec<u8> {
    if !should_remux_mp4(path_str, &original_bytes) {
        return original_bytes;
    }

    let p = Path::new(path_str);
    let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let file_size = p.metadata().map(|m| m.len()).unwrap_or(original_bytes.len() as u64);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&path_str, &mut hasher);
    std::hash::Hash::hash(&file_size, &mut hasher);
    let path_hash = std::hash::Hasher::finish(&hasher);

    let safe_stem: String = file_stem
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .take(30)
        .collect();
    let safe_stem = if safe_stem.is_empty() { "track".to_string() } else { safe_stem };

    let cache_dir = std::env::temp_dir().join("mp3_player_lokal_cache");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cached_path = cache_dir.join(format!("{}_{:x}_faststart.m4a", safe_stem, path_hash));

    // Fast-path: Return cached remuxed file if already generated
    if let Ok(meta) = cached_path.metadata() {
        if meta.len() > 0 {
            if let Ok(cached_bytes) = std::fs::read(&cached_path) {
                if !cached_bytes.is_empty() {
                    return cached_bytes;
                }
            }
        }
    }

    // Remux using ffmpeg stream copy: -vn -c:a copy -movflags +faststart
    // 1. -vn removes any embedded video track / attached picture so WebKitGTK <audio> plays cleanly without corking
    // 2. -c:a copy does bit-exact lossless stream copy of the audio (zero re-encoding, ~20ms)
    // 3. -movflags +faststart places moov at the start of the container for instant buffering and seamless playback
    let remux_status = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-i",
            path_str,
            "-vn",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            cached_path.to_str().unwrap_or(""),
        ])
        .output();

    if let Ok(output) = remux_status {
        if output.status.success() {
            if let Ok(remuxed_bytes) = std::fs::read(&cached_path) {
                if !remuxed_bytes.is_empty() {
                    return remuxed_bytes;
                }
            }
        }
    }

    // Fallback: return original bytes if ffmpeg is unavailable or fails
    original_bytes
}

/// Check if an MP3 file contains an attached picture / video stream (ID3 APIC frame),
/// which can cork WebKitGTK's audio sink and cause stuttering / skipping.
pub fn is_mp3_with_attached_pic(path_str: &str, data: &[u8]) -> bool {
    let p = Path::new(path_str);
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext != "mp3" && !data.starts_with(b"ID3") {
        return false;
    }
    if !data.starts_with(b"ID3") || data.len() < 10 {
        return false;
    }
    // Calculate ID3v2 header tag size (synchsafe integer in bytes 6..10)
    let id3_size = ((data[6] as usize & 0x7F) << 21)
        | ((data[7] as usize & 0x7F) << 14)
        | ((data[8] as usize & 0x7F) << 7)
        | (data[9] as usize & 0x7F);
    let inspect_len = (10 + id3_size).min(data.len()).min(5 * 1024 * 1024);
    let header_slice = &data[..inspect_len];
    header_slice.windows(4).any(|w| w == b"APIC" || w == b"PIC ")
}

/// If an MP3 audio file contains an attached picture / video stream, strip it into a clean
/// pure audio MP3 stream (`-vn -c:a copy`) so GStreamer never stalls on missing video sinks.
pub fn get_or_remux_mp3(path_str: &str, original_bytes: Vec<u8>) -> Vec<u8> {
    if !is_mp3_with_attached_pic(path_str, &original_bytes) {
        return original_bytes;
    }

    let p = Path::new(path_str);
    let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let file_size = p.metadata().map(|m| m.len()).unwrap_or(original_bytes.len() as u64);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&path_str, &mut hasher);
    std::hash::Hash::hash(&file_size, &mut hasher);
    let path_hash = std::hash::Hasher::finish(&hasher);

    let safe_stem: String = file_stem
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .take(30)
        .collect();
    let safe_stem = if safe_stem.is_empty() { "track".to_string() } else { safe_stem };

    let cache_dir = std::env::temp_dir().join("mp3_player_lokal_cache");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cached_path = cache_dir.join(format!("{}_{:x}_clean.mp3", safe_stem, path_hash));

    // Fast-path: Return cached remuxed file if already generated
    if let Ok(meta) = cached_path.metadata() {
        if meta.len() > 0 {
            if let Ok(cached_bytes) = std::fs::read(&cached_path) {
                if !cached_bytes.is_empty() {
                    return cached_bytes;
                }
            }
        }
    }

    // Remux using ffmpeg stream copy: -vn -c:a copy
    let remux_status = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-i",
            path_str,
            "-vn",
            "-c:a",
            "copy",
            cached_path.to_str().unwrap_or(""),
        ])
        .output();

    if let Ok(output) = remux_status {
        if output.status.success() {
            if let Ok(remuxed_bytes) = std::fs::read(&cached_path) {
                if !remuxed_bytes.is_empty() {
                    return remuxed_bytes;
                }
            }
        }
    }

    original_bytes
}

/// If the audio file is in FLAC format, remux it into an OGG container (-vn -c:a copy -f ogg).
///
/// Context & WebKitGTK / GStreamer Architecture:
/// WebKitGTK feeds Blob URLs to GStreamer using push-mode `appsrc`.
/// GStreamer's `flacparse` element in push-mode suffers from a severe bug when encountering
/// attached picture metadata or seeking frame sync boundaries:
/// `gst_base_parse_finish_frame: assertion 'size > 0 || frame->out_buffer' failed`
/// triggering `HTMLMediaElement.error.code = 4` (MEDIA_ERR_SRC_NOT_SUPPORTED).
///
/// Remuxing the FLAC audio stream into an Ogg container via stream copy (`-vn -c:a copy -f ogg`):
/// 1. Takes only ~40-80ms (zero transcoding, 100% bit-exact lossless FLAC preserved).
/// 2. Caches the result in `/tmp/mp3_player_lokal_cache/` so subsequent loads take 0ms.
/// 3. Enables flawless playback and seeking in WebKitGTK / GStreamer without any pipeline assertion errors.
pub fn get_or_remux_flac(path_str: &str, original_bytes: Vec<u8>) -> Vec<u8> {
    let is_flac = original_bytes.starts_with(b"fLaC")
        || Path::new(path_str)
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("flac"))
            .unwrap_or(false);

    if !is_flac {
        return original_bytes;
    }

    let p = Path::new(path_str);
    let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let file_size = p.metadata().map(|m| m.len()).unwrap_or(original_bytes.len() as u64);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&path_str, &mut hasher);
    std::hash::Hash::hash(&file_size, &mut hasher);
    let path_hash = std::hash::Hasher::finish(&hasher);

    let cache_dir = std::env::temp_dir().join("mp3_player_lokal_cache");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cached_path = cache_dir.join(format!("{}_{:x}_flac.ogg", file_stem, path_hash));

    // Fast-path: Return cached remuxed OGG file if already generated
    if let Ok(meta) = cached_path.metadata() {
        if meta.len() > 0 {
            if let Ok(cached_bytes) = std::fs::read(&cached_path) {
                if !cached_bytes.is_empty() {
                    return cached_bytes;
                }
            }
        }
    }

    // Remux using ffmpeg stream copy: -vn -c:a copy -f ogg
    let remux_status = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-i",
            path_str,
            "-vn",
            "-c:a",
            "copy",
            "-f",
            "ogg",
            cached_path.to_str().unwrap_or(""),
        ])
        .output();

    if let Ok(output) = remux_status {
        if output.status.success() {
            if let Ok(remuxed_bytes) = std::fs::read(&cached_path) {
                if !remuxed_bytes.is_empty() {
                    return remuxed_bytes;
                }
            }
        }
    }

    // Fallback: return original bytes if ffmpeg is unavailable or fails
    original_bytes
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
    // PRD v1.5 §1: Only genuine raw .mp3 files without ID3 or MP4 container headers can be pure audio.
    // Container formats (.m4a, .flac, .ogg, .wav) and MP4-disguised-as-.mp3 always require standard handling.
    let is_raw_mp3_candidate = ext == "mp3" && !check_has_id3_or_mp4_header(path);
    let has_metadata = if !is_raw_mp3_candidate {
        true
    } else {
        has_tag_meta || has_lrc
    };

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

    #[test]
    fn test_fragmented_mp4_detection() {
        // Standard M4A header: size 24, 'ftyp', 'M4A '
        let standard_m4a = vec![
            0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p',
            b'M', b'4', b'A', b' ', 0x00, 0x00, 0x00, 0x00,
        ];
        assert!(!is_fragmented_mp4(&standard_m4a));

        // Fragmented DASH header: size 24, 'ftyp', 'dash'
        let dash_fmp4 = vec![
            0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p',
            b'd', b'a', b's', b'h', 0x00, 0x00, 0x00, 0x00,
        ];
        assert!(is_fragmented_mp4(&dash_fmp4));

        // MP4 with sidx box inside header
        let mut sidx_fmp4 = standard_m4a.clone();
        sidx_fmp4.extend_from_slice(b"....sidx....");
        assert!(is_fragmented_mp4(&sidx_fmp4));

        // Non-mp4 (MP3)
        let mp3_bytes = vec![0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00];
        assert!(!is_fragmented_mp4(&mp3_bytes));

        // Non-fragmented input should return unchanged
        let non_fmp4_result = get_or_remux_fragmented_mp4("mock.mp3", mp3_bytes.clone());
        assert_eq!(non_fmp4_result, mp3_bytes);

        // Real fragmented file test if present in user's Music directory
        let real_dash_path = "/home/sah/Music/Up.mp3";
        if std::path::Path::new(real_dash_path).is_file() {
            let original = std::fs::read(real_dash_path).unwrap();
            assert!(is_fragmented_mp4(&original));
            let remuxed = get_or_remux_fragmented_mp4(real_dash_path, original.clone());
            assert!(!remuxed.is_empty());
            // Remuxed output must NO LONGER be fragmented
            assert!(!is_fragmented_mp4(&remuxed));
        }

        // Test non-faststart M4A file (Teenagers.m4a has moov at the end of the file)
        let teenagers_path = "/home/sah/Music/Teenagers.m4a";
        if std::path::Path::new(teenagers_path).is_file() {
            let original = std::fs::read(teenagers_path).unwrap();
            // Must detect that Teenagers.m4a requires remuxing (non-faststart / delayed moov)
            assert!(is_problematic_mp4(&original));
            let remuxed = get_or_remux_fragmented_mp4(teenagers_path, original.clone());
            assert!(!remuxed.is_empty());
            // Remuxed output has moov at start and no video stream, so it is no longer problematic!
            assert!(!is_problematic_mp4(&remuxed));
        }
    }

    #[test]
    fn test_flac_remuxing() {
        let non_flac = vec![0xFF, 0xFB, 0x90, 0x64];
        let res = get_or_remux_flac("track.mp3", non_flac.clone());
        assert_eq!(res, non_flac);

        // Test with real user FLAC file if present
        let flac_path = "/home/sah/Music/The World Is Ugly - My Chemical Romance.flac";
        if std::path::Path::new(flac_path).is_file() {
            let original = std::fs::read(flac_path).unwrap();
            let remuxed = get_or_remux_flac(flac_path, original.clone());
            assert!(!remuxed.is_empty());
            // Must be remuxed into an Ogg container (starts with 'OggS')
            assert!(remuxed.starts_with(b"OggS"));
        }
    }


    #[test]
    fn test_clean_missing_and_deleted_songs() {
        use crate::db::initialize_db;
        use std::io::Write;

        let temp_dir = std::env::temp_dir().join(format!("test_music_folder_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let old_song_path = temp_dir.join("old_song.mp3");
        let kept_song_path = temp_dir.join("kept_song.mp3");
        let new_song_path = temp_dir.join("new_song.mp3");

        {
            let mut f = File::create(&old_song_path).unwrap();
            f.write_all(b"dummy audio 1").unwrap();
        }
        {
            let mut f = File::create(&kept_song_path).unwrap();
            f.write_all(b"dummy audio 2").unwrap();
        }

        // Initialize SQLite db
        let db_path = temp_dir.join("test.db");
        initialize_db(&db_path).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();

        // Insert old_song and kept_song
        conn.execute(
            "INSERT INTO songs (path, title) VALUES (?1, ?2)",
            params![old_song_path.to_str().unwrap(), "Old Song"],
        ).unwrap();
        let old_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO songs (path, title) VALUES (?1, ?2)",
            params![kept_song_path.to_str().unwrap(), "Kept Song"],
        ).unwrap();

        // Simulate user deleting old_song.mp3 from disk and adding new_song.mp3
        std::fs::remove_file(&old_song_path).unwrap();
        {
            let mut f = File::create(&new_song_path).unwrap();
            f.write_all(b"dummy audio 3").unwrap();
        }

        // Current files found in directory during rescan:
        let scanned_files = vec![kept_song_path.clone(), new_song_path.clone()];

        // Clean missing & deleted songs
        let deleted = clean_missing_and_deleted_songs(&mut conn, temp_dir.to_str().unwrap(), &scanned_files).unwrap();

        // Old song should have been deleted!
        assert_eq!(deleted, vec![old_id]);

        // Verify SQLite now has only kept_song
        let mut stmt = conn.prepare("SELECT title FROM songs").unwrap();
        let remaining: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(remaining, vec!["Kept Song".to_string()]);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_mp3_attached_pic_remuxing() {
        let raw_mp3 = vec![0xFF, 0xFB, 0x90, 0x64];
        assert!(!is_mp3_with_attached_pic("track.mp3", &raw_mp3));

        let res = get_or_remux_mp3("track.mp3", raw_mp3.clone());
        assert_eq!(res, raw_mp3);

        // Test with real user MP3 file with attached picture if present
        let rex_path = "/home/sah/Music/Rex Orange County - AMAZING.mp3";
        if std::path::Path::new(rex_path).is_file() {
            let original = std::fs::read(rex_path).unwrap();
            assert!(is_mp3_with_attached_pic(rex_path, &original));
            let remuxed = get_or_remux_mp3(rex_path, original.clone());
            assert!(!remuxed.is_empty());
        }
    }
}


