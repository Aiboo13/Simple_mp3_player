import { useEffect } from 'react';
import NavPanel from './components/NavPanel/NavPanel';
import MainPanel from './components/MainPanel/MainPanel';
import QueuePanel from './components/QueuePanel/QueuePanel';
import AudioPlayer from './components/AudioPlayer/AudioPlayer';
import ContextMenu from './components/ContextMenu/ContextMenu';
import usePlayerStore from './store/usePlayerStore';
import { getAllSongs, getPlaylists } from './lib/api';
import './App.css';

export default function App() {
  const {
    setSongs,
    setPlaylists,
    toast,
    theme,
    isLyricsFullscreen,
    setIsLyricsFullscreen,
    contextMenu,
    closeContextMenu,
    playNextSong,
    playPrevSong,
  } = usePlayerStore();

  // Sync theme attribute to html/document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Global Keyboard Shortcuts (Ctrl+F, PgUp, PgDn, Escape)
  useEffect(() => {
    function handleKeyDown(e) {
      // 1. Escape key -> close context menu or exit lyrics fullscreen
      if (e.key === 'Escape') {
        const state = usePlayerStore.getState();
        if (state.contextMenu) {
          state.closeContextMenu();
          return;
        }
        if (state.isLyricsFullscreen) {
          state.setIsLyricsFullscreen(false);
          return;
        }
      }

      // 2. Ctrl + F (or Cmd + F) -> Auto-focus search input
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const state = usePlayerStore.getState();
        if (state.isLyricsFullscreen) {
          state.setIsLyricsFullscreen(false);
        }
        setTimeout(() => {
          const searchInput = document.getElementById('search-input');
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        }, 50);
        return;
      }

      // 3. Page Up -> Previous Music
      if (e.key === 'PageUp') {
        e.preventDefault();
        usePlayerStore.getState().playPrevSong();
        return;
      }

      // 4. Page Down -> Next Music
      if (e.key === 'PageDown') {
        e.preventDefault();
        usePlayerStore.getState().playNextSong(true);
        return;
      }

      // 5. Space -> Toggle Play/Pause
      if (e.code === 'Space' || e.key === ' ') {
        const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (tag !== 'input' && tag !== 'textarea' && !e.target.isContentEditable) {
          e.preventDefault();
          const state = usePlayerStore.getState();
          const audio = state.audioElement;
          if (state.queue.length > 0 && state.currentIndex >= 0) {
            if (state.isPlaying) {
              if (audio && !audio.paused) audio.pause();
              state.setIsPlaying(false);
            } else {
              state.setIsPlaying(true);
              if (audio && audio.paused && audio.src) {
                audio.play().catch(() => {});
              }
            }
          }
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Progressive Directory Scanning Listeners (PRD 3.B: Lazy Loading / Progressive Rendering)
  useEffect(() => {
    let unlistenBatch = null;
    let unlistenDeleted = null;
    let unlistenProgress = null;
    let unlistenComplete = null;

    async function setupScanListeners() {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        unlistenBatch = await listen('scan-batch', (event) => {
          if (Array.isArray(event.payload) && event.payload.length > 0) {
            usePlayerStore.getState().appendSongsBatch(event.payload);
          }
        });

        unlistenDeleted = await listen('scan-deleted', (event) => {
          if (Array.isArray(event.payload) && event.payload.length > 0) {
            usePlayerStore.getState().removeSongsBatch(event.payload);
          }
        });

        unlistenProgress = await listen('scan-progress', (event) => {
          const { count, current_file } = event.payload || {};
          usePlayerStore
            .getState()
            .setScanProgress(`Found ${count} tracks...`);
        });

        unlistenComplete = await listen('scan-complete', (event) => {
          const store = usePlayerStore.getState();
          store.setIsScanning(false);
          store.setScanProgress('');
          getAllSongs(store.sortBy, store.sortOrder)
            .then((songs) => store.setSongs(songs))
            .catch(() => {});
          getPlaylists()
            .then((pl) => store.setPlaylists(pl))
            .catch(() => {});
        });
      } catch (err) {
        console.warn('Failed to register scan event listeners:', err);
      }
    }

    setupScanListeners();

    return () => {
      if (unlistenBatch) unlistenBatch();
      if (unlistenDeleted) unlistenDeleted();
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
    };
  }, []);

  // Load library on mount
  useEffect(() => {
    async function init() {
      try {
        const [songs, playlists] = await Promise.all([
          getAllSongs('title', 'asc'),
          getPlaylists(),
        ]);
        setSongs(songs);
        setPlaylists(playlists);
      } catch (err) {
        console.error('Failed to load library:', err);
      }
    }
    init();
  }, []);

  return (
    <div
      className={`app-shell ${isLyricsFullscreen ? 'lyrics-fullscreen' : ''}`}
      id="app-root"
      data-theme={theme}
    >
      {/* ── 3-Panel Layout ── */}
      <div className="app-panels">
        <NavPanel />
        <MainPanel />
        <QueuePanel />
      </div>

      {/* ── Audio Player Bar (bottom) ── */}
      <div className="app-player-bar">
        <AudioPlayer />
      </div>

      {/* ── Right-Click Context Menu ── */}
      <ContextMenu />

      {/* ── Toast Notification ── */}
      {toast && (
        <div
          key={toast.id}
          className={`toast ${toast.type === 'error' ? 'toast-error' : toast.type === 'success' ? 'toast-success' : ''}`}
          role="alert"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
