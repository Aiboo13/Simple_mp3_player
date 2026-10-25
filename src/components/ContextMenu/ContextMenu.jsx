import { useEffect, useRef, useState } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import {
  getPlaylists,
  createPlaylist,
  addSongsToPlaylist,
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
  } = usePlayerStore();

  const menuRef = useRef(null);
  const submenuRef = useRef(null);
  const newPlInputRef = useRef(null);

  const [showSubmenu, setShowSubmenu] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newPlName, setNewPlName] = useState('');

  // Close context menu on outside click or scroll
  useEffect(() => {
    function handlePointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        closeContextMenu();
      }
    }

    function handleScroll() {
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
  }, [contextMenu, closeContextMenu]);

  // Focus input when creating new playlist
  useEffect(() => {
    if (isCreatingNew && newPlInputRef.current) {
      newPlInputRef.current.focus();
    }
  }, [isCreatingNew]);

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

  // Clamping coordinates so menu stays visible within viewport
  const MENU_WIDTH = 230;
  const MENU_HEIGHT = 220;
  const posX = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 12));
  const posY = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 12));

  // Determine whether submenu should fly out to the left or right
  const SUBMENU_WIDTH = 230;
  const openSubmenuLeft = posX + MENU_WIDTH + SUBMENU_WIDTH > window.innerWidth - 8;

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

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: `${posX}px`, top: `${posY}px` }}
      role="menu"
      aria-label="Song Context Menu"
      onClick={(e) => e.stopPropagation()}
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

      {/* Featured PRD Action: Play Next */}
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

      {/* PRD v1.6 Core Feature: Tambahkan ke Playlist... with Sub-Menu */}
      <div
        className="context-submenu-wrapper"
        onMouseEnter={() => setShowSubmenu(true)}
        onMouseLeave={() => {
          if (!isCreatingNew) setShowSubmenu(false);
        }}
      >
        <button
          id="context-menu-add-playlist"
          className={`context-menu-item context-menu-has-submenu ${showSubmenu ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowSubmenu((prev) => !prev);
          }}
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={showSubmenu}
        >
          <span className="context-menu-icon">📁</span>
          <span className="context-menu-label">Tambahkan ke Playlist...</span>
          <span className="context-menu-arrow">▶</span>
        </button>

        {showSubmenu && (
          <div
            ref={submenuRef}
            className={`context-submenu ${openSubmenuLeft ? 'open-left' : 'open-right'}`}
            onClick={(e) => e.stopPropagation()}
            role="menu"
            aria-label="Daftar Playlist"
          >
            <div className="context-submenu-header mono">
              <span>PILIH PLAYLIST</span>
              {isMulti && <span className="badge badge-yellow mono">{targetSongIds.length} LAGU</span>}
            </div>

            {/* "+ Buat Playlist Baru" Action */}
            {isCreatingNew ? (
              <div className="context-submenu-new-pl-box">
                <input
                  ref={newPlInputRef}
                  id="context-submenu-new-pl-input"
                  type="text"
                  className="input context-submenu-input"
                  placeholder="Nama playlist baru..."
                  value={newPlName}
                  onChange={(e) => setNewPlName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateAndAddToPlaylist();
                    if (e.key === 'Escape') setIsCreatingNew(false);
                  }}
                />
                <div className="context-submenu-new-pl-btns">
                  <button
                    id="context-submenu-confirm-pl"
                    className="btn btn-sm btn-primary"
                    onClick={handleCreateAndAddToPlaylist}
                  >
                    Simpan & Tambah
                  </button>
                  <button
                    id="context-submenu-cancel-pl"
                    className="btn btn-sm"
                    onClick={() => setIsCreatingNew(false)}
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button
                id="context-submenu-new-playlist"
                className="context-menu-item context-submenu-create-btn"
                onClick={() => {
                  setIsCreatingNew(true);
                  setNewPlName('');
                }}
                role="menuitem"
              >
                <span className="context-menu-icon">＋</span>
                <span className="context-menu-label">
                  <strong>+ Buat Playlist Baru</strong>
                </span>
              </button>
            )}

            <div className="context-submenu-divider" />

            {/* List of Existing Playlists */}
            <div className="context-submenu-playlists-list">
              {playlists.length === 0 ? (
                <div className="context-submenu-empty mono">Belum ada playlist</div>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    id={`context-submenu-playlist-${pl.id}`}
                    className="context-menu-item context-submenu-playlist-item"
                    onClick={() => handleAddToExistingPlaylist(pl)}
                    role="menuitem"
                  >
                    <span className="context-menu-icon">🎵</span>
                    <span className="context-menu-label text-truncate" title={pl.name}>
                      {pl.name}
                    </span>
                    <span className="badge mono context-menu-badge">{pl.song_count}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

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
    </div>
  );
}

