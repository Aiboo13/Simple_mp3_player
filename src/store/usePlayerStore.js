import { create } from 'zustand';
import { parseLrc } from '../lib/lrc.js';

function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

let lastSkipTimestamp = 0;
const SKIP_THROTTLE_MS = 250;

const usePlayerStore = create((set, get) => ({
  // ── Library ──────────────────────────────────────────────
  songs: [],
  setSongs: (songs) => set({ songs }),
  appendSongsBatch: (batch) =>
    set((state) => {
      if (!Array.isArray(batch) || batch.length === 0) return {};
      const existingMap = new Map(state.songs.map((s) => [s.path, s]));
      for (const song of batch) {
        existingMap.set(song.path, song);
      }
      return { songs: Array.from(existingMap.values()) };
    }),

  playlists: [],
  setPlaylists: (playlists) => set({ playlists }),

  activePlaylistId: null,
  setActivePlaylistId: (id) => set({ activePlaylistId: id }),

  // 'library' | 'playlist'
  activeView: 'library',
  setActiveView: (view) => set({ activeView: view }),

  sortBy: 'title',
  setSortBy: (sortBy) => set({ sortBy }),

  sortOrder: 'asc',
  setSortOrder: (sortOrder) => set({ sortOrder }),

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // ── Audio Sink & Element Reference (PRD v1.5 Strict Mute) ──
  audioElement: null,
  setAudioElement: (audioElement) => set({ audioElement }),
  strictMuteSink: () => {
    const el = get().audioElement;
    if (el) {
      el.muted = true;
      el.volume = 0;
    }
  },

  // ── Queue ─────────────────────────────────────────────────
  queue: [],
  originalQueue: [],
  setQueue: (queue) => set({ queue }),
  currentIndex: -1,
  setCurrentIndex: (currentIndex) => {
    if (currentIndex !== get().currentIndex) {
      get().strictMuteSink();
    }
    set({ currentIndex });
  },

  addToQueue: (song) =>
    set((state) => ({
      queue: [...state.queue, song],
      originalQueue:
        state.originalQueue.length > 0
          ? [...state.originalQueue, song]
          : state.originalQueue,
    })),

  addAllToQueue: (songs) =>
    set((state) => ({
      queue: [...state.queue, ...songs],
      originalQueue:
        state.originalQueue.length > 0
          ? [...state.originalQueue, ...songs]
          : state.originalQueue,
    })),

  // Insert a song right next in the queue (2nd in active queue below current song)
  insertPlayNext: (song) => {
    const { queue, currentIndex, originalQueue } = get();

    // If queue is empty or nothing is playing, play immediately
    if (queue.length === 0 || currentIndex === -1) {
      get().strictMuteSink();
      set({
        queue: [song],
        currentIndex: 0,
        isPlaying: true,
        originalQueue: originalQueue.length > 0 ? [song] : [],
      });
      get().showToast(`✓ Playing: ${song.title}`);
      return;
    }

    // If song is currently playing
    if (queue[currentIndex]?.id === song.id) {
      get().showToast(`"${song.title}" is already playing`);
      return;
    }

    // If already next in queue
    if (currentIndex + 1 < queue.length && queue[currentIndex + 1]?.id === song.id) {
      get().showToast(`"${song.title}" is already next in queue`);
      return;
    }

    const existingIndex = queue.findIndex((s) => s.id === song.id);
    const newQueue = [...queue];

    // Synchronize originalQueue if shuffle was enabled
    let newOriginalQueue = originalQueue.length > 0 ? [...originalQueue] : [];
    if (newOriginalQueue.length > 0) {
      const origExistingIndex = newOriginalQueue.findIndex((s) => s.id === song.id);
      const currentSongObj = queue[currentIndex];
      const origCurrentIndex = currentSongObj
        ? newOriginalQueue.findIndex((s) => s.id === currentSongObj.id)
        : -1;

      if (origExistingIndex !== -1) {
        const [origItem] = newOriginalQueue.splice(origExistingIndex, 1);
        const targetIdx = origCurrentIndex !== -1 ? origCurrentIndex + 1 : 0;
        newOriginalQueue.splice(targetIdx, 0, origItem);
      } else {
        const targetIdx = origCurrentIndex !== -1 ? origCurrentIndex + 1 : newOriginalQueue.length;
        newOriginalQueue.splice(targetIdx, 0, song);
      }
    }

    if (existingIndex !== -1) {
      // Song is already somewhere in queue -> reposition it right next
      const [item] = newQueue.splice(existingIndex, 1);
      if (existingIndex < currentIndex) {
        // Since an item before currentIndex was removed, currentIndex shifts down by 1
        const newCurrentIndex = currentIndex - 1;
        newQueue.splice(newCurrentIndex + 1, 0, item);
        set({
          queue: newQueue,
          currentIndex: newCurrentIndex,
          originalQueue: newOriginalQueue,
        });
      } else {
        newQueue.splice(currentIndex + 1, 0, item);
        set({
          queue: newQueue,
          originalQueue: newOriginalQueue,
        });
      }
    } else {
      // Song not in queue -> insert at currentIndex + 1
      newQueue.splice(currentIndex + 1, 0, song);
      set({
        queue: newQueue,
        originalQueue: newOriginalQueue,
      });
    }

    get().showToast(`✓ Play next: ${song.title}`);
  },

  replaceQueue: (songs, startIndex = 0) => {
    get().strictMuteSink();
    const { isShuffled } = get();
    if (isShuffled && songs.length > 1) {
      const selectedSong = songs[startIndex];
      const remaining = songs.filter((_, idx) => idx !== startIndex);
      const shuffledRemaining = shuffleArray(remaining);
      const newQueue = selectedSong
        ? [selectedSong, ...shuffledRemaining]
        : shuffleArray(songs);

      set({
        queue: newQueue,
        currentIndex: 0,
        originalQueue: [...songs],
      });
    } else {
      set({
        queue: [...songs],
        currentIndex: startIndex,
        originalQueue: [],
      });
    }
  },

  removeFromQueue: (index) =>
    set((state) => {
      const queue = [...state.queue];
      const [removed] = queue.splice(index, 1);
      const currentIndex =
        state.currentIndex >= queue.length
          ? queue.length - 1
          : state.currentIndex > index
          ? state.currentIndex - 1
          : state.currentIndex;

      const originalQueue = removed
        ? state.originalQueue.filter((s) => s.id !== removed.id)
        : state.originalQueue;

      return { queue, currentIndex, originalQueue };
    }),

  reorderQueue: (from, to) =>
    set((state) => {
      const queue = [...state.queue];
      const [moved] = queue.splice(from, 1);
      queue.splice(to, 0, moved);

      let currentIndex = state.currentIndex;
      if (state.currentIndex === from) {
        currentIndex = to;
      } else if (state.currentIndex > from && state.currentIndex <= to) {
        currentIndex = state.currentIndex - 1;
      } else if (state.currentIndex < from && state.currentIndex >= to) {
        currentIndex = state.currentIndex + 1;
      }

      return { queue, currentIndex };
    }),

  clearQueue: () => set({ queue: [], currentIndex: -1, originalQueue: [] }),

  // ── Player ────────────────────────────────────────────────
  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  currentTime: 0,
  setCurrentTime: (currentTime) => set({ currentTime }),

  duration: 0,
  setDuration: (duration) => set({ duration }),

  volume: 0.8,
  setVolume: (volume) => set({ volume }),

  isMuted: false,
  setIsMuted: (isMuted) => set({ isMuted }),

  isShuffled: false,
  setIsShuffled: (isShuffled) => set({ isShuffled }),
  toggleShuffle: () =>
    set((state) => {
      const { isShuffled, queue, currentIndex, originalQueue } = state;
      if (!isShuffled) {
        // Turning shuffle ON -> Shuffle the queue
        if (queue.length <= 1) {
          return { isShuffled: true, originalQueue: [...queue] };
        }
        const currentSong =
          currentIndex >= 0 && currentIndex < queue.length
            ? queue[currentIndex]
            : null;

        let newQueue;
        let newIndex = 0;

        if (currentSong) {
          // Keep current song at index 0 so it continues playing, shuffle the rest
          const remaining = queue.filter((_, idx) => idx !== currentIndex);
          const shuffledRemaining = shuffleArray(remaining);
          newQueue = [currentSong, ...shuffledRemaining];
          newIndex = 0;
        } else {
          newQueue = shuffleArray(queue);
          newIndex = -1;
        }

        return {
          isShuffled: true,
          queue: newQueue,
          currentIndex: newIndex,
          originalQueue: originalQueue.length > 0 ? originalQueue : [...queue],
        };
      } else {
        // Turning shuffle OFF -> Restore original queue order
        const currentSong =
          currentIndex >= 0 && currentIndex < queue.length
            ? queue[currentIndex]
            : null;

        const baseQueue =
          originalQueue && originalQueue.length > 0
            ? [...originalQueue]
            : [...queue];

        let restoredIndex = currentIndex;
        if (currentSong) {
          const foundIdx = baseQueue.findIndex((s) => s.id === currentSong.id);
          if (foundIdx !== -1) {
            restoredIndex = foundIdx;
          }
        }

        return {
          isShuffled: false,
          queue: baseQueue,
          currentIndex: restoredIndex,
          originalQueue: [],
        };
      }
    }),

  // 'none' | 'one' | 'all'
  repeatMode: 'none',
  setRepeatMode: (repeatMode) => set({ repeatMode }),
  cycleRepeat: () =>
    set((state) => {
      const modes = ['none', 'all', 'one'];
      const idx = modes.indexOf(state.repeatMode);
      return { repeatMode: modes[(idx + 1) % modes.length] };
    }),

  albumArtCache: {},
  setAlbumArt: (path, data) =>
    set((state) => ({
      albumArtCache: { ...state.albumArtCache, [path]: data },
    })),

  // ── Navigation & Skip Actions ───────────────────────────
  playNextSong: (manual = false) => {
    const now = Date.now();
    if (manual && now - lastSkipTimestamp < SKIP_THROTTLE_MS) {
      return;
    }
    lastSkipTimestamp = now;

    // Strict Mute on Transition: Immediately silence sink to prevent any spill
    get().strictMuteSink();

    const { queue, currentIndex, repeatMode } = get();
    if (queue.length === 0) return;

    if (!manual && repeatMode === 'one') {
      set({ seekRequest: 0, isPlaying: true });
      return;
    }

    let nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode === 'all' || manual) {
        nextIndex = 0;
      } else {
        set({ isPlaying: false });
        return;
      }
    }

    set({ currentIndex: nextIndex, isPlaying: true });
  },

  playPrevSong: () => {
    const now = Date.now();
    if (now - lastSkipTimestamp < SKIP_THROTTLE_MS) {
      return;
    }
    lastSkipTimestamp = now;

    // Strict Mute on Transition: Immediately silence sink to prevent any spill
    get().strictMuteSink();

    const { queue, currentIndex, repeatMode, currentTime } = get();
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart track
    if (currentTime > 3) {
      set({ seekRequest: 0, isPlaying: true });
      return;
    }

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = repeatMode === 'all' ? queue.length - 1 : 0;
    }

    set({ currentIndex: prevIndex, isPlaying: true });
  },

  // ── UI State ──────────────────────────────────────────────
  showLyrics: false,
  setShowLyrics: (showLyrics) => set({ showLyrics }),

  isLyricsFullscreen: false,
  setIsLyricsFullscreen: (isLyricsFullscreen) => set({ isLyricsFullscreen }),
  toggleLyricsFullscreen: () => set((state) => ({ isLyricsFullscreen: !state.isLyricsFullscreen })),

  contextMenu: null,
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),

  lyricsContent: null,
  parsedLyrics: [],
  setLyricsContent: (lyricsContent) => {
    const parsedLyrics = parseLrc(lyricsContent);
    set({ lyricsContent, parsedLyrics });
  },

  seekRequest: null,
  seekTo: (seekRequest) => set({ seekRequest }),

  currentAlbumArt: null,
  setCurrentAlbumArt: (currentAlbumArt) => set({ currentAlbumArt }),

  toast: null,
  showToast: (message, type = 'default') => {
    set({ toast: { message, type, id: Date.now() } });
    setTimeout(() => set({ toast: null }), 3000);
  },

  isScanning: false,
  setIsScanning: (isScanning) => set({ isScanning }),
  scanProgress: '',
  setScanProgress: (scanProgress) => set({ scanProgress }),

  // ── Theme State ───────────────────────────────────────────
  // 'default' (Brutalism) | 'bw' (Black & White) | 'darkweb' (Dark Web)
  theme: typeof window !== 'undefined' ? (localStorage.getItem('mp3_player_theme') || 'default') : 'default',
  setTheme: (theme) => {
    try {
      localStorage.setItem('mp3_player_theme', theme);
    } catch (e) {}
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    set({ theme });
  },
  cycleTheme: () => {
    const themes = ['default', 'bw', 'darkweb'];
    const current = get().theme;
    const nextIdx = (themes.indexOf(current) + 1) % themes.length;
    const nextTheme = themes[nextIdx];
    try {
      localStorage.setItem('mp3_player_theme', nextTheme);
    } catch (e) {}
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', nextTheme);
    }
    set({ theme: nextTheme });
    return nextTheme;
  },

  // ── Computed ──────────────────────────────────────────────
  getCurrentSong: () => {
    const { queue, currentIndex } = get();
    return currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;
  },
}));

export default usePlayerStore;
