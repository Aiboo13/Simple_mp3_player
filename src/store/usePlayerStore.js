import { create } from 'zustand';
import { parseLrc } from '../lib/lrc';

function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const usePlayerStore = create((set, get) => ({
  // ── Library ──────────────────────────────────────────────
  songs: [],
  setSongs: (songs) => set({ songs }),

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

  // ── Queue ─────────────────────────────────────────────────
  queue: [],
  originalQueue: [],
  setQueue: (queue) => set({ queue }),
  currentIndex: -1,
  setCurrentIndex: (currentIndex) => set({ currentIndex }),

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

  replaceQueue: (songs, startIndex = 0) => {
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
        queue: songs,
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

  // ── UI State ──────────────────────────────────────────────
  showLyrics: false,
  setShowLyrics: (showLyrics) => set({ showLyrics }),

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
  get currentSong() {
    const { queue, currentIndex } = get();
    return currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;
  },
}));

export default usePlayerStore;
