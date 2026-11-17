import { defineConfig } from '@playwright/test';
import { getDevConfig, loadDevEnvironment } from './scripts/dev-config.mjs';

loadDevEnvironment();
const devConfig = getDevConfig();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: devConfig.testWebUrl,
    headless: true,
    acceptDownloads: true,
    serviceWorkers: 'block'
  },
  webServer: {
    command: `npm run dev:client -- --host 127.0.0.1 --port ${devConfig.testWebPort}`,
    url: devConfig.testWebUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
