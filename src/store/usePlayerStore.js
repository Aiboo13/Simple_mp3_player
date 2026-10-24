import { create } from 'zustand';

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
  setQueue: (queue) => set({ queue }),
  currentIndex: -1,
  setCurrentIndex: (currentIndex) => set({ currentIndex }),

  addToQueue: (song) =>
    set((state) => ({
      queue: [...state.queue, song],
    })),

  addAllToQueue: (songs) =>
    set((state) => ({
      queue: [...state.queue, ...songs],
    })),

  replaceQueue: (songs, startIndex = 0) =>
    set({ queue: songs, currentIndex: startIndex }),

  removeFromQueue: (index) =>
    set((state) => {
      const queue = [...state.queue];
      queue.splice(index, 1);
      const currentIndex =
        state.currentIndex >= queue.length
          ? queue.length - 1
          : state.currentIndex > index
          ? state.currentIndex - 1
          : state.currentIndex;
      return { queue, currentIndex };
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

  clearQueue: () => set({ queue: [], currentIndex: -1 }),

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
  setLyricsContent: (lyricsContent) => set({ lyricsContent }),

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

  // ── Computed ──────────────────────────────────────────────
  get currentSong() {
    const { queue, currentIndex } = get();
    return currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;
  },
}));

export default usePlayerStore;
