const { test, expect } = require('@playwright/test');
const { bootstrapApp, openLaunchModes } = require('../fixtures/mockApi');

const workflows = [
  {
    id: 'jira_to_repo_task',
    name: 'Jira to repo task',
    description: 'Collect issue and repository details before launching a thread.',
    supportsScheduling: true
  }
];

const tasks = [
  {
    id: 'thread-12345678',
    goal: 'Review the release checklist and summarize blockers',
    workspace: '/Users/test/Ender/workspace/release-checklist',
    status: 'done',
    startedAt: '2026-03-01T09:00:00.000Z',
    finishedAt: '2026-03-01T09:15:00.000Z',
    logCount: 12,
    runCount: 1,
    pendingApprovalCount: 0
  }
];

const schedules = [
  {
    id: 'schedule-1',
    name: 'Morning triage',
    cron: '0 9 * * 1-5',
    timezone: 'America/Toronto',
    enabled: true,
    lastRunAt: '2026-03-01T14:00:00.000Z',
    lastRunStatus: 'done',
    lastRunMessage: 'Completed in 2m 14s',
    target: {
      kind: 'prompt',
      prompt: 'Summarize overnight alerts',
      workspace: '/Users/test/Ender/workspace/alerts'
    }
  }
];

test('renders the schedule editor and ledger', async ({ page }) => {
  await bootstrapApp(page, { tasks, workflows, schedules });

  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /schedules/i }).click();

  await expect(page.getByText('Create a recurring run')).toBeVisible();
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('Target type')).toBeVisible();
  await expect(page.getByText('Current schedules')).toBeVisible();
  await expect(page.getByText('Morning triage')).toBeVisible();
  await expect(page.locator('.automationOverview')).toHaveScreenshot('schedule-overview.png', {
    animations: 'disabled'
  });
  await expect(page.locator('.scheduleWorkspace')).toHaveScreenshot('schedule-panel.png', {
    animations: 'disabled',
    maxDiffPixels: 200
  });

  await page.getByLabel('Target type').selectOption('thread');
  await expect(page.getByRole('combobox', { name: /^Thread/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Resume prompt/ })).toBeVisible();
});
