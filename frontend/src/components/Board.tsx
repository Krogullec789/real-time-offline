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

export function Board() {
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
            />
          ))}
        </SortableContext>
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
