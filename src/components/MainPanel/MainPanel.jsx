import { useState, useEffect, useRef, useMemo } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import { searchSongs, getAlbumArt, getLyrics, formatDuration } from '../../lib/api';
import { getActiveLyricIndex } from '../../lib/lrc';
import './MainPanel.css';

const PLAY_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);

const MusicNote = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
  </svg>
);

export default function MainPanel() {
  const {
    songs, searchQuery, replaceQueue, currentIndex, addAllToQueue,
    queue, isPlaying, setIsPlaying, showLyrics, setShowLyrics,
    lyricsContent, setLyricsContent, parsedLyrics,
    currentAlbumArt, setCurrentAlbumArt,
    albumArtCache, setAlbumArt, showToast, setCurrentIndex,
    activeView, activePlaylistId,
    currentTime, seekTo,
  } = usePlayerStore();

  const [displaySongs, setDisplaySongs] = useState([]);
  const [loadingArt, setLoadingArt] = useState(false);

  const currentSong = queue[currentIndex] ?? null;

  // Filter songs by search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setDisplaySongs(songs);
      return;
    }
    const q = searchQuery.toLowerCase();
    setDisplaySongs(
      songs.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.artist || '').toLowerCase().includes(q) ||
          (s.album || '').toLowerCase().includes(q)
      )
    );
  }, [songs, searchQuery]);

  // Load album art when currentSong changes
  useEffect(() => {
    if (!currentSong) {
      setCurrentAlbumArt(null);
      return;
    }
    if (albumArtCache[currentSong.path]) {
      setCurrentAlbumArt(albumArtCache[currentSong.path]);
      return;
    }
    if (!currentSong.has_cover) {
      setCurrentAlbumArt(null);
      return;
    }
    setLoadingArt(true);
    getAlbumArt(currentSong.path)
      .then((art) => {
        setAlbumArt(currentSong.path, art || null);
        setCurrentAlbumArt(art || null);
      })
      .catch(() => setCurrentAlbumArt(null))
      .finally(() => setLoadingArt(false));
  }, [currentSong?.path]);

  // Auto-sync lyrics when currentSong changes if lyrics view is active
  useEffect(() => {
    if (!currentSong) {
      setLyricsContent(null);
      return;
    }
    if (showLyrics) {
      getLyrics(currentSong.path)
        .then((lyrics) => {
          setLyricsContent(lyrics || null);
        })
        .catch(() => setLyricsContent(null));
    }
  }, [currentSong?.path, showLyrics]);

  async function handleToggleLyrics(e) {
    if (e) e.stopPropagation();
    if (!currentSong) return;
    if (showLyrics) {
      setShowLyrics(false);
      return;
    }
    try {
      const lyrics = await getLyrics(currentSong.path);
      setLyricsContent(lyrics || null);
      setShowLyrics(true);
    } catch (err) {
      showToast('No lyrics found');
    }
  }

  function handlePlaySong(song, index) {
    if (isCurrentSong(song)) {
      setIsPlaying(true);
    } else {
      replaceQueue(displaySongs, index);
      setIsPlaying(true);
    }
  }

  function handleTogglePlaySong(song, index) {
    if (isCurrentSong(song)) {
      setIsPlaying(!isPlaying);
    } else {
      replaceQueue(displaySongs, index);
      setIsPlaying(true);
    }
  }

  function handlePlayAll() {
    if (displaySongs.length === 0) return;
    replaceQueue(displaySongs, 0);
    setIsPlaying(true);
  }

  function handleAddAllToQueue() {
    if (displaySongs.length === 0) return;
    addAllToQueue(displaySongs);
    showToast(`Added ${displaySongs.length} songs to queue`);
  }

  // Check if a song is currently playing
  function isCurrentSong(song) {
    return currentSong?.id === song.id;
  }

  return (
    <main className="main-panel" role="main">
      {/* ── Now Playing / Album Art Area ── */}
      <div
        className={`now-playing-area ${showLyrics ? 'show-lyrics' : ''}`}
        onClick={handleToggleLyrics}
        role="button"
        tabIndex={0}
        aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
        onKeyDown={(e) => e.key === 'Enter' && handleToggleLyrics()}
      >
        {showLyrics ? (
          <LyricsView
            currentSong={currentSong}
            parsedLyrics={parsedLyrics}
            currentTime={currentTime}
            seekTo={seekTo}
            onClose={(e) => {
              if (e) e.stopPropagation();
              setShowLyrics(false);
            }}
          />
        ) : currentSong ? (
          /* ── Album Art View ── */
          <div className="album-art-view">
            <div className={`album-art-wrapper ${loadingArt ? 'loading' : ''}`}>
              {currentAlbumArt ? (
                <img
                  className="album-art-img"
                  src={currentAlbumArt}
                  alt={`${currentSong.title} album art`}
                  draggable={false}
                />
              ) : (
                <div className="album-art-placeholder">
                  <MusicNote />
                </div>
              )}
              <div className="album-art-overlay">
                <span className="mono" style={{fontSize: '11px', letterSpacing: '0.1em'}}>
                  {currentSong.has_lyrics ? '♪ CLICK FOR LYRICS' : '♪ NO LYRICS'}
                </span>
              </div>
            </div>
            <div className="now-playing-info">
              <div className="now-playing-title text-truncate">{currentSong.title}</div>
              <div className="now-playing-artist text-truncate">
                {currentSong.artist || 'Unknown Artist'}
              </div>
              {currentSong.album && (
                <div className="now-playing-album text-truncate mono">{currentSong.album}</div>
              )}
            </div>
          </div>
        ) : (
          /* ── Empty State ── */
          <div className="empty-player">
            <div className="empty-player-icon">
              <MusicNote />
            </div>
            <div className="empty-player-text">
              <strong>Nothing Playing</strong>
              <span className="mono">Select a song to begin</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Song List ── */}
      <div className="song-list-section">
        <div className="song-list-header">
          <div className="song-list-title">
            <h1>
              {searchQuery
                ? `Search: "${searchQuery}"`
                : activeView === 'playlist'
                ? 'Playlist'
                : 'Full Music'}
            </h1>
            <span className="badge mono">{displaySongs.length} tracks</span>
          </div>
          <div className="song-list-actions">
            <button id="play-all-btn" className="btn btn-primary btn-sm" onClick={handlePlayAll} disabled={displaySongs.length === 0}>
              ▶ Play All
            </button>
            <button id="queue-all-btn" className="btn btn-yellow btn-sm" onClick={handleAddAllToQueue} disabled={displaySongs.length === 0}>
              + Queue All
            </button>
          </div>
        </div>

        {/* Column Headers */}
        <div className="song-list-cols mono">
          <span>#</span>
          <span>Title</span>
          <span>Artist</span>
          <span>Album</span>
          <span>Duration</span>
        </div>

        {/* Song Rows */}
        <div className="song-list-rows" role="list">
          {displaySongs.length === 0 ? (
            <div className="song-list-empty">
              <p>No songs found.</p>
              <p className="mono" style={{fontSize: '12px', color: '#aaa'}}>
                {searchQuery ? 'Try a different search term.' : 'Use "Open Folder" to add your music.'}
              </p>
            </div>
          ) : (
            displaySongs.map((song, index) => (
              <SongRow
                key={song.id}
                song={song}
                index={index}
                isCurrent={isCurrentSong(song)}
                isPlaying={isPlaying && isCurrentSong(song)}
                onPlay={() => handlePlaySong(song, index)}
                onTogglePlay={() => handleTogglePlaySong(song, index)}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function SongRow({ song, index, isCurrent, isPlaying, onPlay, onTogglePlay }) {
  const { addToQueue, showToast } = usePlayerStore();

  function handleAddToQueue(e) {
    e.stopPropagation();
    addToQueue(song);
    showToast(`Added to queue: ${song.title}`);
  }

  function handleRowClick() {
    onPlay();
  }

  return (
    <div
      id={`song-row-${song.id}`}
      className={`song-row ${isCurrent ? 'current' : ''}`}
      role="listitem"
      onClick={handleRowClick}
      onDoubleClick={handleRowClick}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPlay()}
      aria-label={`${song.title} by ${song.artist || 'Unknown'}`}
    >
      <div className="song-row-num mono">
        {isPlaying ? (
          <span className="playing-bars">
            <span/><span/><span/>
          </span>
        ) : isCurrent ? (
          <span style={{color: 'var(--clr-red)'}}>▶</span>
        ) : (
          <span className="song-row-index">{index + 1}</span>
        )}
      </div>
      <div className="song-row-title">
        <span className="song-name text-truncate">{song.title}</span>
        {song.has_lyrics && <span className="badge badge-blue song-lyrics-badge">♪</span>}
      </div>
      <div className="song-row-artist text-truncate">{song.artist || '—'}</div>
      <div className="song-row-album text-truncate">{song.album || '—'}</div>
      <div className="song-row-dur mono">{formatDuration(song.duration_secs)}</div>
      <div className="song-row-actions">
        <button
          id={`queue-btn-${song.id}`}
          className="btn btn-icon btn-sm song-queue-btn"
          onClick={handleAddToQueue}
          aria-label={`Add ${song.title} to queue`}
          title="Add to queue"
        >
          +
        </button>
        <button
          id={`play-btn-${song.id}`}
          className="btn btn-icon btn-sm song-play-btn btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePlay();
          }}
          aria-label={isCurrent && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
          title={isCurrent && isPlaying ? "Pause" : "Play"}
        >
          {isCurrent && isPlaying ? '❚❚' : '▶'}
        </button>
      </div>
    </div>
  );
}

function LyricsView({ currentSong, parsedLyrics, currentTime, seekTo, onClose }) {
  const activeLineRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const scrollTimeoutRef = useRef(null);

  const activeIndex = useMemo(
    () => getActiveLyricIndex(parsedLyrics, currentTime),
    [parsedLyrics, currentTime]
  );

  const isSynced = parsedLyrics.length > 0 && parsedLyrics.some((l) => l.time >= 0);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeIndex >= 0 && activeLineRef.current && !userScrolled) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, userScrolled]);

  // Clean up scroll timer on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const handleScroll = () => {
    setUserScrolled(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setUserScrolled(false);
    }, 2500);
  };

  const handleLineClick = (lineTime) => {
    if (lineTime >= 0) {
      seekTo(lineTime);
    }
  };

  return (
    <div className="lyrics-view" onClick={(e) => e.stopPropagation()}>
      <div className="lyrics-header">
        <span className={`badge ${isSynced ? 'badge-red' : 'badge-blue'}`}>
          {isSynced ? 'SYNCED' : 'LYRICS'}
        </span>
        <span className="lyrics-song-name text-truncate">
          {currentSong?.title} — {currentSong?.artist || 'Unknown'}
        </span>
        <button
          className="lyrics-close-btn"
          onClick={onClose}
          aria-label="Close lyrics"
          title="Close lyrics"
        >
          ✕ Close
        </button>
      </div>

      <div className="lyrics-content" onScroll={handleScroll}>
        {parsedLyrics && parsedLyrics.length > 0 ? (
          <div className="lyrics-lines">
            {parsedLyrics.map((line, idx) => {
              const isActive = isSynced && idx === activeIndex;
              const isPast = isSynced && activeIndex >= 0 && idx < activeIndex;

              return (
                <div
                  key={line.id ?? idx}
                  ref={isActive ? activeLineRef : null}
                  className={`lyrics-line ${isActive ? 'active' : ''} ${isPast ? 'past' : ''} ${line.time >= 0 ? 'clickable' : ''}`}
                  onClick={() => handleLineClick(line.time)}
                  title={line.time >= 0 ? `Jump to ${formatDuration(line.time)}` : undefined}
                >
                  {line.text || '♪'}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="lyrics-empty">
            <span>No lyrics found for this file.</span>
            <span className="mono" style={{ fontSize: '12px', color: '#aaa' }}>
              Add a .lrc file or embed USLT/SYLT tags to display synced lyrics.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
