const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:14173',
    viewport: { width: 1440, height: 1024 },
    colorScheme: 'dark',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npm run start:test:api',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 120000
    },
    {
      command: 'npm run start:test:ui',
      url: 'http://127.0.0.1:14173',
      reuseExistingServer: false,
      timeout: 120000
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium'
      }
    }
  ]
});
