const { test, expect } = require('@playwright/test');
const {
  bootstrapApp,
  mockGetWorkflowSession,
  openLaunchModes
} = require('../fixtures/mockApi');

const workflow = {
  id: 'jira_to_repo_task',
  name: 'Jira to repo task',
  description: 'Collect issue and repository details before launching a thread.',
  supportsScheduling: true
};

const restoredSession = {
  id: 'session-restored-1',
  workflowId: workflow.id,
  workflowName: workflow.name,
  mode: 'interactive',
  updatedAt: '2026-03-01T12:01:00.000Z',
  canGoBack: true,
  currentStep: {
    id: 'details',
    type: 'form',
    title: 'Resume launch details',
    description: 'Continue the saved workflow without restarting.',
    submitAction: 'save_details',
    submitLabel: 'Continue',
    fields: [
      { id: 'issueKey', label: 'Issue key', type: 'text', required: true }
    ]
  }
};

test('restores the saved workflow session for the connected server', async ({ page }) => {
  await bootstrapApp(page, { workflows: [workflow] });
  await page.addInitScript(({ sessionId }) => {
    window.localStorage.setItem(
      'ender_workflow_sessions',
      JSON.stringify({ 'http://127.0.0.1:3000': sessionId })
    );
  }, { sessionId: restoredSession.id });
  await mockGetWorkflowSession(page, restoredSession);

  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /workflows/i }).click();

  await expect(page.locator('.workflowHero .launchTitle')).toHaveText('Resume launch details');
  await expect(page.getByLabel('Issue key')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change workflow' })).toBeVisible();
});
