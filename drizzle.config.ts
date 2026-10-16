import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: './packages/persistence/src/schema.ts', out: './packages/persistence/generated', dialect: 'sqlite' });
