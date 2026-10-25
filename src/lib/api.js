import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export { convertFileSrc };

/**
 * Scan a directory for music files and index them in SQLite
 */
export async function scanDirectory(path) {
  return invoke('scan_directory', { path });
}

/**
 * Get all songs with optional sorting
 */
export async function getAllSongs(sortBy = 'title', sortOrder = 'asc') {
  return invoke('get_all_songs', { sortBy, sortOrder });
}

/**
 * Search songs by title, artist, or album
 */
export async function searchSongs(query) {
  return invoke('search_songs', { query });
}

/**
 * Get all playlists with song count
 */
export async function getPlaylists() {
  return invoke('get_playlists');
}

/**
 * Create a new playlist
 */
export async function createPlaylist(name) {
  return invoke('create_playlist', { name });
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(id) {
  return invoke('delete_playlist', { id });
}

/**
 * Add songs to a playlist
 */
export async function addSongsToPlaylist(playlistId, songIds) {
  return invoke('add_songs_to_playlist', { playlistId, songIds });
}

/**
 * Remove a song from a playlist
 */
export async function removeSongFromPlaylist(playlistId, songId) {
  return invoke('remove_song_from_playlist', { playlistId, songId });
}

/**
 * Get all songs in a playlist
 */
export async function getPlaylistSongs(playlistId) {
  return invoke('get_playlist_songs', { playlistId });
}

/**
 * Get lyrics for a song
 */
export async function getLyrics(path) {
  return invoke('get_lyrics', { path });
}

/**
 * Get album art as base64 data URL
 */
export async function getAlbumArt(path) {
  return invoke('get_album_art', { path });
}

/**
 * Get indexed music directories
 */
export async function getMusicDirs() {
  return invoke('get_music_dirs');
}

/**
 * Remove a music directory
 */
export async function removeMusicDir(id) {
  return invoke('remove_music_dir', { id });
}

/**
 * Detect actual audio MIME type from binary magic bytes to support files with mismatched extensions
 * (e.g., MP4/AAC/DASH files disguised with .mp3 extension).
 */
export function detectAudioMimeType(uint8Array, fallbackExt = '') {
  if (!uint8Array || uint8Array.length < 4) {
    const ext = (fallbackExt || '').toLowerCase();
    const mimeMap = {
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      wav: 'audio/wav',
      aac: 'audio/aac',
    };
    return mimeMap[ext] || 'audio/mpeg';
  }

  // 1. ISO Base Media File Format (MP4 / M4A / DASH / QuickTime container)
  // Bytes 4..8 == 'ftyp'
  if (
    uint8Array.length >= 8 &&
    uint8Array[4] === 0x66 && // 'f'
    uint8Array[5] === 0x74 && // 't'
    uint8Array[6] === 0x79 && // 'y'
    uint8Array[7] === 0x70    // 'p'
  ) {
    return 'audio/mp4';
  }

  // 2. FLAC ('fLaC')
  if (
    uint8Array[0] === 0x66 &&
    uint8Array[1] === 0x4c &&
    uint8Array[2] === 0x61 &&
    uint8Array[3] === 0x43
  ) {
    return 'audio/flac';
  }

  // 3. Ogg container ('OggS')
  if (
    uint8Array[0] === 0x4f &&
    uint8Array[1] === 0x67 &&
    uint8Array[2] === 0x67 &&
    uint8Array[3] === 0x73
  ) {
    return 'audio/ogg';
  }

  // 4. WAV ('RIFF' ... 'WAVE')
  if (
    uint8Array.length >= 12 &&
    uint8Array[0] === 0x52 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 && uint8Array[3] === 0x46 &&
    uint8Array[8] === 0x57 && uint8Array[9] === 0x41 && uint8Array[10] === 0x56 && uint8Array[11] === 0x45
  ) {
    return 'audio/wav';
  }

  // 5. MP3 with ID3v2 header ('ID3')
  if (
    uint8Array[0] === 0x49 &&
    uint8Array[1] === 0x44 &&
    uint8Array[2] === 0x33
  ) {
    return 'audio/mpeg';
  }

  // 6. Raw MPEG Frame Sync (11 consecutive 1s: 0xFF followed by high 3 bits 111)
  if (uint8Array[0] === 0xff && (uint8Array[1] & 0xe0) === 0xe0) {
    const layerBits = (uint8Array[1] >> 1) & 0x03;
    if (layerBits === 0) {
      // ADTS AAC
      return 'audio/aac';
    }
    // MPEG Layer I, II, or III (MP3)
    return 'audio/mpeg';
  }

  // Fallback by extension
  const ext = (fallbackExt || '').toLowerCase();
  const mimeMap = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    wav: 'audio/wav',
    aac: 'audio/aac',
  };
  return mimeMap[ext] || 'audio/mpeg';
}

/**
 * Read raw audio file bytes and return a native browser Blob URL.
 * PRD v1.5 §4.B: Pass `isPureAudio=true` for files without ID3 headers so the Rust backend
 * takes the fast-path (no fMP4 detection, no metadata probe), eliminating the 1-second stutter.
 *
 * NOTE (Tauri v2): invoke() parameters must use snake_case to match Rust function signatures.
 * `is_pure_audio` maps to `is_pure_audio: Option<bool>` in commands.rs.
 */
export async function readAudioFile(path, isPureAudio = false) {
  // Tauri v2 requires snake_case keys — camelCase is NOT auto-converted unlike Tauri v1
  const bytes = await invoke('read_audio_file', { path, is_pure_audio: isPureAudio });
  const u8 = new Uint8Array(bytes);
  const ext = (path.split('.').pop() || '').toLowerCase();
  const type = detectAudioMimeType(u8, ext);
  const blob = new Blob([u8], { type });
  return URL.createObjectURL(blob);
}

/**
 * Format seconds to MM:SS string
 */
export function formatDuration(secs) {
  if (!secs || isNaN(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
