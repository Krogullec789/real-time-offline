import { useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { useBoardStore } from '../store';
import { leaveBoardAndStop } from './signalRConnection';

const SIGNALR_URL = import.meta.env.VITE_SIGNALR_URL ?? 'http://localhost:5212/hubs/kanban';

export function useSignalR(boardId: string | null) {
  const connection = useRef<signalR.HubConnection | null>(null);
  
  const applyRemoteCardChange = useBoardStore(s => s.applyRemoteCardChange);
  const applyRemoteCardsBatchUpdate = useBoardStore(s => s.applyRemoteCardsBatchUpdate);
  const applyRemoteColumnChange = useBoardStore(s => s.applyRemoteColumnChange);
  const applyRemoteCardDelete = useBoardStore(s => s.applyRemoteCardDelete);
  const applyRemoteColumnDelete = useBoardStore(s => s.applyRemoteColumnDelete);
  const setConnectionStatus = useBoardStore(s => s.setConnectionStatus);

  useEffect(() => {
    if (!boardId) return;

    // Build connection
    const newConnection = new signalR.HubConnectionBuilder()
      .withUrl(SIGNALR_URL)
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
    applyRemoteCardDelete, 
    applyRemoteColumnDelete,
    applyRemoteCardsBatchUpdate, 
    setConnectionStatus
  ]);
}
