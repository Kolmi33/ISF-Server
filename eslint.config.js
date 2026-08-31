import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config. The rules encode ARCHITECTURE.md §5 + §10 as machine checks.
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'data/**', 'backups/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // New source: the full standard.
  {
    files: ['{web,server,shared}/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      complexity: ['error', 12],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },

  // React components (Phase 7, ARCHITECTURE §18): catches real bugs — a hook called
  // conditionally, or an effect/callback with a stale/missing dependency.
  {
    ...reactHooks.configs['recommended-latest'],
    files: ['web/js/**/*.tsx'],
  },

  // Pure core: no DOM, no I/O, no imports from side-effect layers.
  {
    files: ['web/js/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'core/ must stay DOM-free (ARCHITECTURE §5).' },
        { name: 'window', message: 'core/ must stay DOM-free (ARCHITECTURE §5).' },
        { name: 'navigator', message: 'core/ must stay DOM-free (ARCHITECTURE §5).' },
        { name: 'localStorage', message: 'core/ must stay DOM-free (ARCHITECTURE §5).' },
        { name: 'fetch', message: 'core/ must not do I/O (ARCHITECTURE §5).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/**', '**/net/**'], message: 'core/ must not import ui/ or net/.' },
          ],
        },
      ],
    },
  },

  // Net layer: the backend data client. May do I/O (fetch) and use DOM globals, but must
  // not reach up into the UI layer — dependency direction stays core → net → ui.
  {
    files: ['web/js/net/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['**/ui/**'], message: 'net/ must not import ui/.' }],
        },
      ],
    },
  },

  // Tests and config files are exempt from size/any budgets.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '*.config.ts', '*.config.js', 'eslint.config.js'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Dev-only Node scripts (e.g. the Playwright UI smoke driver, ARCHITECTURE §18) — plain
  // JS, so (unlike server/*.ts) typescript-eslint isn't managing `no-undef` for them.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
