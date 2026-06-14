import { defineConfig, devices } from '@playwright/test';

const boardId = process.env.VITE_BOARD_ID ?? '00000000-0000-0000-0000-000000000001';

export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER ? undefined : [
    {
      command: 'dotnet bin/Debug/net9.0/KanbanBoard.Api.dll --urls http://localhost:5212',
      cwd: '../backend/KanbanBoard.Api',
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
      },
      url: 'http://localhost:5212/swagger',
      reuseExistingServer: true,
      timeout: 45_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1',
      url: 'http://localhost:5173',
      env: {
        VITE_API_BASE_URL: 'http://localhost:5212/api',
        VITE_SIGNALR_URL: 'http://localhost:5212/hubs/kanban',
        VITE_SIGNALR_LOG_LEVEL: 'none',
        VITE_API_KEY: process.env.VITE_API_KEY ?? 'dev-demo-key',
        VITE_BOARD_ID: boardId,
      },
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined,
      },
    },
  ],
  metadata: {
    boardId,
  },
});
