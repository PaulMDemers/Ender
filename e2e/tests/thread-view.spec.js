const { test, expect } = require('@playwright/test');
const { bootstrapApp, mockLogs, mockStream, mockTask } = require('../fixtures/mockApi');

const task = {
  id: 'thread-abcdef12',
  goal: 'Audit the React workflow UI and summarize visual regressions',
  workspace: '/Users/test/Ender/workspace/react-audit',
  status: 'done',
  startedAt: '2026-03-01T10:00:00.000Z',
  finishedAt: '2026-03-01T10:05:00.000Z',
  logCount: 5,
  runCount: 1,
  pendingApprovalCount: 0,
  pendingApprovals: []
};

const entries = [
  { t: '2026-03-01T10:00:01.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: 'Review the workflow UI.' } },
  { t: '2026-03-01T10:00:02.000Z', level: 'info', data: 'runtime heartbeat connected' },
  { t: '2026-03-01T10:00:03.000Z', level: 'debug', data: 'tool args (browser_snapshot_page): {"url":"http://127.0.0.1:4173/"}' },
  { t: '2026-03-01T10:00:05.000Z', level: 'info', data: 'tool call: browser_snapshot_page' },
  { t: '2026-03-01T10:00:08.000Z', level: 'info', data: 'tool result (browser_snapshot_page): {"message":"Captured workflow panel screenshot","path":"/tmp/workflow.png"}' },
  { t: '2026-03-01T10:00:12.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: 'The workflow panel looks aligned and readable.' } },
  { t: '2026-03-01T10:00:15.000Z', level: 'info', data: 'final: DONE: Visual review complete.' }
];

test('renders a selected thread transcript view', async ({ page }) => {
  let followUpPayload = null;
  await bootstrapApp(page, { tasks: [task] });
  await mockTask(page, task);
  await mockLogs(page, task.id, entries);
  await mockStream(page, task.id);
  await page.route(`http://127.0.0.1:3000/tasks/${task.id}/messages`, async (route) => {
    followUpPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');
  await page.getByText(task.goal).click();

  await expect(page.getByText('Live transcript')).toBeVisible();
  await expect(page.locator('.threadCardMain[aria-current="true"]')).toContainText(task.goal);
  await expect(page.getByText('The workflow panel looks aligned and readable.')).toBeVisible();
  await expect(page.locator('.logToolGroupLabel').filter({ hasText: 'browser_snapshot_page' })).toBeVisible();
  await expect(page.getByText(/tool args \(browser_snapshot_page\)/i)).toHaveCount(0);
  await expect(page.getByText('runtime heartbeat connected')).toHaveCount(0);
  await expect(page.getByText('1 routine event hidden')).toBeVisible();
  await page.getByRole('button', { name: 'All activity' }).click();
  await expect(page.getByText('runtime heartbeat connected')).toBeVisible();
  await page.getByRole('button', { name: 'Conversation' }).click();
  await expect(page.getByLabel('Follow-up message')).toBeVisible();
  const runSettings = page.getByRole('button', { name: 'Review follow-up run settings' });
  await expect(runSettings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Backend profile')).toHaveCount(0);
  await runSettings.click();
  await expect(page.getByLabel('Backend profile')).toBeVisible();
  await page.getByRole('button', { name: 'Hide follow-up run settings' }).click();
  await expect(page.locator('.transcriptStack')).toHaveScreenshot('thread-transcript.png', { animations: 'disabled' });

  await page.getByLabel('Follow-up message').fill('Summarize the most important regression.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => followUpPayload).not.toBeNull();
  expect(followUpPayload).toMatchObject({
    prompt: 'Summarize the most important regression.',
    memoryMode: 'auto'
  });
  expect(followUpPayload.llmProfileId).toBeTruthy();
});

test('keeps a long focused transcript contained on a narrow viewport', async ({ page }) => {
  const longContent = `Result: ${'supercalifragilisticexpialidocious'.repeat(12)}`;
  const narrowTask = {
    ...task,
    id: 'thread-narrow-1',
    goal: 'Inspect a long mobile transcript',
    logCount: 3
  };
  const narrowEntries = [
    { t: '2026-03-01T10:00:01.000Z', level: 'info', data: 'runtime initialized with verbose diagnostics' },
    { t: '2026-03-01T10:00:02.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: 'Return the identifier.' } },
    { t: '2026-03-01T10:00:03.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: longContent } }
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapApp(page, { tasks: [narrowTask] });
  await mockTask(page, narrowTask);
  await mockLogs(page, narrowTask.id, narrowEntries);
  await mockStream(page, narrowTask.id);

  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByText(narrowTask.goal).click();

  await expect(page.getByRole('button', { name: 'Conversation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('runtime initialized with verbose diagnostics')).toHaveCount(0);
  await expect(page.getByText(longContent)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'All activity' }).click();
  await expect(page.getByText('runtime initialized with verbose diagnostics')).toBeVisible();
});

test('presents one persistent approval decision surface and blocks follow-up input', async ({ page }) => {
  const approval = {
    id: 'approval-12345678',
    type: 'exec_run',
    title: 'Run deployment command',
    description: 'The agent wants to run a command that changes the deployment environment.',
    details: { command: 'npm run deploy' },
    requestedAt: '2026-03-01T10:03:00.000Z'
  };
  const waitingTask = {
    ...task,
    status: 'awaiting_approval',
    finishedAt: null,
    pendingApprovalCount: 1,
    pendingApprovals: [approval]
  };
  await bootstrapApp(page, { tasks: [waitingTask] });
  await mockTask(page, waitingTask);
  await mockLogs(page, waitingTask.id, entries.slice(0, 3));
  await mockStream(page, waitingTask.id);

  await page.goto('/');
  await page.getByText(waitingTask.goal).click();

  await expect(page.getByRole('alert', { name: approval.title })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(1);
  await expect(page.getByText('Resolve the pending approval above to continue this run.')).toBeVisible();
  await expect(page.getByLabel('Follow-up message')).toHaveCount(0);
});

test('retains a failed follow-up and retries it in context', async ({ page }) => {
  let attempts = 0;
  await bootstrapApp(page, { tasks: [task] });
  await mockTask(page, task);
  await mockLogs(page, task.id, entries);
  await mockStream(page, task.id);
  await page.route(`http://127.0.0.1:3000/tasks/${task.id}/messages`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'Follow-up service unavailable' })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');
  await page.getByText(task.goal).click();
  const message = page.getByLabel('Follow-up message');
  await message.fill('Keep this message available for retry.');
  await page.getByRole('button', { name: 'Send' }).click();

  const failure = page.getByRole('alert').filter({ hasText: 'Message not sent' });
  await expect(failure).toContainText('Follow-up service unavailable');
  await expect(message).toHaveValue('Keep this message available for retry.');
  await failure.getByRole('button', { name: 'Retry message' }).click();

  await expect.poll(() => attempts).toBe(2);
  await expect(failure).toHaveCount(0);
  await expect(message).toHaveValue('');
});

test('explains an unavailable editor while the empty transcript waits for activity', async ({ page }) => {
  const emptyTask = { ...task, id: 'thread-empty-1', goal: 'Wait for the first agent event', logCount: 0 };
  await bootstrapApp(page, {
    tasks: [emptyTask],
    health: {
      services: { llm: { ready: true, missing: [] }, codeServer: { ready: false } },
      setupHints: { codeServer: 'Install and configure code-server to enable the workspace editor.' }
    }
  });
  await mockTask(page, emptyTask);
  await mockLogs(page, emptyTask.id, []);
  await mockStream(page, emptyTask.id);

  await page.goto('/');
  await page.getByText(emptyTask.goal).click();

  await expect(page.getByText('Workspace editor unavailable')).toBeVisible();
  await expect(page.getByText('Install and configure code-server to enable the workspace editor.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Launch Editor' })).toBeDisabled();
  await expect(page.getByText('Waiting for transcript activity')).toBeVisible();
});
