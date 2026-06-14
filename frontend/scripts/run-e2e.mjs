import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(frontendDir, '..');
const backendDir = path.join(rootDir, 'backend', 'KanbanBoard.Api');
const backendDll = path.join(backendDir, 'bin', 'Debug', 'net9.0', 'KanbanBoard.Api.dll');
const boardId = process.env.VITE_BOARD_ID ?? '00000000-0000-0000-0000-000000000001';

const children = [];

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? rootDir,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  return child;
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Process is already gone.
  }
}

async function cleanup() {
  for (const child of children.reverse()) {
    killTree(child);
  }
}

process.on('exit', () => {
  for (const child of children.reverse()) {
    killTree(child);
  }
});
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});
process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143);
});

if (!existsSync(backendDll)) {
  console.log('Building backend for E2E...');
  runChecked('dotnet', ['build', path.join(backendDir, 'KanbanBoard.Api.csproj'), '-v', 'minimal']);
} else {
  console.log('Using existing backend build for E2E.');
}

console.log('Starting backend and frontend for E2E...');
start('dotnet', [backendDll, '--urls', 'http://localhost:5212'], {
  cwd: backendDir,
  env: {
    ASPNETCORE_ENVIRONMENT: 'Development',
  },
});

start('node', ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  cwd: frontendDir,
  env: {
    VITE_API_BASE_URL: 'http://localhost:5212/api',
    VITE_SIGNALR_URL: 'http://localhost:5212/hubs/kanban',
    VITE_SIGNALR_LOG_LEVEL: 'none',
    VITE_API_KEY: process.env.VITE_API_KEY ?? 'dev-demo-key',
    VITE_BOARD_ID: boardId,
  },
});

try {
  await waitForUrl('http://localhost:5212/swagger', 45_000);
  await waitForUrl('http://localhost:5173', 30_000);

  const playwrightCli = path.join(frontendDir, 'node_modules', '@playwright', 'test', 'cli.js');
  const playwright = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: frontendDir,
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_WEBSERVER: '1',
      VITE_API_KEY: process.env.VITE_API_KEY ?? 'dev-demo-key',
      VITE_BOARD_ID: boardId,
      VITE_SIGNALR_LOG_LEVEL: 'none',
    },
    stdio: 'inherit',
    windowsHide: true,
  });

  const exitCode = await new Promise(resolve => {
    playwright.on('exit', code => resolve(code ?? 1));
  });

  await cleanup();
  process.exit(exitCode);
} catch (error) {
  console.error(error);
  await cleanup();
  process.exit(1);
}
