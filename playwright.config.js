// Playwright config (PR 8). The single HTML page is served statically;
// every test runs against this local server — no production dependency.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx serve . -l 4173 --no-clipboard',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
