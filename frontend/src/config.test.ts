import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_ID, getConfiguredBoardId } from './config';

describe('getConfiguredBoardId', () => {
  it('uses the default portfolio board when no environment value is provided', () => {
    expect(getConfiguredBoardId()).toBe(DEFAULT_BOARD_ID);
    expect(getConfiguredBoardId('   ')).toBe(DEFAULT_BOARD_ID);
  });

  it('uses a trimmed Vite environment board id when provided', () => {
    expect(getConfiguredBoardId('  board-from-env  ')).toBe('board-from-env');
  });
});
