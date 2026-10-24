import { useRef, useEffect, useState, useCallback } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import { formatDuration, readAudioFile } from '../../lib/api';
import './AudioPlayer.css';

// ── SVG Icons ────────────────────────────────────────────────
const IconPlay = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);
const IconPause = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
  </svg>
);
const IconNext = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"/>
  </svg>
);
const IconPrev = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"/>
  </svg>
);
const IconVolume = ({ muted }) => muted ? (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
  </svg>
) : (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  </svg>
);
const IconShuffle = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
    <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
    <line x1="4" y1="4" x2="9" y2="9"/>
  </svg>
);
const IconRepeat = ({ mode }) => mode === 'one' ? (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    <line x1="11" y1="10" x2="11" y2="17"/>
  </svg>
) : (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);

export default function AudioPlayer() {
  const audioRef = useRef(null);
  const seekRef = useRef(null);
  const volumeRef = useRef(null);

  const {
    queue, currentIndex, setCurrentIndex,
    isPlaying, setIsPlaying,
    currentTime, setCurrentTime,
    duration, setDuration,
    volume, setVolume,
    isMuted, setIsMuted,
    isShuffled, setIsShuffled,
    repeatMode, cycleRepeat,
    showToast,
  } = usePlayerStore();

  const currentSong = queue[currentIndex] ?? null;
  const blobUrlRef = useRef(null);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  // ── Audio source management ──────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    let isCancelled = false;

    // Revoke previous blob URL if any
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    const loadAndPlay = async () => {
      try {
        console.log('[AudioPlayer] Loading via Blob URL for:', currentSong.title, currentSong.path);
        const blobUrl = await readAudioFile(currentSong.path);
        if (isCancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        blobUrlRef.current = blobUrl;
        audio.src = blobUrl;
        audio.load();

        if (isPlaying) {
          try {
            await audio.play();
          } catch (playErr) {
            if (isCancelled) return;
            if (playErr.name !== 'AbortError') {
              console.warn('[AudioPlayer] audio.play() rejected:', playErr);
            }
          }
        }
      } catch (err) {
        if (isCancelled) return;
        console.error('[AudioPlayer] Failed to load audio file:', err);
        showToast('Playback error: ' + (err.message || err), 'error');
        setIsPlaying(false);
      }
    };

    loadAndPlay();

    return () => {
      isCancelled = true;
    };
  }, [currentSong?.path]);

  // ── Sync play/pause when user toggles play button ─────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong || !audio.src) return;
    if (isPlaying) {
      if (audio.paused) {
        audio.play().catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn('[AudioPlayer] Play toggle error:', err);
          }
        });
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [isPlaying]);

  // ── Sync volume ──────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // ── Audio event handlers ─────────────────────────────────────
  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration);
  }

  function handleEnded() {
    handleNext();
  }

  function handleAudioError() {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    const error = audio.error;
    console.error('[AudioPlayer] HTML5 Audio error:', error, audio.src);
    let msg = 'Failed to play audio';
    if (error) {
      if (error.code === 4) msg = 'Audio format not supported or file inaccessible';
      else if (error.code === 2) msg = 'Network or file read error';
      else if (error.code === 3) msg = 'Audio decoding failed';
    }
    showToast(msg, 'error');
    setIsPlaying(false);
  }

  const handleNext = useCallback(() => {
    if (queue.length === 0) return;

    if (repeatMode === 'one') {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; audio.play(); }
      return;
    }

    let nextIndex;
    if (isShuffled) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === 'all') {
          nextIndex = 0;
        } else {
          setIsPlaying(false);
          return;
        }
      }
    }

    setCurrentIndex(nextIndex);
    setIsPlaying(true);
  }, [queue, currentIndex, repeatMode, isShuffled]);

  const handlePrev = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // If more than 3 seconds in, restart
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = repeatMode === 'all' ? queue.length - 1 : 0;
    }
    setCurrentIndex(prevIndex);
    setIsPlaying(true);
  }, [currentIndex, queue.length, repeatMode]);

  // ── Seek control ─────────────────────────────────────────────
  function handleSeek(e) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const newTime = pct * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }

  // ── Volume control ────────────────────────────────────────────
  function handleVolumeChange(e) {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    setIsMuted(newVol === 0);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <footer className="audio-player" role="complementary" aria-label="Audio Player">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleAudioError}
        preload="auto"
      />

      {/* ── Song Info ── */}
      <div className="player-song-info">
        {currentSong ? (
          <>
            <div className="player-title text-truncate">{currentSong.title}</div>
            <div className="player-artist text-truncate">{currentSong.artist || 'Unknown'}</div>
          </>
        ) : (
          <>
            <div className="player-title" style={{color: '#aaa'}}>No song selected</div>
            <div className="player-artist" style={{color: '#ccc'}}>—</div>
          </>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="player-center">
        {/* Control Buttons */}
        <div className="player-controls">
          <button
            id="shuffle-btn"
            className={`btn btn-icon player-ctrl-btn ${isShuffled ? 'active' : ''}`}
            onClick={() => setIsShuffled(!isShuffled)}
            aria-label="Shuffle"
            title="Shuffle"
          >
            <IconShuffle />
          </button>

          <button
            id="prev-btn"
            className="btn btn-icon player-ctrl-btn"
            onClick={handlePrev}
            disabled={!currentSong}
            aria-label="Previous"
          >
            <IconPrev />
          </button>

          <button
            id="play-pause-btn"
            className="btn btn-icon player-play-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={!currentSong}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>

          <button
            id="next-btn"
            className="btn btn-icon player-ctrl-btn"
            onClick={handleNext}
            disabled={!currentSong}
            aria-label="Next"
          >
            <IconNext />
          </button>

          <button
            id="repeat-btn"
            className={`btn btn-icon player-ctrl-btn ${repeatMode !== 'none' ? 'active' : ''}`}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeatMode}`}
            title={`Repeat: ${repeatMode}`}
          >
            <IconRepeat mode={repeatMode} />
            {repeatMode === 'one' && <span className="repeat-one-badge mono">1</span>}
          </button>
        </div>

        {/* Seek Bar */}
        <div className="player-seek-row">
          <span className="player-time mono">{formatDuration(currentTime)}</span>
          <div
            id="seek-bar"
            className="seek-bar"
            onClick={handleSeek}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-label="Seek"
            tabIndex={0}
          >
            <div className="seek-track">
              <div className="seek-fill" style={{ width: `${progress}%` }} />
              <div className="seek-thumb" style={{ left: `${progress}%` }} />
            </div>
          </div>
          <span className="player-time mono">{formatDuration(duration)}</span>
        </div>
      </div>

      {/* ── Volume ── */}
      <div className="player-volume">
        <button
          id="mute-btn"
          className="btn btn-icon player-ctrl-btn"
          onClick={() => setIsMuted(!isMuted)}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          <IconVolume muted={isMuted} />
        </button>
        <input
          id="volume-slider"
          ref={volumeRef}
          className="volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.02"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          aria-label="Volume"
        />
        <span className="volume-pct mono">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
      </div>
    </footer>
  );
}
