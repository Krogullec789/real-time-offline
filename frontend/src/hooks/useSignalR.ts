import { useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { useBoardStore } from '../store';
import { leaveBoardAndStop } from './signalRConnection';

const SIGNALR_URL = import.meta.env.VITE_SIGNALR_URL ?? 'http://localhost:5212/hubs/kanban';
const API_KEY = import.meta.env.VITE_API_KEY;

export function useSignalR(boardId: string | null) {
  const connection = useRef<signalR.HubConnection | null>(null);
  
  const applyRemoteCardChange = useBoardStore(s => s.applyRemoteCardChange);
  const applyRemoteCardsBatchUpdate = useBoardStore(s => s.applyRemoteCardsBatchUpdate);
  const applyRemoteColumnChange = useBoardStore(s => s.applyRemoteColumnChange);
  const applyRemoteColumnsBatchUpdate = useBoardStore(s => s.applyRemoteColumnsBatchUpdate);
  const applyRemoteCardDelete = useBoardStore(s => s.applyRemoteCardDelete);
  const applyRemoteColumnDelete = useBoardStore(s => s.applyRemoteColumnDelete);
  const refreshBoardFromServer = useBoardStore(s => s.refreshBoardFromServer);
  const setConnectionStatus = useBoardStore(s => s.setConnectionStatus);

  useEffect(() => {
    if (!boardId) return;

    // Build connection
    const connectionBuilder = new signalR.HubConnectionBuilder();
    const newConnection = (API_KEY
      ? connectionBuilder.withUrl(SIGNALR_URL, { accessTokenFactory: () => API_KEY })
      : connectionBuilder.withUrl(SIGNALR_URL))
      .withAutomaticReconnect()
      .build();

    connection.current = newConnection;
    let isDisposed = false;

    newConnection.onreconnecting(() => {
      setConnectionStatus('reconnecting');
    });

    newConnection.onreconnected(async () => {
      setConnectionStatus('online');
      await newConnection.invoke('JoinBoard', boardId);
      await refreshBoardFromServer(boardId);
    });

    newConnection.onclose(() => {
      setConnectionStatus('offline');
    });

    // Event handlers mapping
    newConnection.on('CardCreated', applyRemoteCardChange);
    newConnection.on('CardUpdated', applyRemoteCardChange);
    newConnection.on('CardDeleted', applyRemoteCardDelete);
    newConnection.on('CardsBatchMoved', applyRemoteCardsBatchUpdate);
    
    newConnection.on('ColumnCreated', applyRemoteColumnChange);
    newConnection.on('ColumnUpdated', applyRemoteColumnChange);
    newConnection.on('ColumnsBatchMoved', applyRemoteColumnsBatchUpdate);
    newConnection.on('ColumnDeleted', applyRemoteColumnDelete);

    // Connect
    newConnection.start()
      .then(async () => {
        if (isDisposed) {
          await newConnection.stop();
          return;
        }

        setConnectionStatus('online');
        await newConnection.invoke('JoinBoard', boardId);
      })
      .catch(e => {
        if (!isDisposed) {
          console.error('SignalR Connection Error: ', e);
          setConnectionStatus('offline');
        }
      });

    // Cleanup
    return () => {
      isDisposed = true;
      if (connection.current) {
        const connectionToStop = connection.current;
        connection.current = null;
        void leaveBoardAndStop(connectionToStop, boardId);
      }
    };
  }, [
    boardId, 
    applyRemoteCardChange, 
    applyRemoteColumnChange, 
    applyRemoteColumnsBatchUpdate,
    applyRemoteCardDelete, 
    applyRemoteColumnDelete,
    applyRemoteCardsBatchUpdate, 
    refreshBoardFromServer,
    setConnectionStatus
  ]);
}
