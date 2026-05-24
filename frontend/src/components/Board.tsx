import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { useBoardStore } from '../store';
import type { Card, Column } from '../types';
import { calculateCardMove } from './dragReorder';
import { Plus } from 'lucide-react';

interface BoardProps {
  onSelectCard?: (card: Card) => void;
}

export function Board({ onSelectCard }: BoardProps) {
  const columns = useBoardStore(s => s.columns);
  const cards = useBoardStore(s => s.cards);
  
  const moveCardsBatch = useBoardStore(s => s.moveCardsBatch);

  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortedColumns = useMemo(() => {
    return [...columns].sort((a, b) => a.order - b.order);
  }, [columns]);

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    columns.forEach(c => map.set(c.id, []));
    cards.forEach(c => {
      if (map.has(c.columnId)) {
        map.get(c.columnId)!.push(c);
      }
    });
    return map;
  }, [columns, cards]);

  const onDragStart = (e: DragStartEvent) => {
    if (e.active.data.current?.type === 'Card') {
      setActiveCard(e.active.data.current.card);
      return;
    }
    if (e.active.data.current?.type === 'Column') {
      setActiveColumn(e.active.data.current.column);
      return;
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null);
    setActiveColumn(null);

    const { active, over } = e;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    // Handle Card sorting and moving
    if (active.data.current?.type === 'Card') {
      const isOverACard = over.data.current?.type === 'Card';
      const isOverAColumn = over.data.current?.type === 'Column';

      const targetColumnId = isOverAColumn
        ? String(overId)
        : over.data.current?.card.columnId;

      if (!targetColumnId) return;

      const positions = calculateCardMove({
        cards: useBoardStore.getState().cards,
        activeCardId: String(activeId),
        targetColumnId,
        overCardId: isOverACard ? String(overId) : undefined,
      });

      await moveCardsBatch(positions);
    }

    // Handle Column sorting
    if (active.data.current?.type === 'Column') {
      const overIndex = sortedColumns.findIndex(c => c.id === overId);
      if (overIndex !== -1) {
        await useBoardStore.getState().moveColumn(String(activeId), overIndex);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="board-container">
        <SortableContext items={sortedColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          {sortedColumns.map(col => (
            <KanbanColumn
              key={col.id}
              column={col}
              cards={cardsByColumn.get(col.id) || []}
              onSelectCard={onSelectCard}
            />
          ))}
        </SortableContext>
        
        <AddColumnForm />
      </div>

      <DragOverlay>
        {activeCard && <KanbanCard card={activeCard} isOverlay />}
        {activeColumn && (
          <KanbanColumn
            column={activeColumn}
            cards={cardsByColumn.get(activeColumn.id) || []}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function AddColumnForm() {
  const addColumn = useBoardStore(s => s.addColumn);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await addColumn(title);
    setTitle('');
    setIsAdding(false);
  };

  if (!isAdding) {
    return (
      <button className="glass-panel add-column-trigger-btn" onClick={() => setIsAdding(true)}>
        <Plus size={18} />
        <span>Add column</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-panel add-column-form">
      <input
        autoFocus
        type="text"
        className="text-input"
        placeholder="Enter column title..."
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setIsAdding(false);
        }}
      />
      <div className="add-column-form-actions">
        <button type="submit" className="btn-primary">Add</button>
        <button type="button" className="btn-secondary" onClick={() => setIsAdding(false)}>Cancel</button>
      </div>
    </form>
  );
}
