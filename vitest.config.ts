import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic modules run in Node; UI modules that need the DOM can opt into
    // 'jsdom' per-file via a `// @vitest-environment jsdom` docblock later.
    environment: 'node',
    include: ['{web,server,shared,test}/**/*.test.ts'],
    globals: true,
  },
});
