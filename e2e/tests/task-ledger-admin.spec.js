const { test, expect } = require('@playwright/test');
const { bootstrapApp, openLaunchModes } = require('../fixtures/mockApi');

function ledgerEntry(overrides = {}) {
  return {
    id: 'ledger-entry-1',
    title: 'Review deployment notes',
    prompt: 'Review the deployment notes and report blockers.',
    taskType: 'generic',
    workspace: '/Users/test/Ender/workspace',
    autoRun: false,
    status: 'pending',
    attemptCount: 0,
    source: { kind: 'manual', label: null, referenceId: null },
    lifecycle: {
      currentStage: 'queued',
      stageSummary: 'Entry created',
      history: [{ stage: 'queued', summary: 'Entry created', at: '2026-07-18T12:00:00.000Z' }],
      feasibility: { outcome: 'unknown', summary: null },
      plan: { summary: null, checklist: [], verificationSteps: [] },
      verification: { status: 'pending', summary: null, evidence: [] },
      outcome: { status: null, summary: null }
    },
    successCriteria: [],
    constraints: [],
    verificationPlan: [],
    createdAt: '2026-07-18T12:00:00.000Z',
    updatedAt: '2026-07-18T12:00:00.000Z',
    ...overrides
  };
}

async function openLedger(page) {
  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /task ledger/i }).click();
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('retains a structured create after failure and retries the exact request', async ({ page }) => {
  let attempts = 0;
  let received = null;
  let entries = [];
  await bootstrapApp(page);
  await page.route('http://127.0.0.1:3000/task-ledger', async (route) => {
    if (route.request().method() === 'GET') {
      return fulfillJson(route, { items: entries, maxAutoAgents: 2, pollIntervalMs: 15000 });
    }
    attempts += 1;
    received = route.request().postDataJSON();
    if (attempts === 1) return fulfillJson(route, { ok: false, message: 'Ledger store temporarily unavailable' }, 503);
    const created = ledgerEntry({ id: 'ledger-created-1', ...received, source: received.source });
    entries = [created];
    return fulfillJson(route, created, 201);
  });

  await openLedger(page);
  await expect(page.getByText('2 auto-agent slots')).toBeVisible();
  await page.getByRole('button', { name: 'Show more options' }).click();
  await page.getByLabel('Task Request').fill('Prepare the release readiness report.');
  await page.getByLabel('Title').fill('Release readiness');
  await page.getByLabel('Task Type').selectOption('ops');
  await page.getByLabel('Source Kind').fill('jira');
  await page.getByLabel('Source Label / Ref').fill('OPS-42');
  await page.getByLabel('Success Criteria').fill('Checks summarized\nBlockers listed');
  await page.getByRole('button', { name: 'Add to ledger' }).click();

  const failure = page.getByRole('alert').filter({ hasText: 'Ledger operation failed' });
  await expect(failure).toContainText('Ledger store temporarily unavailable');
  await expect(page.getByLabel('Task Request')).toHaveValue('Prepare the release readiness report.');
  await expect(page.getByLabel('Title')).toHaveValue('Release readiness');
  await failure.getByRole('button', { name: 'Retry create' }).click();

  await expect.poll(() => attempts).toBe(2);
  expect(received).toMatchObject({
    prompt: 'Prepare the release readiness report.',
    title: 'Release readiness',
    taskType: 'ops',
    source: { kind: 'jira', label: 'OPS-42' },
    successCriteria: ['Checks summarized', 'Blockers listed']
  });
  await expect(page.getByText('Entry added')).toBeVisible();
  await expect(page.getByLabel('Task Request')).toHaveValue('');
  await expect(page.getByText('Release readiness', { exact: true })).toBeVisible();
});

