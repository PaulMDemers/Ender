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
    llmProfileId: 'acp',
    memoryMode: 'auto',
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
  tasks[0] = { ...tasks[0], goal: 'This is a test prompt, just respond hello' };
  await bootstrapApp(page, { tasks });

  await page.goto('/');
  const cards = page.locator('.threadCard');
  await expect(cards).toHaveCount(12);
  const ledgerLayout = await page.evaluate(() => {
    const search = document.querySelector('.threadSearchRow').getBoundingClientRect();
    const firstCard = document.querySelector('.threadCard').getBoundingClientRect();
    return {
      searchBottom: search.bottom,
      firstCardTop: firstCard.top,
      cardHeight: firstCard.height,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(ledgerLayout.firstCardTop).toBeGreaterThanOrEqual(ledgerLayout.searchBottom);
  expect(ledgerLayout.cardHeight).toBeLessThanOrEqual(44);
  expect(ledgerLayout.pageOverflow).toBeLessThanOrEqual(0);
  await expect(cards.first().getByRole('img', { name: 'Unread thread updates' })).toBeVisible();
  await expect(cards.first().locator('.threadTitle')).toHaveCSS('white-space', 'nowrap');
  await expect(page.locator('.threadCollection')).toHaveScreenshot('thread-ledger-compact.png', { animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const constrainedLayout = await page.evaluate(() => {
    const search = document.querySelector('.threadSearchRow').getBoundingClientRect();
    const firstCard = document.querySelector('.threadCard').getBoundingClientRect();
    return {
      searchBottom: search.bottom,
      firstCardTop: firstCard.top,
      cardHeight: firstCard.height,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(constrainedLayout.firstCardTop).toBeGreaterThanOrEqual(constrainedLayout.searchBottom);
  expect(constrainedLayout.cardHeight).toBeLessThanOrEqual(44);
  expect(constrainedLayout.pageOverflow).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1024 });

  await page.getByLabel('Search threads').fill('Collection task 13');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Collection task 13');
  await expect(page.getByText('1 found')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(cards).toHaveCount(12);
  await page.getByRole('button', { name: 'Load more threads' }).click();
  await expect(cards).toHaveCount(13);

  const oldest = page.locator('.threadCard').filter({
    has: page.locator('.threadTitle').filter({ hasText: tasks[0].goal })
  });
  await oldest.getByRole('button', { name: `Expand thread details for ${tasks[0].goal}` }).click();
  await expect(oldest.locator('.threadTitle')).toHaveCSS('white-space', 'normal');
  await expect(oldest.getByText('completed', { exact: true })).toBeVisible();
  await expect(oldest.getByText('acp', { exact: true })).toBeVisible();
  await expect(oldest.getByText('auto memory', { exact: true })).toBeVisible();
  await expect(oldest).not.toContainText(tasks[0].id);
  const expandedHeight = await oldest.evaluate((element) => element.getBoundingClientRect().height);
  expect(expandedHeight).toBeLessThanOrEqual(160);
  await expect(oldest).toHaveScreenshot('thread-ledger-expanded.png', { animations: 'disabled' });

  const moreActions = oldest.getByRole('button', { name: `Expand actions for ${tasks[0].goal}` });
  await expect(moreActions).toHaveAttribute('aria-expanded', 'false');
  await moreActions.click();
  await expect(oldest.getByText(`Thread ${tasks[0].id.slice(0, 8)}`, { exact: true })).toBeVisible();
  await expect(oldest.getByRole('button', { name: 'Copy ID' })).toBeVisible();
  await expect(oldest).toHaveScreenshot('thread-ledger-more-actions.png', { animations: 'disabled' });
  await oldest.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(cards.first().locator('.threadTitle')).toHaveText(tasks[0].goal);
  await expect(cards.first().getByText('Pinned', { exact: true })).toBeVisible();

  await cards.first().getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText(tasks[0].goal, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show archived threads (1)' }).click();
  await expect(page.locator('.threadCard')).toHaveCount(1);
  await expect(page.getByText(tasks[0].goal, { exact: true })).toBeVisible();

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
  await page.getByRole('button', { name: /Manage server/ }).click();
  const standbyRow = page.locator('.serverRow').filter({ hasText: 'Standby' });
  await standbyRow.locator('.serverRowMain').click();

  await expect(page.locator('.serverTargetName')).toHaveText('Standby');
  await expect(page.getByText('No threads on this server yet')).toBeVisible();
  await page.getByRole('button', { name: 'Show archived threads (1)' }).click();
  await expect(page.getByText('Shared identity thread', { exact: true })).toBeVisible();
  await expect(page.getByText('Pinned', { exact: true })).toHaveCount(0);
});

test('unread marker clears on view, persists, and returns after a background update', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  const first = makeTask(24, { goal: 'Revision tracking thread' });
  const second = makeTask(25, { goal: 'Read another thread' });
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
  await mockSelectedTask(page, baseUrl, second);

  await page.goto('/');
  const firstCard = page.locator('.threadCard').filter({ hasText: first.goal });
  const secondCard = page.locator('.threadCard').filter({ hasText: second.goal });
  await expect(firstCard.getByRole('img', { name: 'Unread thread updates' })).toBeVisible();

  await firstCard.locator('.threadCardMain').click();
  await expect(firstCard.getByRole('img', { name: 'Unread thread updates' })).toHaveCount(0);
  await expect(firstCard).toHaveScreenshot('thread-ledger-seen-row.png', { animations: 'disabled' });
  const persistedAfterView = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem('ender_task_ui_state') || '{}'
  ));
  expect(typeof persistedAfterView[baseUrl][first.id].seenRevision).toBe('string');

  await page.reload();
  await expect(firstCard.getByRole('img', { name: 'Unread thread updates' })).toHaveCount(0);

  await secondCard.locator('.threadCardMain').click();
  response = { items: [{ ...first, logCount: first.logCount + 1 }, second] };
  await page.clock.fastForward(3000);
  await expect(firstCard.getByRole('img', { name: 'Unread thread updates' })).toBeVisible();

  await firstCard.locator('.threadCardMain').click();
  await expect(firstCard.getByRole('img', { name: 'Unread thread updates' })).toHaveCount(0);
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
  await page.locator('.threadCard.selected').getByRole('button', { name: `Expand thread details for ${first.goal}` }).click();
  await expect(page.locator('.threadCard.selected')).toContainText('99 logs');

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

test('untitled threads and their disclosures retain unique accessible names', async ({ page }) => {
  const task = makeTask(41, {
    id: 'thread-empty-title',
    title: '   ',
    goal: '',
    logCount: 0
  });
  await bootstrapApp(page, { tasks: [task] });

  await page.goto('/');
  const card = page.locator('.threadCard');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.threadTitle')).toHaveText('Untitled thread thread-e');
  await expect(card.locator('.threadCardMain')).toHaveAccessibleName(
    'Unread thread updates Untitled thread thread-e'
  );

  const disclosure = card.getByRole('button', {
    name: 'Expand thread details for Untitled thread thread-e'
  });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await expect(card.getByRole('button', {
    name: 'Collapse thread details for Untitled thread thread-e'
  })).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('button', {
    name: 'Expand actions for Untitled thread thread-e'
  })).toBeVisible();
});
