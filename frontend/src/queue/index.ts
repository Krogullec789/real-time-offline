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
const statusListeners = new Set<(status: OutboxStatus) => void>();

export interface OutboxStatus {
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  isSyncing: boolean;
}

interface OutboxWorkItem {
  operation: SyncOperation;
  operationIds: string[];
}

type BatchMoveOperation = Extract<SyncOperation, { type: 'BATCH_MOVE_CARDS' }>;

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

export async function getOutboxStatus(): Promise<OutboxStatus> {
  const db = await getDB();
  const operations = await db.getAll('outbox');

  return {
    pendingCount: operations.filter((operation) => operation.status === 'pending').length,
    syncingCount: operations.filter((operation) => operation.status === 'syncing').length,
    failedCount: operations.filter((operation) => operation.status === 'failed').length,
    isSyncing,
  };
}

export async function publishOutboxStatus() {
  const status = await getOutboxStatus();
  for (const listener of statusListeners) {
    listener(status);
  }
}

export function subscribeOutboxStatus(listener: (status: OutboxStatus) => void) {
  statusListeners.add(listener);
  void publishOutboxStatus();

  return () => {
    statusListeners.delete(listener);
  };
}

export async function processOutbox(apiClient: ApiClient) {
  if (isSyncing) {
    await publishOutboxStatus();
    return;
  }

  if (!navigator.onLine) {
    await publishOutboxStatus();
    return;
  }

  isSyncing = true;
  const db = await getDB();
  await publishOutboxStatus();
  
  try {
    const tx = db.transaction('outbox', 'readwrite');
    const outboxStore = tx.objectStore('outbox');
    
    // Sort by timestamp is crucial for consistency
    const pendingOps = await outboxStore.index('by-status').getAll('pending');
    pendingOps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const workItems = coalesceRepeatedCardUpdates(coalesceConsecutiveCardMoveBatches(pendingOps));

    for (const workItem of workItems) {
      const op = workItem.operation;

      for (const operationId of workItem.operationIds.filter((id) => id !== op.id)) {
        await db.delete('outbox', operationId);
      }

      // Mark as syncing
      op.status = 'syncing';
      await db.put('outbox', op);
      await publishOutboxStatus();
      
      try {
        await executeOperation(op, apiClient);
        
        // Success: remove from outbox
        for (const operationId of workItem.operationIds) {
          await db.delete('outbox', operationId);
        }
        await publishOutboxStatus();
      } catch (err: unknown) {
        console.error('Failed to sync offline operation', op, err);
        
        // Handle last-write-wins 409 conflict
        if (isApiErrorWithStatus(err, 409)) {
          console.warn('Conflict detected, server version is ahead. Marking offline operation as failed.');
          op.status = 'failed';
          op.retryCount += 1;
          await db.put('outbox', op);
          await publishOutboxStatus();
        } else {
          // General network error or something else - let's retry later
          op.status = 'pending';
          op.retryCount += 1;
          
          if (op.retryCount > 10) {
              op.status = 'failed';
          }
          await db.put('outbox', op);
          await publishOutboxStatus();
        }
      }
    }
  } finally {
    isSyncing = false;
    await publishOutboxStatus();
  }
}

function coalesceConsecutiveCardMoveBatches(operations: SyncOperation[]): OutboxWorkItem[] {
  const workItems: OutboxWorkItem[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.type !== 'BATCH_MOVE_CARDS') {
      workItems.push({ operation, operationIds: [operation.id] });
      continue;
    }

    const batchOperations: BatchMoveOperation[] = [operation];
    let nextIndex = index + 1;

    while (nextIndex < operations.length && operations[nextIndex].type === 'BATCH_MOVE_CARDS') {
      batchOperations.push(operations[nextIndex] as BatchMoveOperation);
      nextIndex += 1;
    }

    index = nextIndex - 1;

    if (batchOperations.length === 1) {
      workItems.push({ operation, operationIds: [operation.id] });
      continue;
    }

    const latestPositionsByCardId = new Map<string, BatchMoveCardsRequest['cards'][number]>();

    for (const batchOperation of batchOperations) {
      for (const cardPosition of batchOperation.payload.cards) {
        latestPositionsByCardId.set(cardPosition.id, cardPosition);
      }
    }

    const lastOperation = batchOperations[batchOperations.length - 1];
    const mergedOperation: SyncOperation = {
      ...lastOperation,
      payload: {
        cards: [...latestPositionsByCardId.values()].sort((a, b) => {
          const columnComparison = a.columnId.localeCompare(b.columnId);
          return columnComparison === 0 ? a.order - b.order : columnComparison;
        }),
      },
    };

    workItems.push({
      operation: mergedOperation,
      operationIds: batchOperations.map((batchOperation) => batchOperation.id),
    });
  }

  return workItems;
}

function coalesceRepeatedCardUpdates(workItems: OutboxWorkItem[]): OutboxWorkItem[] {
  const latestUpdateByCardId = new Map<string, number>();
  const obsoleteIndexes = new Set<number>();

  for (let index = 0; index < workItems.length; index += 1) {
    const operation = workItems[index].operation;
    if (operation.type !== 'UPDATE_CARD') continue;

    const previousIndex = latestUpdateByCardId.get(operation.payload.id);
    if (previousIndex !== undefined) {
      obsoleteIndexes.add(previousIndex);
      workItems[index].operationIds = [
        ...workItems[previousIndex].operationIds,
        ...workItems[index].operationIds,
      ];
    }

    latestUpdateByCardId.set(operation.payload.id, index);
  }

  return workItems.filter((_, index) => !obsoleteIndexes.has(index));
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
