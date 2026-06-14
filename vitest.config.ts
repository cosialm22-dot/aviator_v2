import { defineConfig } from 'vitest/config';

// Standalone Vitest config (takes precedence over vite.config.ts) so the unit
// suite runs without the app's Vite/React build plugins. Pure-logic modules are
// tested in a Node environment; type-only imports are erased by esbuild.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
