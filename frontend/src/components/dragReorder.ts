import { arrayMove } from '@dnd-kit/sortable';
import type { Card, CardPositionRequest } from '../types';

interface CalculateCardMoveInput {
  cards: Card[];
  activeCardId: string;
  targetColumnId: string;
  overCardId?: string;
}

type CardPositionDraft = Omit<CardPositionRequest, 'clientUpdatedAt'>;

function toPositions(cards: Card[], columnId: string): CardPositionDraft[] {
  return cards.map((card, order) => ({
    id: card.id,
    columnId,
    order,
  }));
}

export function calculateCardMove({
  cards,
  activeCardId,
  targetColumnId,
  overCardId,
}: CalculateCardMoveInput): CardPositionDraft[] {
  const activeCard = cards.find((card) => card.id === activeCardId);
  if (!activeCard) return [];

  const sourceColumnId = activeCard.columnId;
  const sourceCards = cards
    .filter((card) => card.columnId === sourceColumnId)
    .sort((a, b) => a.order - b.order);

  if (sourceColumnId === targetColumnId) {
    const oldIndex = sourceCards.findIndex((card) => card.id === activeCardId);
    const newIndex = overCardId
      ? sourceCards.findIndex((card) => card.id === overCardId)
      : sourceCards.length - 1;

    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return [];
    return toPositions(arrayMove(sourceCards, oldIndex, newIndex), sourceColumnId);
  }

  const nextSourceCards = sourceCards.filter((card) => card.id !== activeCardId);
  const targetCards = cards
    .filter((card) => card.columnId === targetColumnId)
    .sort((a, b) => a.order - b.order);

  const insertIndex = overCardId
    ? targetCards.findIndex((card) => card.id === overCardId)
    : targetCards.length;

  const boundedInsertIndex = insertIndex < 0 ? targetCards.length : insertIndex;
  const movedCard = { ...activeCard, columnId: targetColumnId };
  const nextTargetCards = [
    ...targetCards.slice(0, boundedInsertIndex),
    movedCard,
    ...targetCards.slice(boundedInsertIndex),
  ];

  return [
    ...toPositions(nextSourceCards, sourceColumnId),
    ...toPositions(nextTargetCards, targetColumnId),
  ];
}
