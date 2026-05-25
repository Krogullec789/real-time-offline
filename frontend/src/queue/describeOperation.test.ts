import { describe, expect, it } from 'vitest';
import type { SyncOperation } from '../db';
import { describeSyncOperation } from './describeOperation';

const baseOperation = {
  id: 'op-1',
  timestamp: '2026-05-24T12:00:00.000Z',
  status: 'pending',
  retryCount: 0,
} satisfies Pick<SyncOperation, 'id' | 'timestamp' | 'status' | 'retryCount'>;

describe('describeSyncOperation', () => {
  it('describes card operations without unsafe payload casts', () => {
    const operation: SyncOperation = {
      ...baseOperation,
      type: 'UPDATE_CARD',
      payload: {
        id: 'card-1',
        columnId: 'column-1',
        title: 'Polish portfolio project',
        description: '',
        priority: 'high',
        order: 1,
        clientUpdatedAt: '2026-05-24T12:00:00.000Z',
      },
    };

    expect(describeSyncOperation(operation)).toBe('Edit card "Polish portfolio project"');
  });

  it('describes batch moves using the typed card count', () => {
    const operation: SyncOperation = {
      ...baseOperation,
      type: 'BATCH_MOVE_CARDS',
      payload: {
        cards: [
          {
            id: 'card-1',
            columnId: 'column-2',
            order: 0,
            clientUpdatedAt: '2026-05-24T12:00:00.000Z',
          },
          {
            id: 'card-2',
            columnId: 'column-2',
            order: 1,
            clientUpdatedAt: '2026-05-24T12:00:00.000Z',
          },
        ],
      },
    };

    expect(describeSyncOperation(operation)).toBe('Move 2 cards');
  });
});
