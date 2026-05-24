import { create } from 'zustand';
import type {
  BatchMoveCardsRequest,
  Board,
  BoardData,
  Card,
  CardPositionRequest,
  Column,
  ConnectionStatus,
} from '../types';
import { getDB, queueOfflineAction, syncDatabaseFromServer } from '../db';
import {
  type OutboxStatus,
  processOutbox,
  publishOutboxStatus,
  subscribeOutboxStatus,
} from '../queue';
import * as api from '../api';

interface BoardState {
  boardId: string | null;
  board: Board | null;
  columns: Column[];
  cards: Card[];
  connectionStatus: ConnectionStatus;
  outboxStatus: OutboxStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
  initializeBoard: (boardData: BoardData) => Promise<void>;
  addCard: (columnId: string, title: string, priority?: 'low' | 'medium' | 'high') => Promise<void>;
  updateCard: (cardId: string, updates: Partial<Card>) => Promise<void>;
  deleteCard: (cardId: string) => Promise<void>;
  moveCard: (cardId: string, newColumnId: string, newOrder: number) => Promise<void>;
  moveCardsBatch: (positions: Omit<CardPositionRequest, 'clientUpdatedAt'>[]) => Promise<void>;
  addColumn: (title: string) => Promise<void>;
  updateColumn: (columnId: string, title: string) => Promise<void>;
  deleteColumn: (columnId: string) => Promise<void>;
  moveColumn: (columnId: string, newOrder: number) => Promise<void>;
  applyRemoteCardChange: (card: Card) => Promise<void>;
  applyRemoteColumnChange: (column: Column) => Promise<void>;
  applyRemoteCardDelete: (cardId: string) => Promise<void>;
  applyRemoteColumnDelete: (columnId: string) => Promise<void>;
  applyRemoteCardsBatchUpdate: (cards: Card[]) => Promise<void>;
}

function createId() {
  return crypto.randomUUID();
}

function initialConnectionStatus(): ConnectionStatus {
  return typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline';
}

