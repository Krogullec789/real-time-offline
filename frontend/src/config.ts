export const DEFAULT_BOARD_ID = '00000000-0000-0000-0000-000000000001';

export function getConfiguredBoardId(boardId = '') {
  const trimmedBoardId = boardId.trim();
  return trimmedBoardId.length > 0 ? trimmedBoardId : DEFAULT_BOARD_ID;
}

export const MAIN_BOARD_ID = getConfiguredBoardId(import.meta.env.VITE_BOARD_ID);
