const { test, expect } = require('@playwright/test');

async function routeJson(page, url, getResponse) {
  await page.route(url, async (route) => {
    const response = typeof getResponse === 'function' ? getResponse(route) : getResponse;
    await route.fulfill({
      status: response?.status || 200,
      contentType: 'application/json',
      headers: response?.headers || {},
      body: JSON.stringify(response?.body ?? response)
    });
  });
}

async function mockServer(page, baseUrl, options = {}) {
  await routeJson(page, `${baseUrl}/health`, () => {
    options.onHealthRequest?.();
    if (options.getHealthResponse) return options.getHealthResponse();
    return {
      ok: true,
      app: { name: 'Ender', version: options.serverVersion || '0.1.1' },
      backend: options.backend || 'acp',
      services: {
        apiAccess: options.apiAccess || { ready: true, mode: 'local', bindHost: '127.0.0.1', corsOrigins: [], remoteAccess: false },
        llm: { ready: true, missing: [] },
        browserCapture: { ready: true, detail: 'Chromium installed' },
        github: { ready: true, missing: [] },
        selfUpdate: { ready: true, rootDir: '/Users/test/Ender' },
        codeServer: { ready: true, mode: 'auto' },
        pillar: { ready: true, enabled: false, missing: [] },
        beacon: { ready: true, enabled: false, missing: [] }
      },
      workflows: { jira_to_repo_task: { ready: true, missing: [] } },
      setupHints: {},
      paths: { workspaceRoot: options.workspaceRoot || '/Users/test/Ender/workspace' }
    };
  });
  await routeJson(page, `${baseUrl}/tasks`, () => {
    options.onTaskRequest?.();
    return { items: options.tasks || [] };
  });
  await routeJson(page, `${baseUrl}/workflows`, { items: [] });
  await routeJson(page, `${baseUrl}/schedules`, { items: [] });
  await routeJson(page, `${baseUrl}/llm-profiles`, () => {
    options.onProfileRequest?.();
    return {
      items: options.getProfiles?.() || options.profiles || [],
      defaultProfileId: options.defaultProfileId || options.profiles?.[0]?.id || null
    };
  });
  await routeJson(page, `${baseUrl}/projects`, () => {
    options.onProjectRequest?.();
    return { items: options.getProjects?.() || options.projects || [] };
  });
}

