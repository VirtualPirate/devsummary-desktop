import js from '@eslint/js'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const currentDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: currentDir,
      },
    },
  },
  {
    files: ['src/components/ui/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Vendored assistant-ui templates, written by `assistant-ui add` and updated
  // in place by re-running it. Same treatment as the shadcn components in
  // `ui/**`: local edits are restyling only, so their lint findings are not
  // ours to fix and would be overwritten on the next generator run. Anything we
  // author lives in `devsummary/agents/` and is linted normally.
  {
    files: ['src/components/assistant-ui/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/component-hook-factories': 'off',
      'react-hooks/static-components': 'off',
    },
  },
])
