import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { getDB as getDBType } from '../db';
import type { useBoardStore as useBoardStoreType } from './index';

let getDB: typeof getDBType;
let useBoardStore: typeof useBoardStoreType;

const boardData = {
  id: 'board-1',
  title: 'Portfolio Board',
  updatedAt: '2026-05-08T10:00:00.000Z',
  columns: [
    {
      id: 'column-1',
      boardId: 'board-1',
      title: 'Backlog',
      order: 0,
      updatedAt: '2026-05-08T10:00:00.000Z',
      cards: [
        {
          id: 'card-1',
          columnId: 'column-1',
          title: 'Write tests',
          description: '',
          order: 0,
          updatedAt: '2026-05-08T10:00:00.000Z',
        },
      ],
    },
  ],
};

async function clearDatabase() {
  const db = await getDB();
  const tx = db.transaction(['boards', 'columns', 'cards', 'outbox'], 'readwrite');
  await Promise.all([
    tx.objectStore('boards').clear(),
    tx.objectStore('columns').clear(),
    tx.objectStore('cards').clear(),
    tx.objectStore('outbox').clear(),
  ]);
  await tx.done;
}

describe('board store offline behavior', () => {
  beforeAll(async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { onLine: false });

    ({ getDB } = await import('../db'));
    ({ useBoardStore } = await import('./index'));
  });

  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: false });
    useBoardStore.setState({
      boardId: null,
      board: null,
      columns: [],
      cards: [],
      connectionStatus: 'offline',
    });
    await clearDatabase();
  });

  it('persists initialized server data into IndexedDB for offline reloads', async () => {
    await useBoardStore.getState().initializeBoard(boardData);

    const db = await getDB();
    await expect(db.get('boards', 'board-1')).resolves.toMatchObject({ id: 'board-1' });
    await expect(db.get('columns', 'column-1')).resolves.toMatchObject({ id: 'column-1' });
    await expect(db.get('cards', 'card-1')).resolves.toMatchObject({ id: 'card-1' });
  });

  it('queues column creation with boardId so the outbox can replay it', async () => {
    await useBoardStore.getState().initializeBoard(boardData);
    await useBoardStore.getState().addColumn('Review');

    const db = await getDB();
    const operations = await db.getAll('outbox');

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: 'CREATE_COLUMN',
      payload: expect.objectContaining({
        boardId: 'board-1',
        title: 'Review',
      }),
    });
  });
});
