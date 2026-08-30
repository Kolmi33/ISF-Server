import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic modules run in Node; UI modules that need the DOM can opt into
    // 'jsdom' per-file via a `// @vitest-environment jsdom` docblock later.
    environment: 'node',
    include: ['{web,server,shared,test}/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['web/js/**/*.{ts,tsx}', 'server/**/*.ts', 'shared/**/*.ts'],
      // app.ts is the boot/bridge entry (side effects, exercised by browser smoke,
      // not unit tests) — excluded like the legacy shim. shared/types.ts and
      // server/types.ts are type-only (compile to nothing). server/server.ts and
      // server/import.ts are the backend's impure entry shells (HTTP/SSE/backup and the
      // seed CLI) — run-verified (E5), not unit-covered, like app.ts.
      exclude: [
        'web/js/app.ts',
        'web/js/legacy.ts',
        'shared/types.ts',
        'server/types.ts',
        'server/server.ts',
        'server/import.ts',
        'server/backfill.ts',
        '**/*.test.{ts,tsx}',
      ],
      reporter: ['text', 'json-summary'],
      // Armed from Phase 2 (ARCHITECTURE §10): pure core is pinned hard. The pure store
      // (Phase 3.1, §14 D6) is core-grade and held to the same floor.
      thresholds: {
        // Repo-wide floor (Phase 5.3): every covered file — including a new top-level
        // module not matched by the layer globs below (e.g. a future `actions.ts`) — must
        // clear this. The layer entries stay explicit; the project standard remains 100%.
        lines: 90,
        branches: 85,
        'web/js/core/**': { lines: 90, branches: 85 },
        'web/js/state.ts': { lines: 90, branches: 85 },
        // net/ pure bits (URL/body building, response normalization) are unit-tested via
        // an injected fetch (E4/E5); the live fetch/SSE wiring is browser-smoked.
        'web/js/net/**': { lines: 90, branches: 85 },
        // ui/ pure model logic (cell classification, class stems, header/row builders) is
        // unit-tested; the DOM writes that consume it are browser-smoked (E5).
        'web/js/ui/**': { lines: 90, branches: 85 },
      },
    },
  },
});
