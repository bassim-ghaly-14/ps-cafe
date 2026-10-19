import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Splash enforces a 3s minimum per full App mount; UI tests mount the app
    // (sometimes twice for reload scenarios), so allow generous per-test time.
    testTimeout: 25000,
    hookTimeout: 25000,
  },
});
