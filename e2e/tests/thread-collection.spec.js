const { test, expect } = require('@playwright/test');
const { bootstrapApp, mockHealth, mockSchedules, mockWorkflows } = require('../fixtures/mockApi');

function makeTask(index, overrides = {}) {
  return {
    id: `thread-${String(index).padStart(8, '0')}`,
    goal: `Collection task ${index}`,
    workspace: `/Users/test/Ender/workspace/task-${index}`,
    status: 'done',
    startedAt: new Date(Date.UTC(2026, 2, 1, 10, index)).toISOString(),
    finishedAt: new Date(Date.UTC(2026, 2, 1, 10, index + 1)).toISOString(),
    logCount: index,
    runCount: 1,
    pendingApprovalCount: 0,
    pendingApprovals: [],
    ...overrides
  };
}

async function routeJson(page, url, getResponse) {
  await page.route(url, async (route) => {
    const response = typeof getResponse === 'function' ? getResponse(route) : getResponse;
    const isEnvelope = Number.isInteger(response?.status) && Object.hasOwn(response, 'body');
    await route.fulfill({
      status: isEnvelope ? response.status : 200,
      contentType: 'application/json',
      body: JSON.stringify(isEnvelope ? response.body : response)
    });
  });
}

async function mockThreadServer(page, baseUrl, getTasks) {
  await routeJson(page, `${baseUrl}/health`, {
    ok: true,
    services: { llm: { ready: true, missing: [] }, codeServer: { ready: false } },
    workflows: {},
    setupHints: {},
    paths: { workspaceRoot: '/Users/test/Ender/workspace' }
  });
  await routeJson(page, `${baseUrl}/tasks`, getTasks);
  await routeJson(page, `${baseUrl}/workflows`, { items: [] });
  await routeJson(page, `${baseUrl}/schedules`, { items: [] });
  await routeJson(page, `${baseUrl}/llm-profiles`, { items: [], defaultProfileId: null });
  await routeJson(page, `${baseUrl}/projects`, { items: [] });
}

async function mockSelectedTask(page, baseUrl, task) {
  await routeJson(page, `${baseUrl}/tasks/${task.id}`, task);
  await routeJson(page, `${baseUrl}/tasks/${task.id}/logs?from=*`, { entries: [] });
  await page.route(`${baseUrl}/tasks/${task.id}/stream`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });
}

test('thread pagination, pinning, and archiving remain server-scoped and persistent', async ({ page }) => {
  const tasks = Array.from({ length: 13 }, (_, index) => makeTask(index + 1));
  await bootstrapApp(page, { tasks });

  await page.goto('/');
  const cards = page.locator('.threadCard');
  await expect(cards).toHaveCount(12);
  await page.getByLabel('Search threads').fill('Collection task 13');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Collection task 13');
  await expect(page.getByText('1 found')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(cards).toHaveCount(12);
  await page.getByRole('button', { name: 'Load more threads' }).click();
  await expect(cards).toHaveCount(13);

  const oldest = page.locator('.threadCard').filter({
    has: page.locator('.threadTitle').filter({ hasText: /^Collection task 1$/ })
  });
  await oldest.getByRole('button', { name: 'Expand thread entry' }).click();
  await oldest.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(cards.first().locator('.threadTitle')).toHaveText('Collection task 1');
  await expect(cards.first().getByText('Pinned', { exact: true })).toBeVisible();

  await cards.first().getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Collection task 1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Archived (1)' }).click();
  await expect(page.locator('.threadCard')).toHaveCount(1);
  await expect(page.getByText('Collection task 1', { exact: true })).toBeVisible();

  const persisted = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem('ender_task_ui_state') || '{}'
  ));
  expect(persisted['http://127.0.0.1:3000'][tasks[0].id]).toEqual({
    pinned: true,
    archived: true
  });
});

test('thread UI metadata changes with the selected server', async ({ page }) => {
  const firstUrl = 'http://127.0.0.1:3000';
  const secondUrl = 'http://127.0.0.1:3001';
  const sharedTask = makeTask(21, { id: 'thread-shared', goal: 'Shared identity thread' });

  await page.addInitScript(({ active, standby, taskId }) => {
    window.localStorage.setItem('ender_api_base', active);
    window.localStorage.setItem('ender_saved_servers', JSON.stringify([
      { name: 'Primary', endpoint: active, favorite: true, lastUsedAt: 2 },
      { name: 'Standby', endpoint: standby, favorite: false, lastUsedAt: 1 }
    ]));
    window.localStorage.setItem('ender_task_ui_state', JSON.stringify({
      [active]: { [taskId]: { pinned: true } },
      [standby]: { [taskId]: { archived: true } }
    }));
  }, { active: firstUrl, standby: secondUrl, taskId: sharedTask.id });
  await mockThreadServer(page, firstUrl, { items: [sharedTask] });
  await mockThreadServer(page, secondUrl, { items: [sharedTask] });

  await page.goto('/');
  await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch Server' }).click();
  const standbyRow = page.locator('.serverRow').filter({ hasText: 'Standby' });
  await standbyRow.locator('.serverRowMain').click();

  await expect(page.locator('.serverNameDisplay')).toHaveText('Standby');
  await expect(page.getByText('No threads on this server yet')).toBeVisible();
  await page.getByRole('button', { name: 'Show Archived (1)' }).click();
  await expect(page.getByText('Shared identity thread', { exact: true })).toBeVisible();
  await expect(page.getByText('Pinned', { exact: true })).toHaveCount(0);
});

test('polling preserves selection, clears failures, and selects the newest recovered thread', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  const first = makeTask(31, { goal: 'Selected polling thread' });
  const second = makeTask(32, { goal: 'Fallback polling thread' });
  const recovered = makeTask(33, { goal: 'Newest recovered thread' });
  let response = { items: [first, second] };

  await page.clock.install();
  await page.addInitScript(({ endpoint }) => {
    window.localStorage.setItem('ender_api_base', endpoint);
  }, { endpoint: baseUrl });
  await mockHealth(page);
  await mockWorkflows(page, []);
  await mockSchedules(page, []);
  await routeJson(page, `${baseUrl}/tasks`, () => response);
  await mockSelectedTask(page, baseUrl, first);
  await mockSelectedTask(page, baseUrl, recovered);

  await page.goto('/');
  await page.getByText(first.goal, { exact: true }).click();
  await expect(page.locator('.threadCard.selected')).toContainText(first.goal);
  await expect(page.locator('.threadCard.selected .threadCardMain')).toHaveAttribute('aria-current', 'true');

  response = { items: [{ ...first, logCount: 99 }, recovered] };
  await page.clock.fastForward(3000);
  await expect(page.locator('.threadCard.selected')).toContainText(first.goal);
  await expect(page.locator('.threadCard.selected')).toContainText('logs 99');

  response = { status: 503, body: { ok: false, message: 'Thread poll failed' } };
  await page.clock.fastForward(3000);
  await expect(page.getByText('Thread sync failed')).toBeVisible();
  await expect(page.getByText('Thread poll failed')).toBeVisible();
  await expect(page.locator('.threadCard')).toHaveCount(0);

  response = { items: [second, recovered] };
  await page.getByRole('button', { name: 'Retry thread sync' }).click();
  await expect(page.locator('.threadCard.selected')).toContainText(recovered.goal);
  await expect(page.getByText('Thread poll failed')).toHaveCount(0);
});
