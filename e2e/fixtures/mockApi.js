const { expect } = require('@playwright/test');

function jsonRoute(page, method, path, body, status = 200) {
  return page.route(`http://127.0.0.1:3000${path}`, async (route) => {
    if (route.request().method() !== method) {
      return route.fallback();
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

async function mockHealth(page, overrides = {}) {
  const body = {
    ok: true,
    services: {
      llm: { ready: true, missing: [] },
      browserCapture: { ready: true, detail: 'Chromium installed' },
      github: { ready: true, missing: [] },
      selfUpdate: { ready: true, rootDir: '/Users/test/Ender' }
    },
    workflows: {
      jira_to_repo_task: { ready: true, missing: [] }
    },
    setupHints: {
      selfUpdate: 'Supervisor connected'
    },
    paths: {
      workspaceRoot: '/Users/test/Ender/workspace'
    },
    ...overrides
  };
  await jsonRoute(page, 'GET', '/health', body);
}

async function mockTasks(page, items) {
  await jsonRoute(page, 'GET', '/tasks', { items });
}

async function mockTask(page, task) {
  await jsonRoute(page, 'GET', `/tasks/${task.id}`, task);
}

async function mockLogs(page, taskId, entries) {
  await page.route(`http://127.0.0.1:3000/tasks/${taskId}/logs?from=*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries })
    });
  });
}

async function mockStream(page, taskId) {
  await page.route(`http://127.0.0.1:3000/tasks/${taskId}/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ''
    });
  });
}

async function mockWorkflows(page, items) {
  await jsonRoute(page, 'GET', '/workflows', { items });
}

async function mockCreateWorkflowSession(page, workflowId, session) {
  await jsonRoute(page, 'POST', `/workflows/${workflowId}/sessions`, session);
}

async function mockGetWorkflowSession(page, session) {
  await jsonRoute(page, 'GET', `/workflow-sessions/${session.id}`, session);
}

async function mockAdvanceWorkflowSession(page, sessionId, responses) {
  let index = 0;
  await page.route(`http://127.0.0.1:3000/workflow-sessions/${sessionId}/advance`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

async function mockSchedules(page, items) {
  await jsonRoute(page, 'GET', '/schedules', { items });
}

async function mockCreateSchedule(page, response = { ok: true }) {
  await jsonRoute(page, 'POST', '/schedules', response);
}

async function bootstrapApp(page, options = {}) {
  await page.addInitScript(({ apiBase }) => {
    window.localStorage.setItem('ender_api_base', apiBase);
  }, { apiBase: 'http://127.0.0.1:3000' });

  await mockHealth(page, options.health);
  await mockTasks(page, options.tasks || []);
  await mockWorkflows(page, options.workflows || []);
  await mockSchedules(page, options.schedules || []);
}

async function openLaunchModes(page) {
  const toggle = page.getByRole('button', { name: /expand launch modes/i });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  await expect(page.getByRole('button', { name: /new thread/i })).toBeVisible();
}

module.exports = {
  bootstrapApp,
  mockCreateSchedule,
  mockCreateWorkflowSession,
  mockAdvanceWorkflowSession,
  mockGetWorkflowSession,
  mockHealth,
  mockLogs,
  mockSchedules,
  mockStream,
  mockTask,
  mockTasks,
  mockWorkflows,
  openLaunchModes
};
