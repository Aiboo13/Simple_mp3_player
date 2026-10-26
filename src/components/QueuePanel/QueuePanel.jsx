import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import usePlayerStore from '../../store/usePlayerStore';
import { formatDuration } from '../../lib/api';
import './QueuePanel.css';

const DRAG_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
    <line x1="8" y1="6" x2="21" y2="6"/>
    <line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/>
    <line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);

function SortableSongItem({ song, index, isCurrent, isPlaying }) {
  const { reorderQueue, removeFromQueue, setCurrentIndex, setIsPlaying, openContextMenu } = usePlayerStore();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: song.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  function handleSelectAndPlay(e) {
    if (e) e.stopPropagation();
    if (isCurrent) {
      setIsPlaying(true);
    } else {
      setCurrentIndex(index);
      setIsPlaying(true);
    }
  }

  function handleTogglePlay(e) {
    e.stopPropagation();
    if (isCurrent) {
      setIsPlaying(!isPlaying);
    } else {
      setCurrentIndex(index);
      setIsPlaying(true);
    }
  }

  function handleRemove(e) {
    e.stopPropagation();
    removeFromQueue(index);
  }

  function handleContextMenu(e) {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      song,
      source: 'queue',
      index,
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`queue-item-${song.id}`}
      className={`queue-item ${isCurrent ? 'current' : ''} ${isDragging ? 'dragging' : ''}`}
      role="listitem"
      onClick={handleSelectAndPlay}
      onDoubleClick={handleSelectAndPlay}
      onContextMenu={handleContextMenu}
      aria-label={`${song.title} by ${song.artist || 'Unknown'}`}
    >
      <div
        className="queue-drag-handle"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        {DRAG_ICON}
      </div>

      <div className="queue-item-num mono">
        {isPlaying ? (
          <span className="q-bars">
            <span/><span/><span/>
          </span>
        ) : isCurrent ? (
          <span style={{color: 'var(--clr-red)'}}>▶</span>
        ) : (
          index + 1
        )}
      </div>

      <div className="queue-item-info" style={{ cursor: 'pointer' }}>
        <span className="queue-item-title text-truncate">{song.title}</span>
        <span className="queue-item-artist text-truncate">{song.artist || 'Unknown'}</span>
      </div>

      <div className="queue-item-dur mono">{formatDuration(song.duration_secs)}</div>

      <div className="queue-item-actions">
        <button
          id={`queue-play-${song.id}`}
          className="btn btn-icon btn-sm queue-play-btn"
          onClick={handleTogglePlay}
          aria-label={isCurrent && isPlaying ? "Pause" : "Play"}
          title={isCurrent && isPlaying ? "Pause" : "Play"}
        >{isCurrent && isPlaying ? '❚❚' : '▶'}</button>
        <button
          id={`queue-remove-${song.id}`}
          className="btn btn-icon btn-sm queue-remove-btn"
          onClick={handleRemove}
          aria-label="Remove from queue"
          title="Remove"
        >✕</button>
      </div>
    </div>
  );
}

export default function QueuePanel() {
  const {
    queue, currentIndex, reorderQueue, clearQueue, isPlaying, showToast,
    isShuffled, toggleShuffle,
  } = usePlayerStore();

  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    try {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id) return;

      const fromIndex = queue.findIndex((s) => s.id === active.id);
      const toIndex = queue.findIndex((s) => s.id === over.id);
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        reorderQueue(fromIndex, toIndex);
      }
    } catch (err) {
      console.error('[QueuePanel] Drag reorder error:', err);
    }
  }

  const activeSong = activeId ? queue.find((s) => s.id === activeId) : null;
  const totalDuration = queue.reduce((acc, s) => acc + (s.duration_secs || 0), 0);

  return (
    <aside className="queue-panel" aria-label="Play Queue">
      {/* ── Header ── */}
      <div className="section-header queue-header">
        <div className="queue-header-top">
          <div className="queue-header-title">
            <h2>QUEUE</h2>
          </div>
          <div className="queue-header-actions">
            {queue.length > 1 && (
              <button
                id="queue-shuffle-btn"
                className={`btn btn-sm queue-shuffle-btn ${isShuffled ? 'btn-yellow' : ''}`}
                onClick={toggleShuffle}
                title={isShuffled ? 'Restore original order' : 'Shuffle queue'}
              >
                ⇄ Shuffle
              </button>
            )}
            {queue.length > 0 && (
              <button
                id="clear-queue-btn"
                className="btn btn-sm queue-clear-btn"
                onClick={() => { clearQueue(); showToast('Queue cleared'); }}
                title="Clear queue"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="queue-header-bottom">
          <div className="queue-meta mono">
            {queue.length} tracks · {formatDuration(totalDuration)}
          </div>
          {isShuffled && (
            <span className="badge badge-yellow mono queue-shuffled-badge">
              SHUFFLED
            </span>
          )}
        </div>
      </div>

      {/* ── Queue List with DnD ── */}
      {queue.length === 0 ? (
        <div className="queue-empty">
          <div className="queue-empty-icon">≡</div>
          <p>Queue is empty</p>
          <p className="mono">Double-click a song or press Play All</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={queue.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="queue-list" role="list">
              {queue.map((song, index) => (
                <SortableSongItem
                  key={song.id}
                  song={song}
                  index={index}
                  isCurrent={index === currentIndex}
                  isPlaying={isPlaying && index === currentIndex}
                />
              ))}
            </div>
          </SortableContext>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeSong ? (
              <div className="queue-item drag-overlay">
                <div className="queue-drag-handle">{DRAG_ICON}</div>
                <div className="queue-item-info">
                  <span className="queue-item-title">{activeSong.title}</span>
                  <span className="queue-item-artist">{activeSong.artist || 'Unknown'}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </aside>
  );
}
