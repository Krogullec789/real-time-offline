import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Column, Card } from '../types';
import { KanbanCard } from './KanbanCard';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useBoardStore } from '../store';
import { Plus } from 'lucide-react';

interface Props {
  column: Column;
  cards: Card[];
}

export function KanbanColumn({ column, cards }: Props) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'Column', column },
  });

  const addCard = useBoardStore(s => s.addCard);
  const [isAdding, setIsAdding] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardTitle.trim()) return;
    addCard(column.id, newCardTitle);
    setNewCardTitle('');
    setIsAdding(false);
  };

  // Ensure cards are sorted by order
  const sortedCards = [...cards].sort((a, b) => a.order - b.order);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="glass-panel kanban-column"
    >
      <div className="column-header" {...attributes} {...listeners}>
        <h2 className="column-title">{column.title}</h2>
        <span style={{color: 'var(--text-secondary)', fontSize: '0.8rem'}}>{cards.length}</span>
      </div>

      <div className="card-list">
        <SortableContext items={sortedCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {sortedCards.map(card => (
            <KanbanCard key={card.id} card={card} />
          ))}
        </SortableContext>
      </div>

      <div style={{marginTop: 'auto', paddingTop: '12px'}}>
        {isAdding ? (
          <form onSubmit={handleAddSubmit}>
            <input
              autoFocus
              className="text-input"
              value={newCardTitle}
              onChange={e => setNewCardTitle(e.target.value)}
              placeholder="Enter card title..."
              onBlur={() => {
                if(!newCardTitle.trim()) setIsAdding(false);
              }}
            />
          </form>
        ) : (
          <button className="add-card-btn" onClick={() => setIsAdding(true)}>
            <Plus size={18} />
            <span>Add a card</span>
          </button>
        )}
      </div>
    </div>
  );
}
