# Real-Time Offline Kanban Board

A portfolio-grade collaboration app built with React, TypeScript, ASP.NET Core, PostgreSQL, SignalR, and IndexedDB. The project focuses on a hard product problem: keeping a shared Kanban board usable during network loss, reconnects, multi-tab editing, and server-side conflicts.

## Application Preview

Here is how the application looks and manages real-time offline synchronization:

### 1. Main Kanban Board (Connected)
A responsive dark-mode Kanban interface featuring drag-and-drop card moves, column additions/deletions, and real-time status indicators.
![Main Kanban Board](assets/kanban_board.jpg)

### 2. Offline Synchronization Flow
When connection is lost, mutations are cached locally in an IndexedDB outbox. Once connection is restored, the queue replays to update the database.

| Offline Mode (Pending Outbox Queue) | Online Mode (Synced & Replayed) |
|:---:|:---:|
| ![Offline Mode](assets/offline_sync.jpg) | ![Online Queue Synced](assets/queue.jpg) |

## Highlights

- Real-time board updates with SignalR groups per board.
- Offline-first client state using IndexedDB and a typed, retryable sync outbox.
- Conflict detection based on the server version the user edited, not local clock time.
- Conflict resolution UI for keeping the server version or retrying the local change after rebasing.
- Server-authoritative reconciliation after successful creates, edits, and batch moves.
- Drag-and-drop card moves with atomic batch updates.
- Reconnect resync so missed SignalR events are repaired by a fresh board snapshot.
- API key/bearer-token demo auth with board allow-listing.
- ASP.NET Core API with EF Core migrations and PostgreSQL persistence.
- TypeScript, ESLint, Vitest, xUnit, Playwright E2E, and build/test scripts for recruiter-friendly verification.

## Tech Stack

- Frontend: React 19, Vite, TypeScript, Zustand, dnd-kit, SignalR client, IndexedDB via `idb`.
- Backend: ASP.NET Core 9, EF Core 9, Npgsql, SignalR, Swashbuckle.
- Tests: Vitest for frontend sync logic, xUnit for backend validation/auth, Playwright for multi-tab/offline browser flows.

## Case Study

This app is intentionally more than a CRUD board. The main engineering challenge is distributed state: a user can edit while offline, another client can update the same card, SignalR can miss events during reconnect, and queued operations can be retried after partial success.

The implementation treats the server as authoritative while keeping the UI optimistic:

- The frontend stores normalized board state in Zustand and persists snapshots plus outbox operations in IndexedDB.
- Every card update carries the server `updatedAt` value that the user originally edited against. The API rejects stale writes with `409 Conflict` and returns the current server card.
- The outbox records conflict metadata, shows it in the sync drawer, and lets the user keep the server copy or retry the local change rebased on the latest server version.
- Successful API responses are applied back into local state so the client does not depend on receiving its own SignalR event.
- Offline operation replay coalesces repeated edits and card moves, prunes obsolete edits before deletes, treats already-applied deletes as success, and propagates server timestamps across dependent queued operations.
- SignalR is used for low-latency collaboration, but reconnect also fetches a fresh board snapshot so missed events do not leave the client stale.

The E2E suite proves the portfolio-critical flows in a real browser:

- A card created in one browser context appears in another tab through SignalR.
- A card created while the browser is offline is replayed after the browser comes back online.
- A stale offline edit becomes a visible conflict, then "Retry mine" rebases and saves the local version.

## Getting Started

### Docker Compose

The fastest way to run the full stack is Docker Compose:

```powershell
docker compose up --build
```

Then open:

- Frontend: http://localhost:3000
- API Swagger UI: http://localhost:5212/swagger
- PostgreSQL: localhost:5432 (`postgres` / `postgres`, database `kanban`)

### Backend

1. Start PostgreSQL locally and create a `kanban` database.
2. Configure the connection string in `backend/KanbanBoard.Api/appsettings.Development.json` or with an environment variable:

```powershell
$env:ConnectionStrings__DefaultConnection="Host=localhost;Port=5432;Database=kanban;Username=postgres;Password=postgres"
```

3. Run the API:

```powershell
cd backend
dotnet run --project KanbanBoard.Api
```

The API applies EF Core migrations automatically in Development.

### Frontend

Create `frontend/.env` if you need non-default URLs:

```env
VITE_API_BASE_URL=http://localhost:5212/api
VITE_SIGNALR_URL=http://localhost:5212/hubs/kanban
VITE_BOARD_ID=00000000-0000-0000-0000-000000000001
```

Then run:

```powershell
cd frontend
npm install
npm run dev
```

## Verification

GitHub Actions runs the frontend and backend checks on pushes to `main` and on pull requests.

Run these before pushing changes:

```powershell
cd frontend
npm run lint
npm run build
npm test
npm run test:e2e
npm audit --omit=dev

cd ../backend
dotnet build KanbanBoard.sln
dotnet test KanbanBoard.sln
```

`npm run test:e2e` starts the API and Vite app, runs Playwright, then stops the local processes. It expects PostgreSQL to be available with the connection string from `backend/KanbanBoard.Api/appsettings.Development.json`.

## Architecture Notes

The frontend stores board data in normalized Zustand state and persists server snapshots to IndexedDB. User mutations are optimistic: they update local state, write IndexedDB, and enqueue a typed outbox operation. When online, the outbox replays operations against the API and reconciles the returned server DTOs into local state.

The backend validates card moves so a batch cannot span boards and cards cannot be moved to columns from another board. Batch move endpoints validate order uniqueness and apply changes atomically. SignalR broadcasts the final DTO state to clients subscribed to the affected board group.

## Portfolio Talking Points

- Offline-first UX with deterministic replay and conflict handling.
- Real-time collaboration backed by reconnect resync, not just best-effort websocket events.
- Practical security boundary for a demo app: API key/bearer auth plus board isolation.
- Full-stack verification across unit, backend integration-style tests, and multi-context Playwright E2E.
- Clear tradeoff: this is a demo auth model, not production identity management. A production version should add user accounts, board memberships, audit logs, and per-user permissions.
