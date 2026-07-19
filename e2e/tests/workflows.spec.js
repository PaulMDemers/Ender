const { test, expect } = require('@playwright/test');
const {
  bootstrapApp,
  mockAdvanceWorkflowSession,
  mockCreateWorkflowSession,
  openLaunchModes
} = require('../fixtures/mockApi');

const workflow = {
  id: 'jira_to_repo_task',
  name: 'Jira to repo task',
  description: 'Collect issue and repository details before launching a thread.',
  supportsScheduling: true
};

const selectSession = {
  id: 'session-workflow-1',
  workflowId: workflow.id,
  workflowName: workflow.name,
  mode: 'interactive',
  updatedAt: '2026-03-01T12:00:00.000Z',
  canGoBack: false,
  currentStep: {
    id: 'pick-project',
    type: 'select',
    title: 'Choose a project',
    description: 'Select the Jira project to inspect.',
    selectAction: 'select_project',
    options: [
      {
        value: 'ENG',
        label: 'Engineering',
        description: 'Core platform backlog',
        meta: { team: 'platform' }
      },
      {
        value: 'OPS',
        label: 'Operations',
        description: 'Automation and support queue',
        meta: { team: 'ops' }
      }
    ],
    filters: [
      {
        id: 'team',
        label: 'Team',
        mode: 'client',
        options: [
          { value: 'all', label: 'All teams' },
          { value: 'platform', label: 'Platform' },
          { value: 'ops', label: 'Ops' }
        ]
      }
    ]
  }
};

const formSession = {
  session: {
    ...selectSession,
    updatedAt: '2026-03-01T12:01:00.000Z',
    canGoBack: true,
    currentStep: {
      id: 'details',
      type: 'form',
      title: 'Provide launch details',
      description: 'Capture the issue key and branch naming preferences.',
      submitAction: 'save_details',
      submitLabel: 'Continue',
      fields: [
        { id: 'issueKey', label: 'Issue key', type: 'text', required: true, placeholder: 'ENG-123' },
        { id: 'branchPrefix', label: 'Branch prefix', type: 'text', defaultValue: 'feature/' },
        { id: 'includeChecklist', label: 'Include checklist', type: 'checkbox', description: 'Attach rollout checklist' }
      ]
    }
  }
};

test('renders workflow list and advances through mocked steps', async ({ page }) => {
  await bootstrapApp(page, { workflows: [workflow] });
  await mockCreateWorkflowSession(page, workflow.id, selectSession);
  await mockAdvanceWorkflowSession(page, selectSession.id, [formSession]);

  await page.goto('/');
  await openLaunchModes(page);
  await page.getByRole('button', { name: /workflows/i }).click();

  await expect(page.getByText('Guided task launch')).toBeVisible();
  await expect(page.getByRole('button', { name: /jira to repo task/i })).toBeVisible();
  await expect(page.locator('.workflowList')).toHaveScreenshot('workflow-list.png');

  await page.getByRole('button', { name: /jira to repo task/i }).click();
  await expect(page.locator('.workflowHero .launchTitle')).toHaveText('Choose a project');
  await page.locator('.workflowConsole').screenshot({ path: 'test-results/workflow-select-state.png' });
  await expect(page.locator('.workflowConsole')).toHaveScreenshot('workflow-select-state.png');

  await page.getByLabel('Team').selectOption('platform');
  await page.getByRole('button', { name: /engineering/i }).click();

  await expect(page.locator('.workflowHero .launchTitle')).toHaveText('Provide launch details');
  await expect(page.getByLabel('Issue key')).toBeVisible();
  await expect(page.locator('.workflowConsole')).toHaveScreenshot('workflow-form-state.png');
});
