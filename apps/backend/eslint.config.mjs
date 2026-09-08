// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const currentDir = decodeURIComponent(new URL('.', import.meta.url).pathname);

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: currentDir,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // Tests and manual mocks are built out of `jest.fn()` and untyped
    // fixtures: supertest's `res.body` is `any` by design, a partial mock is
    // cast into place rather than implemented, and a mock declared `async`
    // for signature parity rarely awaits anything. The assertions are the
    // type check here, so the type-safety family only produces noise.
    files: [
      'test/**/*.ts',
      'src/**/__tests__/**/*.ts',
      'src/**/*.spec.ts',
      'src/__mocks__/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      // `expect(obj.method).toHaveBeenCalled()` is the idiom, not a bug.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
