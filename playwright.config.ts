import { defineConfig, devices } from '@playwright/test';
const stateDirectory = `.wrangler/e2e-state/${crypto.randomUUID()}`;
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:5183', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
  ],
  webServer: [
    { command: `pnpm exec wrangler d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to ${stateDirectory} && pnpm exec wrangler dev --local --config wrangler.local.jsonc --persist-to ${stateDirectory} --ip 127.0.0.1 --port 8797 --var APP_ORIGIN:http://127.0.0.1:5183`, url: 'http://127.0.0.1:8797/api/session', reuseExistingServer: false, timeout: 120_000 },
    { command: 'pnpm build && pnpm exec vite --host 127.0.0.1 --port 5183', env: { LUYPAGE_API_ORIGIN: 'http://127.0.0.1:8797' }, url: 'http://127.0.0.1:5183', reuseExistingServer: false },
  ],
});
