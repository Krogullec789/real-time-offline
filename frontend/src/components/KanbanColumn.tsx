import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Column, Card } from '../types';
import { KanbanCard } from './KanbanCard';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useBoardStore } from '../store';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  column: Column;
  cards: Card[];
  onSelectCard?: (card: Card) => void;
}

export function KanbanColumn({ column, cards, onSelectCard }: Props) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'Column', column },
  });

  const addCard = useBoardStore(s => s.addCard);
  const updateColumn = useBoardStore(s => s.updateColumn);
  const deleteColumn = useBoardStore(s => s.deleteColumn);

  const [isAdding, setIsAdding] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(column.title);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editedTitle.trim() && editedTitle.trim() !== column.title) {
      updateColumn(column.id, editedTitle);
    }
    setIsEditingTitle(false);
  };

  const handleRenameBlur = () => {
    if (editedTitle.trim() && editedTitle.trim() !== column.title) {
      updateColumn(column.id, editedTitle);
    }
    setIsEditingTitle(false);
  };

  const handleDeleteConfirm = async () => {
    await deleteColumn(column.id);
    setIsDeleteDialogOpen(false);
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
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="glass-panel kanban-column"
      >
      <div className="column-header">
        <div className="column-drag-handle" {...attributes} {...listeners} title="Drag column">
          <GripVertical size={16} />
        </div>
        
        {isEditingTitle ? (
          <form onSubmit={handleRenameSubmit} className="column-rename-form">
            <input
              autoFocus
              className="text-input column-title-input"
              value={editedTitle}
              onChange={e => setEditedTitle(e.target.value)}
              onBlur={handleRenameBlur}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setEditedTitle(column.title);
                  setIsEditingTitle(false);
                }
              }}
            />
          </form>
        ) : (
          <h2 className="column-title" onDoubleClick={() => setIsEditingTitle(true)} title="Double-click to rename">
            {column.title}
          </h2>
        )}
        
        <span className="column-card-count">{cards.length}</span>
        
        <div className="column-actions">
          <button className="column-action-btn delete-btn" onClick={() => setIsDeleteDialogOpen(true)} title="Delete column">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="card-list">
        <SortableContext items={sortedCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {sortedCards.map(card => (
            <KanbanCard key={card.id} card={card} onSelect={() => onSelectCard?.(card)} />
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
              onKeyDown={e => {
                if (e.key === 'Escape') setIsAdding(false);
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

      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        title="Delete column"
        description={`Delete "${column.title}" and all cards inside? This action cannot be undone.`}
        confirmLabel="Delete column"
        tone="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setIsDeleteDialogOpen(false)}
      />
    </>
  );
}
