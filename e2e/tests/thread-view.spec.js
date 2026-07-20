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
  const transcriptEntries = [
    ...entries,
    { t: '2026-03-01T10:00:16.000Z', level: 'info', data: 'backend=acp' },
    { t: '2026-03-01T10:00:17.000Z', level: 'info', data: `workspace=${task.workspace}` },
    { t: '2026-03-01T10:00:18.000Z', level: 'info', data: 'loop stop reason=completed' }
  ];
  await bootstrapApp(page, { tasks: [task] });
  await mockTask(page, task);
  await mockLogs(page, task.id, transcriptEntries);
  await mockStream(page, task.id);
  await page.route(`http://127.0.0.1:3000/tasks/${task.id}/messages`, async (route) => {
    followUpPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/');
  await page.getByText(task.goal).click();

  await expect(page.getByRole('heading', { name: task.goal })).toBeVisible();
  await expect(page.locator('.threadCardMain[aria-current="true"]')).toContainText(task.goal);
  await expect(page.getByText('The workflow panel looks aligned and readable.')).toBeVisible();
  await expect(page.getByText('2 messages · 1 update')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show 2 activity items' })).toBeVisible();
  await expect(page.locator('.logWorkSummaryHeadline:visible')).toHaveText('Checked the results');
  await expect(page.locator('.logToolGroupLabel')).toHaveCount(0);
  await expect(page.getByText(/tool args \(browser_snapshot_page\)/i)).toHaveCount(0);
  await expect(page.getByText('runtime heartbeat connected')).toHaveCount(0);
  const streamMetrics = await page.locator('.logStream').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement.getBoundingClientRect();
    return {
      width: rect.width,
      leftGutter: rect.left - parentRect.left,
      rightGutter: parentRect.right - rect.right
    };
  });
  expect(streamMetrics.width).toBeLessThan(850);
  expect(Math.abs(streamMetrics.leftGutter - streamMetrics.rightGutter)).toBeLessThan(2);

  const userActions = page.getByLabel('You message actions');
  await userActions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'View raw markdown' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(userActions.locator('..')).not.toHaveAttribute('open');
  await expect(userActions).toBeFocused();
  await userActions.click();
  await page.getByRole('button', { name: 'View raw markdown' }).click();
  await expect(userActions.locator('..')).not.toHaveAttribute('open');
  await userActions.click();
  await page.getByRole('button', { name: 'Show rendered' }).click();

  await page.getByRole('button', { name: 'Run details' }).click();
  await expect(page.getByText('Backend')).toBeVisible();
  await expect(page.getByText(task.workspace)).toBeVisible();
  await expect(page.locator('.logConsole')).toHaveScreenshot('thread-conversation.png', { animations: 'disabled' });

  await page.getByRole('button', { name: 'All activity' }).click();
  await expect(page.getByText('5 activity items')).toBeVisible();
  await expect(page.getByText('runtime heartbeat connected')).toBeVisible();
  await expect(page.locator('.logToolGroupLabel').filter({ hasText: 'browser_snapshot_page' })).toBeVisible();
  await expect(page.locator('.logConsole')).toHaveScreenshot('thread-activity.png', { animations: 'disabled' });
  await page.getByRole('button', { name: 'Conversation' }).click();
  await expect(page.locator('.logToolGroupLabel')).toHaveCount(0);
  await expect(page.getByLabel('Follow-up message')).toBeVisible();
  await expect(page.locator('.threadComposer')).not.toContainText(task.workspace);
  await expect(page.locator('.threadComposer')).not.toContainText(task.id.slice(0, 8));
  const composerHeight = await page.locator('.threadComposer').evaluate((element) => element.getBoundingClientRect().height);
  expect(composerHeight).toBeLessThan(150);
  await expect(page.locator('.threadComposer')).toHaveScreenshot('thread-composer.png', { animations: 'disabled' });
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

test('shows structured assistant progress and recoverable tool work in Conversation while a run is active', async ({ page }) => {
  const runningTask = {
    ...task,
    id: 'thread-live-progress-1',
    goal: 'Create and verify a minimal Express project',
    status: 'running',
    finishedAt: null,
    logCount: 8
  };
  const progressEntries = [
    { t: '2026-03-01T10:00:01.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: runningTask.goal } },
    { t: '2026-03-01T10:00:03.000Z', level: 'info', data: { kind: 'assistant_progress', segmentId: 'segment-1', sequence: 0, content: 'I’ll inspect the workspace, create the project, and verify it end to end.' } },
    { t: '2026-03-01T10:00:04.000Z', level: 'info', data: { kind: 'plan', entries: [
      { content: 'Inspect the workspace', status: 'completed', priority: 'high' },
      { content: 'Create project files', status: 'completed', priority: 'high' },
      { content: 'Verify the HTTP endpoint', status: 'in_progress', priority: 'high' }
    ] } },
    { t: '2026-03-01T10:00:05.000Z', level: 'info', data: { kind: 'tool_call', toolCallId: 'tool-1', title: 'Start test server', toolKind: 'execute', status: 'in_progress', input: '{"cmd":"npm test"}', output: null, locations: [] } },
    { t: '2026-03-01T10:00:08.000Z', level: 'warn', data: { kind: 'tool_call', toolCallId: 'tool-1', title: 'Start test server', toolKind: 'execute', status: 'failed', input: '{"cmd":"npm test"}', output: '{"error":"Port access denied"}', locations: [] } },
    { t: '2026-03-01T10:00:09.000Z', level: 'info', data: { kind: 'assistant_progress', segmentId: 'segment-2', sequence: 0, content: 'The first live check hit a port restriction, so I’m retrying with the required permission.' } },
    { t: '2026-03-01T10:00:09.500Z', level: 'info', data: { kind: 'approval', action: 'granted', approvalId: 'approval-sensitive-id', title: 'Bind local verification port', type: 'exec_run' } },
    { t: '2026-03-01T10:00:10.000Z', level: 'info', data: { kind: 'tool_call', toolCallId: 'tool-2', title: 'Retry HTTP verification', toolKind: 'execute', status: 'in_progress', input: '{"cmd":"npm test"}', output: null, locations: [] } },
    { t: '2026-03-01T10:00:12.000Z', level: 'info', data: { kind: 'tool_call', toolCallId: 'tool-2', title: 'Retry HTTP verification', toolKind: 'execute', status: 'completed', input: '{"cmd":"npm test"}', output: '{"stdout":"ok"}', locations: [] } }
  ];
  await bootstrapApp(page, { tasks: [runningTask] });
  await mockTask(page, runningTask);
  await mockLogs(page, runningTask.id, progressEntries);
  await mockStream(page, runningTask.id);

  await page.goto('/');
  await page.getByText(runningTask.goal).click();

  await expect(page.getByText('1 message · 1 update')).toBeVisible();
  await expect(page.getByText(/approval-sensitive-id/)).toHaveCount(0);
  await expect(page.getByText(/undefined/i)).toHaveCount(0);
  const workDisclosure = page.locator('.logWorkSummary');
  await expect(page.locator('.logWorkSummaryHeadline')).toHaveText('Checking the results');
  await expect(page.locator('.logRowWorkSummary [role="status"]')).toHaveText('Checking the results');

  const workSummary = workDisclosure.locator(':scope > summary');
  await workSummary.focus();
  await page.keyboard.press('Enter');
  await expect(workDisclosure).toHaveAttribute('open', '');
  await expect(page.getByText('I’ll inspect the workspace, create the project, and verify it end to end.')).toBeVisible();
  await expect(page.getByText('The first live check hit a port restriction, so I’m retrying with the required permission.')).toBeVisible();
  await expect(page.getByText('Permission granted: Bind local verification port')).toBeVisible();
  const toolDisclosure = workDisclosure.locator('.logWorkToolsDisclosure');
  await toolDisclosure.locator(':scope > summary').click();
  await expect(toolDisclosure).toContainText('Port access denied');
  await toolDisclosure.locator(':scope > summary').click();
  await workSummary.focus();
  await page.keyboard.press('Enter');
  await expect(workDisclosure).not.toHaveAttribute('open', '');
  await workSummary.evaluate((element) => element.blur());
  await expect(page.locator('.logConsole')).toHaveScreenshot('thread-live-progress.png', { animations: 'disabled' });

  await page.getByRole('button', { name: 'All activity' }).click();
  const failedWork = page.locator('.logToolEvent').filter({ hasText: 'Start test server' }).last();
  await expect(failedWork).toContainText('failed');
  await expect(failedWork).toContainText('Port access denied');

  await page.getByRole('button', { name: 'Conversation' }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.locator('.logConsole')).toHaveScreenshot('thread-live-progress-narrow.png', { animations: 'disabled' });
});

test('keeps earlier progress separate from a clean final assistant response', async ({ page }) => {
  const completedTask = {
    ...task,
    id: 'thread-segmented-final-1',
    goal: 'Build the example project',
    result: 'Project files are ready and verified.'
  };
  const segmentedEntries = [
    { t: '2026-03-01T10:00:01.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: completedTask.goal } },
    { t: '2026-03-01T10:00:02.000Z', level: 'info', data: { kind: 'assistant_progress', segmentId: 'segment-intro', sequence: 0, content: 'I’ll create the files and verify the server.' } },
    { t: '2026-03-01T10:00:03.000Z', level: 'info', data: { kind: 'tool_call', toolCallId: 'tool-create', title: 'Create project files', toolKind: 'edit', status: 'completed', input: null, output: null, locations: [{ path: 'server.js' }] } },
    { t: '2026-03-01T10:00:04.000Z', level: 'info', data: { kind: 'assistant_progress', segmentId: 'segment-final', sequence: 0, content: completedTask.result } },
    { t: '2026-03-01T10:00:05.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: completedTask.result } }
  ];
  await bootstrapApp(page, { tasks: [completedTask] });
  await mockTask(page, completedTask);
  await mockLogs(page, completedTask.id, segmentedEntries);
  await mockStream(page, completedTask.id);

  await page.goto('/');
  await page.getByText(completedTask.goal).click();

  const completedWork = page.locator('.logWorkSummary:visible').first();
  await completedWork.locator(':scope > summary').click();
  await expect(page.getByText('I’ll create the files and verify the server.')).toBeVisible();
  await expect(page.getByText(completedTask.result)).toHaveCount(1);
  await expect(page.getByText('2 messages · 1 update')).toBeVisible();
});

test('projects legacy ACP progress cleanly without undefined statuses or concatenated final text', async ({ page }) => {
  const legacyTask = {
    ...task,
    id: 'thread-legacy-progress-1',
    goal: 'Create a legacy example project',
    result: 'I’ll create the project.The files are ready.Created and verified the project.'
  };
  const legacyEntries = [
    { t: '2026-03-01T10:00:01.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: legacyTask.goal } },
    { t: '2026-03-01T10:00:02.000Z', level: 'info', data: 'agent: I’ll create the project.' },
    { t: '2026-03-01T10:00:03.000Z', level: 'info', data: 'tool call status: undefined' },
    { t: '2026-03-01T10:00:04.000Z', level: 'info', data: 'agent: The files are ready.' },
    { t: '2026-03-01T10:00:05.000Z', level: 'info', data: 'approval granted (legacy-sensitive-id)' },
    { t: '2026-03-01T10:00:06.000Z', level: 'info', data: 'agent: Created and verified the project.' },
    { t: '2026-03-01T10:00:07.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: legacyTask.result } }
  ];
  await bootstrapApp(page, { tasks: [legacyTask] });
  await mockTask(page, legacyTask);
  await mockLogs(page, legacyTask.id, legacyEntries);
  await mockStream(page, legacyTask.id);

  await page.goto('/');
  await page.getByText(legacyTask.goal).click();

  const legacyWork = page.locator('.logWorkSummary:visible').first();
  await legacyWork.locator(':scope > summary').click();
  await expect(page.getByText('I’ll create the project.')).toBeVisible();
  await expect(page.getByText('The files are ready.')).toBeVisible();
  await expect(page.getByText('Created and verified the project.')).toHaveCount(1);
  await expect(page.getByText('Permission granted', { exact: true })).toBeVisible();
  await expect(page.getByText(/legacy-sensitive-id|undefined/i)).toHaveCount(0);
  await expect(page.getByText(legacyTask.result)).toHaveCount(0);
});

test('reconciles legacy direct-provider iterations into one truthful work summary', async ({ page }) => {
  const directTask = {
    ...task,
    id: 'thread-direct-provider-1',
    goal: 'Create a minimal React project',
    result: 'DONE: Created and verified the React project.'
  };
  const directEntries = [
    { t: '2026-03-01T10:00:01.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: directTask.goal } },
    { t: '2026-03-01T10:00:02.000Z', level: 'info', data: 'step 1: invoking model' },
    { t: '2026-03-01T10:00:03.000Z', level: 'info', data: 'tool call: file_list' },
    { t: '2026-03-01T10:00:04.000Z', level: 'info', data: 'tool result (file_list): {"ok":true,"items":[]}' },
    { t: '2026-03-01T10:00:05.000Z', level: 'info', data: 'tool call: file_exists' },
    { t: '2026-03-01T10:00:06.000Z', level: 'info', data: 'tool result (file_exists): {"ok":true,"exists":false}' },
    { t: '2026-03-01T10:00:07.000Z', level: 'info', data: 'step 2: invoking model' },
    { t: '2026-03-01T10:00:08.000Z', level: 'info', data: 'tool call: add_todo' },
    { t: '2026-03-01T10:00:09.000Z', level: 'info', data: 'tool result (add_todo): {"ok":true}' },
    { t: '2026-03-01T10:00:10.000Z', level: 'info', data: 'step 3: invoking model' },
    { t: '2026-03-01T10:00:11.000Z', level: 'info', data: 'tool call: file_write' },
    { t: '2026-03-01T10:00:12.000Z', level: 'info', data: 'tool result (file_write): {"ok":true,"path":"example/package.json"}' },
    { t: '2026-03-01T10:00:13.000Z', level: 'info', data: 'tool call: file_write' },
    { t: '2026-03-01T10:00:14.000Z', level: 'info', data: 'tool result (file_write): {"ok":true,"path":"example/src/App.jsx"}' },
    { t: '2026-03-01T10:00:15.000Z', level: 'info', data: 'step 4: invoking model' },
    { t: '2026-03-01T10:00:16.000Z', level: 'info', data: 'tool call: finalize' },
    { t: '2026-03-01T10:00:17.000Z', level: 'info', data: `tool result (finalize): ${directTask.result}` },
    { t: '2026-03-01T10:00:18.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: directTask.result } }
  ];
  await bootstrapApp(page, { tasks: [directTask] });
  await mockTask(page, directTask);
  await mockLogs(page, directTask.id, directEntries);
  await mockStream(page, directTask.id);

  await page.goto('/');
  await page.getByText(directTask.goal).click();

  await expect(page.getByText('2 messages · 1 update')).toBeVisible();
  await expect(page.getByText('Wrote 2 files · Inspected the workspace · +2')).toBeVisible();
  await expect(page.getByText(/invoking model/i)).toHaveCount(0);
  const work = page.locator('.logWorkSummary:visible').first();
  await work.locator(':scope > summary').click();
  await expect(work.getByText('Inspect 6 tool actions')).toBeVisible();

  await page.getByRole('button', { name: 'All activity' }).click();
  await expect(page.getByText('MODEL · request 1')).toBeVisible();
  await expect(page.getByText('Requesting the next action from the model').first()).toBeVisible();
  await expect(page.locator('.logRowProgress')).toHaveCount(0);
  await expect(page.locator('.logToolGroupSummary').filter({ hasText: 'file_write' })).toContainText('TOOLS · 2');
});

test('keeps a long task-ledger workspace path compact in the thread header', async ({ page }) => {
  const ledgerTask = {
    ...task,
    id: 'thread-ledger-header-1',
    title: 'Generate five mock Markdown files',
    goal: 'Generate a folder with 5 mock md files in it.',
    workspace: '/Users/test/Desktop/Ender/workspace/generated/mock/content/repository'
  };
  const ledgerEntries = [
    { t: '2026-03-01T10:00:01.000Z', level: 'info', data: { kind: 'chat', role: 'user', content: ledgerTask.goal } },
    { t: '2026-03-01T10:00:02.000Z', level: 'info', data: { kind: 'chat', role: 'assistant', content: 'Created five Markdown files and verified their contents.' } }
  ];
  await page.setViewportSize({ width: 1440, height: 720 });
  await bootstrapApp(page, { tasks: [ledgerTask] });
  await mockTask(page, ledgerTask);
  await mockLogs(page, ledgerTask.id, ledgerEntries);
  await mockStream(page, ledgerTask.id);

  await page.goto('/');
  await page.getByText(ledgerTask.title).click();

  const header = page.locator('.mainHeader');
  const workspaceTag = page.locator('.headerWorkspaceTag');
  await expect(header.getByRole('heading', { name: ledgerTask.title })).toBeVisible();
  await expect(page.getByText(ledgerTask.goal)).toBeVisible();
  await expect(page.getByText(/global task ledger/i)).toHaveCount(0);
  await expect(workspaceTag).toBeVisible();
  const wideMetrics = await page.evaluate(() => {
    const headerElement = document.querySelector('.mainHeader');
    const workspaceElement = document.querySelector('.headerWorkspaceTag');
    const headerRect = headerElement.getBoundingClientRect();
    const workspaceRect = workspaceElement.getBoundingClientRect();
    const style = getComputedStyle(workspaceElement);
    return {
      headerHeight: headerRect.height,
      workspaceHeight: workspaceRect.height,
      workspaceRight: workspaceRect.right,
      headerRight: headerRect.right,
      whiteSpace: style.whiteSpace,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });

  expect(wideMetrics.headerHeight).toBeLessThan(90);
  expect(wideMetrics.workspaceHeight).toBeLessThan(32);
  expect(wideMetrics.workspaceRight).toBeLessThanOrEqual(wideMetrics.headerRight);
  expect(wideMetrics.whiteSpace).toBe('nowrap');
  expect(wideMetrics.pageOverflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1180, height: 720 });
  await expect(workspaceTag).toBeHidden();
  const constrainedMetrics = await page.evaluate(() => ({
    headerHeight: document.querySelector('.mainHeader').getBoundingClientRect().height,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth
  }));
  expect(constrainedMetrics.headerHeight).toBeLessThan(90);
  expect(constrainedMetrics.pageOverflow).toBeLessThanOrEqual(0);
  await expect(header.locator('.headerStatusPill')).toHaveText('completed');
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
  await page.setViewportSize({ width: 320, height: 844 });
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
  await expect(page.locator('.logConsole')).toHaveScreenshot('thread-conversation-narrow.png', { animations: 'disabled' });
  await expect(page.locator('.threadComposer')).toHaveScreenshot('thread-composer-narrow.png', { animations: 'disabled' });

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
  await expect(page.getByText('npm run deploy')).not.toBeVisible();
  await expect(page.locator('.approvalCard')).toHaveScreenshot('approval-card.png', { animations: 'disabled' });
  await page.getByText('Review request details').click();
  await expect(page.getByText('npm run deploy')).toBeVisible();
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
