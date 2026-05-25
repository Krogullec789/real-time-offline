import * as signalR from '@microsoft/signalr';

type HubConnectionCleanupTarget = Pick<signalR.HubConnection, 'invoke' | 'state' | 'stop'>;

export async function leaveBoardAndStop(
  connection: HubConnectionCleanupTarget,
  boardId: string,
  onError: (error: unknown) => void = console.warn,
) {
  try {
    if (connection.state === signalR.HubConnectionState.Connected) {
      await connection.invoke('LeaveBoard', boardId);
    }
  } catch (error) {
    onError(error);
  } finally {
    await connection.stop().catch(onError);
  }
}
