const { test, expect } = require('@playwright/test');
const { bootstrapApp } = require('../fixtures/mockApi');

function parseColor(value) {
  const hex = String(value).trim().match(/^#([\da-f]{6})$/i);
  if (hex) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: 1
    };
  }
  const channels = String(value).match(/[\d.]+/g)?.map(Number) || [];
  return {
    r: channels[0] || 0,
    g: channels[1] || 0,
    b: channels[2] || 0,
    a: channels.length > 3 ? channels[3] : 1
  };
}

function composite(foreground, background) {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1
  };
}

function luminance(color) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test('core text and action colors retain accessible contrast', async ({ page }) => {
  await bootstrapApp(page, { tasks: [] });
  await page.goto('/');

  const colors = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: styles.getPropertyValue('--bg').trim(),
      ink: styles.getPropertyValue('--ink').trim(),
      muted: styles.getPropertyValue('--muted').trim(),
      mutedSoft: styles.getPropertyValue('--muted-soft').trim(),
      accent: styles.getPropertyValue('--accent').trim()
    };
  });
  const background = parseColor(colors.background);
  const mutedSoft = composite(parseColor(colors.mutedSoft), background);

  expect(contrast(parseColor(colors.ink), background)).toBeGreaterThanOrEqual(7);
  expect(contrast(parseColor(colors.muted), background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(mutedSoft, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(parseColor(colors.ink), parseColor(colors.accent))).toBeGreaterThanOrEqual(4.5);
});

test('keyboard focus remains visible and reduced motion removes meaningful transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootstrapApp(page, { tasks: [] });
  await page.goto('/');

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  const styles = await skipLink.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      outlineStyle: computed.outlineStyle,
      outlineWidth: Number.parseFloat(computed.outlineWidth),
      transitionSeconds: Math.max(...computed.transitionDuration.split(',').map((value) => Number.parseFloat(value) || 0))
    };
  });
  expect(styles.outlineStyle).toBe('solid');
  expect(styles.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(styles.transitionSeconds).toBeLessThanOrEqual(0.001);
  await skipLink.press('Enter');
  await expect(page.locator('#ender-main-content')).toBeFocused();
});

test('all primary workspaces remain contained at a 200 percent zoom equivalent', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await bootstrapApp(page, {
    tasks: [],
    workflows: [{ id: 'audit', name: 'Audit workflow', description: 'Review a repository safely.', supportsScheduling: true }]
  });
  await page.goto('/');

  for (const destination of ['Workflows', 'Schedules', 'Task ledger', 'New task']) {
    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    await menuButton.click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: new RegExp(destination, 'i') }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('#ender-main-content')).toBeVisible();
  }
});

test('narrow empty states preserve readable copy above their action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapApp(page, { tasks: [], schedules: [] });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Schedules' }).click();
  const notice = page.getByRole('status').filter({ hasText: 'No schedules yet' });
  const copyBox = await notice.locator('.stateNoticeCopy').boundingBox();
  const actionBox = await notice.getByRole('button', { name: 'Create first schedule' }).boundingBox();
  expect(actionBox.y).toBeGreaterThanOrEqual(copyBox.y + copyBox.height);
  expect(actionBox.width).toBeGreaterThanOrEqual(copyBox.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test.describe('coarse pointer controls', () => {
  test.use({ hasTouch: true });

  test('primary actions and compact controls expose touch-sized targets', async ({ page }) => {
    await bootstrapApp(page, { tasks: [] });
    await page.goto('/');

    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    const startBox = await page.getByRole('button', { name: 'Start task' }).boundingBox();
    const contextBox = await page.getByRole('button', { name: 'Change run context' }).boundingBox();
    expect(startBox.height).toBeGreaterThanOrEqual(44);
    expect(contextBox.height).toBeGreaterThanOrEqual(44);
  });
});
