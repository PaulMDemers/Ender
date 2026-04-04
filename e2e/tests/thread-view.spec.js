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
  { t: '2026-03-01T10:00:03.000Z', level: 'debug', data: 'tool args (browser_snapshot_page): {"url":"http://127.0.0.1:4173/"}' },
  { t: '2026-03-01T10:00:05.000Z', level: 'info', data: 'tool call: browser_snapshot_page' },
  { t: '2026-03-01T10:00:08.000Z', level: 'info', data: 'tool result (browser_snapshot_page): {"message":"Captured workflow panel screenshot","path":"/tmp/workflow.png"}' },
  { t: '2026-03-01T10:00:12.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: 'The workflow panel looks aligned and readable.' } },
  { t: '2026-03-01T10:00:15.000Z', level: 'info', data: 'final: DONE: Visual review complete.' }
];

test('renders a selected thread transcript view', async ({ page }) => {
  await bootstrapApp(page, { tasks: [task] });
  await mockTask(page, task);
  await mockLogs(page, task.id, entries);
  await mockStream(page, task.id);

  await page.goto('/');
  await page.getByText(task.goal).click();

  await expect(page.getByText('Live transcript')).toBeVisible();
  await expect(page.getByText('The workflow panel looks aligned and readable.')).toBeVisible();
  await expect(page.locator('.logToolGroupLabel').filter({ hasText: 'browser_snapshot_page' })).toBeVisible();
  await expect(page.getByText(/tool args \(browser_snapshot_page\)/i)).toHaveCount(0);
  await expect(page.locator('.transcriptStack')).toHaveScreenshot('thread-transcript.png', { animations: 'disabled' });
});
