import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.local.jsonc' },
    miniflare: { r2Buckets: ['TEST_FILES'], bindings: { TEST_MIGRATIONS: await readD1Migrations('./packages/persistence/migrations') } },
  })],
  resolve: { tsconfigPaths: true },
  test: { include: ['tests/integration/**/*.test.ts'], setupFiles: ['./tests/integration/setup.ts'], fileParallelism: false },
}));
