import type { SyncOperation } from '../db';

export function describeSyncOperation(operation: SyncOperation): string {
  switch (operation.type) {
    case 'CREATE_CARD':
      return `Add card "${operation.payload.title}"`;
    case 'UPDATE_CARD':
      return `Edit card "${operation.payload.title}"`;
    case 'DELETE_CARD':
      return 'Delete card';
    case 'CREATE_COLUMN':
      return `Create column "${operation.payload.title}"`;
    case 'UPDATE_COLUMN':
      return `Update column to "${operation.payload.title}" (order ${operation.payload.order})`;
    case 'DELETE_COLUMN':
      return 'Delete column';
    case 'BATCH_MOVE_CARDS':
      return `Move ${operation.payload.cards.length} cards`;
  }
}