test('refreshes a persisted dispatch failure and retries into the linked thread', async ({ page }) => {
  const startedTask = {
    id: 'task-from-ledger-1',
    goal: 'Deployment recovery thread',
    workspace: '/Users/test/Ender/workspace',
    status: 'running',
    startedAt: '2026-07-18T12:05:00.000Z',
    logCount: 0,
    runCount: 1,
    pendingApprovalCount: 0
  };
  let runAttempts = 0;
  let tasks = [];
  let entry = ledgerEntry({ id: 'ledger-run-1', title: 'Recover deployment' });
  await bootstrapApp(page);
  await page.route('http://127.0.0.1:3000/tasks', (route) => fulfillJson(route, { items: tasks }));
  await page.route(`http://127.0.0.1:3000/tasks/${startedTask.id}/logs?from=*`, (route) => fulfillJson(route, { entries: [] }));
  await page.route(`http://127.0.0.1:3000/tasks/${startedTask.id}/stream`, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  await page.route('http://127.0.0.1:3000/task-ledger', (route) => fulfillJson(route, { items: [entry], maxAutoAgents: 1, pollIntervalMs: 15000 }));
  await page.route(`http://127.0.0.1:3000/task-ledger/${entry.id}/run`, async (route) => {
    runAttempts += 1;
    if (runAttempts === 1) {
      entry = ledgerEntry({
        ...entry,
        status: 'failed',
        attemptCount: 1,
        lastError: 'Worker launch failed',
        lifecycle: {
          ...entry.lifecycle,
          currentStage: 'finalize',
          stageSummary: 'Dispatch failed before the worker started',
          outcome: { status: 'failed', summary: 'Worker launch failed' }
        }
      });
      return fulfillJson(route, { ok: false, message: 'Worker launch failed' }, 503);
    }
    tasks = [startedTask];
    entry = ledgerEntry({
      ...entry,
      status: 'running',
      attemptCount: 2,
      startedTaskId: startedTask.id,
      lastError: null,
      lifecycle: { ...entry.lifecycle, currentStage: 'intake', stageSummary: 'Worker started', outcome: { status: null, summary: null } }
    });
    return fulfillJson(route, { entry, startedTaskId: startedTask.id });
  });

  await openLedger(page);
  await page.getByRole('button', { name: 'Run now' }).click();
  const failure = page.getByRole('alert').filter({ hasText: 'Ledger operation failed' });
  await expect(failure).toContainText('Worker launch failed');
  await expect(page.locator('.taskLedgerRow')).toContainText('failed');
  await expect(page.locator('.taskLedgerOutcome')).toContainText('Worker launch failed');
  await failure.getByRole('button', { name: 'Retry run' }).click();

  await expect.poll(() => runAttempts).toBe(2);
  await expect(page.locator('.headerGoal')).toHaveText('Deployment recovery thread');
});

test('filters lifecycle outcomes before rendering and recovers a failed delete', async ({ page }) => {
  let deleteAttempts = 0;
  let entries = [
    ledgerEntry({ id: 'ledger-github-1', title: 'GitHub triage', taskType: 'coding', source: { kind: 'github', label: 'PR 88' } }),
    ledgerEntry({ id: 'ledger-jira-1', title: 'Incident follow-up', taskType: 'ops', status: 'failed', source: { kind: 'jira', label: 'OPS-9' }, lastError: 'Verification failed' }),
    ledgerEntry({ id: 'ledger-docs-1', title: 'Publish notes', taskType: 'documentation', status: 'completed', lifecycle: { ...ledgerEntry().lifecycle, currentStage: 'finalize', outcome: { status: 'completed', summary: 'Notes published' } } })
  ];
  await bootstrapApp(page);
  await page.route('http://127.0.0.1:3000/task-ledger', (route) => fulfillJson(route, { items: entries }));
  await page.route('http://127.0.0.1:3000/task-ledger/ledger-jira-1', async (route) => {
    deleteAttempts += 1;
    if (deleteAttempts === 1) return fulfillJson(route, { ok: false, message: 'Delete lock unavailable' }, 503);
    entries = entries.filter((item) => item.id !== 'ledger-jira-1');
    return fulfillJson(route, { ok: true });
  });
  page.on('dialog', (dialog) => dialog.accept());

  await openLedger(page);
  await expect(page.getByText('GitHub triage')).toBeVisible();
  await expect(page.getByText('Incident follow-up')).toBeVisible();
  await expect(page.getByText('Publish notes')).toHaveCount(0);
  await page.getByLabel('Status').selectOption('all');
  await page.getByLabel('Search').fill('jira');
  await expect(page.getByText('Incident follow-up')).toBeVisible();
  await expect(page.getByText('GitHub triage')).toHaveCount(0);
  await expect(page.getByText('Publish notes')).toHaveCount(0);
  await expect(page.getByLabel('Lifecycle: queued')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();

  const failure = page.getByRole('alert').filter({ hasText: 'Ledger operation failed' });
  await expect(failure).toContainText('Delete lock unavailable');
  await expect(page.getByText('Incident follow-up')).toBeVisible();
  await failure.getByRole('button', { name: 'Retry delete' }).click();
  await expect.poll(() => deleteAttempts).toBe(2);
  await expect(page.getByText('Incident follow-up')).toHaveCount(0);
});

test('isolated queue stays responsive and hands a linked entry back to its thread', async ({ page }) => {
  const task = {
    id: 'task-standalone-1',
    goal: 'Standalone handoff thread',
    workspace: '/Users/test/Ender/workspace',
    status: 'done',
    startedAt: '2026-07-18T11:00:00.000Z',
    finishedAt: '2026-07-18T11:10:00.000Z',
    logCount: 0,
    runCount: 1,
    pendingApprovalCount: 0
  };
  const entry = ledgerEntry({ id: 'ledger-standalone-1', title: 'Standalone completed task', status: 'completed', completedTaskId: task.id, lifecycle: { ...ledgerEntry().lifecycle, currentStage: 'finalize', outcome: { status: 'completed', summary: 'All checks passed' } } });
  await bootstrapApp(page, { tasks: [task] });
  await page.route('http://127.0.0.1:3000/task-ledger', (route) => fulfillJson(route, { items: [entry], maxAutoAgents: 3 }));
  await page.route(`http://127.0.0.1:3000/tasks/${task.id}/logs?from=*`, (route) => fulfillJson(route, { entries: [] }));
  await page.route(`http://127.0.0.1:3000/tasks/${task.id}/stream`, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/#/task-ledger');
  await expect(page.getByRole('heading', { name: 'Shared work queue' })).toBeVisible();
  await page.getByLabel('Status').selectOption('all');
  await expect(page.getByText('All checks passed')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button', { name: /Standalone completed task/ }).click();
  await expect(page.locator('.headerGoal')).toHaveText('Standalone handoff thread');
  await expect(page).not.toHaveURL(/#\/task-ledger/);
});
