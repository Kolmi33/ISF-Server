import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic modules run in Node; UI modules that need the DOM can opt into
    // 'jsdom' per-file via a `// @vitest-environment jsdom` docblock later.
    environment: 'node',
    include: ['{web,server,shared,test}/**/*.test.ts'],
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['web/js/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts'],
      // app.ts is the boot/bridge entry (side effects, exercised by browser smoke,
      // not unit tests) — excluded like the legacy shim.
      exclude: ['web/js/app.ts', 'web/js/legacy.ts', '**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      // Armed from Phase 2 (ARCHITECTURE §10): pure core is pinned hard.
      thresholds: {
        'web/js/core/**': { lines: 90, branches: 85 },
      },
    },
  },
});
