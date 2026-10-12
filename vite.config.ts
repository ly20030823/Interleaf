import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 1436, strictPort: true, watch: { ignored: ['**/src-tauri/**'] }, proxy: {
    '/translation/googleapi': { target: 'https://translate.googleapis.com', changeOrigin: true, rewrite: path => path.replace('/translation/googleapi', '/translate_a/single') },
    '/translation/google': { target: 'https://translate.google.com', changeOrigin: true, rewrite: path => path.replace('/translation/google', '/translate_a/single') },
  } },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
