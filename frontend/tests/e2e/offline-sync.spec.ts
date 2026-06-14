import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:5212/api';
const API_KEY = process.env.VITE_API_KEY ?? 'dev-demo-key';
const BOARD_ID = process.env.VITE_BOARD_ID ?? '00000000-0000-0000-0000-000000000001';

type BoardData = {
  id: string;
  columns: Array<{
    id: string;
    title: string;
    cards: Array<{
      id: string;
      columnId: string;
      title: string;
      description: string;
      priority: 'low' | 'medium' | 'high';
      order: number;
      updatedAt: string;
    }>;
  }>;
};

type CardDto = BoardData['columns'][number]['cards'][number];

let api: APIRequestContext;

async function apiRequest<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  const response = await api.fetch(`${API_BASE}${path}`, {
    method: init.method,
    data: init.body ? JSON.parse(init.body) : undefined,
  });

  if (!response.ok()) {
    throw new Error(`API ${init.method ?? 'GET'} ${path} failed with ${response.status()}`);
  }

  if (response.status() === 204) return undefined as T;
  return await response.json() as T;
}

async function fetchBoard() {
  return await apiRequest<BoardData>(`/boards/${BOARD_ID}`);
}

async function createCard(title: string) {
  const board = await fetchBoard();
  const backlog = board.columns.find((column) => column.title === 'Backlog') ?? board.columns[0];

  return await apiRequest<CardDto>('/cards', {
    method: 'POST',
    body: JSON.stringify({
      columnId: backlog.id,
      title,
      description: '',
      priority: 'medium',
    }),
  });
}

async function deleteCardIfExists(title: string) {
  const board = await fetchBoard();
  const card = board.columns.flatMap((column) => column.cards).find((item) => item.title === title);
  if (!card) return;
  await apiRequest<void>(`/cards/${card.id}`, { method: 'DELETE' });
}

async function waitForBoard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Main Board' })).toBeVisible();
  await expect(page.getByText('Connected')).toBeVisible();
}

async function addCardThroughUi(page: Page, title: string) {
  const backlog = page.locator('[data-testid="kanban-column"][data-column-title="Backlog"]');
  await backlog.getByRole('button', { name: 'Add card to Backlog' }).click();
  await backlog.getByPlaceholder('Enter card title...').fill(title);
  await backlog.getByPlaceholder('Enter card title...').press('Enter');
  await expect(page.getByText(title)).toBeVisible();
}

test.describe('portfolio offline/realtime flows', () => {
  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('broadcasts a card created in one tab to another tab', async ({ browser }) => {
    const title = `Realtime E2E ${Date.now()}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await waitForBoard(pageA);
      await waitForBoard(pageB);

      await addCardThroughUi(pageA, title);

      await expect(pageB.getByText(title)).toBeVisible();
    } finally {
      await deleteCardIfExists(title);
      await contextA.close();
      await contextB.close();
    }
  });

  test('replays an offline card create after the browser comes back online', async ({ browser }) => {
    const title = `Offline Replay E2E ${Date.now()}`;
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForBoard(page);

      await context.setOffline(true);
      await addCardThroughUi(page, title);
      await expect(page.getByText('1 pending change')).toBeVisible();

      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));

      await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });

      const board = await fetchBoard();
      expect(board.columns.flatMap((column) => column.cards).some((card) => card.title === title)).toBe(true);
    } finally {
      await context.setOffline(false);
      await deleteCardIfExists(title);
      await context.close();
    }
  });

  test('shows conflict resolution and can retry the local version', async ({ browser }) => {
    const originalTitle = `Conflict E2E ${Date.now()}`;
    const localTitle = `${originalTitle} local`;
    const serverTitle = `${originalTitle} server`;
    const createdCard = await createCard(originalTitle);
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForBoard(page);
      await expect(page.getByText(originalTitle)).toBeVisible();

      await context.setOffline(true);
      await page.getByLabel(`Edit ${originalTitle}`).click();
      await page.getByLabel('Title').fill(localTitle);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText(localTitle)).toBeVisible();

      await apiRequest<CardDto>(`/cards/${createdCard.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: serverTitle,
          description: createdCard.description,
          priority: createdCard.priority,
          order: createdCard.order,
          columnId: createdCard.columnId,
          clientUpdatedAt: createdCard.updatedAt,
        }),
      });

      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));

      await expect(page.getByText('1 failed sync')).toBeVisible({ timeout: 15_000 });
      await page.getByTitle('Open Sync Outbox').click();
      const conflictPanel = page.locator('.conflict-panel');
      await expect(conflictPanel.getByText('Conflict detected')).toBeVisible();
      await expect(conflictPanel.getByText(serverTitle)).toBeVisible();

      await page.getByRole('button', { name: 'Retry mine' }).click();

      await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });

      const board = await fetchBoard();
      const syncedCard = board.columns.flatMap((column) => column.cards).find((card) => card.id === createdCard.id);
      expect(syncedCard?.title).toBe(localTitle);
    } finally {
      await context.setOffline(false);
      await apiRequest<void>(`/cards/${createdCard.id}`, { method: 'DELETE' });
      await context.close();
    }
  });
});
