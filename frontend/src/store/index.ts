import { create } from 'zustand';
import type {
  BatchMoveCardsRequest,
  BatchMoveColumnsRequest,
  Board,
  BoardData,
  Card,
  CardPositionRequest,
  Column,
  ConnectionStatus,
} from '../types';
import { getDB, queueOfflineAction, syncDatabaseFromServer, type SyncOperation } from '../db';
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
  refreshBoardFromServer: (boardId?: string) => Promise<void>;
  applyRemoteCardChange: (card: Card) => Promise<void>;
  applyRemoteColumnChange: (column: Column) => Promise<void>;
  applyRemoteColumnsBatchUpdate: (columns: Column[]) => Promise<void>;
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

async function readOutboxInOrder() {
  const db = await getDB();
  const operations = await db.getAll('outbox');
  return operations.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

async function getPendingCardBaseUpdatedAt(cardId: string) {
  const operations = await readOutboxInOrder();

  for (const operation of operations) {
    if (operation.type === 'UPDATE_CARD' && operation.payload.id === cardId) {
      return operation.payload.clientUpdatedAt;
    }

    if (operation.type === 'BATCH_MOVE_CARDS') {
      const pendingPosition = operation.payload.cards.find((position) => position.id === cardId);
      if (pendingPosition) return pendingPosition.clientUpdatedAt;
    }
  }

  return undefined;
}

async function mergeServerDataWithQueuedOperations(
  serverBoard: Board,
  serverColumns: Column[],
  serverCards: Card[],
) {
  const db = await getDB();
  const localColumns = new Map((await db.getAll('columns')).map((column) => [column.id, column]));
  const localCards = new Map((await db.getAll('cards')).map((card) => [card.id, card]));
  const operations = await readOutboxInOrder();

  const board = serverBoard;
  let columns = [...serverColumns];
  let cards = [...serverCards];

  for (const operation of operations) {
    switch (operation.type) {
      case 'CREATE_CARD': {
        const localCard = operation.payload.id ? localCards.get(operation.payload.id) : undefined;
        if (localCard && !cards.some((card) => card.id === localCard.id)) {
          cards.push(localCard);
        }
        break;
      }
      case 'UPDATE_CARD':
        cards = cards.map((card) => (
          card.id === operation.payload.id
            ? {
                ...card,
                columnId: operation.payload.columnId,
                title: operation.payload.title,
                description: operation.payload.description,
                priority: operation.payload.priority,
                order: operation.payload.order,
                updatedAt: localCards.get(card.id)?.updatedAt ?? card.updatedAt,
              }
            : card
        ));
        break;
      case 'DELETE_CARD':
        cards = cards.filter((card) => card.id !== operation.payload.id);
        break;
      case 'BATCH_MOVE_CARDS': {
        const positions = new Map(operation.payload.cards.map((position) => [position.id, position]));
        cards = cards.map((card) => {
          const position = positions.get(card.id);
          return position
            ? {
                ...card,
                columnId: position.columnId,
                order: position.order,
                updatedAt: localCards.get(card.id)?.updatedAt ?? card.updatedAt,
              }
            : card;
        });
        break;
      }
      case 'CREATE_COLUMN': {
        const localColumn = operation.payload.id ? localColumns.get(operation.payload.id) : undefined;
        if (localColumn && !columns.some((column) => column.id === localColumn.id)) {
          columns.push(localColumn);
        }
        break;
      }
      case 'UPDATE_COLUMN':
        columns = columns.map((column) => (
          column.id === operation.payload.id
            ? {
                ...column,
                title: operation.payload.title,
                order: operation.payload.order,
                updatedAt: localColumns.get(column.id)?.updatedAt ?? column.updatedAt,
              }
            : column
        ));
        break;
      case 'BATCH_MOVE_COLUMNS': {
        const positions = new Map(operation.payload.columns.map((position) => [position.id, position.order]));
        columns = columns.map((column) => {
          const order = positions.get(column.id);
          return order === undefined
            ? column
            : {
                ...column,
                order,
                updatedAt: localColumns.get(column.id)?.updatedAt ?? column.updatedAt,
              };
        });
        break;
      }
      case 'DELETE_COLUMN':
        columns = columns.filter((column) => column.id !== operation.payload.id);
        cards = cards.filter((card) => card.columnId !== operation.payload.id);
        break;
    }
  }

  return { board, columns, cards };
}

async function reconcileSuccessfulOutboxOperation(operation: SyncOperation, result: unknown) {
  if (operation.type === 'DELETE_CARD') {
    useBoardStore.setState((state) => ({
      cards: state.cards.filter((card) => card.id !== operation.payload.id),
    }));
    const db = await getDB();
    await db.delete('cards', operation.payload.id);
    return;
  }

  if (operation.type === 'DELETE_COLUMN') {
    useBoardStore.setState((state) => ({
      columns: state.columns.filter((column) => column.id !== operation.payload.id),
      cards: state.cards.filter((card) => card.columnId !== operation.payload.id),
    }));
    return;
  }

  if (
    operation.type === 'CREATE_CARD'
    || operation.type === 'UPDATE_CARD'
  ) {
    const serverCard = result as Card | undefined;
    if (!serverCard) return;

    useBoardStore.setState((state) => ({
      cards: [...state.cards.filter((card) => card.id !== serverCard.id), serverCard],
    }));
    await persistCards([serverCard]);
    return;
  }

  if (operation.type === 'BATCH_MOVE_CARDS') {
    const serverCards = result as Card[] | undefined;
    if (!serverCards) return;

    useBoardStore.setState((state) => ({
      cards: [
        ...state.cards.filter((card) => !serverCards.some((serverCard) => serverCard.id === card.id)),
        ...serverCards,
      ],
    }));
    await persistCards(serverCards);
    return;
  }

  if (
    operation.type === 'CREATE_COLUMN'
    || operation.type === 'UPDATE_COLUMN'
  ) {
    const serverColumn = result as Column | undefined;
    if (!serverColumn) return;

    useBoardStore.setState((state) => ({
      columns: [...state.columns.filter((column) => column.id !== serverColumn.id), serverColumn],
    }));
    const db = await getDB();
    await db.put('columns', serverColumn);
    return;
  }

  if (operation.type === 'BATCH_MOVE_COLUMNS') {
    const serverColumns = result as Column[] | undefined;
    if (!serverColumns) return;

    useBoardStore.setState((state) => ({
      columns: [
        ...state.columns.filter((column) => !serverColumns.some((serverColumn) => serverColumn.id === column.id)),
        ...serverColumns,
      ],
    }));

    const db = await getDB();
    const tx = db.transaction('columns', 'readwrite');
    for (const column of serverColumns) {
      await tx.store.put(column);
    }
    await tx.done;
  }
}

function processStoreOutbox() {
  return processOutbox(api, { onOperationSuccess: reconcileSuccessfulOutboxOperation });
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

    const merged = await mergeServerDataWithQueuedOperations(board, parsedColumns, parsedCards);

    set({
      boardId: boardData.id,
      board: merged.board,
      columns: merged.columns,
      cards: merged.cards,
    });

    await syncDatabaseFromServer([merged.board], merged.columns, merged.cards);
    void processStoreOutbox();
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
    void processStoreOutbox();
  },

  updateCard: async (cardId, updates) => {
    const oldCard = get().cards.find((card) => card.id === cardId);
    if (!oldCard) return;

    const now = new Date().toISOString();
    const baseUpdatedAt = await getPendingCardBaseUpdatedAt(cardId) ?? oldCard.updatedAt;
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
        clientUpdatedAt: baseUpdatedAt
      },
      timestamp: now,
    });

    await publishOutboxStatus();
    void processStoreOutbox();
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
    void processStoreOutbox();
  },

  moveCard: async (cardId, newColumnId, newOrder) => {
    await get().moveCardsBatch([{ id: cardId, columnId: newColumnId, order: newOrder }]);
  },

  moveCardsBatch: async (positions) => {
    if (positions.length === 0) return;

    const now = new Date().toISOString();
    const positionById = new Map(positions.map((position) => [position.id, position]));
    const cardsBeforeMove = get().cards;
    const updatedCards = cardsBeforeMove
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

    const cardsById = new Map(cardsBeforeMove.map((card) => [card.id, card]));
    const cardsWithBaseVersions = await Promise.all(positions.map(async (position) => ({
      ...position,
      clientUpdatedAt: await getPendingCardBaseUpdatedAt(position.id)
        ?? cardsById.get(position.id)?.updatedAt
        ?? now,
    })));
    const payload: BatchMoveCardsRequest = { cards: cardsWithBaseVersions };

    await queueOfflineAction({
      id: createId(),
      type: 'BATCH_MOVE_CARDS',
      payload,
      timestamp: now,
    });

    await publishOutboxStatus();
    void processStoreOutbox();
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
    void processStoreOutbox();
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
    void processStoreOutbox();
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
    void processStoreOutbox();
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

    const payload: BatchMoveColumnsRequest = {
      columns: updatedColumns.map((col) => ({ id: col.id, order: col.order })),
    };

    await queueOfflineAction({
      id: createId(),
      type: 'BATCH_MOVE_COLUMNS',
      payload: { boardId, ...payload },
      timestamp: now,
    });

    await publishOutboxStatus();
    void processStoreOutbox();
  },

  refreshBoardFromServer: async (boardId) => {
    const currentBoardId = boardId ?? get().boardId;
    if (!currentBoardId) return;

    const data = await api.fetchBoard(currentBoardId);
    await get().initializeBoard(data);
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

  applyRemoteColumnsBatchUpdate: async (remoteColumns) => {
    set((state) => {
      let nextColumns = [...state.columns];
      for (const remoteColumn of remoteColumns) {
        const existing = nextColumns.find((column) => column.id === remoteColumn.id);
        if (existing && new Date(existing.updatedAt).getTime() > new Date(remoteColumn.updatedAt).getTime()) {
          continue;
        }

        nextColumns = nextColumns.filter((column) => column.id !== remoteColumn.id);
        nextColumns.push(remoteColumn);
      }

      return { columns: nextColumns };
    });

    const db = await getDB();
    const tx = db.transaction('columns', 'readwrite');
    for (const column of remoteColumns) {
      await tx.store.put(column);
    }
    await tx.done;
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
    void processStoreOutbox();
  });

  window.addEventListener('offline', () => {
    useBoardStore.getState().setConnectionStatus('offline');
  });
}
