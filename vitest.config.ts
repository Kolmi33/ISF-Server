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
      // not unit tests) — excluded like the legacy shim. shared/types.ts is type-only
      // (compiles to nothing) so there is no runtime to cover.
      exclude: ['web/js/app.ts', 'web/js/legacy.ts', 'shared/types.ts', '**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      // Armed from Phase 2 (ARCHITECTURE §10): pure core is pinned hard. The pure store
      // (Phase 3.1, §14 D6) is core-grade and held to the same floor.
      thresholds: {
        'web/js/core/**': { lines: 90, branches: 85 },
        'web/js/state.ts': { lines: 90, branches: 85 },
        // net/ pure bits (URL/body building, response normalization) are unit-tested via
        // an injected fetch (E4/E5); the live fetch/SSE wiring is browser-smoked.
        'web/js/net/**': { lines: 90, branches: 85 },
      },
    },
  },
});
