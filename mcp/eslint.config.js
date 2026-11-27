// Added for Mistwarden on 2026-11-27.
// ESLint for the MCP server, with the backend's rules: no explicit `any`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/', 'coverage/', '**/*.js'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    name: 'mistwarden/mcp',
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
];
