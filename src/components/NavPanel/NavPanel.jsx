import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import usePlayerStore from '../../store/usePlayerStore';
import {
  scanDirectory,
  getAllSongs,
  getPlaylists,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  getPlaylistSongs,
} from '../../lib/api';
import './NavPanel.css';

const NAV_ICON_MUSIC = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
  </svg>
);
const NAV_ICON_LIST = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);
const ICON_PLUS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const ICON_FOLDER = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);
const ICON_EDIT = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const ICON_CHECK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const ICON_TRASH = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
  </svg>
);
const ICON_SCAN = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.18-4.6"/>
  </svg>
);

const THEMES = [
  { id: 'default', label: 'Brutal', icon: '🎨', name: 'Brutalism (Default)' },
  { id: 'bw', label: 'B & W', icon: '⚪', name: 'Black & White' },
  { id: 'darkweb', label: 'DarkWeb', icon: '🟢', name: 'Dark Web' },
];

export default function NavPanel() {
  const {
    activeView, setActiveView,
    setActivePlaylistId,
    songs,
    setSongs, setPlaylists, playlists,
    searchQuery, setSearchQuery,
    sortBy, setSortBy, sortOrder, setSortOrder,
    isScanning, setIsScanning, scanProgress, setScanProgress,
    showToast, replaceQueue,
    activePlaylistId,
    theme, setTheme, cycleTheme,
    clearSelectedSongs,
  } = usePlayerStore();

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [editingName, setEditingName] = useState('');

  // ── Handlers ──────────────────────────────────────────────
  async function handleScanDirectory() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;

      setIsScanning(true);
      setScanProgress(`Scanning ${selected}...`);
      const count = await scanDirectory(selected);
      showToast(`✓ Found ${count} tracks`, 'success');

      const songs = await getAllSongs(sortBy, sortOrder);
      setSongs(songs);
      const pl = await getPlaylists();
      setPlaylists(pl);
    } catch (err) {
      showToast(`Error: ${err}`, 'error');
    } finally {
      setIsScanning(false);
      setScanProgress('');
    }
  }

  async function handleSelectLibrary() {
    setActiveView('library');
    setActivePlaylistId(null);
    clearSelectedSongs();
    try {
      const songs = await getAllSongs(sortBy, sortOrder);
      setSongs(songs);
    } catch (err) {
      showToast(`Error loading library: ${err}`, 'error');
    }
  }

  async function handleSelectPlaylist(pl) {
    setActiveView('playlist');
    setActivePlaylistId(pl.id);
    clearSelectedSongs();
    try {
      const songs = await getPlaylistSongs(pl.id);
      setSongs(songs);
    } catch (err) {
      showToast(`Error loading playlist: ${err}`, 'error');
    }
  }

  async function handleCreatePlaylist() {
    if (!newPlaylistName.trim()) return;
    try {
      await createPlaylist(newPlaylistName.trim());
      const pl = await getPlaylists();
      setPlaylists(pl);
      setNewPlaylistName('');
      setShowNewPlaylist(false);
      showToast(`Created: ${newPlaylistName.trim()}`);
    } catch (err) {
      showToast(`Error: ${err}`, 'error');
    }
  }

  function handleStartRename(e, pl) {
    e.stopPropagation();
    setEditingPlaylistId(pl.id);
    setEditingName(pl.name);
  }

  async function handleSaveRename(id) {
    const trimmed = editingName.trim();
    if (!trimmed) {
      showToast('Nama playlist tidak boleh kosong', 'error');
      return;
    }
    try {
      await renamePlaylist(id, trimmed);
      const pl = await getPlaylists();
      setPlaylists(pl);
      setEditingPlaylistId(null);
      showToast(`✓ Playlist diubah: "${trimmed}"`);
    } catch (err) {
      showToast(`Gagal mengubah nama: ${err}`, 'error');
    }
  }

  async function handleDeletePlaylist(e, id) {
    e.stopPropagation();
    try {
      await deletePlaylist(id);
      const pl = await getPlaylists();
      setPlaylists(pl);
      if (activePlaylistId === id) {
        setActiveView('library');
        setActivePlaylistId(null);
        const songs = await getAllSongs(sortBy, sortOrder);
        setSongs(songs);
      }
      showToast('Playlist deleted');
    } catch (err) {
      showToast(`Error: ${err}`, 'error');
    }
  }

  async function handleSortChange(newSortBy) {
    let newOrder = 'asc';
    if (sortBy === newSortBy) {
      newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      setSortOrder(newOrder);
    } else {
      setSortBy(newSortBy);
      setSortOrder('asc');
    }
    try {
      const songs = await getAllSongs(newSortBy, newOrder);
      setSongs(songs);
    } catch (err) {
      showToast(`Error: ${err}`, 'error');
    }
  }

  return (
    <nav className="nav-panel" aria-label="Navigation">
      {/* ── Brand ── */}
      <div className="nav-brand">
        <span className="nav-brand-icon">▶</span>
        <div className="nav-brand-text">
          <div className="nav-brand-name">
            {theme === 'darkweb' ? 'DARK WEB' : 'MP3 Player'}
          </div>
          <div className="nav-brand-sub mono">
            {theme === 'darkweb' ? '// TERMINAL' : 'LOKAL'}
          </div>
        </div>
        <button
          id="quick-theme-btn"
          className="btn btn-icon btn-sm nav-quick-theme"
          onClick={() => {
            const next = cycleTheme();
            const found = THEMES.find((t) => t.id === next);
            showToast(`Tema: ${found?.name || next}`);
          }}
          title="Ganti tema (Brutalism / B&W / Dark Web)"
          aria-label="Ganti tema"
        >
          {theme === 'default' ? '🎨' : theme === 'bw' ? '⚪' : '🟢'}
        </button>
      </div>

      {/* ── Search ── */}
      <div className="nav-search-wrap">
        <div className="nav-search-inner">
          <svg className="nav-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            id="search-input"
            className="input nav-search-input"
            type="text"
            placeholder="Search songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search songs"
          />
          {searchQuery && (
            <button className="nav-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">✕</button>
          )}
        </div>
      </div>

      {/* ── Main Nav ── */}
      <div className="nav-section">
        <div className="nav-section-label mono">LIBRARY</div>
        <button
          id="nav-full-music"
          className={`nav-item ${activeView === 'library' && !activePlaylistId ? 'active' : ''}`}
          onClick={handleSelectLibrary}
        >
          {NAV_ICON_MUSIC}
          <span>Full Music</span>
          <span className="nav-item-badge badge mono">{songs?.length || ''}</span>
        </button>
      </div>

      {/* ── Sort Controls ── */}
      {activeView === 'library' && (
        <div className="nav-sort">
          <div className="nav-section-label mono">SORT BY</div>
          <div className="nav-sort-btns">
            {[['title', 'Title'], ['artist', 'Artist'], ['date_added', 'Date'], ['duration', 'Duration']].map(([key, label]) => (
              <button
                key={key}
                id={`sort-${key}`}
                className={`btn btn-sm nav-sort-btn ${sortBy === key ? 'active' : ''}`}
                onClick={() => handleSortChange(key)}
              >
                {label}
                {sortBy === key && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Playlists ── */}
      <div className="nav-section nav-playlists">
        <div className="nav-playlists-header">
          <div className="nav-section-label mono">PLAYLISTS</div>
          <button
            id="create-playlist-btn"
            className="btn btn-sm btn-icon"
            onClick={() => setShowNewPlaylist((v) => !v)}
            aria-label="Create playlist"
            title="New Playlist"
          >
            {ICON_PLUS}
          </button>
        </div>

        {showNewPlaylist && (
          <div className="nav-new-playlist">
            <input
              id="new-playlist-name"
              className="input"
              type="text"
              placeholder="Playlist name..."
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
              autoFocus
            />
            <div className="nav-new-playlist-btns">
              <button id="confirm-playlist" className="btn btn-sm btn-primary" onClick={handleCreatePlaylist}>Create</button>
              <button id="cancel-playlist" className="btn btn-sm" onClick={() => setShowNewPlaylist(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="nav-playlist-list">
          {playlists.length === 0 ? (
            <p className="nav-empty-hint mono">No playlists yet</p>
          ) : (
            playlists.map((pl) =>
              editingPlaylistId === pl.id ? (
                <div
                  key={pl.id}
                  className="nav-playlist-edit-wrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    className="input nav-playlist-edit-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(pl.id);
                      if (e.key === 'Escape') setEditingPlaylistId(null);
                    }}
                    autoFocus
                  />
                  <button
                    className="btn btn-sm btn-primary nav-playlist-edit-btn"
                    onClick={() => handleSaveRename(pl.id)}
                    title="Simpan nama"
                    aria-label="Simpan nama playlist"
                  >
                    {ICON_CHECK}
                  </button>
                  <button
                    className="btn btn-sm nav-playlist-edit-btn"
                    onClick={() => setEditingPlaylistId(null)}
                    title="Batal"
                    aria-label="Batal ubah nama"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  key={pl.id}
                  id={`playlist-${pl.id}`}
                  className={`nav-item nav-playlist-item ${activePlaylistId === pl.id ? 'active' : ''}`}
                  onClick={() => handleSelectPlaylist(pl)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSelectPlaylist(pl);
                  }}
                >
                  {NAV_ICON_LIST}
                  <span className="text-truncate">{pl.name}</span>
                  <span className="nav-item-badge badge mono">{pl.song_count}</span>
                  <div className="nav-playlist-item-actions">
                    <button
                      className="nav-playlist-edit"
                      onClick={(e) => handleStartRename(e, pl)}
                      aria-label={`Rename ${pl.name}`}
                      title="Ubah nama playlist"
                    >
                      {ICON_EDIT}
                    </button>
                    <button
                      className="nav-playlist-del"
                      onClick={(e) => handleDeletePlaylist(e, pl.id)}
                      aria-label={`Delete ${pl.name}`}
                      title="Hapus playlist"
                    >
                      {ICON_TRASH}
                    </button>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </div>

      {/* ── Footer: Theme Selector & Scan Directory ── */}
      <div className="nav-footer">
        {/* Theme Selector */}
        <div className="nav-theme-box">
          <div className="nav-theme-header mono">
            <span className="nav-theme-title">THEME</span>
            <span className="nav-theme-badge badge mono">
              {THEMES.find((t) => t.id === theme)?.label || 'Theme'}
            </span>
          </div>
          <div className="nav-theme-btns">
            {THEMES.map((t) => (
              <button
                key={t.id}
                id={`theme-btn-${t.id}`}
                className={`btn btn-sm nav-theme-pill ${theme === t.id ? 'active' : ''}`}
                onClick={() => {
                  setTheme(t.id);
                  showToast(`Tema: ${t.name}`);
                }}
                title={`Ganti tema ke ${t.name}`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {isScanning && (
          <div className="nav-scan-progress mono">{scanProgress || 'Scanning...'}</div>
        )}
        <button
          id="scan-directory-btn"
          className="btn btn-primary nav-scan-btn"
          onClick={handleScanDirectory}
          disabled={isScanning}
        >
          {isScanning ? ICON_SCAN : ICON_FOLDER}
          {isScanning ? 'Scanning...' : 'Open Folder'}
        </button>
      </div>
    </nav>
  );
}
