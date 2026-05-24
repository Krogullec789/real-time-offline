export interface Board {
  id: string;
  title: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  boardId: string;
  title: string;
  order: number;
  updatedAt: string;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string;
  order: number;
  updatedAt: string;
}

// Tree view of Board for loading
export interface BoardData extends Board {
  columns: ColumnData[];
}

export interface ColumnData extends Column {
  cards: Card[];
}

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

export interface CreateColumnRequest {
  id?: string;
  title: string;
}

export interface CreateColumnOperation extends CreateColumnRequest {
  boardId: string;
}

export interface UpdateColumnRequest {
  id: string;
  boardId: string;
  title: string;
  order: number;
}

export interface DeleteColumnOperation {
  id: string;
  boardId: string;
}

export interface CreateCardRequest {
  id?: string;
  columnId: string;
  title: string;
  description?: string;
}

export interface UpdateCardRequest {
  id: string;
  columnId: string;
  title: string;
  description: string;
  order: number;
  clientUpdatedAt: string;
}

export interface DeleteCardOperation {
  id: string;
}

export interface CardPositionRequest {
  id: string;
  columnId: string;
  order: number;
  clientUpdatedAt: string;
}

export interface BatchMoveCardsRequest {
  cards: CardPositionRequest[];
}