test('contains modal focus, dismisses with Escape, and restores the opener', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  await page.addInitScript(({ endpoint }) => window.localStorage.setItem('ender_api_base', endpoint), { endpoint: baseUrl });
  await mockServer(page, baseUrl);

  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Switch Server' });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Server connections' });
  await expect(dialog.getByRole('button', { name: 'Close server modal' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('pauses background polling while hidden and refreshes immediately when visible', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  const requests = { health: 0, tasks: 0, profiles: 0, projects: 0 };

  await page.clock.install();
  await page.addInitScript(({ endpoint }) => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility
    });
    window.__setEnderTestVisibility = (nextVisibility) => {
      visibility = nextVisibility;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.localStorage.setItem('ender_api_base', endpoint);
  }, { endpoint: baseUrl });
  await mockServer(page, baseUrl, {
    onHealthRequest: () => { requests.health += 1; },
    onTaskRequest: () => { requests.tasks += 1; },
    onProfileRequest: () => { requests.profiles += 1; },
    onProjectRequest: () => { requests.projects += 1; },
    profiles: [{ id: 'default', label: 'Default profile', backend: 'acp' }]
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Review run settings' }).click();
  await expect(page.getByLabel('Backend profile')).toHaveValue('default');
  await expect.poll(() => requests.tasks).toBeGreaterThan(0);
  const beforeHidden = { ...requests };

  await page.evaluate(() => window.__setEnderTestVisibility('hidden'));
  await page.clock.fastForward(30000);
  expect(requests).toEqual(beforeHidden);

  await page.evaluate(() => window.__setEnderTestVisibility('visible'));
  await expect.poll(() => requests.health).toBeGreaterThan(beforeHidden.health);
  await expect.poll(() => requests.tasks).toBeGreaterThan(beforeHidden.tasks);
  await expect.poll(() => requests.profiles).toBeGreaterThan(beforeHidden.profiles);
  await expect.poll(() => requests.projects).toBeGreaterThan(beforeHidden.projects);
});

test('failed initial connection preserves saved servers and can return to idle', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  await page.addInitScript(({ endpoint }) => {
    window.localStorage.setItem('ender_api_base', endpoint);
    window.localStorage.setItem('ender_saved_servers', JSON.stringify([
      { name: 'Saved offline', endpoint, favorite: true, lastUsedAt: 1 }
    ]));
  }, { endpoint: baseUrl });

  let taskAttempts = 0;
  await routeJson(page, `${baseUrl}/tasks`, () => {
    taskAttempts += 1;
    return { status: 503, body: { ok: false, message: 'Endpoint unavailable' } };
  });
  await routeJson(page, `${baseUrl}/health`, { status: 503, body: { ok: false } });
  await routeJson(page, `${baseUrl}/llm-profiles`, { items: [] });
  await routeJson(page, `${baseUrl}/projects`, { items: [] });

  await page.goto('/');
  await expect(page.getByText('Connection failed')).toBeVisible();
  await expect(page.getByText('Endpoint unavailable')).toBeVisible();
  const savedRow = page.locator('.serverRow').filter({ hasText: 'Saved offline' });
  await expect(savedRow).toBeVisible();
  await expect(savedRow).toContainText('Unavailable');
  await page.getByRole('button', { name: 'Retry last target' }).click();
  await expect.poll(() => taskAttempts).toBeGreaterThan(1);

  await savedRow.getByRole('button', { name: 'Remove' }).click();
  await expect(savedRow).toHaveCount(0);
  await expect(page.getByText('This screen is bundled with the app')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('ender_api_base'))).toBeNull();
});

