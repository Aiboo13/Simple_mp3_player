import { useState, useEffect, useRef, useMemo } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import {
  searchSongs,
  getAlbumArt,
  getLyrics,
  formatDuration,
  renamePlaylist,
  deletePlaylist,
  removeSongFromPlaylist,
  removeSongsFromPlaylist,
  getPlaylistSongs,
  getPlaylists,
  getAllSongs,
} from '../../lib/api';
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
    queue, isPlaying, setIsPlaying,
    lyricsContent, setLyricsContent, parsedLyrics,
    currentAlbumArt, setCurrentAlbumArt,
    albumArtCache, setAlbumArt, showToast, setCurrentIndex,
    activeView, setActiveView,
    activePlaylistId, setActivePlaylistId,
    playlists, setPlaylists, setSongs,
    sortBy, sortOrder,
    currentTime, seekTo,
    isLyricsFullscreen, toggleLyricsFullscreen,
    openContextMenu,
    selectedSongIds, setSelectedSongIds, toggleSelectSongId, clearSelectedSongs,
  } = usePlayerStore();

  const [displaySongs, setDisplaySongs] = useState([]);
  const [loadingArt, setLoadingArt] = useState(false);
  const [isEditingPlaylistTitle, setIsEditingPlaylistTitle] = useState(false);
  const [playlistTitleInput, setPlaylistTitleInput] = useState('');
  const lastClickedIndexRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selectedSongIds), [selectedSongIds]);
  const currentPlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) || null,
    [playlists, activePlaylistId]
  );

  const currentSong = queue[currentIndex] ?? null;

  // Global keyboard shortcuts: Ctrl/Cmd+A to select all, Escape to clear selection
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return;
        }
        e.preventDefault();
        if (displaySongs.length > 0) {
          setSelectedSongIds(displaySongs.map((s) => s.id));
        }
      } else if (e.key === 'Escape') {
        if (selectedSongIds.length > 0) {
          clearSelectedSongs();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displaySongs, selectedSongIds, clearSelectedSongs, setSelectedSongIds]);

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

  // Load album art when currentSong changes (bypasses pure audio tracks with no metadata/cover)
  useEffect(() => {
    if (!currentSong) {
      setCurrentAlbumArt(null);
      return;
    }
    // PRD 3.A.3: Pure Audio Bypass — Skip album art search if no cover or no metadata
    if (currentSong.has_metadata === false || !currentSong.has_cover) {
      setCurrentAlbumArt(null);
      return;
    }
    if (albumArtCache[currentSong.path]) {
      setCurrentAlbumArt(albumArtCache[currentSong.path]);
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
  }, [currentSong?.path, currentSong?.has_cover, currentSong?.has_metadata]);

  // Automatically fetch lyrics when currentSong changes (bypasses pure audio tracks)
  useEffect(() => {
    if (!currentSong) {
      setLyricsContent(null);
      return;
    }
    // PRD 3.A.3: Pure Audio Bypass — Skip lyrics search if no lyrics or no metadata
    if (currentSong.has_metadata === false || !currentSong.has_lyrics) {
      setLyricsContent(null);
      return;
    }
    getLyrics(currentSong.path)
      .then((lyrics) => {
        setLyricsContent(lyrics || null);
      })
      .catch(() => setLyricsContent(null));
  }, [currentSong?.path, currentSong?.has_lyrics, currentSong?.has_metadata]);

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
      usePlayerStore.getState().togglePlayPause();
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

  async function handleSavePlaylistTitle() {
    if (!activePlaylistId) return;
    const trimmed = playlistTitleInput.trim();
    if (!trimmed) {
      showToast('Nama playlist tidak boleh kosong', 'error');
      return;
    }
    try {
      await renamePlaylist(activePlaylistId, trimmed);
      const pl = await getPlaylists();
      setPlaylists(pl);
      setIsEditingPlaylistTitle(false);
      showToast(`✓ Playlist diubah: "${trimmed}"`);
    } catch (err) {
      console.error(err);
      showToast(`Gagal mengubah nama: ${err}`, 'error');
    }
  }

  async function handleDeleteCurrentPlaylist() {
    if (!activePlaylistId) return;
    try {
      await deletePlaylist(activePlaylistId);
      const pl = await getPlaylists();
      setPlaylists(pl);
      setActiveView('library');
      setActivePlaylistId(null);
      const allSongs = await getAllSongs(sortBy, sortOrder);
      setSongs(allSongs);
      showToast('Playlist deleted');
    } catch (err) {
      console.error(err);
      showToast(`Gagal menghapus playlist: ${err}`, 'error');
    }
  }

  async function handleBatchRemoveFromPlaylist() {
    if (!activePlaylistId || selectedSongIds.length === 0) return;
    try {
      const count = selectedSongIds.length;
      await removeSongsFromPlaylist(activePlaylistId, selectedSongIds);
      const updated = await getPlaylistSongs(activePlaylistId);
      setSongs(updated);
      const pl = await getPlaylists();
      setPlaylists(pl);
      clearSelectedSongs();
      showToast(`✓ Dihapus dari playlist (${count} lagu)`);
    } catch (err) {
      console.error(err);
      showToast(`Gagal menghapus dari playlist: ${err}`, 'error');
    }
  }

  async function handleRemoveSongFromPlaylist(song) {
    if (!activePlaylistId) return;
    try {
      await removeSongFromPlaylist(activePlaylistId, song.id);
      const updated = await getPlaylistSongs(activePlaylistId);
      setSongs(updated);
      const pl = await getPlaylists();
      setPlaylists(pl);
      if (selectedSongIds.includes(song.id)) {
        setSelectedSongIds(selectedSongIds.filter((id) => id !== song.id));
      }
      showToast(`✓ Dihapus dari playlist: ${song.title}`);
    } catch (err) {
      console.error(err);
      showToast(`Gagal menghapus dari playlist: ${err}`, 'error');
    }
  }

  return (
    <main className={`main-panel ${isLyricsFullscreen ? 'lyrics-fullscreen' : ''}`} role="main">
      {/* ── Side-by-Side Now Playing Area ── */}
      <div className={`now-playing-area ${isLyricsFullscreen ? 'fullscreen-mode' : ''}`}>
        {currentSong ? (
          <div className="now-playing-split">
            {/* ── Left Side: Album Art & Track Details ── */}
            <div className="now-playing-media">
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
              </div>
              <div className="now-playing-info">
                <div className="now-playing-title text-truncate" title={currentSong.title}>
                  {currentSong.title}
                </div>
                <div className="now-playing-artist text-truncate" title={currentSong.artist}>
                  {currentSong.artist || 'Unknown Artist'}
                </div>
                {currentSong.album && (
                  <div className="now-playing-album text-truncate mono" title={currentSong.album}>
                    {currentSong.album}
                  </div>
                )}
              </div>
            </div>

            {/* ── Vertical Divider Line ── */}
            <div className="now-playing-divider" />

            {/* ── Right Side: Synced Lyrics Stream (or completely blank if no lyrics) ── */}
            <LyricsSidePanel
              currentSong={currentSong}
              parsedLyrics={parsedLyrics}
              currentTime={currentTime}
              seekTo={seekTo}
              isFullscreen={isLyricsFullscreen}
              onToggleFullscreen={toggleLyricsFullscreen}
            />
          </div>
        ) : (
          /* ── Empty State when nothing is playing ── */
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

      {/* ── Song List Section (Hidden when lyrics are in fullscreen mode) ── */}
      {!isLyricsFullscreen && (
        <div className="song-list-section">
          <div className="song-list-header">
            <div className="song-list-title">
              {isEditingPlaylistTitle && activeView === 'playlist' ? (
                <div className="playlist-title-edit-wrap">
                  <input
                    type="text"
                    className="input playlist-title-input"
                    value={playlistTitleInput}
                    onChange={(e) => setPlaylistTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePlaylistTitle();
                      if (e.key === 'Escape') setIsEditingPlaylistTitle(false);
                    }}
                    autoFocus
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleSavePlaylistTitle}
                    title="Simpan nama"
                    aria-label="Simpan nama playlist"
                  >
                    ✓
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => setIsEditingPlaylistTitle(false)}
                    title="Batal"
                    aria-label="Batal ubah nama"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <h1>
                    {searchQuery
                      ? `Search: "${searchQuery}"`
                      : activeView === 'playlist'
                      ? (currentPlaylist?.name || 'Playlist')
                      : 'Full Music'}
                  </h1>
                  {activeView === 'playlist' && activePlaylistId && !searchQuery && (
                    <div className="playlist-header-btns">
                      <button
                        className="btn btn-sm btn-icon playlist-header-btn"
                        onClick={() => {
                          setIsEditingPlaylistTitle(true);
                          setPlaylistTitleInput(currentPlaylist?.name || '');
                        }}
                        title="Ubah nama playlist"
                        aria-label="Ubah nama playlist"
                      >
                        ✎
                      </button>
                      <button
                        className="btn btn-sm btn-icon playlist-header-btn playlist-header-del"
                        onClick={handleDeleteCurrentPlaylist}
                        title="Hapus playlist"
                        aria-label="Hapus playlist"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </>
              )}
              <span className="badge mono">{displaySongs.length} tracks</span>
              {selectedSongIds.length > 0 && (
                <div className="song-selection-badge-wrap">
                  <span className="badge badge-yellow mono">{selectedSongIds.length} selected</span>
                  <button
                    id="clear-selection-btn"
                    className="btn btn-sm btn-clear-selection"
                    onClick={clearSelectedSongs}
                    title="Deselect all (Esc)"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            <div className="song-list-actions">
              {activeView === 'playlist' && activePlaylistId && selectedSongIds.length > 0 && (
                <button
                  id="batch-remove-pl-btn"
                  className="btn btn-danger btn-sm"
                  onClick={handleBatchRemoveFromPlaylist}
                  title="Hapus lagu terpilih HANYA dari playlist ini (tetap ada di library)"
                >
                  ✕ Hapus ({selectedSongIds.length}) dari Playlist
                </button>
              )}
              {selectedSongIds.length > 1 && (
                <button
                  id="batch-playlist-btn"
                  className="btn btn-yellow btn-sm"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const firstSong = displaySongs.find((s) => selectedSongIds.includes(s.id)) || displaySongs[0];
                    openContextMenu({
                      x: rect.left,
                      y: rect.bottom + 4,
                      song: firstSong,
                      source: 'main',
                      index: 0,
                      selectedSongIds,
                    });
                  }}
                  title="Tambahkan lagu terpilih ke playlist"
                >
                  + Playlist ({selectedSongIds.length})
                </button>
              )}
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
                  isSelected={selectedSet.has(song.id)}
                  isPlaying={isPlaying && isCurrentSong(song)}
                  isInPlaylist={activeView === 'playlist' && Boolean(activePlaylistId)}
                  onRemoveFromPlaylist={() => handleRemoveSongFromPlaylist(song)}
                  onClick={(e) => {
                    const isMulti = e.ctrlKey || e.metaKey;
                    if (isMulti) {
                      toggleSelectSongId(song.id);
                      lastClickedIndexRef.current = index;
                    } else if (e.shiftKey && lastClickedIndexRef.current !== null) {
                      const start = Math.min(lastClickedIndexRef.current, index);
                      const end = Math.max(lastClickedIndexRef.current, index);
                      const rangeIds = displaySongs.slice(start, end + 1).map((s) => s.id);
                      setSelectedSongIds(Array.from(new Set([...selectedSongIds, ...rangeIds])));
                    } else {
                      setSelectedSongIds([song.id]);
                      lastClickedIndexRef.current = index;
                    }
                  }}
                  onPlay={() => handlePlaySong(song, index)}
                  onTogglePlay={() => handleTogglePlaySong(song, index)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    let currentSelection = selectedSongIds;
                    if (!selectedSongIds.includes(song.id)) {
                      currentSelection = [song.id];
                      setSelectedSongIds(currentSelection);
                      lastClickedIndexRef.current = index;
                    }
                    openContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      song,
                      source: 'main',
                      index,
                      selectedSongIds: currentSelection,
                    });
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function SongRow({
  song,
  index,
  isCurrent,
  isSelected,
  isPlaying,
  isInPlaylist,
  onRemoveFromPlaylist,
  onClick,
  onPlay,
  onTogglePlay,
  onContextMenu,
}) {
  const { addToQueue, showToast } = usePlayerStore();

  function handleAddToQueue(e) {
    e.stopPropagation();
    try {
      addToQueue(song);
      showToast(`Added to queue: ${song.title}`);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      id={`song-row-${song.id}`}
      className={`song-row ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
      role="listitem"
      onClick={onClick}
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onPlay();
        }
      }}
      aria-label={`${song.title} by ${song.artist || 'Unknown'}`}
      aria-selected={isSelected}
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
        {isInPlaylist && (
          <button
            id={`remove-pl-btn-${song.id}`}
            className="btn btn-icon btn-sm song-remove-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFromPlaylist();
            }}
            aria-label={`Hapus ${song.title} dari playlist`}
            title="Hapus dari playlist (hanya hapus dari playlist)"
          >
            ✕
          </button>
        )}
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

function LyricsSidePanel({ currentSong, parsedLyrics, currentTime, seekTo, isFullscreen, onToggleFullscreen }) {
  const activeLineRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const scrollTimeoutRef = useRef(null);

  const hasLyrics = Boolean(parsedLyrics && parsedLyrics.length > 0);

  const activeIndex = useMemo(
    () => (hasLyrics ? getActiveLyricIndex(parsedLyrics, currentTime) : -1),
    [parsedLyrics, currentTime, hasLyrics]
  );

  const isSynced = hasLyrics && parsedLyrics.some((l) => l.time >= 0);

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
    <div className="now-playing-lyrics" onClick={(e) => e.stopPropagation()}>
      {/* ── Toolbar: Status & Fullscreen Toggle ── */}
      <div className="lyrics-toolbar">
        {hasLyrics ? (
          <div className="lyrics-toolbar-left">
            <span className={`badge ${isSynced ? 'badge-red' : 'badge-blue'}`}>
              {isSynced ? 'SYNCED' : 'LYRICS'}
            </span>
          </div>
        ) : (
          <div className="lyrics-toolbar-left" />
        )}

        <button
          id="fullscreen-lyrics-btn"
          className="btn btn-sm lyrics-fs-btn"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Keluar Layar Penuh (Esc)' : 'Mode Layar Penuh Lirik'}
          aria-label={isFullscreen ? 'Keluar Layar Penuh' : 'Mode Layar Penuh Lirik'}
        >
          {isFullscreen ? '✕ Exit' : '⛶ Fullscreen'}
        </button>
      </div>

      {/* ── Lyrics Content Area ── */}
      {hasLyrics ? (
        <div className="lyrics-content" onScroll={handleScroll}>
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
        </div>
      ) : (
        /* CRITICAL REQUIREMENT A: Edge Case — completely blank if no lyrics found */
        <div className="lyrics-empty-blank" aria-hidden="true" />
      )}
    </div>
  );
}