async function persistCards(cards: Card[]) {
  const db = await getDB();
  const tx = db.transaction('cards', 'readwrite');
  for (const card of cards) {
    await tx.store.put(card);
  }
  await tx.done;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  boardId: null,
  board: null,
  columns: [],
  cards: [],
  connectionStatus: initialConnectionStatus(),
  outboxStatus: {
    pendingCount: 0,
    syncingCount: 0,
    failedCount: 0,
    isSyncing: false,
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  initializeBoard: async (boardData) => {
    const parsedColumns = boardData.columns.map((column) => ({
      id: column.id,
      boardId: column.boardId,
      title: column.title,
      order: column.order,
      updatedAt: column.updatedAt,
    }));
    const parsedCards = boardData.columns.flatMap((column) => column.cards);
    const board = {
      id: boardData.id,
      title: boardData.title,
      updatedAt: boardData.updatedAt,
    };

    set({
      boardId: boardData.id,
      board,
      columns: parsedColumns,
      cards: parsedCards,
    });

    await syncDatabaseFromServer([board], parsedColumns, parsedCards);
    void processOutbox(api);
  },

  addCard: async (columnId, title, priority) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const { cards } = get();
    const columnCards = cards.filter((card) => card.columnId === columnId);
    const maxOrder = columnCards.length > 0 ? Math.max(...columnCards.map((card) => card.order)) : -1;
    const now = new Date().toISOString();

    const newCard: Card = {
      id: createId(),
      columnId,
      title: trimmedTitle,
      description: '',
      priority: priority || 'medium',
      order: maxOrder + 1,
      updatedAt: now,
    };

    set((state) => ({ cards: [...state.cards, newCard] }));
    await persistCards([newCard]);

    await queueOfflineAction({
      id: createId(),
      type: 'CREATE_CARD',
      payload: {
        id: newCard.id,
        columnId: newCard.columnId,
        title: newCard.title,
        description: newCard.description,
        priority: newCard.priority
      },
      timestamp: now,
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  updateCard: async (cardId, updates) => {
    const oldCard = get().cards.find((card) => card.id === cardId);
    if (!oldCard) return;

    const now = new Date().toISOString();
    const updatedCard = { ...oldCard, ...updates, updatedAt: now };

    set((state) => ({
      cards: state.cards.map((card) => (card.id === cardId ? updatedCard : card)),
    }));

    await persistCards([updatedCard]);

    await queueOfflineAction({
      id: createId(),
      type: 'UPDATE_CARD',
      payload: {
        id: updatedCard.id,
        columnId: updatedCard.columnId,
        title: updatedCard.title,
        description: updatedCard.description,
        priority: updatedCard.priority,
        order: updatedCard.order,
        clientUpdatedAt: now
      },
      timestamp: now,
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  deleteCard: async (cardId) => {
    set((state) => ({
      cards: state.cards.filter((card) => card.id !== cardId),
    }));

    const db = await getDB();
    await db.delete('cards', cardId);

    await queueOfflineAction({
      id: createId(),
      type: 'DELETE_CARD',
      payload: { id: cardId },
      timestamp: new Date().toISOString(),
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  moveCard: async (cardId, newColumnId, newOrder) => {
    await get().moveCardsBatch([{ id: cardId, columnId: newColumnId, order: newOrder }]);
  },

  moveCardsBatch: async (positions) => {
    if (positions.length === 0) return;

    const now = new Date().toISOString();
    const positionById = new Map(positions.map((position) => [position.id, position]));
    const updatedCards = get().cards
      .filter((card) => positionById.has(card.id))
      .map((card) => {
        const position = positionById.get(card.id);
        if (!position) return card;
        return {
          ...card,
          columnId: position.columnId,
          order: position.order,
          updatedAt: now,
        };
      });

    if (updatedCards.length === 0) return;

    set((state) => ({
      cards: state.cards.map((card) => updatedCards.find((updated) => updated.id === card.id) ?? card),
    }));

    await persistCards(updatedCards);

    const payload: BatchMoveCardsRequest = {
      cards: positions.map((position) => ({
        ...position,
        clientUpdatedAt: now,
      })),
    };

    await queueOfflineAction({
      id: createId(),
      type: 'BATCH_MOVE_CARDS',
      payload,
      timestamp: now,
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  addColumn: async (title) => {
    const trimmedTitle = title.trim();
    const { columns, boardId } = get();
    if (!boardId || !trimmedTitle) return;

    const maxOrder = columns.length > 0 ? Math.max(...columns.map((column) => column.order)) : -1;
    const now = new Date().toISOString();
    const newColumn: Column = {
      id: createId(),
      boardId,
      title: trimmedTitle,
      order: maxOrder + 1,
      updatedAt: now,
    };

    set((state) => ({ columns: [...state.columns, newColumn] }));

    const db = await getDB();
    await db.put('columns', newColumn);

    await queueOfflineAction({
      id: createId(),
      type: 'CREATE_COLUMN',
      payload: { id: newColumn.id, boardId, title: newColumn.title },
      timestamp: now,
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  updateColumn: async (columnId, title) => {
    const trimmedTitle = title.trim();
    const { columns, boardId } = get();
    if (!boardId || !trimmedTitle) return;

    const column = columns.find((c) => c.id === columnId);
    if (!column) return;

    const now = new Date().toISOString();
    const updatedColumn = { ...column, title: trimmedTitle, updatedAt: now };

    set((state) => ({
      columns: state.columns.map((c) => (c.id === columnId ? updatedColumn : c)),
    }));

    const db = await getDB();
    await db.put('columns', updatedColumn);

    await queueOfflineAction({
      id: createId(),
      type: 'UPDATE_COLUMN',
      payload: { id: columnId, boardId, title: trimmedTitle, order: column.order },
      timestamp: now,
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  deleteColumn: async (columnId) => {
    const { boardId } = get();
    if (!boardId) return;

    set((state) => ({
      columns: state.columns.filter((c) => c.id !== columnId),
      cards: state.cards.filter((c) => c.columnId !== columnId),
    }));

    const db = await getDB();
    const tx = db.transaction(['columns', 'cards'], 'readwrite');
    await tx.objectStore('columns').delete(columnId);
    const cards = await tx.objectStore('cards').index('by-column').getAll(columnId);
    await Promise.all(cards.map((c) => tx.objectStore('cards').delete(c.id)));
    await tx.done;

    await queueOfflineAction({
      id: createId(),
      type: 'DELETE_COLUMN',
      payload: { id: columnId, boardId },
      timestamp: new Date().toISOString(),
    });

    await publishOutboxStatus();
    void processOutbox(api);
  },

  moveColumn: async (columnId, newOrder) => {
    const { columns, boardId } = get();
    if (!boardId) return;

    const column = columns.find((c) => c.id === columnId);
    if (!column) return;

    const now = new Date().toISOString();
    const sorted = [...columns].sort((a, b) => a.order - b.order);
    const oldIndex = sorted.findIndex((c) => c.id === columnId);
    if (oldIndex === -1) return;

    sorted.splice(oldIndex, 1);
    sorted.splice(newOrder, 0, column);

    const updatedColumns = sorted.map((col, index) => ({
      ...col,
      order: index,
      updatedAt: now,
    }));

    set({ columns: updatedColumns });

    const db = await getDB();
    const tx = db.transaction('columns', 'readwrite');
    for (const col of updatedColumns) {
      await tx.store.put(col);
    }
    await tx.done;

    for (const col of updatedColumns) {
      await queueOfflineAction({
        id: createId(),
        type: 'UPDATE_COLUMN',
        payload: { id: col.id, boardId, title: col.title, order: col.order },
        timestamp: now,
      });
    }

    await publishOutboxStatus();
    void processOutbox(api);
  },

  applyRemoteCardChange: async (remoteCard) => {
    set((state) => {
      const existing = state.cards.find((card) => card.id === remoteCard.id);
      if (existing && new Date(existing.updatedAt).getTime() > new Date(remoteCard.updatedAt).getTime()) {
        return state;
      }

      return {
        cards: [...state.cards.filter((card) => card.id !== remoteCard.id), remoteCard],
      };
    });

    await persistCards([remoteCard]);
  },

  applyRemoteCardsBatchUpdate: async (remoteCards) => {
    set((state) => {
      let nextCards = [...state.cards];
      for (const remoteCard of remoteCards) {
        const existing = nextCards.find((card) => card.id === remoteCard.id);
        if (existing && new Date(existing.updatedAt).getTime() > new Date(remoteCard.updatedAt).getTime()) {
          continue;
        }

        nextCards = nextCards.filter((card) => card.id !== remoteCard.id);
        nextCards.push(remoteCard);
      }

      return { cards: nextCards };
    });

    await persistCards(remoteCards);
  },

  applyRemoteColumnChange: async (remoteColumn) => {
    set((state) => {
      const existing = state.columns.find((column) => column.id === remoteColumn.id);
      if (existing && new Date(existing.updatedAt).getTime() > new Date(remoteColumn.updatedAt).getTime()) {
        return state;
      }

      return {
        columns: [...state.columns.filter((column) => column.id !== remoteColumn.id), remoteColumn],
      };
    });

    const db = await getDB();
    await db.put('columns', remoteColumn);
  },

  applyRemoteCardDelete: async (cardId) => {
    set((state) => ({ cards: state.cards.filter((card) => card.id !== cardId) }));
    const db = await getDB();
    await db.delete('cards', cardId);
  },

  applyRemoteColumnDelete: async (columnId) => {
    set((state) => ({
      columns: state.columns.filter((column) => column.id !== columnId),
      cards: state.cards.filter((card) => card.columnId !== columnId),
    }));

    const db = await getDB();
    const tx = db.transaction(['columns', 'cards'], 'readwrite');
    await tx.objectStore('columns').delete(columnId);
    const cards = await tx.objectStore('cards').index('by-column').getAll(columnId);
    await Promise.all(cards.map((card) => tx.objectStore('cards').delete(card.id)));
    await tx.done;
  },
}));

subscribeOutboxStatus((outboxStatus) => {
  useBoardStore.setState({ outboxStatus });
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useBoardStore.getState().setConnectionStatus('online');
    void processOutbox(api);
  });

  window.addEventListener('offline', () => {
    useBoardStore.getState().setConnectionStatus('offline');
  });
}
