// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config. `tsconfigRootDir` is the repository root.
 * @param {{ tsconfigRootDir: string }} options
 */
export function ardoiseEslint({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/playwright-report/**',
        '**/test-results/**',
        'packages/db/migrations/**',
      ],
    },
    js.configs.recommended,
    {
      files: ['**/*.{ts,tsx}'],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      languageOptions: { globals: { ...globals.node } },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
      languageOptions: { globals: { ...globals.browser } },
      rules: {
        ...reactHooks.configs.recommended.rules,
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      },
    },
    {
      // shadcn/ui components are used as they are (PRODUCT §19).
      files: ['apps/web/src/components/ui/**'],
      rules: { 'react-refresh/only-export-components': 'off', 'react-hooks/purity': 'off' },
    },
    prettier,
  );
}
