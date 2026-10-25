import { useRef, useEffect, useState, useCallback } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import { formatDuration, readAudioFile, getAlbumArt } from '../../lib/api';
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
    isShuffled, toggleShuffle,
    repeatMode, cycleRepeat,
    showToast,
    albumArtCache, setAlbumArt,
    seekRequest,
    playNextSong,
    playPrevSong,
  } = usePlayerStore();

  const currentSong = queue[currentIndex] ?? null;

  // In-memory Blob URL cache (max 4 tracks) and in-flight promises
  const blobCacheRef = useRef(new Map()); // Map<path, blobUrl>
  const pendingLoadsRef = useRef(new Map()); // Map<path, Promise<string>>

  // Helper to load or fetch from cache
  // PRD v1.5 §4.B §4.C: Pass `isPureAudio` so Rust takes the fast-path (no metadata probe,
  // no fMP4 scan) for pure audio files, eliminating the 1-second stutter on transition.
  const getOrLoadBlob = useCallback(async (path, isPureAudio = false) => {
    if (!path) return null;
    if (blobCacheRef.current.has(path)) {
      return blobCacheRef.current.get(path);
    }
    if (pendingLoadsRef.current.has(path)) {
      return pendingLoadsRef.current.get(path);
    }

    const loadPromise = (async () => {
      try {
        // PRD §4.B: isPureAudio=true triggers Rust fast-path (skip fMP4 check + no lofty probe)
        const blobUrl = await readAudioFile(path, isPureAudio);
        blobCacheRef.current.set(path, blobUrl);

        // Keep cache bounded to max 3 tracks (current, next, prev) without ever evicting the active song or the song just loaded
        const activeSongPath = usePlayerStore.getState().queue[usePlayerStore.getState().currentIndex]?.path;
        while (blobCacheRef.current.size > 3) {
          let keyToEvict = null;
          for (const k of blobCacheRef.current.keys()) {
            if (k !== activeSongPath && k !== path) {
              keyToEvict = k;
              break;
            }
          }
          if (!keyToEvict) break;
          const urlToRevoke = blobCacheRef.current.get(keyToEvict);
          if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
          blobCacheRef.current.delete(keyToEvict);
        }

        return blobUrl;
      } finally {
        pendingLoadsRef.current.delete(path);
      }
    })();

    pendingLoadsRef.current.set(path, loadPromise);
    return loadPromise;
  }, []);

  // Register audio ref with store so skip actions can synchronously mute sink immediately
  useEffect(() => {
    if (audioRef.current) {
      usePlayerStore.getState().setAudioElement(audioRef.current);
    }
    return () => {
      usePlayerStore.getState().setAudioElement(null);
    };
  }, []);

  // Clean up all cached blob URLs on unmount
  useEffect(() => {
    return () => {
      blobCacheRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobCacheRef.current.clear();
    };
  }, []);

  // Evict cache entries if queue changes and they are no longer in queue
  useEffect(() => {
    const queuePaths = new Set(queue.map((s) => s.path));
    if (currentSong?.path) queuePaths.add(currentSong.path);
    for (const [path, url] of blobCacheRef.current.entries()) {
      if (!queuePaths.has(path)) {
        URL.revokeObjectURL(url);
        blobCacheRef.current.delete(path);
      }
    }
  }, [queue, currentSong?.path]);

  // Helper to determine the next song in queue
  const getNextSong = useCallback(() => {
    if (queue.length === 0) return null;
    if (repeatMode === 'one') {
      return queue[currentIndex] ?? null;
    }
    let nextIdx = currentIndex + 1;
    if (nextIdx >= queue.length) {
      if (repeatMode === 'all') nextIdx = 0;
      else return null;
    }
    return queue[nextIdx] ?? null;
  }, [queue, currentIndex, repeatMode]);

  // Helper to determine the previous song in queue
  const getPrevSong = useCallback(() => {
    if (queue.length === 0) return null;
    let prevIdx = currentIndex - 1;
    if (prevIdx < 0) {
      if (repeatMode === 'all') prevIdx = queue.length - 1;
      else return null;
    }
    return queue[prevIdx] ?? null;
  }, [queue, currentIndex, repeatMode]);

  // ── Pre-buffering Pure Audio & Adjacent Tracks (PRD v1.5 Requirement 4.C) ──
  useEffect(() => {
    const nextSong = getNextSong();
    const prevSong = getPrevSong();

    // Pure audio pre-buffering: start quickly (400ms) since no metadata/album-art overhead exists
    // Standard tracks: pre-buffer after 1500ms
    const isPureNext = nextSong && nextSong.has_metadata === false;
    const preloadDelay = isPureNext ? 400 : 1500;

    const timer = setTimeout(() => {
      const doPreload = () => {
        if (nextSong?.path && nextSong.path !== currentSong?.path) {
          // PRD §4.B §4.C: pass isPureAudio=true so pre-buffer also uses the fast-path
          const nextIsPure = nextSong.has_metadata === false;
          getOrLoadBlob(nextSong.path, nextIsPure).catch((err) => {
            console.warn('[AudioPlayer] Pre-buffering next track error:', err);
          });

          // PRD 4.C: Skip album art lookup if next track is pure audio or has no cover
          if (nextSong.has_metadata !== false && nextSong.has_cover && !albumArtCache[nextSong.path]) {
            getAlbumArt(nextSong.path)
              .then((art) => {
                if (art) setAlbumArt(nextSong.path, art);
              })
              .catch(() => {});
          }
        }

        // Also pre-buffer prevSong so PgUp transitions are instantaneous cache hits
        if (prevSong?.path && prevSong.path !== currentSong?.path && prevSong.path !== nextSong?.path) {
          const prevIsPure = prevSong.has_metadata === false;
          getOrLoadBlob(prevSong.path, prevIsPure).catch(() => {});
        }
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(doPreload, { timeout: 2500 });
      } else {
        doPreload();
      }
    }, preloadDelay);

    return () => clearTimeout(timer);
  }, [currentSong?.path, getNextSong, getPrevSong, getOrLoadBlob, albumArtCache, setAlbumArt]);

  // ── Strict Sequential State Machine for Audio Transitions (PRD v1.5 Req 4.A & 4.C) ──
  // Sequence: Pause/Stop (A) -> Flush Buffer -> Load File (B) -> Wait Buffer -> Play (B) -> Verify Decoder Stabilization -> Unmute
  // Speaker is strictly muted during transition and remains muted until continuous rendering is verified.
  const transitionSeqRef = useRef(0);
  const isTransitioningRef = useRef(false);
  const lastPlayToggleRef = useRef(0);

  const handleTogglePlay = useCallback(() => {
    const now = Date.now();
    if (now - lastPlayToggleRef.current < 150) return;
    lastPlayToggleRef.current = now;

    const audio = audioRef.current;
    if (!currentSong) return;

    if (isPlaying) {
      if (audio && !audio.paused) {
        audio.pause();
      }
      isTransitioningRef.current = false;
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      if (audio && audio.paused && audio.src) {
        const p = audio.play();
        if (p !== undefined) {
          p.catch((err) => {
            if (err.name !== 'AbortError') {
              console.warn('[AudioPlayer] Play toggle error:', err);
            }
          });
        }
      }
    }
  }, [isPlaying, currentSong, setIsPlaying]);

  // ── Audio source management ──────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    const seq = ++transitionSeqRef.current;
    isTransitioningRef.current = true;

    const executeStrictTransition = async () => {
      try {
        // ── Phase 1: Stop previous audio immediately (PRD v1.5 Req 4.A) ──
        // Ensure no audio from Lagu A bleeds into the transition.
        // Pausing immediately silences the speaker safely without corrupting GStreamer's volume pipeline.
        if (!audio.paused) {
          audio.pause();
        }

        // ── Phase 2: Reset playback position without tearing down WebKitGTK decoder ──
        audio.currentTime = 0;
        setCurrentTime(0);
        setDuration(0);

        // Check if aborted by a subsequent skip/PgDn
        if (seq !== transitionSeqRef.current) return;

        // ── Phase 3: Pre-buffering Pure Audio / Load File (PRD v1.5 Req 4.C) ──
        const isPureAudio = currentSong.has_metadata === false;
        const isCached = blobCacheRef.current.has(currentSong.path);
        console.log(
          `[AudioPlayer] ⚡ State machine: loading (${isPureAudio ? 'Pure Audio, ' : ''}${isCached ? 'cached' : 'disk I/O'}) for:`,
          currentSong.title
        );

        // PRD §4.B §4.C: Pass isPureAudio so Rust skips fMP4 check and lofty metadata probe
        const blobUrl = await getOrLoadBlob(currentSong.path, isPureAudio);
        if (seq !== transitionSeqRef.current || !blobUrl) return;

        if (audio.src !== blobUrl) {
          audio.src = blobUrl;
          audio.load();
        }

        // ── Phase 4: Wait for initial buffer to fill (PRD v1.5 §4.A) ──
        // When readyState >= 2 (HAVE_CURRENT_DATA) or on canplay/loadeddata, resolve immediately.
        // Safety timeout (3500ms) guarantees we never hang on corrupt files while avoiding
        // prematurely killing decoding for large or remuxed files.
        const safetyTimeoutMs = 3500;

        await new Promise((resolve) => {
          if (audio.readyState >= 2) {
            resolve();
            return;
          }

          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              audio.removeEventListener('canplay', finish);
              audio.removeEventListener('canplaythrough', finish);
              audio.removeEventListener('loadeddata', finish);
              audio.removeEventListener('error', finish);
              resolve();
            }
          };

          audio.addEventListener('canplay', finish, { once: true });
          audio.addEventListener('canplaythrough', finish, { once: true });
          audio.addEventListener('loadeddata', finish, { once: true });
          audio.addEventListener('error', finish, { once: true });

          setTimeout(finish, safetyTimeoutMs);
        });

        if (seq !== transitionSeqRef.current) return;

        if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        } else if (currentSong?.duration_secs && currentSong.duration_secs > 0) {
          setDuration(currentSong.duration_secs);
        }

        // ── Phase 4.5: Decoder Stabilization (PRD v1.5 §4.A) ──
        // For pure audio files, add a brief stabilization window (40ms) before playback.
        // This ensures the decoder has fully committed to the first continuous audio frames
        // and prevents any raw MPEG sync-word frames from leaking to the speaker (audio spill).
        if (isPureAudio) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          if (seq !== transitionSeqRef.current) return;
        }

        // Restore user's actual volume & mute settings now that buffer is fully ready
        const currentMuted = usePlayerStore.getState().isMuted;
        const currentVol = usePlayerStore.getState().volume;
        audio.muted = currentMuted;
        audio.volume = currentMuted ? 0 : currentVol;

        // ── Phase 5: Play (Lagu B) ──
        const shouldPlay = usePlayerStore.getState().isPlaying;
        if (shouldPlay) {
          try {
            const playPromise = audio.play();
            if (playPromise !== undefined) {
              await playPromise;
            }
            // Guard against WebKitGTK/GStreamer pipeline resetting volume to 0 asynchronously
            if (!usePlayerStore.getState().isMuted && audio.volume === 0 && currentVol > 0) {
              audio.volume = currentVol;
              audio.muted = false;
            }
          } catch (playErr) {
            if (seq !== transitionSeqRef.current) return;
            if (playErr.name !== 'AbortError') {
              console.warn('[AudioPlayer] audio.play() rejected:', playErr);
            }
          }
        }
      } catch (err) {
        if (seq !== transitionSeqRef.current) return;
        console.error('[AudioPlayer] Strict transition failed:', err);
        const errStr = String(err?.message || err || '');
        const isNotFound = errStr.includes('No such file') || errStr.includes('not found') || errStr.includes('Failed to open file');

        if (isNotFound && currentSong) {
          showToast(`File tidak ditemukan: ${currentSong.title}. Dihapus dari pustaka.`, 'error');
          usePlayerStore.getState().removeSongById(currentSong.id);
          const state = usePlayerStore.getState();
          if (state.queue.length > 0) {
            state.playNextSong(false);
          } else {
            setIsPlaying(false);
          }
        } else {
          showToast('Playback error: ' + (err.message || err), 'error');
          setIsPlaying(false);
        }
      } finally {
        if (seq === transitionSeqRef.current) {
          isTransitioningRef.current = false;
        }
      }
    };

    executeStrictTransition();

    return () => {
      // Invalidate this sequence if track changes before completion
      transitionSeqRef.current++;
    };
  }, [currentSong?.id, currentSong?.path, getOrLoadBlob, setCurrentTime, setDuration, setIsPlaying, showToast]);

  // ── Sync play/pause when user toggles play button ─────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong || !audio.src) return;
    // Prevent collision with in-progress transition
    if (isTransitioningRef.current) return;

    if (isPlaying) {
      if (audio.paused) {
        const p = audio.play();
        if (p !== undefined) {
          p.catch((err) => {
            if (err.name !== 'AbortError') {
              console.warn('[AudioPlayer] Play toggle error:', err);
            }
          });
        }
      }
    } else {
      // Pause must always execute immediately!
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [isPlaying, currentSong]);

  // ── Sync volume ──────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  // ── Handle external seek requests (e.g. clicking lyrics line) ─
  useEffect(() => {
    if (seekRequest !== null && audioRef.current) {
      audioRef.current.currentTime = seekRequest;
      setCurrentTime(seekRequest);
      usePlayerStore.setState({ seekRequest: null });
    }
  }, [seekRequest, setCurrentTime]);

  // ── Audio event handlers ─────────────────────────────────────
  function handlePlay() {
    const audio = audioRef.current;
    if (audio) {
      const { volume: storeVol, isMuted: storeMuted } = usePlayerStore.getState();
      if (audio.muted !== storeMuted) audio.muted = storeMuted;
      const target = storeMuted ? 0 : storeVol;
      if (Math.abs(audio.volume - target) > 0.01) {
        audio.volume = target;
      }
    }
    if (!isTransitioningRef.current) {
      setIsPlaying(true);
    }
  }

  function handleAudioVolumeChange() {
    const audio = audioRef.current;
    if (!audio) return;
    const { volume: storeVol, isMuted: storeMuted } = usePlayerStore.getState();
    // Guard against WebKitGTK/GStreamer pipeline resetting volume to 0 asynchronously
    if (!storeMuted && storeVol > 0 && audio.volume === 0) {
      audio.volume = storeVol;
      audio.muted = false;
    }
  }

  function handlePause() {
    if (!isTransitioningRef.current) {
      setIsPlaying(false);
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || isTransitioningRef.current) return;
    setCurrentTime(audio.currentTime);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    } else if (currentSong?.duration_secs && currentSong.duration_secs > 0) {
      setDuration(currentSong.duration_secs);
    }
  }

  function handleEnded() {
    if (isTransitioningRef.current) return;
    // PRD Acceptance Criteria: Always fetch latest queue reference when song ends
    usePlayerStore.getState().playNextSong(false);
  }

  function handleAudioError() {
    const audio = audioRef.current;
    if (!audio || !currentSong || isTransitioningRef.current) return;
    if (!audio.src || audio.src === window.location.href) return;

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

  const handleNext = useCallback((manual = false) => {
    usePlayerStore.getState().playNextSong(manual);
  }, []);

  const handlePrev = useCallback(() => {
    usePlayerStore.getState().playPrevSong();
  }, []);

  // ── Seek control ─────────────────────────────────────────────
  function handleSeek(e) {
    const audio = audioRef.current;
    if (!audio || !duration || isTransitioningRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const newTime = pct * duration;
    if (isFinite(newTime) && newTime >= 0) {
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    }
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
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleAudioError}
        onVolumeChange={handleAudioVolumeChange}
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
            onClick={toggleShuffle}
            aria-label={isShuffled ? 'Disable Shuffle' : 'Enable Shuffle'}
            title={isShuffled ? 'Shuffle: ON' : 'Shuffle: OFF'}
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
            onClick={handleTogglePlay}
            disabled={!currentSong}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>

          <button
            id="next-btn"
            className="btn btn-icon player-ctrl-btn"
            onClick={() => handleNext(true)}
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
