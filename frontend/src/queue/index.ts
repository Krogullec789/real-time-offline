import { getDB, type SyncOperation } from '../db';
import type {
  BatchMoveCardsRequest,
  Card,
  Column,
  CreateCardRequest,
  CreateColumnRequest,
  UpdateCardRequest,
  UpdateColumnRequest,
} from '../types';

let isSyncing = false;

// We'll pass in these API functions from where they are defined, 
// to avoid circular dependencies or keep the networking decoupled.
export type ApiClient = {
  createCard: (payload: CreateCardRequest) => Promise<Card>;
  updateCard: (id: string, payload: UpdateCardRequest) => Promise<Card>;
  deleteCard: (id: string) => Promise<void>;
  batchMoveCards: (payload: BatchMoveCardsRequest) => Promise<Card[]>;
  createColumn: (boardId: string, payload: CreateColumnRequest) => Promise<Column>;
  updateColumn: (boardId: string, columnId: string, payload: UpdateColumnRequest) => Promise<Column>;
  deleteColumn: (boardId: string, columnId: string) => Promise<void>;
};

function isApiErrorWithStatus(error: unknown, status: number) {
  return error instanceof Error
    && 'response' in error
    && (error as { response?: Response }).response?.status === status;
}

export async function processOutbox(apiClient: ApiClient) {
  if (isSyncing) return;
  if (!navigator.onLine) return; // Wait until online

  isSyncing = true;
  const db = await getDB();
  
  try {
    const tx = db.transaction('outbox', 'readwrite');
    const outboxStore = tx.objectStore('outbox');
    
    // Sort by timestamp is crucial for consistency
    const pendingOps = await outboxStore.index('by-status').getAll('pending');
    pendingOps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const op of pendingOps) {
      // Mark as syncing
      op.status = 'syncing';
      await db.put('outbox', op);
      
      try {
        await executeOperation(op, apiClient);
        
        // Success: remove from outbox
        await db.delete('outbox', op.id);
      } catch (err: unknown) {
        console.error('Failed to sync offline operation', op, err);
        
        // Handle last-write-wins 409 conflict
        if (isApiErrorWithStatus(err, 409)) {
          console.warn('Conflict detected, server version is ahead. Discarding offline operation.');
          await db.delete('outbox', op.id);
          // (In a fuller app, we'd trigger a re-fetch of the board state from server here)
        } else {
          // General network error or something else - let's retry later
          op.status = 'pending';
          op.retryCount += 1;
          
          if (op.retryCount > 10) {
              op.status = 'failed';
          }
          await db.put('outbox', op);
        }
      }
    }
  } finally {
    isSyncing = false;
  }
}

async function executeOperation(op: SyncOperation, api: ApiClient) {
  switch (op.type) {
    case 'CREATE_CARD':
      return api.createCard(op.payload);
    case 'UPDATE_CARD':
      return api.updateCard(op.payload.id, op.payload);
    case 'DELETE_CARD':
      return api.deleteCard(op.payload.id);
    case 'BATCH_MOVE_CARDS':
      return api.batchMoveCards(op.payload);
    case 'CREATE_COLUMN':
      return api.createColumn(op.payload.boardId, op.payload);
    case 'UPDATE_COLUMN':
      return api.updateColumn(op.payload.boardId, op.payload.id, op.payload);
    case 'DELETE_COLUMN':
      return api.deleteColumn(op.payload.boardId, op.payload.id);
    default:
      return undefined;
  }
}

// Global listener setup helper
export function setupSyncListeners(api: ApiClient) {
  // Sync now
  processOutbox(api);

  // Sync when coming back online
  window.addEventListener('online', () => {
    processOutbox(api);
  });
}
