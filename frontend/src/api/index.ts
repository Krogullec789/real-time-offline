import type {
  BatchMoveCardsRequest,
  BatchMoveColumnsRequest,
  BoardData,
  Card,
  CreateCardRequest,
  CreateColumnRequest,
  Column,
  UpdateCardRequest,
  UpdateColumnRequest,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5212/api';
const API_KEY = import.meta.env.VITE_API_KEY;

class ApiError extends Error {
  response: Response;
  constructor(message: string, response: Response) {
    super(message);
    this.response = response;
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    ...options?.headers,
  };
  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  
  if (!response.ok) {
    throw new ApiError(`HTTP error! status: ${response.status}`, response);
  }
  
  // 204 No Content
  if (response.status === 204) return {} as T;
  
  return await response.json();
}

export const fetchBoard = (boardId: string) => request<BoardData>(`/boards/${boardId}`);

// Columns
export const createColumn = (boardId: string, payload: CreateColumnRequest) =>
  request<Column>(`/boards/${boardId}/columns`, { method: 'POST', body: JSON.stringify(payload) });

export const updateColumn = (boardId: string, columnId: string, payload: UpdateColumnRequest) =>
  request<Column>(`/boards/${boardId}/columns/${columnId}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteColumn = (boardId: string, columnId: string) => 
  request<void>(`/boards/${boardId}/columns/${columnId}`, { method: 'DELETE' });

export const batchMoveColumns = (boardId: string, payload: BatchMoveColumnsRequest) =>
  request<Column[]>(`/boards/${boardId}/columns/batch-move`, { method: 'PUT', body: JSON.stringify(payload) });

// Cards
export const createCard = (payload: CreateCardRequest) =>
  request<Card>(`/cards`, { method: 'POST', body: JSON.stringify(payload) });

export const updateCard = (cardId: string, payload: UpdateCardRequest) =>
  request<Card>(`/cards/${cardId}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteCard = (cardId: string) => 
  request<void>(`/cards/${cardId}`, { method: 'DELETE' });

export const batchMoveCards = (payload: BatchMoveCardsRequest) =>
  request<Card[]>(`/cards/batch-move`, { method: 'PUT', body: JSON.stringify(payload) });
