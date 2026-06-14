import { useCallback, useEffect, useRef, useState } from 'react';
import { useBoardStore } from '../store';
import { getDB, type SyncOperation } from '../db';
import { X, RefreshCw, Trash2, Clock, CheckCircle2, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import {
  keepServerConflict,
  retryOperationWithServerVersion,
} from '../queue';
import { describeSyncOperation } from '../queue/describeOperation';
import { ConfirmDialog } from './ConfirmDialog';
import { useDialogFocus } from './useDialogFocus';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function OutboxDrawer({ isOpen, onClose }: Props) {
  const outboxStatus = useBoardStore(s => s.outboxStatus);
  const connectionStatus = useBoardStore(s => s.connectionStatus);
  const syncNow = useBoardStore(s => s.syncNow);
  const applyRemoteCardChange = useBoardStore(s => s.applyRemoteCardChange);
  const applyRemoteCardsBatchUpdate = useBoardStore(s => s.applyRemoteCardsBatchUpdate);
  const [operations, setOperations] = useState<SyncOperation[]>([]);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  useDialogFocus(drawerRef, isOpen && !isClearDialogOpen, onClose);

  const loadOperations = useCallback(async () => {
    try {
      const db = await getDB();
      const ops = await db.getAll('outbox');
      // Execution order: oldest first
      ops.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setOperations(ops);
    } catch (err) {
      console.error("Failed to load outbox operations", err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const refreshId = window.setTimeout(() => {
      void loadOperations();
    }, 0);

    return () => window.clearTimeout(refreshId);
  }, [isOpen, outboxStatus, loadOperations]);

  const handleSyncNow = () => {
    void syncNow();
  };

  const handleKeepServer = async (operation: SyncOperation) => {
    if (operation.conflict?.serverCard) {
      await applyRemoteCardChange(operation.conflict.serverCard);
    }
    if (operation.conflict?.serverCards) {
      await applyRemoteCardsBatchUpdate(operation.conflict.serverCards);
    }

    await keepServerConflict(operation);
    await loadOperations();
  };

  const handleRetryMine = async (operation: SyncOperation) => {
    await retryOperationWithServerVersion(operation);
    await loadOperations();
    await syncNow();
  };

  const handleClearOutbox = async () => {
    try {
      const db = await getDB();
      await db.clear('outbox');
      setIsClearDialogOpen(false);
      // Force store update
      useBoardStore.setState({
        outboxStatus: {
          pendingCount: 0,
          syncingCount: 0,
          failedCount: 0,
          isSyncing: false
        }
      });
    } catch (err) {
      console.error("Failed to clear outbox", err);
    }
  };

  if (!isOpen) return null;

  const getOpIcon = (type: string) => {
    switch (type) {
      case 'CREATE_CARD':
      case 'CREATE_COLUMN':
        return <span className="op-badge op-create">CREATE</span>;
      case 'UPDATE_CARD':
      case 'UPDATE_COLUMN':
        return <span className="op-badge op-update">UPDATE</span>;
      case 'DELETE_CARD':
      case 'DELETE_COLUMN':
        return <span className="op-badge op-delete">DELETE</span>;
      case 'BATCH_MOVE_CARDS':
      case 'BATCH_MOVE_COLUMNS':
        return <span className="op-badge op-move">MOVE BATCH</span>;
      default:
        return <span className="op-badge op-other">{type}</span>;
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}>
        <aside
          ref={drawerRef}
          className="glass-panel outbox-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="outbox-drawer-title"
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
        >
        <header className="drawer-header">
          <div className="drawer-title-group">
            <h3 id="outbox-drawer-title">Offline Sync Outbox</h3>
            <div className={`connection-badge status-${connectionStatus}`}>
              <span className={`status-dot ${connectionStatus}`} />
              <span>{connectionStatus === 'online' ? 'Online' : 'Offline Mode'}</span>
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Close drawer">
            <X size={20} />
          </button>
        </header>

        <div className="drawer-actions">
          <button 
            className="btn-primary" 
            onClick={handleSyncNow} 
            disabled={connectionStatus !== 'online' || operations.length === 0}
          >
            <RefreshCw size={16} className={outboxStatus.isSyncing ? 'spin' : ''} />
            <span>Sync Now</span>
          </button>
          
          <button 
            className="btn-secondary btn-danger-text" 
            onClick={() => setIsClearDialogOpen(true)}
            disabled={operations.length === 0}
          >
            <Trash2 size={16} />
            <span>Clear Queue</span>
          </button>
        </div>

        <div className="drawer-content">
          {operations.length === 0 ? (
            <div className="drawer-empty-state">
              <CheckCircle2 size={48} className="empty-icon" />
              <p>Your queue is empty!</p>
              <span>All changes have been successfully synced to the database.</span>
            </div>
          ) : (
            <div className="op-list">
              {operations.map((op) => (
                <div key={op.id} className={`op-item status-${op.status}`}>
                  <div className="op-header-row">
                    {getOpIcon(op.type)}
                    <span className="op-time">
                      {new Date(op.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  
                  <p className="op-desc">{describeSyncOperation(op)}</p>
                  
                  <div className="op-footer-row">
                    <span className={`op-status-text op-status-${op.status}`}>
                      {op.status === 'pending' && (
                        <>
                          <Clock size={12} />
                          <span>Pending</span>
                        </>
                      )}
                      {op.status === 'syncing' && (
                        <>
                          <ArrowRightLeft size={12} className="spin-reverse" />
                          <span>Syncing...</span>
                        </>
                      )}
                      {op.status === 'failed' && (
                        <>
                          <AlertTriangle size={12} />
                          <span>Failed (Retries: {op.retryCount})</span>
                        </>
                      )}
                    </span>
                  </div>

                  {op.status === 'failed' && op.conflict && (
                    <ConflictResolutionPanel
                      operation={op}
                      onKeepServer={() => void handleKeepServer(op)}
                      onRetryMine={() => void handleRetryMine(op)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </aside>
      </div>

      <ConfirmDialog
        isOpen={isClearDialogOpen}
        title="Clear offline queue"
        description="Clear all pending changes? Local modifications in the queue will not be synced to the server."
        confirmLabel="Clear queue"
        tone="danger"
        onConfirm={handleClearOutbox}
        onCancel={() => setIsClearDialogOpen(false)}
      />
    </>
  );
}

interface ConflictResolutionPanelProps {
  operation: SyncOperation;
  onKeepServer: () => void;
  onRetryMine: () => void;
}

function ConflictResolutionPanel({
  operation,
  onKeepServer,
  onRetryMine,
}: ConflictResolutionPanelProps) {
  const serverCards = operation.conflict?.serverCards
    ?? (operation.conflict?.serverCard ? [operation.conflict.serverCard] : []);

  return (
    <div className="conflict-panel">
      <div className="conflict-panel-header">
        <AlertTriangle size={14} />
        <span>Conflict detected</span>
      </div>

      <p className="conflict-message">
        {operation.conflict?.message ?? 'The server has a newer version of this card.'}
      </p>

      <div className="conflict-comparison">
        <div>
          <span className="conflict-label">Your queued change</span>
          <p>{describeLocalChange(operation)}</p>
        </div>

        <div>
          <span className="conflict-label">Server version</span>
          {serverCards.length > 0 ? (
            serverCards.map((card) => (
              <p key={card.id}>
                {card.title} - {new Date(card.updatedAt).toLocaleTimeString()}
              </p>
            ))
          ) : (
            <p>Server has newer data for this operation.</p>
          )}
        </div>
      </div>

      <div className="conflict-actions">
        <button type="button" className="btn-secondary" onClick={onKeepServer}>
          Keep server
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onRetryMine}
          disabled={serverCards.length === 0}
        >
          Retry mine
        </button>
      </div>
    </div>
  );
}

function describeLocalChange(operation: SyncOperation) {
  if (operation.type === 'UPDATE_CARD') {
    return `${operation.payload.title} - ${operation.payload.priority}`;
  }

  if (operation.type === 'BATCH_MOVE_CARDS') {
    return `Move ${operation.payload.cards.length} card${operation.payload.cards.length === 1 ? '' : 's'}`;
  }

  return describeSyncOperation(operation);
}
