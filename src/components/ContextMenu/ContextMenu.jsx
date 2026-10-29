import { useEffect, useRef, useState } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import {
  getPlaylists,
  createPlaylist,
  addSongsToPlaylist,
  removeSongsFromPlaylist,
  getPlaylistSongs,
} from '../../lib/api';
import './ContextMenu.css';

export default function ContextMenu() {
  const {
    contextMenu,
    closeContextMenu,
    insertPlayNext,
    insertPlayNextBatch,
    addToQueue,
    addAllToQueue,
    removeFromQueue,
    setCurrentIndex,
    setIsPlaying,
    replaceQueue,
    songs,
    playlists,
    setPlaylists,
    setSongs,
    activeView,
    activePlaylistId,
    showToast,
    clearSelectedSongs,
  } = usePlayerStore();

  const menuRef = useRef(null);
  const modalCardRef = useRef(null);
  const newPlInputRef = useRef(null);
  const openedAtRef = useRef(0);

  const [isSelectingPlaylist, setIsSelectingPlaylist] = useState(false);
  const [newPlName, setNewPlName] = useState('');
  const [playlistSearch, setPlaylistSearch] = useState('');

  // Reset local state and record open timestamp whenever contextMenu opens/changes
  useEffect(() => {
    setIsSelectingPlaylist(false);
    setNewPlName('');
    setPlaylistSearch('');
    if (contextMenu) {
      openedAtRef.current = Date.now();
    }
  }, [contextMenu]);

  // Focus new playlist input when playlist modal opens
  useEffect(() => {
    if (isSelectingPlaylist && newPlInputRef.current) {
      setTimeout(() => {
        newPlInputRef.current?.focus();
      }, 50);
    }
  }, [isSelectingPlaylist]);

  // Close context menu on outside click or scroll (unless selecting playlist)
  // Grace period prevents auto-closing from touchpad micro-scrolls or trailing pointerdown events
  useEffect(() => {
    function handlePointerDown(e) {
      if (isSelectingPlaylist) return; // Handled by modal backdrop
      // Prevent premature closing from the opening right-click gesture / touch
      if (Date.now() - openedAtRef.current < 200) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        closeContextMenu();
      }
    }

    function handleScroll() {
      if (isSelectingPlaylist) return; // Don't close modal on playlist list scroll
      // Ignore inertial scroll or micro-scroll right when menu opened
      if (Date.now() - openedAtRef.current < 250) return;
      closeContextMenu();
    }

    if (contextMenu) {
      window.addEventListener('pointerdown', handlePointerDown);
      window.addEventListener('scroll', handleScroll, true);
      return () => {
        window.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [contextMenu, closeContextMenu, isSelectingPlaylist]);

  // Escape key listener when selecting playlist
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    }
    if (isSelectingPlaylist) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isSelectingPlaylist, closeContextMenu]);

  if (!contextMenu || !contextMenu.song) return null;

  const { x, y, song, source, index, selectedSongIds } = contextMenu;

  // Compute target songs: either multiple selected songs or the single clicked song
  const targetSongIds =
    Array.isArray(selectedSongIds) && selectedSongIds.length > 0
      ? selectedSongIds
      : [song.id];
  const isMulti = targetSongIds.length > 1;

  function getTargetSongs() {
    if (!isMulti) return [song];
    const songMap = new Map(songs.map((s) => [s.id, s]));
    return targetSongIds.map((id) => songMap.get(id)).filter(Boolean);
  }

  // Clamping coordinates so context menu stays visible within viewport
  const MENU_WIDTH = 230;
  const MENU_HEIGHT = 220;
  const posX = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 12));
  const posY = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 12));

  function handlePlayNext(e) {
    e.stopPropagation();
    try {
      if (isMulti) {
        const targetSongs = getTargetSongs();
        insertPlayNextBatch(targetSongs);
      } else {
        insertPlayNext(song);
      }
    } catch (err) {
      console.error('[ContextMenu] handlePlayNext error:', err);
    } finally {
      closeContextMenu();
    }
  }

  function handlePlayNow(e) {
    e.stopPropagation();
    try {
      if (isMulti) {
        const targetSongs = getTargetSongs();
        replaceQueue(targetSongs, 0);
        setIsPlaying(true);
      } else {
        const state = usePlayerStore.getState();
        if (source === 'queue' && typeof index === 'number') {
          setCurrentIndex(index);
          setIsPlaying(true);
        } else {
          const existingIdx = state.queue.findIndex((s) => s.id === song.id);
          if (existingIdx !== -1) {
            setCurrentIndex(existingIdx);
            setIsPlaying(true);
          } else if (state.queue.length === 0 || state.currentIndex === -1) {
            state.replaceQueue([song], 0);
            setIsPlaying(true);
          } else {
            insertPlayNext(song);
            const updatedState = usePlayerStore.getState();
            const nextIdx = Math.min(updatedState.currentIndex + 1, updatedState.queue.length - 1);
            setCurrentIndex(Math.max(0, nextIdx));
            setIsPlaying(true);
          }
        }
      }
    } catch (err) {
      console.error('[ContextMenu] handlePlayNow error:', err);
    } finally {
      closeContextMenu();
    }
  }

  function handleAddToQueue(e) {
    e.stopPropagation();
    try {
      if (isMulti) {
        const targetSongs = getTargetSongs();
        addAllToQueue(targetSongs);
        showToast(`Added ${targetSongs.length} songs to queue`);
      } else {
        addToQueue(song);
        showToast(`Added to queue: ${song.title}`);
      }
    } catch (err) {
      console.error('[ContextMenu] handleAddToQueue error:', err);
    } finally {
      closeContextMenu();
    }
  }

  function handleRemoveFromQueue(e) {
    e.stopPropagation();
    try {
      if (typeof index === 'number') {
        removeFromQueue(index);
        showToast(`Removed from queue`);
      }
    } catch (err) {
      console.error('[ContextMenu] handleRemoveFromQueue error:', err);
    } finally {
      closeContextMenu();
    }
  }

  async function handleRemoveFromPlaylist(e) {
    e.stopPropagation();
    if (!activePlaylistId) {
      closeContextMenu();
      return;
    }
    try {
      const idsToRemove = targetSongIds;
      await removeSongsFromPlaylist(activePlaylistId, idsToRemove);

      // Refresh current playlist songs view
      const updatedSongs = await getPlaylistSongs(activePlaylistId);
      setSongs(updatedSongs);

      // Refresh playlists list in sidebar to reflect updated song count
      const updatedPlaylists = await getPlaylists();
      setPlaylists(updatedPlaylists);

      clearSelectedSongs();
      showToast(`✓ Dihapus dari playlist (${idsToRemove.length} lagu)`);
    } catch (err) {
      console.error('[ContextMenu] handleRemoveFromPlaylist error:', err);
      showToast(`Gagal menghapus dari playlist: ${err}`, 'error');
    } finally {
      closeContextMenu();
    }
  }

  async function handleAddToExistingPlaylist(pl) {
    try {
      await addSongsToPlaylist(pl.id, targetSongIds);
      const updatedPlaylists = await getPlaylists();
      setPlaylists(updatedPlaylists);

      // If user is currently looking at this playlist, immediately refresh its songs
      if (activeView === 'playlist' && activePlaylistId === pl.id) {
        const updatedSongs = await getPlaylistSongs(pl.id);
        setSongs(updatedSongs);
      }

      showToast(`✓ Ditambahkan ke "${pl.name}" (${targetSongIds.length} lagu)`);
    } catch (err) {
      console.error('[ContextMenu] handleAddToExistingPlaylist error:', err);
      showToast(`Gagal menambahkan lagu: ${err}`, 'error');
    } finally {
      closeContextMenu();
    }
  }

  async function handleCreateAndAddToPlaylist() {
    const trimmed = newPlName.trim();
    if (!trimmed) {
      showToast('Nama playlist tidak boleh kosong', 'error');
      return;
    }

    try {
      const newPlaylistId = await createPlaylist(trimmed);
      await addSongsToPlaylist(newPlaylistId, targetSongIds);

      const updatedPlaylists = await getPlaylists();
      setPlaylists(updatedPlaylists);

      if (activeView === 'playlist' && activePlaylistId === newPlaylistId) {
        const updatedSongs = await getPlaylistSongs(newPlaylistId);
        setSongs(updatedSongs);
      }

      showToast(`✓ Playlist "${trimmed}" dibuat & ${targetSongIds.length} lagu ditambahkan`);
    } catch (err) {
      console.error('[ContextMenu] handleCreateAndAddToPlaylist error:', err);
      showToast(`Gagal membuat playlist: ${err}`, 'error');
    } finally {
      closeContextMenu();
    }
  }

  // ── Mode 1: Centered Playlist Selection Modal ─────────────
  if (isSelectingPlaylist) {
    const filteredPlaylists = playlistSearch.trim()
      ? playlists.filter((pl) =>
          pl.name.toLowerCase().includes(playlistSearch.toLowerCase())
        )
      : playlists;

    return (
      <div
        className="playlist-modal-backdrop"
        onClick={closeContextMenu}
        role="dialog"
        aria-modal="true"
        aria-label="Tambah ke Playlist"
      >
        <div
          ref={modalCardRef}
          className="playlist-modal-card"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="playlist-modal-header">
            <div className="playlist-modal-title-group">
              <div className="playlist-modal-title">
                <span className="playlist-modal-icon">📁</span>
                <h2>TAMBAHKAN KE PLAYLIST</h2>
              </div>
              <div className="playlist-modal-subtitle mono text-truncate">
                {isMulti ? (
                  <>
                    <span className="badge badge-yellow mono">
                      {targetSongIds.length} LAGU DIPILIH
                    </span>
                    <span className="playlist-modal-song-info">
                      {song?.title ? `Termasuk: ${song.title}` : 'Multi-selection'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="badge badge-yellow mono">1 LAGU</span>
                    <span className="playlist-modal-song-info text-truncate" title={song.title}>
                      {song.title} {song.artist ? `— ${song.artist}` : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              id="playlist-modal-close-btn"
              className="btn btn-sm playlist-modal-close-btn"
              onClick={closeContextMenu}
              title="Tutup (Esc)"
              aria-label="Tutup dialog"
            >
              ✕
            </button>
          </div>

          {/* Form Buat Playlist Baru */}
          <div className="playlist-modal-create-section">
            <div className="playlist-modal-section-label mono">
              <span>＋ BUAT PLAYLIST BARU</span>
            </div>
            <form
              className="playlist-modal-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateAndAddToPlaylist();
              }}
            >
              <input
                ref={newPlInputRef}
                id="playlist-modal-new-input"
                type="text"
                className="input playlist-modal-input"
                placeholder="Ketik nama playlist baru..."
                value={newPlName}
                onChange={(e) => setNewPlName(e.target.value)}
              />
              <button
                id="playlist-modal-create-btn"
                type="submit"
                className="btn btn-primary playlist-modal-create-btn"
                disabled={!newPlName.trim()}
              >
                + Buat & Tambah
              </button>
            </form>
          </div>

          <div className="playlist-modal-divider" />

          {/* Daftar Playlist yang Tersedia */}
          <div className="playlist-modal-list-section">
            <div className="playlist-modal-list-header">
              <div className="playlist-modal-section-label mono">
                <span>PILIH PLAYLIST TUJUAN</span>
                <span className="badge mono">{playlists.length} TOTAL</span>
              </div>
              {playlists.length >= 4 && (
                <input
                  type="text"
                  className="input playlist-modal-search"
                  placeholder="Cari nama playlist..."
                  value={playlistSearch}
                  onChange={(e) => setPlaylistSearch(e.target.value)}
                />
              )}
            </div>

            <div className="playlist-modal-items-list">
              {filteredPlaylists.length === 0 ? (
                <div className="playlist-modal-empty mono">
                  {playlists.length === 0
                    ? 'Belum ada playlist. Buat playlist baru menggunakan form di atas.'
                    : 'Tidak ada playlist yang cocok dengan pencarian.'}
                </div>
              ) : (
                filteredPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    id={`playlist-modal-item-${pl.id}`}
                    className="playlist-modal-item"
                    onClick={() => handleAddToExistingPlaylist(pl)}
                    type="button"
                  >
                    <div className="playlist-modal-item-left">
                      <span className="playlist-modal-item-icon">🎵</span>
                      <span className="playlist-modal-item-name text-truncate" title={pl.name}>
                        {pl.name}
                      </span>
                    </div>
                    <div className="playlist-modal-item-right">
                      <span className="badge mono playlist-modal-badge">
                        {pl.song_count} lagu
                      </span>
                      <span className="playlist-modal-add-icon">＋</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="playlist-modal-footer">
            <span className="playlist-modal-hint mono">
              Tip: Klik pada playlist untuk langsung memasukkan lagu
            </span>
            <button
              id="playlist-modal-cancel-btn"
              type="button"
              className="btn btn-sm playlist-modal-cancel-btn"
              onClick={closeContextMenu}
            >
              Batal
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode 2: Standard Floating Context Menu ─────────────────
  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: `${posX}px`, top: `${posY}px` }}
      role="menu"
      aria-label="Song Context Menu"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="context-menu-header">
        {isMulti ? (
          <>
            <div className="context-menu-multi-title">
              <span className="badge badge-yellow mono">{targetSongIds.length} LAGU</span>
              <span className="context-menu-song-title">Terseleksi</span>
            </div>
            <span className="context-menu-song-artist text-truncate mono">
              {song?.title ? `Termasuk: ${song.title}` : 'Multi-selection'}
            </span>
          </>
        ) : (
          <>
            <span className="context-menu-song-title text-truncate" title={song.title}>
              {song.title}
            </span>
            <span className="context-menu-song-artist text-truncate mono">
              {song.artist || 'Unknown'}
            </span>
          </>
        )}
      </div>

      {/* Featured Action: Play Next */}
      <button
        id="context-menu-play-next"
        className="context-menu-item context-menu-play-next"
        onClick={handlePlayNext}
        role="menuitem"
      >
        <span className="context-menu-icon">⏭</span>
        <span className="context-menu-label">
          {isMulti ? `Play Next (${targetSongIds.length})` : 'Play Next'}
        </span>
        <span className="badge badge-yellow context-menu-badge mono">NEXT</span>
      </button>

      <button
        id="context-menu-play-now"
        className="context-menu-item"
        onClick={handlePlayNow}
        role="menuitem"
      >
        <span className="context-menu-icon">▶</span>
        <span className="context-menu-label">
          {isMulti ? `Play Now (${targetSongIds.length})` : 'Play Now'}
        </span>
      </button>

      <button
        id="context-menu-add-queue"
        className="context-menu-item"
        onClick={handleAddToQueue}
        role="menuitem"
      >
        <span className="context-menu-icon">+</span>
        <span className="context-menu-label">
          {isMulti ? `Add to Queue (${targetSongIds.length})` : 'Add to Queue'}
        </span>
      </button>

      {/* Tambahkan ke Playlist... (Opens Centered Modal) */}
      <button
        id="context-menu-add-playlist"
        className="context-menu-item"
        onClick={(e) => {
          e.stopPropagation();
          setIsSelectingPlaylist(true);
        }}
        role="menuitem"
      >
        <span className="context-menu-icon">📁</span>
        <span className="context-menu-label">Tambahkan ke Playlist...</span>
        <span className="context-menu-arrow">▶</span>
      </button>

      {source === 'queue' && (
        <button
          id="context-menu-remove-queue"
          className="context-menu-item context-menu-item-danger"
          onClick={handleRemoveFromQueue}
          role="menuitem"
        >
          <span className="context-menu-icon">✕</span>
          <span className="context-menu-label">Remove from Queue</span>
        </button>
      )}

      {activeView === 'playlist' && activePlaylistId && (
        <button
          id="context-menu-remove-playlist"
          className="context-menu-item context-menu-item-danger"
          onClick={handleRemoveFromPlaylist}
          role="menuitem"
          title="Hapus dari playlist ini (hanya hapus dari playlist)"
        >
          <span className="context-menu-icon">✕</span>
          <span className="context-menu-label">
            {isMulti
              ? `Hapus dari Playlist (${targetSongIds.length})`
              : 'Hapus dari Playlist'}
          </span>
        </button>
      )}
    </div>
  );
}
