const { test, expect } = require('@playwright/test');
const { bootstrapApp, openLaunchModes } = require('../fixtures/mockApi');

test('renders the default app shell and launch modes', async ({ page }) => {
  await bootstrapApp(page, {
    tasks: [],
    workflows: [
      {
        id: 'jira_to_repo_task',
        name: 'Jira to repo task',
        description: 'Prepare a Jira issue and repository handoff.',
        supportsScheduling: true
      }
    ]
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ender' })).toBeVisible();
  await expect(page.getByText('Agent operations console')).toBeVisible();
  await expect(page.getByText('Current server')).toBeVisible();
  await expect(page.getByText('No threads on this server yet')).toBeVisible();

  await openLaunchModes(page);
  await expect(page.getByRole('button', { name: /new thread/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /workflows/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /schedules/i })).toBeVisible();
  await expect(page.getByText('Start a new task')).toBeVisible();

  await expect(page).toHaveScreenshot('app-shell.png', { fullPage: true });
});

test('renders the offline server picker before any backend is connected', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ender' })).toBeVisible();
  await expect(page.getByText('Offline-first server picker')).toBeVisible();
  await expect(page.getByText('Saved servers')).toBeVisible();
  await expect(page.getByRole('button', { name: /save and connect/i })).toBeVisible();
  await expect(page.getByText('This screen is bundled with the app')).toBeVisible();
});
