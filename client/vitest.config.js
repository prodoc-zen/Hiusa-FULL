import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Dozens of jsdom workers start at once on a many-core machine, so heavy pages (and the
    // exceljs export tests) can outlast the 5s default without being wrong.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
