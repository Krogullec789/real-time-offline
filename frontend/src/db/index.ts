import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BatchMoveCardsRequest,
  BatchMoveColumnsOperation,
  Board,
  Card,
  Column,
  CreateCardRequest,
  CreateColumnOperation,
  DeleteCardOperation,
  DeleteColumnOperation,
  UpdateCardRequest,
  UpdateColumnRequest,
} from '../types';

interface SyncOperationBase<TType extends string, TPayload> {
  id: string;
  type: TType;
  payload: TPayload;
  timestamp: string; // ISO string
  status: 'pending' | 'syncing' | 'failed';
  retryCount: number;
}

export type SyncOperation =
  | SyncOperationBase<'CREATE_CARD', CreateCardRequest>
  | SyncOperationBase<'UPDATE_CARD', UpdateCardRequest>
  | SyncOperationBase<'DELETE_CARD', DeleteCardOperation>
  | SyncOperationBase<'BATCH_MOVE_CARDS', BatchMoveCardsRequest>
  | SyncOperationBase<'BATCH_MOVE_COLUMNS', BatchMoveColumnsOperation>
  | SyncOperationBase<'CREATE_COLUMN', CreateColumnOperation>
  | SyncOperationBase<'UPDATE_COLUMN', UpdateColumnRequest>
  | SyncOperationBase<'DELETE_COLUMN', DeleteColumnOperation>;

export type QueuedSyncOperation = SyncOperation extends infer T
  ? T extends SyncOperation
    ? Omit<T, 'status' | 'retryCount'>
    : never
  : never;

interface KanbanDBSchema extends DBSchema {
  boards: {
    key: string;
    value: Board;
  };
  columns: {
    key: string;
    value: Column;
    indexes: { 'by-board': string };
  };
  cards: {
    key: string;
    value: Card;
    indexes: { 'by-column': string };
  };
  outbox: {
    key: string;
    value: SyncOperation;
    indexes: { 'by-status': string, 'by-timestamp': string };
  };
}

let dbPromise: Promise<IDBPDatabase<KanbanDBSchema>>;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<KanbanDBSchema>('kanban-offline-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('boards')) {
          db.createObjectStore('boards', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('columns')) {
          const store = db.createObjectStore('columns', { keyPath: 'id' });
          store.createIndex('by-board', 'boardId');
        }
        if (!db.objectStoreNames.contains('cards')) {
          const store = db.createObjectStore('cards', { keyPath: 'id' });
          store.createIndex('by-column', 'columnId');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('by-status', 'status');
          store.createIndex('by-timestamp', 'timestamp');
        }
      },
    });
  }
  return dbPromise;
}

// Helper to fully overwrite local DB from server fetch
export async function syncDatabaseFromServer(boards: Board[], columns: Column[], cards: Card[]) {
  const db = await getDB();
  const tx = db.transaction(['boards', 'columns', 'cards'], 'readwrite');
  
  await tx.objectStore('boards').clear();
  await tx.objectStore('columns').clear();
  await tx.objectStore('cards').clear();

  for (const b of boards) await tx.objectStore('boards').put(b);
  for (const c of columns) await tx.objectStore('columns').put(c);
  for (const card of cards) await tx.objectStore('cards').put(card);

  await tx.done;
}

export async function loadBoardFromCache(boardId: string) {
  const db = await getDB();
  const board = await db.get('boards', boardId);
  if (!board) return null;

  const columns = (await db.getAllFromIndex('columns', 'by-board', boardId))
    .sort((a, b) => a.order - b.order);

  const columnsWithCards = await Promise.all(
    columns.map(async (column) => ({
      ...column,
      cards: (await db.getAllFromIndex('cards', 'by-column', column.id))
        .sort((a, b) => a.order - b.order),
    })),
  );

  return {
    ...board,
    columns: columnsWithCards,
  };
}

// Queue an action offline
export async function queueOfflineAction(operation: QueuedSyncOperation) {
  const db = await getDB();
  await db.put('outbox', {
    ...operation,
    status: 'pending',
    retryCount: 0
  });
}
