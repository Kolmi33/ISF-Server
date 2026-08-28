import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic modules run in Node; UI modules that need the DOM can opt into
    // 'jsdom' per-file via a `// @vitest-environment jsdom` docblock later.
    environment: 'node',
    include: ['{web,server,shared,test}/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['web/js/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['web/js/legacy.ts', '**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      // Thresholds activate in Phase 2, once core/ modules exist:
      //   'web/js/core/**': { lines: 90, branches: 85 }
    },
  },
});
