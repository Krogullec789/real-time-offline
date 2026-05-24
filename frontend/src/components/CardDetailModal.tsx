import React, { useState, useEffect } from 'react';
import { X, Trash2, AlertCircle } from 'lucide-react';
import { useBoardStore } from '../store';
import type { Card } from '../types';

interface Props {
  card: Card;
  onClose: () => void;
}

export function CardDetailModal({ card, onClose }: Props) {
  const updateCard = useBoardStore(s => s.updateCard);
  const deleteCard = useBoardStore(s => s.deleteCard);

  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(card.priority);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await updateCard(card.id, {
      title: title.trim(),
      description: description.trim(),
      priority,
    });
    onClose();
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this card?")) {
      await deleteCard(card.id);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass-panel modal-content" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Edit Task</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSave} className="modal-form">
          <div className="form-group">
            <label htmlFor="card-title">Title</label>
            <input
              id="card-title"
              type="text"
              className="text-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="card-priority">Priority</label>
            <div className="priority-select-wrapper">
              <AlertCircle size={16} className="priority-icon" />
              <select
                id="card-priority"
                className="text-input priority-select"
                value={priority}
                onChange={e => setPriority(e.target.value as 'low' | 'medium' | 'high')}
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="card-desc">Description</label>
            <textarea
              id="card-desc"
              className="text-input textarea-input"
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add details about this task..."
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-danger" onClick={handleDelete}>
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
