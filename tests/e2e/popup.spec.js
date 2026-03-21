'use strict';

const { test, expect } = require('./fixtures');

test.describe('Popup UI', () => {

  test('renders with zero count on fresh install', async ({ popup }) => {
    await expect(popup.locator('#totalCount')).toHaveText('0 авто');
  });

  test('scrape buttons are disabled on non-CarMax tab', async ({ popup }) => {
    await expect(popup.locator('#btnScrape')).toBeDisabled();
    await expect(popup.locator('#btnScrapeAll')).toBeDisabled();
  });

  test('export and clear buttons are disabled with no data', async ({ popup }) => {
    await expect(popup.locator('#btnExportCSV')).toBeDisabled();
    await expect(popup.locator('#btnExportJSON')).toBeDisabled();
    await expect(popup.locator('#btnClear')).toBeDisabled();
  });

  test('status shows error for non-CarMax tab', async ({ context, extensionId }) => {
    // Open a non-CarMax page first
    const tab = await context.newPage();
    await tab.goto('about:blank');

    // Then open popup — it should detect the wrong domain
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // Status dot should be in error state
    const dot = popup.locator('#statusDot');
    await expect(dot).toBeVisible();
    const cls = await dot.getAttribute('class');
    expect(cls).toContain('error');

    await tab.close();
    await popup.close();
  });

  test('filter input is visible and accepts text', async ({ popup }) => {
    const input = popup.locator('#filterInput');
    await expect(input).toBeVisible();
    await input.fill('Honda');
    await expect(input).toHaveValue('Honda');
  });

  test('carmaxError global is defined', async ({ popup }) => {
    const isDefined = await popup.evaluate(() => typeof window.carmaxError?.capture === 'function');
    expect(isDefined).toBe(true);
  });

});
