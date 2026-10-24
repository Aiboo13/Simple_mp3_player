import { useEffect, useRef } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import './ContextMenu.css';

export default function ContextMenu() {
  const {
    contextMenu,
    closeContextMenu,
    insertPlayNext,
    addToQueue,
    removeFromQueue,
    setCurrentIndex,
    setIsPlaying,
    replaceQueue,
    songs,
  } = usePlayerStore();

  const menuRef = useRef(null);

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

  if (!contextMenu || !contextMenu.song) return null;

  const { x, y, song, source, index } = contextMenu;

  // Clamping coordinates so menu stays visible within viewport
  const MENU_WIDTH = 210;
  const MENU_HEIGHT = 180;
  const posX = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 12));
  const posY = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 12));

  function handlePlayNext(e) {
    e.stopPropagation();
    try {
      insertPlayNext(song);
    } catch (err) {
      console.error('[ContextMenu] handlePlayNext error:', err);
    } finally {
      closeContextMenu();
    }
  }

  function handlePlayNow(e) {
    e.stopPropagation();
    try {
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
    } catch (err) {
      console.error('[ContextMenu] handlePlayNow error:', err);
    } finally {
      closeContextMenu();
    }
  }

  function handleAddToQueue(e) {
    e.stopPropagation();
    try {
      addToQueue(song);
      usePlayerStore.getState().showToast(`Added to queue: ${song.title}`);
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
        usePlayerStore.getState().showToast(`Removed from queue`);
      }
    } catch (err) {
      console.error('[ContextMenu] handleRemoveFromQueue error:', err);
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
      <div className="context-menu-header">
        <span className="context-menu-song-title text-truncate" title={song.title}>
          {song.title}
        </span>
        <span className="context-menu-song-artist text-truncate mono">
          {song.artist || 'Unknown'}
        </span>
      </div>

      <div className="context-menu-divider" />

      {/* Featured PRD Action: Play Next */}
      <button
        id="context-menu-play-next"
        className="context-menu-item context-menu-play-next"
        onClick={handlePlayNext}
        role="menuitem"
      >
        <span className="context-menu-icon">⏭</span>
        <span className="context-menu-label">Play Next</span>
        <span className="badge badge-yellow context-menu-badge mono">NEXT</span>
      </button>

      <button
        id="context-menu-play-now"
        className="context-menu-item"
        onClick={handlePlayNow}
        role="menuitem"
      >
        <span className="context-menu-icon">▶</span>
        <span className="context-menu-label">Play Now</span>
      </button>

      <button
        id="context-menu-add-queue"
        className="context-menu-item"
        onClick={handleAddToQueue}
        role="menuitem"
      >
        <span className="context-menu-icon">+</span>
        <span className="context-menu-label">Add to Queue</span>
      </button>

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
