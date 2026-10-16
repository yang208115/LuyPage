import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './apps/jobs/wrangler.jsonc' },
    miniflare: { bindings: { BACKGROUND_TEST_MIGRATIONS: await readD1Migrations('./packages/persistence/migrations') } },
  })],
  resolve: { tsconfigPaths: true },
  test: { include: ['packages/storage/src/**/*.workers.ts'], fileParallelism: false },
}));
