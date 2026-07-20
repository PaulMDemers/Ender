const { test, expect } = require('@playwright/test');
const { bootstrapApp, mockCreateWorkflowSession, openLaunchModes } = require('../fixtures/mockApi');

const readyWorkflow = {
  id: 'ready_workflow',
  name: 'Ready workflow',
  description: 'Collect validated inputs and start a task.',
  supportsScheduling: true
};

const blockedWorkflow = {
  id: 'blocked_workflow',
  name: 'Blocked workflow',
  description: 'Requires external credentials before it can run.',
  supportsScheduling: false
};

async function openWorkflows(page) {
  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /workflows/i }).click();
}

async function openSchedules(page) {
  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /schedules/i }).click();
}

test('reloads workflow discovery and explains server readiness before launch', async ({ page }) => {
  let listAttempts = 0;
  await bootstrapApp(page, {
    workflows: [],
    health: {
      workflows: {
        ready_workflow: { ready: true, missing: [] },
        blocked_workflow: { ready: false, missing: ['JIRA_BASE_URL', 'JIRA_API_TOKEN'] }
      }
    }
  });
  await page.route('http://127.0.0.1:3000/workflows', async (route) => {
    listAttempts += 1;
    if (listAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'Workflow catalog temporarily unavailable' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [readyWorkflow, blockedWorkflow] })
    });
  });

  await openWorkflows(page);
  const failure = page.getByRole('alert').filter({ hasText: 'Workflows could not load' });
  await expect(failure).toContainText('Workflow catalog temporarily unavailable');
  await failure.getByRole('button', { name: 'Reload workflows' }).click();

  await expect.poll(() => listAttempts).toBe(2);
  await expect(page.getByRole('button', { name: /ready workflow/i })).toBeEnabled();
  const blocked = page.getByRole('button', { name: /blocked workflow/i });
  await expect(blocked).toBeDisabled();
  await expect(blocked).toContainText('Needs setup');
  await expect(blocked).toContainText('JIRA_BASE_URL, JIRA_API_TOKEN');
});

test('retains a failed workflow step and retries the same structured input', async ({ page }) => {
  const session = {
    id: 'session-retry-1',
    workflowId: readyWorkflow.id,
    workflowName: readyWorkflow.name,
    status: 'active',
    mode: 'interactive',
    createdAt: '2026-07-18T12:00:00.000Z',
    updatedAt: '2026-07-18T12:00:00.000Z',
    startedTaskId: null,
    resumedFromDisk: false,
    canGoBack: false,
    bootstrapError: null,
    debug: [],
    currentStep: {
      id: 'pick-environment',
      type: 'select',
      title: 'Choose environment',
      description: 'Select the target environment.',
      options: [{ value: 'staging', label: 'Staging', description: 'Pre-production environment' }]
    }
  };
  const nextSession = {
    ...session,
    updatedAt: '2026-07-18T12:01:00.000Z',
    canGoBack: true,
    currentStep: {
      id: 'objective',
      type: 'form',
      title: 'Describe the objective',
      fields: [{ id: 'goal', label: 'Goal', type: 'textarea', required: true }]
    }
  };
  let advanceAttempts = 0;
  let latestPayload = null;
  await bootstrapApp(page, { workflows: [readyWorkflow] });
  await mockCreateWorkflowSession(page, readyWorkflow.id, session);
  await page.route(`http://127.0.0.1:3000/workflow-sessions/${session.id}/advance`, async (route) => {
    advanceAttempts += 1;
    latestPayload = route.request().postDataJSON();
    if (advanceAttempts === 1) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'Workflow provider timed out' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session: nextSession, startedTaskId: null })
    });
  });

  await openWorkflows(page);
  await page.getByRole('button', { name: /ready workflow/i }).click();
  await page.getByRole('button', { name: /staging/i }).click();

  const failure = page.getByRole('alert').filter({ hasText: 'Workflow step failed' });
  await expect(failure).toContainText('Workflow provider timed out');
  await failure.getByRole('button', { name: 'Retry step' }).click();
  await expect(page.getByLabel('Goal')).toBeVisible();
  expect(latestPayload).toMatchObject({ value: 'staging' });
  expect(advanceAttempts).toBe(2);
});

