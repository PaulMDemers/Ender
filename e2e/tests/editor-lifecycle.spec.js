const { test, expect } = require('@playwright/test');
const { bootstrapApp, mockLogs, mockStream, mockTask } = require('../fixtures/mockApi');

const task = {
  id: 'thread-editor-1',
  goal: 'Inspect the workspace implementation in the embedded editor',
  workspace: '/Users/test/Ender/workspace/editor-review',
  status: 'done',
  startedAt: '2026-07-18T12:00:00.000Z',
  finishedAt: '2026-07-18T12:04:00.000Z',
  logCount: 1,
  runCount: 1,
  pendingApprovalCount: 0,
  pendingApprovals: []
};

const editorSession = {
  taskId: task.id,
  url: 'http://127.0.0.1:43210/',
  proxyUrl: `http://127.0.0.1:3000/tasks/${task.id}/code-server/proxy/`,
  password: 'ender-editor-test',
  mode: 'local',
  port: 43210
};

async function prepareEditorApp(page, { failFirstLaunch = false, initiallyReachable = true } = {}) {
  let session = null;
  let launchAttempts = 0;
  let stopAttempts = 0;
  let reachable = initiallyReachable;

  await bootstrapApp(page, { tasks: [task] });
  await mockTask(page, task);
  await mockLogs(page, task.id, [
    { t: '2026-07-18T12:04:00.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: 'The workspace is ready for inspection.' } }
  ]);
  await mockStream(page, task.id);

  await page.route(`http://127.0.0.1:3000/tasks/${task.id}/code-server`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: session ? 200 : 400,
        contentType: 'application/json',
        body: JSON.stringify(session
          ? { ok: true, session }
          : { ok: false, message: 'No editor session exists for this task.' })
      });
      return;
    }
    if (method === 'POST') {
      launchAttempts += 1;
      if (failFirstLaunch && launchAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, message: 'Editor runtime failed to boot' })
        });
        return;
      }
      session = editorSession;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, created: true, session })
      });
      return;
    }
    if (method === 'DELETE') {
      stopAttempts += 1;
      session = null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fallback();
  });

  await page.route(`${editorSession.proxyUrl}**`, async (route) => {
    if (!reachable) {
      await route.abort('connectionrefused');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#161925;color:#f4f1ff;font:16px system-ui;display:grid;place-content:center;height:100vh"><main><strong>Ender workspace editor</strong><p>editor-review</p></main></body></html>'
    });
  });

  await page.goto('/');
  await page.getByText(task.goal).click();

  return {
    get launchAttempts() { return launchAttempts; },
    get stopAttempts() { return stopAttempts; },
    setReachable(value) { reachable = value; }
  };
}

test('recovers a failed launch and exposes one complete docked editor lifecycle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const state = await prepareEditorApp(page, { failFirstLaunch: true });

  await page.getByRole('button', { name: 'Launch Editor' }).click();
  const launchFailure = page.getByRole('alert').filter({ hasText: 'Workspace editor could not start' });
  await expect(launchFailure).toContainText('Editor runtime failed to boot');
  await launchFailure.getByRole('button', { name: 'Retry editor' }).click();

  const dock = page.getByRole('dialog', { name: 'Docked workspace editor' });
  await expect(dock).toBeVisible();
  await expect.poll(() => state.launchAttempts).toBe(2);
  await expect(dock.getByText('connected', { exact: true })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Copy editor password' })).toHaveCount(0);
  await dock.getByRole('button', { name: 'Connection' }).click();
  await expect(dock.getByText(task.workspace)).toBeVisible();
  await expect(dock.getByText(editorSession.proxyUrl)).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Copy editor password' }).first()).toBeVisible();
  await expect(dock).toHaveScreenshot('editor-dock.png', { animations: 'disabled' });

  await dock.getByRole('button', { name: 'Modal' }).click();
  const modal = page.getByRole('dialog', { name: 'Workspace editor' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Stop editor' })).toBeVisible();
  await modal.getByRole('button', { name: 'Stop editor' }).click();

  await expect(modal).toHaveCount(0);
  await expect.poll(() => state.stopAttempts).toBe(1);
  await expect(page.getByRole('button', { name: 'Launch Editor' })).toBeEnabled();
});

test('moves an active editor between docked, modal, and stacked responsive surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareEditorApp(page);
  await page.getByRole('button', { name: 'Launch Editor' }).click();
  const dock = page.getByRole('dialog', { name: 'Docked workspace editor' });
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Close view' }).click();
  await expect(dock).toHaveCount(0);
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(dock).toBeVisible();

  await page.setViewportSize({ width: 900, height: 844 });
  const editorTab = page.getByRole('tab', { name: 'Editor' });
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');
  await expect(editorTab).toHaveAttribute('tabindex', '0');
  await expect(editorTab).toHaveAttribute('aria-controls', 'thread-editor-panel');
  await expect(page.getByLabel('Thread workspace editor')).toBeVisible();
  await editorTab.focus();
  await page.keyboard.press('ArrowLeft');
  const transcriptTab = page.getByRole('tab', { name: 'Transcript' });
  await expect(transcriptTab).toBeFocused();
  await expect(transcriptTab).toHaveAttribute('aria-selected', 'true');
  await expect(transcriptTab).toHaveAttribute('tabindex', '0');
  await expect(transcriptTab).toHaveAttribute('aria-controls', 'thread-transcript-panel');
  await expect(editorTab).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('tabpanel', { name: 'Transcript' })).toBeVisible();
  await expect(page.getByText('The workspace is ready for inspection.')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(editorTab).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Editor' })).toBeVisible();

  await page.setViewportSize({ width: 1100, height: 844 });
  const modal = page.getByRole('dialog', { name: 'Workspace editor' });
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  const editorButton = page.getByRole('button', { name: 'Editor', exact: true });
  await editorButton.click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Close workspace editor' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(editorButton).toBeFocused();
  await editorButton.click();
  await expect(modal).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('keeps connection recovery available while an editor embed is still starting', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await prepareEditorApp(page, { initiallyReachable: false });
  await page.getByRole('button', { name: 'Launch Editor' }).click();

  const dock = page.getByRole('dialog', { name: 'Docked workspace editor' });
  await expect(dock.getByText('Connecting to workspace editor')).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  state.setReachable(true);
  await dock.getByRole('button', { name: 'Retry connection' }).click();
  await expect(dock.getByText('connected', { exact: true })).toBeVisible();
});
