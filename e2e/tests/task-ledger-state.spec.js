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
    source: { kind: 'manual' },
    lifecycle: {},
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z',
    ...overrides
  };
}

test('creates a ledger entry and refreshes the domain collection', async ({ page }) => {
  let entries = [];
  await bootstrapApp(page);
  await page.route('http://127.0.0.1:3000/task-ledger', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      const created = ledgerEntry({ title: input.title || 'Untitled ledger entry', prompt: input.prompt });
      entries = [created];
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: entries })
    });
  });

  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /task ledger/i }).click();
  await expect(page.getByLabel('Title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show more options' }).click();
  await expect(page.getByLabel('Title')).toBeVisible();
  await page.getByLabel('Task Request').fill('Review the deployment notes and report blockers.');
  await page.getByRole('button', { name: 'Add to ledger' }).click();

  await expect(page.locator('.taskLedgerPromptPreview')).toHaveText('Review the deployment notes and report blockers.');
  await expect(page.getByText(/1 open · 0 finished · 1 total/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run now' })).toBeVisible();
});
