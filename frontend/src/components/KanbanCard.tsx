import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDistanceToNow } from 'date-fns';
import { Clock3 } from 'lucide-react';
import type { Card } from '../types';

interface Props {
  card: Card;
  isOverlay?: boolean;
}

export function KanbanCard({ card, isOverlay }: Props) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`glass-card kanban-card ${isOverlay ? 'drag-overlay-item' : ''}`}
      {...attributes}
      {...listeners}
    >
      <p>{card.title}</p>

      <div className="card-meta">
        <span className="card-meta-item">
          <Clock3 size={14} aria-hidden="true" />
          {formattedDate}
        </span>
      </div>
    </div>
  );
}
