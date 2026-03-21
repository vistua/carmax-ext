const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    headless: false,   // extensions require non-headless (or --headless=new)
    viewport: { width: 1280, height: 720 },
  },
  projects: [{
    name: 'chromium-extension',
    use: {
      channel: 'chromium',
    },
  }],
});