test('validates and retains a failed schedule create before retrying in place', async ({ page }) => {
  let createAttempts = 0;
  let schedules = [];
  await bootstrapApp(page, { schedules: [] });
  await page.route('http://127.0.0.1:3000/schedules', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: schedules }) });
      return;
    }
    createAttempts += 1;
    const payload = route.request().postDataJSON();
    if (createAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'Schedule store unavailable' })
      });
      return;
    }
    const created = {
      id: 'schedule-created-1',
      ...payload,
      createdAt: '2026-07-18T12:00:00.000Z',
      updatedAt: '2026-07-18T12:00:00.000Z',
      lastRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null
    };
    schedules = [created];
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
  });

  await openSchedules(page);
  await page.getByRole('button', { name: 'New schedule' }).click();
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByText('Add a name so operators can identify this schedule.')).toBeVisible();

  const name = page.getByLabel('Name');
  await name.fill('Nightly review');
  await page.getByLabel('Cadence').fill('invalid cron');
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Review overnight incidents.');
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByText('Enter a cron expression with five or six space-separated fields.')).toBeVisible();

  await page.getByLabel('Cadence').fill('0 2 * * *');
  await page.getByRole('button', { name: 'Create schedule' }).click();
  const failure = page.getByRole('alert').filter({ hasText: 'Schedule operation failed' });
  await expect(failure).toContainText('Schedule store unavailable');
  await expect(name).toHaveValue('Nightly review');
  await failure.getByRole('button', { name: 'Retry create' }).click();

  await expect.poll(() => createAttempts).toBe(2);
  await expect(page.getByText('Schedule created')).toBeVisible();
  await expect(page.getByText('Nightly review')).toBeVisible();
  await expect(name).toHaveCount(0);
});

test('recovers edit, run, and delete operations while refreshing persisted outcomes', async ({ page }) => {
  let updateAttempts = 0;
  let runAttempts = 0;
  let deleteAttempts = 0;
  let schedule = {
    id: 'schedule-ops-1',
    name: 'Release watch',
    cron: '0 * * * *',
    timezone: 'America/New_York',
    enabled: true,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T10:00:00.000Z',
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    target: { kind: 'prompt', prompt: 'Inspect release health.', workspace: null }
  };
  await bootstrapApp(page, { schedules: [schedule] });
  await page.route('http://127.0.0.1:3000/schedules', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: schedule ? [schedule] : [] })
    });
  });
  await page.route(`http://127.0.0.1:3000/schedules/${schedule.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      updateAttempts += 1;
      if (updateAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Update lock unavailable' }) });
        return;
      }
      schedule = { ...schedule, ...route.request().postDataJSON(), updatedAt: '2026-07-18T12:05:00.000Z' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(schedule) });
      return;
    }
    deleteAttempts += 1;
    if (deleteAttempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Delete lock unavailable' }) });
      return;
    }
    schedule = null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('http://127.0.0.1:3000/schedules/schedule-ops-1/run', async (route) => {
    runAttempts += 1;
    if (runAttempts === 1) {
      schedule = {
        ...schedule,
        lastRunAt: '2026-07-18T12:06:00.000Z',
        lastRunStatus: 'error',
        lastRunMessage: 'Provider quota exceeded'
      };
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Provider quota exceeded' }) });
      return;
    }
    schedule = {
      ...schedule,
      lastRunAt: '2026-07-18T12:07:00.000Z',
      lastRunStatus: 'ok',
      lastRunMessage: 'started task thread-release-1'
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'ok', message: schedule.lastRunMessage }) });
  });
  page.on('dialog', (dialog) => dialog.accept());

  await openSchedules(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  const name = page.getByLabel('Name');
  await name.fill('Release watch updated');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  let failure = page.getByRole('alert').filter({ hasText: 'Schedule operation failed' });
  await expect(failure).toContainText('Update lock unavailable');
  await expect(name).toHaveValue('Release watch updated');
  await failure.getByRole('button', { name: 'Retry update' }).click();
  await expect(page.getByText('Release watch updated')).toBeVisible();
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('button', { name: 'Enable' })).toBeVisible();

  await page.getByRole('button', { name: 'Run now' }).click();
  failure = page.getByRole('alert').filter({ hasText: 'Schedule operation failed' });
  await expect(failure).toContainText('Provider quota exceeded');
  await expect(page.getByText('Latest outcome').locator('..')).toContainText('Provider quota exceeded');
  await failure.getByRole('button', { name: 'Retry run' }).click();
  await expect(page.getByText('Schedule run started')).toBeVisible();
  await expect(page.getByText('Latest outcome').locator('..')).toContainText('started task thread-release-1');

  await page.getByRole('button', { name: 'Delete' }).click();
  failure = page.getByRole('alert').filter({ hasText: 'Schedule operation failed' });
  await expect(failure).toContainText('Delete lock unavailable');
  await failure.getByRole('button', { name: 'Retry delete' }).click();
  await expect(page.getByText('Schedule deleted')).toBeVisible();
  await expect(page.getByText('Release watch updated')).toHaveCount(0);
});

test('keeps schedule administration contained on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapApp(page, { schedules: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /schedules/i }).click();

  await expect(page.getByText('Recurring operations')).toBeVisible();
  await page.getByRole('button', { name: 'New schedule' }).click();
  await page.getByRole('button', { name: 'Show advanced options' }).click();
  await expect(page.getByLabel('Timezone')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