test('switching servers resets the shell and loads the new runtime catalogs', async ({ page }) => {
  const localUrl = 'http://127.0.0.1:3000';
  const remoteUrl = 'http://127.0.0.1:3001';
  await page.addInitScript(({ endpoint }) => {
    window.localStorage.setItem('ender_api_base', endpoint);
  }, { endpoint: localUrl });

  await mockServer(page, localUrl, {
    profiles: [{ id: 'local', label: 'Local profile', backend: 'acp' }],
    defaultProfileId: 'local'
  });
  await mockServer(page, remoteUrl, {
    workspaceRoot: '/srv/ender/workspace',
    profiles: [{ id: 'remote', label: 'Remote profile', backend: 'openai', model: 'gpt-test' }],
    defaultProfileId: 'remote',
    projects: [{ id: 'remote-project', name: 'Remote project' }]
  });

  await page.goto('/');
  await expect(page.getByText('Current server')).toBeVisible();
  await page.getByRole('button', { name: 'Switch Server' }).click();

  const dialog = page.getByRole('dialog', { name: 'Server connections' });
  await dialog.getByLabel('Friendly name').fill('Remote lab');
  await dialog.getByLabel('Base URL').fill(remoteUrl);
  await dialog.getByRole('button', { name: 'Save and connect' }).click();

  await expect(page.locator('.serverNameDisplay')).toHaveText('Remote lab');
  await expect(page.getByText(remoteUrl, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Review run settings' }).click();
  await expect(page.getByLabel('Backend profile')).toHaveValue('remote');
  await expect(page.locator('.launchField').filter({ hasText: /^Project/ }).locator('option', { hasText: 'Remote project' })).toHaveCount(1);

  const stored = await page.evaluate(() => ({
    active: window.localStorage.getItem('ender_api_base'),
    saved: JSON.parse(window.localStorage.getItem('ender_saved_servers') || '[]')
  }));
  expect(stored.active).toBe(remoteUrl);
  expect(stored.saved[0]).toMatchObject({ name: 'Remote lab', endpoint: remoteUrl });
});

test('health recovery refreshes tasks and periodic catalogs', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  let online = true;
  let taskRequests = 0;
  let catalogRevision = 1;

  await page.clock.install();
  await page.addInitScript(({ endpoint }) => {
    window.localStorage.setItem('ender_api_base', endpoint);
  }, { endpoint: baseUrl });
  await mockServer(page, baseUrl, {
    onTaskRequest: () => { taskRequests += 1; },
    getHealthResponse: () => (online
      ? { ok: true, services: {}, workflows: {}, setupHints: {}, paths: {} }
      : { status: 503, body: { ok: false } }),
    getProfiles: () => [{
      id: `profile-${catalogRevision}`,
      label: `Profile ${catalogRevision}`,
      backend: 'acp'
    }],
    getProjects: () => [{ id: `project-${catalogRevision}`, name: `Project ${catalogRevision}` }]
  });

  await page.goto('/');
  await expect(page.getByText('Current server')).toBeVisible();
  await page.getByRole('button', { name: 'Review run settings' }).click();
  await expect(page.getByLabel('Backend profile')).toHaveValue('profile-1');
  const requestsBeforeDisconnect = taskRequests;

  online = false;
  catalogRevision = 2;
  await page.clock.fastForward(15000);
  await expect(page.getByText('Connection lost')).toBeVisible();
  await expect(page.getByText('Server disconnected. Waiting to reconnect...')).toBeVisible();
  await expect(page.getByLabel('Backend profile')).toHaveValue('profile-2');

  online = true;
  await page.clock.fastForward(15000);
  await expect(page.getByText('Connection restored')).toBeVisible();
  await expect(page.getByText('Reconnected. Refreshing...')).toBeVisible();
  await expect.poll(() => taskRequests).toBeGreaterThan(requestsBeforeDisconnect);
});

test('validates server URLs in place without discarding the connection form', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/');

  await page.getByLabel('Friendly name').fill('Unsafe endpoint');
  await page.getByLabel('Base URL').fill('ftp://ender.example.com');
  await page.getByRole('button', { name: 'Save and connect' }).click();

  await expect(page.getByText('Server URL needs attention')).toBeVisible();
  await expect(page.getByText('Server URL must use http:// or https://')).toBeVisible();
  await expect(page.getByLabel('Friendly name')).toHaveValue('Unsafe endpoint');
  await expect(page.getByLabel('Base URL')).toHaveValue('ftp://ender.example.com');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('ender_api_base'))).toBeNull();
});

