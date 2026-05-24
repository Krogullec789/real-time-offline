import { useEffect, useState } from 'react';
import { useBoardStore } from './store';
import { useSignalR } from './hooks/useSignalR';
import { Board } from './components/Board';
import * as api from './api';
import { loadBoardFromCache } from './db';
import './index.css';

// Harcoded boardId as chosen in requirements
const MAIN_BOARD_ID = '00000000-0000-0000-0000-000000000001';

function App() {
  const initializeBoard = useBoardStore(s => s.initializeBoard);
  const status = useBoardStore(s => s.connectionStatus);
  const board = useBoardStore(s => s.board);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hook wires up SignalR and maps events if boardId is provided
  useSignalR(MAIN_BOARD_ID);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await api.fetchBoard(MAIN_BOARD_ID);
        await initializeBoard(data);
      } catch (err) {
        console.error("Failed to load initial board", err);
        const cachedBoard = await loadBoardFromCache(MAIN_BOARD_ID);
        if (cachedBoard) {
          await initializeBoard(cachedBoard);
          setError("Loaded the last locally cached board.");
          return;
        }

        setError("Could not load board. No local cache is available yet.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [initializeBoard]);

  return (
    <>
      <header className="app-header">
        <h1>{board?.title || 'Loading Board...'}</h1>
        
        <div className="connection-badge">
          <div className={`status-dot ${status}`} />
          <span>
            {status === 'online' ? 'Connected' : 
             status === 'reconnecting' ? 'Reconnecting...' : 'Offline'}
          </span>
        </div>
      </header>
      
      <main>
        {loading ? (
          <div className="app-message">Loading...</div>
        ) : error && !board ? (
          <div className="app-message app-message-error">{error}</div>
        ) : (
          <>
            {error && <div className="app-banner">{error}</div>}
            <Board />
          </>
        )}
      </main>
    </>
  );
}

export default App;
