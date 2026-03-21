'use strict';

const { test: base, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../../dist/unpacked');

/**
 * Extended test fixture that launches Chrome with the unpacked extension loaded.
 * Usage:
 *   const { test, expect } = require('./fixtures');
 *   test('my test', async ({ context, extensionId, popup }) => { ... });
 */
exports.test = base.extend({
  // Persistent browser context with extension loaded
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    await use(ctx);
    await ctx.close();
  },

  // The extension ID derived from the running service worker
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = sw.url().split('/')[2];
    await use(id);
  },

  // A page with the extension popup open
  popup: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(page);
  },
});

exports.expect = base.expect;
