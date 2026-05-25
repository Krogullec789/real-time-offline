import { useEffect, useState } from 'react';
import { useBoardStore } from './store';
import { useSignalR } from './hooks/useSignalR';
import { Board } from './components/Board';
import * as api from './api';
import { loadBoardFromCache } from './db';
import { CardDetailModal } from './components/CardDetailModal';
import { OutboxDrawer } from './components/OutboxDrawer';
import type { Card } from './types';
import { MAIN_BOARD_ID } from './config';
import './index.css';

function App() {
  const initializeBoard = useBoardStore(s => s.initializeBoard);
  const status = useBoardStore(s => s.connectionStatus);
  const outboxStatus = useBoardStore(s => s.outboxStatus);
  const board = useBoardStore(s => s.board);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI states
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isOutboxOpen, setIsOutboxOpen] = useState(false);

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
        
        <div className="header-status">
          <div className="connection-badge">
            <div className={`status-dot ${status}`} />
            <span>
              {status === 'online' ? 'Connected' : 
               status === 'reconnecting' ? 'Reconnecting...' : 'Offline'}
            </span>
          </div>

          <button 
            className={`sync-badge clickable ${outboxStatus.failedCount > 0 ? 'has-error' : ''}`}
            onClick={() => setIsOutboxOpen(true)}
            title="Open Sync Outbox"
          >
            {outboxStatus.isSyncing || outboxStatus.syncingCount > 0 ? (
              <span>Syncing changes...</span>
            ) : outboxStatus.failedCount > 0 ? (
              <span>{outboxStatus.failedCount} failed sync</span>
            ) : outboxStatus.pendingCount > 0 ? (
              <span>{outboxStatus.pendingCount} pending change{outboxStatus.pendingCount === 1 ? '' : 's'}</span>
            ) : (
              <span>All changes saved</span>
            )}
          </button>
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
            <Board onSelectCard={(card) => setSelectedCard(card)} />
          </>
        )}
      </main>

      {/* Modals and Side Drawers */}
      {selectedCard && (
        <CardDetailModal 
          card={selectedCard} 
          onClose={() => setSelectedCard(null)} 
        />
      )}

      <OutboxDrawer 
        isOpen={isOutboxOpen} 
        onClose={() => setIsOutboxOpen(false)} 
      />
    </>
  );
}

export default App;
