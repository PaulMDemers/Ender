const { test, expect } = require('@playwright/test');
const { bootstrapApp } = require('../fixtures/mockApi');

test('launches from the focused objective flow while preserving disclosed run settings', async ({ page }) => {
  let launchPayload = null;
  await bootstrapApp(page, { tasks: [] });
  await page.route('http://127.0.0.1:3000/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    launchPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'thread-launched-1' })
    });
  });

  await page.goto('/');
  const settings = page.getByRole('button', { name: 'Review run settings' });
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await settings.click();
  await page.getByLabel('Memory loading').selectOption('manual');
  await page.getByRole('button', { name: 'Hide run settings' }).click();

  const mission = page.getByLabel(/Mission goal/);
  await mission.fill('Audit the release workflow and prepare a remediation plan.');
  await mission.press('Enter');

  await expect.poll(() => launchPayload).not.toBeNull();
  expect(launchPayload).toMatchObject({
    goal: 'Audit the release workflow and prepare a remediation plan.',
    workspace: '/Users/test/Ender/workspace',
    memoryMode: 'manual'
  });
  expect(launchPayload.llmProfileId).toBeTruthy();
  await expect(page.getByText('Audit the release workflow and prepare a remediation plan.').first()).toBeVisible();
});

test('selects any configured provider and model profile for a new thread', async ({ page }) => {
  let launchPayload = null;
  await bootstrapApp(page, { tasks: [] });
  await page.route('http://127.0.0.1:3000/llm-profiles', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        defaultProfileId: 'acp',
        items: [
          { id: 'acp', label: 'ACP default', backend: 'acp', ready: true, missing: [] },
          { id: 'openai', label: 'OpenAI · gpt-default', backend: 'openai', model: 'gpt-default', ready: true, missing: [] },
          { id: 'openai-gpt-review', label: 'OpenAI · gpt-review', backend: 'openai', model: 'gpt-review', ready: true, missing: [] }
        ]
      })
    });
  });
  await page.route('http://127.0.0.1:3000/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    launchPayload = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'thread-openai-1' }) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Review run settings' }).click();
  await expect(page.getByLabel('Backend profile').locator('option')).toHaveText([
    'ACP default',
    'OpenAI · gpt-default',
    'OpenAI · gpt-review'
  ]);
  await page.getByLabel('Backend profile').selectOption('openai-gpt-review');
  await expect(page.getByLabel('Backend profile')).toHaveValue('openai-gpt-review');
  await page.getByLabel(/Mission goal/).fill('Run this task with the OpenAI review model.');
  await page.getByRole('button', { name: 'Start task' }).click();

  await expect.poll(() => launchPayload).not.toBeNull();
  expect(launchPayload.llmProfileId).toBe('openai-gpt-review');
});

test('keeps a failed launch intact and exposes an explicit retry', async ({ page }) => {
  let launchAttempts = 0;
  let created = false;
  await bootstrapApp(page, { tasks: [] });
  await page.route('http://127.0.0.1:3000/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        services: { llm: { ready: false, missing: ['OPENAI_API_KEY'] }, codeServer: { ready: true } },
        workflows: {},
        setupHints: {},
        paths: { workspaceRoot: '/Users/test/Ender/workspace' }
      })
    });
  });
  await page.route('http://127.0.0.1:3000/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: created ? [{
            id: 'thread-retried-1',
            goal: 'Retry this launch without losing operator input.',
            status: 'running',
            startedAt: '2026-07-18T12:00:00.000Z',
            logCount: 0,
            runCount: 1,
            pendingApprovalCount: 0
          }] : []
        })
      });
      return;
    }
    if (route.request().method() !== 'POST') return route.fallback();
    launchAttempts += 1;
    if (launchAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'Task runtime unavailable' })
      });
      return;
    }
    created = true;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'thread-retried-1' })
    });
  });

  await page.goto('/');
  const mission = page.getByLabel(/Mission goal/);
  await mission.fill('Retry this launch without losing operator input.');
  await page.getByRole('button', { name: 'Start task' }).click();

  const failure = page.getByRole('alert').filter({ hasText: 'Task could not start' });
  await expect(failure).toContainText('OPENAI_API_KEY');
  await expect(mission).toHaveValue('Retry this launch without losing operator input.');
  await failure.getByRole('button', { name: 'Try again' }).click();

  await expect.poll(() => launchAttempts).toBe(2);
  await expect(failure).toHaveCount(0);
  await expect(page.getByText('Retry this launch without losing operator input.').first()).toBeVisible();
});

test('keeps project and workspace power behind the run-context disclosure', async ({ page }) => {
  let launchPayload = null;
  await bootstrapApp(page, { tasks: [] });
  await page.route('http://127.0.0.1:3000/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: 'release-project', name: 'Release project' }] })
    });
  });
  await page.route('http://127.0.0.1:3000/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    launchPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'thread-context-1' })
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Change run context' }).click();
  await page.getByLabel('Project').selectOption('release-project');
  await page.getByPlaceholder('/path/to/repo or project').fill('/Users/test/Ender/workspace/release');
  await page.getByRole('button', { name: 'Hide run context' }).click();
  await expect(page.getByText(/Release project · .*workspace\/release/)).toBeVisible();

  await page.getByLabel(/Mission goal/).fill('Prepare the release project.');
  await page.getByRole('button', { name: 'Start task' }).click();

  await expect.poll(() => launchPayload).not.toBeNull();
  expect(launchPayload).toMatchObject({
    goal: 'Prepare the release project.',
    projectId: 'release-project',
    workspace: '/Users/test/Ender/workspace/release'
  });
});
