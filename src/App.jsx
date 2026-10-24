import { useEffect } from 'react';
import NavPanel from './components/NavPanel/NavPanel';
import MainPanel from './components/MainPanel/MainPanel';
import QueuePanel from './components/QueuePanel/QueuePanel';
import AudioPlayer from './components/AudioPlayer/AudioPlayer';
import usePlayerStore from './store/usePlayerStore';
import { getAllSongs, getPlaylists } from './lib/api';
import './App.css';

export default function App() {
  const { setSongs, setPlaylists, toast, theme } = usePlayerStore();

  // Sync theme attribute to html/document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
    <div className="app-shell" id="app-root" data-theme={theme}>
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
