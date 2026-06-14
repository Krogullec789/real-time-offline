import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB, queueOfflineAction } from '../db';
import { processOutbox, retryOperationWithServerVersion, type ApiClient } from './index';

async function clearOutbox() {
  const db = await getDB();
  await db.clear('outbox');
}

function createApiClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    createCard: vi.fn(),
    updateCard: vi.fn(),
    deleteCard: vi.fn(),
    batchMoveCards: vi.fn(),
    createColumn: vi.fn(),
    updateColumn: vi.fn(),
    batchMoveColumns: vi.fn(),
    deleteColumn: vi.fn(),
    ...overrides,
  } as ApiClient;
}

function createConflictError() {
  const error = new Error('Conflict');
  Object.assign(error, {
    response: new Response(null, { status: 409 }),
  });
  return error;
}

function createJsonConflictError(payload: unknown) {
  const error = new Error('Conflict');
  Object.assign(error, {
    response: new Response(JSON.stringify(payload), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  return error;
}

describe('processOutbox', () => {
  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await clearOutbox();
  });

  it('marks a conflicted operation as failed instead of deleting it silently', async () => {
    await queueOfflineAction({
      id: 'op-1',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-1',
        columnId: 'column-1',
        title: 'Correct payment status',
        description: '',
        priority: 'high',
        order: 0,
        clientUpdatedAt: '2026-05-25T09:00:00.000Z',
      },
    });

    await processOutbox(createApiClient({
      updateCard: vi.fn().mockRejectedValue(createConflictError()),
    }));

    const db = await getDB();
    const operations = await db.getAll('outbox');

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: 'op-1',
      status: 'failed',
      retryCount: 1,
    });
  });

  it('stores server card details for conflict resolution UI', async () => {
    const serverCard = {
      id: 'card-1',
      columnId: 'column-1',
      title: 'Server title',
      description: 'Changed by another user',
      priority: 'high' as const,
      order: 0,
      updatedAt: '2026-05-25T10:05:00.000Z',
    };

    await queueOfflineAction({
      id: 'op-1',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-1',
        columnId: 'column-1',
        title: 'Local title',
        description: '',
        priority: 'medium',
        order: 0,
        clientUpdatedAt: '2026-05-25T09:00:00.000Z',
      },
    });

    await processOutbox(createApiClient({
      updateCard: vi.fn().mockRejectedValue(createJsonConflictError({
        message: 'Conflict: server has a newer version.',
        serverCard,
      })),
    }));

    const db = await getDB();
    const operation = await db.get('outbox', 'op-1');

    expect(operation).toMatchObject({
      status: 'failed',
      conflict: {
        message: 'Conflict: server has a newer version.',
        serverCard,
      },
    });
  });

  it('rebases a conflicted card update before retrying local changes', async () => {
    const db = await getDB();
    await db.put('outbox', {
      id: 'op-1',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      status: 'failed',
      retryCount: 1,
      payload: {
        id: 'card-1',
        columnId: 'column-1',
        title: 'Local title',
        description: '',
        priority: 'medium',
        order: 0,
        clientUpdatedAt: '2026-05-25T09:00:00.000Z',
      },
      conflict: {
        message: 'Conflict: server has a newer version.',
        serverCard: {
          id: 'card-1',
          columnId: 'column-1',
          title: 'Server title',
          description: '',
          priority: 'high',
          order: 0,
          updatedAt: '2026-05-25T10:05:00.000Z',
        },
      },
    });

    const failedOperation = await db.get('outbox', 'op-1');
    expect(failedOperation).toBeDefined();

    await retryOperationWithServerVersion(failedOperation!);

    await expect(db.get('outbox', 'op-1')).resolves.toMatchObject({
      status: 'pending',
      retryCount: 0,
      payload: expect.objectContaining({
        clientUpdatedAt: '2026-05-25T10:05:00.000Z',
      }),
      conflict: undefined,
    });
  });

  it('retries failed operations when sync is requested again', async () => {
    const db = await getDB();
    await db.put('outbox', {
      id: 'op-1',
      type: 'DELETE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: { id: 'card-1' },
      status: 'failed',
      retryCount: 3,
    });

    const deleteCard = vi.fn().mockResolvedValue(undefined);

    await processOutbox(createApiClient({ deleteCard }));

    expect(deleteCard).toHaveBeenCalledWith('card-1');
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('treats repeated deletes that return 404 as already synced', async () => {
    await queueOfflineAction({
      id: 'delete-1',
      type: 'DELETE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: { id: 'card-1' },
    });

    const notFound = new Error('Not found');
    Object.assign(notFound, {
      response: new Response(null, { status: 404 }),
    });

    await processOutbox(createApiClient({
      deleteCard: vi.fn().mockRejectedValue(notFound),
    }));

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('notifies callers with the authoritative API response before removing successful operations', async () => {
    await queueOfflineAction({
      id: 'edit-1',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Edited title',
        description: '',
        priority: 'medium',
        order: 0,
        clientUpdatedAt: '2026-05-25T09:00:00.000Z',
      },
    });

    const serverCard = {
      id: 'card-a',
      columnId: 'todo',
      title: 'Edited title',
      description: '',
      priority: 'medium' as const,
      order: 0,
      updatedAt: '2026-05-25T10:02:00.000Z',
    };
    const onOperationSuccess = vi.fn();

    await processOutbox(
      createApiClient({ updateCard: vi.fn().mockResolvedValue(serverCard) }),
      { onOperationSuccess },
    );

    expect(onOperationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'edit-1', type: 'UPDATE_CARD' }),
      serverCard,
    );
  });

  it('coalesces consecutive card move batches before syncing them', async () => {
    await queueOfflineAction({
      id: 'move-1',
      type: 'BATCH_MOVE_CARDS',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        cards: [
          {
            id: 'card-a',
            columnId: 'done',
            order: 0,
            clientUpdatedAt: '2026-05-25T10:00:00.000Z',
          },
          {
            id: 'card-c',
            columnId: 'done',
            order: 1,
            clientUpdatedAt: '2026-05-25T10:00:00.000Z',
          },
        ],
      },
    });
    await queueOfflineAction({
      id: 'move-2',
      type: 'BATCH_MOVE_CARDS',
      timestamp: '2026-05-25T10:01:00.000Z',
      payload: {
        cards: [
          {
            id: 'card-a',
            columnId: 'done',
            order: 0,
            clientUpdatedAt: '2026-05-25T10:01:00.000Z',
          },
          {
            id: 'card-b',
            columnId: 'done',
            order: 1,
            clientUpdatedAt: '2026-05-25T10:01:00.000Z',
          },
          {
            id: 'card-c',
            columnId: 'done',
            order: 2,
            clientUpdatedAt: '2026-05-25T10:01:00.000Z',
          },
        ],
      },
    });

    const batchMoveCards = vi.fn().mockResolvedValue([]);

    await processOutbox(createApiClient({ batchMoveCards }));

    expect(batchMoveCards).toHaveBeenCalledTimes(1);
    expect(batchMoveCards).toHaveBeenCalledWith({
      cards: [
        {
          id: 'card-a',
          columnId: 'done',
          order: 0,
          clientUpdatedAt: '2026-05-25T10:01:00.000Z',
        },
        {
          id: 'card-b',
          columnId: 'done',
          order: 1,
          clientUpdatedAt: '2026-05-25T10:01:00.000Z',
        },
        {
          id: 'card-c',
          columnId: 'done',
          order: 2,
          clientUpdatedAt: '2026-05-25T10:01:00.000Z',
        },
      ],
    });

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('coalesces repeated offline edits to the same card before syncing them', async () => {
    await queueOfflineAction({
      id: 'edit-1',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'First offline title',
        description: '',
        priority: 'medium',
        order: 0,
        clientUpdatedAt: '2026-05-25T10:00:00.000Z',
      },
    });
    await queueOfflineAction({
      id: 'edit-2',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:01:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Final offline title',
        description: 'Final description',
        priority: 'high',
        order: 0,
        clientUpdatedAt: '2026-05-25T10:01:00.000Z',
      },
    });

    const updateCard = vi.fn().mockResolvedValue({
      id: 'card-a',
      columnId: 'todo',
      title: 'Final offline title',
      description: 'Final description',
      priority: 'high',
      order: 0,
      updatedAt: '2026-05-25T10:02:00.000Z',
    });

    await processOutbox(createApiClient({ updateCard }));

    expect(updateCard).toHaveBeenCalledTimes(1);
    expect(updateCard).toHaveBeenCalledWith('card-a', {
      id: 'card-a',
      columnId: 'todo',
      title: 'Final offline title',
      description: 'Final description',
      priority: 'high',
      order: 0,
      clientUpdatedAt: '2026-05-25T10:01:00.000Z',
    });

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('uses the server timestamp from an offline card create before replaying its later edit', async () => {
    await queueOfflineAction({
      id: 'create-card',
      type: 'CREATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Draft card',
        description: '',
        priority: 'medium',
      },
    });
    await queueOfflineAction({
      id: 'edit-card',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:01:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Final offline title',
        description: 'Edited before reconnect',
        priority: 'high',
        order: 0,
        clientUpdatedAt: '2026-05-25T10:01:00.000Z',
      },
    });

    const createCard = vi.fn().mockResolvedValue({
      id: 'card-a',
      columnId: 'todo',
      title: 'Draft card',
      description: '',
      priority: 'medium',
      order: 0,
      updatedAt: '2026-05-25T10:02:00.000Z',
    });
    const updateCard = vi.fn().mockResolvedValue({
      id: 'card-a',
      columnId: 'todo',
      title: 'Final offline title',
      description: 'Edited before reconnect',
      priority: 'high',
      order: 0,
      updatedAt: '2026-05-25T10:03:00.000Z',
    });

    await processOutbox(createApiClient({ createCard, updateCard }));

    expect(updateCard).toHaveBeenCalledWith('card-a', {
      id: 'card-a',
      columnId: 'todo',
      title: 'Final offline title',
      description: 'Edited before reconnect',
      priority: 'high',
      order: 0,
      clientUpdatedAt: '2026-05-25T10:02:00.000Z',
    });

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('uses the server timestamp from an offline card create before replaying its later move', async () => {
    await queueOfflineAction({
      id: 'create-card',
      type: 'CREATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Offline card',
        description: '',
        priority: 'medium',
      },
    });
    await queueOfflineAction({
      id: 'move-card',
      type: 'BATCH_MOVE_CARDS',
      timestamp: '2026-05-25T10:01:00.000Z',
      payload: {
        cards: [
          {
            id: 'card-a',
            columnId: 'done',
            order: 1,
            clientUpdatedAt: '2026-05-25T10:01:00.000Z',
          },
        ],
      },
    });

    const createCard = vi.fn().mockResolvedValue({
      id: 'card-a',
      columnId: 'todo',
      title: 'Offline card',
      description: '',
      priority: 'medium',
      order: 0,
      updatedAt: '2026-05-25T10:02:00.000Z',
    });
    const batchMoveCards = vi.fn().mockResolvedValue([]);

    await processOutbox(createApiClient({ createCard, batchMoveCards }));

    expect(batchMoveCards).toHaveBeenCalledWith({
      cards: [
        {
          id: 'card-a',
          columnId: 'done',
          order: 1,
          clientUpdatedAt: '2026-05-25T10:02:00.000Z',
        },
      ],
    });

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('uses the server timestamp from an offline card update before replaying its later move', async () => {
    await queueOfflineAction({
      id: 'edit-card',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Edited offline title',
        description: '',
        priority: 'medium',
        order: 0,
        clientUpdatedAt: '2026-05-25T09:00:00.000Z',
      },
    });
    await queueOfflineAction({
      id: 'move-card',
      type: 'BATCH_MOVE_CARDS',
      timestamp: '2026-05-25T10:01:00.000Z',
      payload: {
        cards: [
          {
            id: 'card-a',
            columnId: 'done',
            order: 1,
            clientUpdatedAt: '2026-05-25T09:00:00.000Z',
          },
        ],
      },
    });

    const updateCard = vi.fn().mockResolvedValue({
      id: 'card-a',
      columnId: 'todo',
      title: 'Edited offline title',
      description: '',
      priority: 'medium',
      order: 0,
      updatedAt: '2026-05-25T10:02:00.000Z',
    });
    const batchMoveCards = vi.fn().mockResolvedValue([]);

    await processOutbox(createApiClient({ updateCard, batchMoveCards }));

    expect(batchMoveCards).toHaveBeenCalledWith({
      cards: [
        {
          id: 'card-a',
          columnId: 'done',
          order: 1,
          clientUpdatedAt: '2026-05-25T10:02:00.000Z',
        },
      ],
    });

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });

  it('drops obsolete card edits before replaying a later delete for the same card', async () => {
    await queueOfflineAction({
      id: 'edit-card',
      type: 'UPDATE_CARD',
      timestamp: '2026-05-25T10:00:00.000Z',
      payload: {
        id: 'card-a',
        columnId: 'todo',
        title: 'Edited before delete',
        description: '',
        priority: 'medium',
        order: 0,
        clientUpdatedAt: '2026-05-25T09:00:00.000Z',
      },
    });
    await queueOfflineAction({
      id: 'move-card',
      type: 'BATCH_MOVE_CARDS',
      timestamp: '2026-05-25T10:01:00.000Z',
      payload: {
        cards: [
          {
            id: 'card-a',
            columnId: 'done',
            order: 1,
            clientUpdatedAt: '2026-05-25T09:00:00.000Z',
          },
        ],
      },
    });
    await queueOfflineAction({
      id: 'delete-card',
      type: 'DELETE_CARD',
      timestamp: '2026-05-25T10:02:00.000Z',
      payload: { id: 'card-a' },
    });

    const updateCard = vi.fn();
    const batchMoveCards = vi.fn();
    const deleteCard = vi.fn().mockResolvedValue(undefined);

    await processOutbox(createApiClient({ updateCard, batchMoveCards, deleteCard }));

    expect(updateCard).not.toHaveBeenCalled();
    expect(batchMoveCards).not.toHaveBeenCalled();
    expect(deleteCard).toHaveBeenCalledWith('card-a');

    const db = await getDB();
    await expect(db.getAll('outbox')).resolves.toEqual([]);
  });
});
