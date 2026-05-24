import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDistanceToNow } from 'date-fns';
import { Clock3, Edit2 } from 'lucide-react';
import type { Card } from '../types';

interface Props {
  card: Card;
  isOverlay?: boolean;
  onSelect?: () => void;
}

export function KanbanCard({ card, isOverlay, onSelect }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: 'Card', card } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const formattedDate = formatDistanceToNow(new Date(card.updatedAt), { addSuffix: true });

  const getPriorityClass = (p: string) => {
    switch (p) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return 'priority-medium';
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`glass-card kanban-card ${isOverlay ? 'drag-overlay-item' : ''}`}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // If clicked on action button, prevent triggering double click / select
        if ((e.target as HTMLElement).closest('.card-action-btn')) {
          return;
        }
        onSelect?.();
      }}
    >
      <div className="card-header-row">
        <span className={`priority-badge ${getPriorityClass(card.priority)}`}>
          {card.priority}
        </span>
        
        {!isOverlay && (
          <button 
            className="card-action-btn edit-btn" 
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.();
            }}
            title="Edit card"
          >
            <Edit2 size={12} />
          </button>
        )}
      </div>

      <p className="card-title-text">{card.title}</p>

      <div className="card-meta">
        <span className="card-meta-item">
          <Clock3 size={12} aria-hidden="true" />
          {formattedDate}
        </span>
      </div>
    </div>
  );
}
