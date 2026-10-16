import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'apps/web', plugins: [react()],
  resolve: { alias: { '@luypage/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)) } },
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: process.env.LUYPAGE_API_ORIGIN ?? 'http://127.0.0.1:8787' } } },
  build: { outDir: 'dist', emptyOutDir: true },
});
