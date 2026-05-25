import { describe, expect, it, vi } from 'vitest';
import * as signalR from '@microsoft/signalr';
import { leaveBoardAndStop } from './signalRConnection';

describe('leaveBoardAndStop', () => {
  it('does not invoke LeaveBoard when the connection is already disconnected', async () => {
    const invoke = vi.fn();
    const stop = vi.fn().mockResolvedValue(undefined);

    await leaveBoardAndStop({
      state: signalR.HubConnectionState.Disconnected,
      invoke,
      stop,
    }, 'board-1');

    expect(invoke).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('leaves the board before stopping an active connection', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);

    await leaveBoardAndStop({
      state: signalR.HubConnectionState.Connected,
      invoke,
      stop,
    }, 'board-1');

    expect(invoke).toHaveBeenCalledWith('LeaveBoard', 'board-1');
    expect(stop).toHaveBeenCalledOnce();
  });
});
