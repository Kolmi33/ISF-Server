import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config. The rules encode ARCHITECTURE.md §5 + §10 as machine checks.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'data/**',
      'backups/**',
      'public/**', // the legacy monolith is being replaced, not linted
      'src/**', // legacy backend (.mjs); converted + gated in Phase 6
      'web/js/legacy.ts', // quarantine: gate-excluded, burns down to zero by Phase 5
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // New source: the full standard.
  {
    files: ['{web,server,shared}/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      complexity: ['error', 12],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
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

  // Tests and config files are exempt from size/any budgets.
  {
    files: ['**/*.test.ts', '*.config.ts', '*.config.js', 'eslint.config.js'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
