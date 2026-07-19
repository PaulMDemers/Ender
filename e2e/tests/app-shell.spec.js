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

  const runSettings = page.getByRole('button', { name: 'Review run settings' });
  await expect(runSettings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Backend profile')).toHaveCount(0);
  await runSettings.click();
  const hideRunSettings = page.getByRole('button', { name: 'Hide run settings' });
  await expect(hideRunSettings).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Backend profile')).toBeVisible();
  await hideRunSettings.click();

  await expect(page).toHaveScreenshot('app-shell.png', { fullPage: true });
});

test('primary navigation exposes destinations and current-page state', async ({ page }) => {
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

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await skipLink.press('Enter');
  await expect(page.locator('#ender-main-content')).toBeFocused();

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('button')).toHaveCount(4);
  await expect(navigation.getByRole('button', { name: /new thread/i })).toHaveAttribute('aria-current', 'page');

  await navigation.getByRole('button', { name: /workflows/i }).click();
  await expect(navigation.getByRole('button', { name: /workflows/i })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: /new thread/i })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Ender' })).toBeVisible();
  await expect(page.getByText('Guided task launch')).toBeVisible();
});

test('mobile navigation opens and dismisses with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await bootstrapApp(page, { tasks: [] });

  await page.goto('/');

  const menuButton = page.getByRole('button', { name: 'Open navigation' });
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('complementary', { name: 'Ender navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /new thread/i })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton).toBeFocused();
});

test('disclosures expose state and controlled content', async ({ page }) => {
  const task = {
    id: 'thread-accessible-1',
    goal: 'Verify accessible disclosure controls',
    status: 'done',
    startedAt: '2026-03-01T09:00:00.000Z',
    finishedAt: '2026-03-01T09:05:00.000Z',
    logCount: 2,
    runCount: 1,
    pendingApprovalCount: 0
  };
  await bootstrapApp(page, { tasks: [task] });
  await page.goto('/');

  const serverDisclosure = page.getByRole('button', { name: 'Expand server details' });
  await expect(serverDisclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(serverDisclosure).toHaveAttribute('aria-controls', 'server-summary-details');
  await serverDisclosure.click();
  const collapseServer = page.getByRole('button', { name: 'Collapse server details' });
  await expect(collapseServer).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#server-summary-details')).toBeVisible();
  await collapseServer.click();
  await expect(page.locator('#server-summary-details')).toHaveCount(0);

  const threadDisclosure = page.getByRole('button', { name: 'Expand thread entry' });
  await expect(threadDisclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(threadDisclosure).toHaveAttribute('aria-controls', `thread-details-${task.id}`);
  await threadDisclosure.click();
  await expect(page.getByRole('button', { name: 'Collapse thread entry' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#thread-details-${task.id}`)).toBeVisible();
});

test('narrow layout keeps primary content inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapApp(page, { tasks: [] });
  await page.goto('/');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await expect(page.locator('#ender-main-content')).toBeVisible();
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
