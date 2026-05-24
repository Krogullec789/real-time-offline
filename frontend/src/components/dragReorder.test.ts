import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { calculateCardMove } from './dragReorder';

const baseCards: Card[] = [
  { id: 'a', columnId: 'todo', title: 'A', description: '', order: 0, updatedAt: '2026-05-08T10:00:00Z' },
  { id: 'b', columnId: 'todo', title: 'B', description: '', order: 1, updatedAt: '2026-05-08T10:00:00Z' },
  { id: 'c', columnId: 'done', title: 'C', description: '', order: 0, updatedAt: '2026-05-08T10:00:00Z' },
  { id: 'd', columnId: 'done', title: 'D', description: '', order: 1, updatedAt: '2026-05-08T10:00:00Z' },
];

describe('calculateCardMove', () => {
  it('reorders cards inside the same column', () => {
    const positions = calculateCardMove({
      cards: baseCards,
      activeCardId: 'a',
      targetColumnId: 'todo',
      overCardId: 'b',
    });

    expect(positions).toEqual([
      { id: 'b', columnId: 'todo', order: 0 },
      { id: 'a', columnId: 'todo', order: 1 },
    ]);
  });

  it('moves a card between columns and reindexes both affected columns', () => {
    const positions = calculateCardMove({
      cards: baseCards,
      activeCardId: 'a',
      targetColumnId: 'done',
      overCardId: 'd',
    });

    expect(positions).toEqual([
      { id: 'b', columnId: 'todo', order: 0 },
      { id: 'c', columnId: 'done', order: 0 },
      { id: 'a', columnId: 'done', order: 1 },
      { id: 'd', columnId: 'done', order: 2 },
    ]);
  });
});
