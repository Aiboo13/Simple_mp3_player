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
 * Read raw audio file bytes and return a native browser Blob URL
 */
export async function readAudioFile(path) {
  const bytes = await invoke('read_audio_file', { path });
  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
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