test('shows runtime, exposure, and newer-contract diagnostics in the connection manager', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  await page.addInitScript(({ endpoint }) => window.localStorage.setItem('ender_api_base', endpoint), { endpoint: baseUrl });
  await mockServer(page, baseUrl);
  await routeJson(page, `${baseUrl}/health`, {
    headers: { 'X-Ender-API-Version': '2', 'Access-Control-Expose-Headers': 'X-Ender-API-Version' },
    body: {
      ok: true,
      app: { name: 'Ender', version: '0.2.0' },
      backend: 'openai',
      paths: { workspaceRoot: '/srv/ender/workspace' },
      services: {
        apiAccess: { ready: true, mode: 'open', bindHost: '0.0.0.0', corsOrigins: [], remoteAccess: true },
        llm: { ready: true, backend: 'openai', missing: [] },
        browserCapture: { ready: true, detail: 'Chromium installed' },
        github: { ready: false, missing: ['GITHUB_TOKEN'] },
        selfUpdate: { ready: false, missing: ['ENDER_SUPERVISOR_URL'] },
        codeServer: { ready: true, mode: 'docker', missing: [] },
        pillar: { ready: false, enabled: true, missing: ['PILLAR_SERVER_TOKEN'] },
        beacon: { ready: true, enabled: false, missing: [] }
      },
      workflows: { jira_to_repo_task: { ready: false, missing: ['JIRA_API_TOKEN'], setupHint: 'Configure Jira credentials.' } },
      setupHints: {
        github: 'Set GITHUB_TOKEN for private repository access.',
        selfUpdate: 'Start Ender under the supervisor.',
        pillar: 'Configure PILLAR_SERVER_TOKEN for Pillar relay.',
        beacon: 'Beacon is optional.'
      }
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Switch Server' }).click();
  const dialog = page.getByRole('dialog', { name: 'Server connections' });
  await expect(dialog.getByText('UI 0.1.1 · server 0.2.0')).toBeVisible();
  await expect(dialog.getByText('API v2 newer')).toBeVisible();
  await expect(dialog.getByText('Newer server contract detected')).toBeVisible();
  await expect(dialog.getByText('Direct remote access enabled')).toBeVisible();
  await expect(dialog.getByText('Agent runtime')).toBeVisible();
  await expect(dialog.getByText('openai backend')).toBeVisible();
  await expect(dialog.getByText('Pillar relay', { exact: true })).toBeVisible();
  await expect(dialog.getByText('incomplete')).toBeVisible();
});

test('keeps last-known diagnostics through an outage and recovers with a manual health check', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  let online = true;
  const readyHealth = {
    ok: true,
    app: { name: 'Ender', version: '0.1.1' },
    backend: 'ollama',
    paths: { workspaceRoot: '/srv/ollama/workspace' },
    services: {
      apiAccess: { ready: true, mode: 'local', bindHost: '127.0.0.1', corsOrigins: [], remoteAccess: false },
      llm: { ready: true, backend: 'ollama', missing: [] },
      browserCapture: { ready: true, detail: 'Chromium installed' },
      github: { ready: true, missing: [] },
      selfUpdate: { ready: true, missing: [] },
      codeServer: { ready: true, mode: 'local', missing: [] },
      pillar: { ready: true, enabled: false, missing: [] },
      beacon: { ready: true, enabled: false, missing: [] }
    },
    workflows: { jira_to_repo_task: { ready: true, missing: [] } },
    setupHints: {}
  };
  await page.addInitScript(({ endpoint }) => window.localStorage.setItem('ender_api_base', endpoint), { endpoint: baseUrl });
  await mockServer(page, baseUrl);
  await routeJson(page, `${baseUrl}/health`, () => online
    ? { headers: { 'X-Ender-API-Version': '1', 'Access-Control-Expose-Headers': 'X-Ender-API-Version' }, body: readyHealth }
    : { status: 503, body: { ok: false, message: 'Health probe timed out' } });

  await page.goto('/');
  await page.getByRole('button', { name: 'Expand server details' }).click();
  const diagnostics = page.getByRole('region', { name: 'Server diagnostics' });
  await diagnostics.getByText('Runtime capabilities').click();
  await expect(diagnostics.getByText('ollama backend')).toBeVisible();

  online = false;
  await diagnostics.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText('Connection lost')).toBeVisible();
  await expect(diagnostics.getByText('Health check unavailable')).toBeVisible();
  await expect(diagnostics.getByText('last known snapshot')).toBeVisible();
  await expect(diagnostics.getByText('ollama backend')).toBeVisible();

  online = true;
  await diagnostics.getByRole('button', { name: 'Retry check' }).click();
  await expect(page.getByText('Connection restored')).toBeVisible();
  await expect(diagnostics.getByText('Health check unavailable')).toHaveCount(0);
  await expect(diagnostics.getByText('last known snapshot')).toHaveCount(0);
});

test('keeps connection diagnostics contained in the narrow server modal', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:3000';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ endpoint }) => window.localStorage.setItem('ender_api_base', endpoint), { endpoint: baseUrl });
  await mockServer(page, baseUrl);

  await page.goto('/');
  await page.getByRole('button', { name: 'Switch Server' }).click();
  await expect(page.getByRole('dialog', { name: 'Server connections' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByText('Runtime capabilities')).toBeVisible();
});
