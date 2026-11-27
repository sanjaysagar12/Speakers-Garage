import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const IGNORES = ['**/dist', '**/.perf-dist', '**/node_modules', '**/.generated', '**/perf-results', '**/pier-check', '**/shots', '**/public/assets'];

/**
 * The repo's single ESLint config. Each package's eslint.config.js calls this with its environment.
 * @param {{ browser?: boolean, node?: boolean, react?: boolean, ignores?: string[] }} opts
 */
export function speakersGarageEslint(opts = {}) {
  const env = { ...(opts.browser ? globals.browser : {}), ...(opts.node ? globals.node : {}) };
  return tseslint.config(
    { ignores: [...IGNORES, ...(opts.ignores ?? [])] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { globals: env },
      plugins: opts.react ? { 'react-hooks': reactHooks } : {},
      rules: {
        ...(opts.react ? { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } : {}),
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        // no deep relative imports across package boundaries: use the package name (@speakersgarage/shared)
        'no-restricted-imports': ['error', { patterns: [{ group: ['**/packages/*', '../../packages/**', '**/apps/*/src/**'], message: 'Import other workspace packages by name.' }] }],
      },
    },
  );
}
