// ESLint flat config. `npm run lint` runs `eslint .`; these blocks decide the scope.
//
// `typescript` in package.json is the TS 6 API (npm:@typescript/typescript6), which
// typescript-eslint reads; the build compiler is `@typescript/native` (TS 7). See
// CLAUDE.md, "Linting".
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { importX } from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import globals from 'globals';

export default tseslint.config(
  // Flat config reads no .gitignore and does not skip dot-directories, so everything a
  // workstation holds that CI does not is listed here, and both lint the same tree.
  // tests/*.ts are the legacy hand-run drivers and tests/archived-cdo-tests/ is dead code;
  // nothing in the gate runs either. Revisit when they are deleted or moved under
  // tests/integration/.
  {
    ignores: [
      'dist/',
      'coverage/',
      'examples/',
      'node_modules/',
      '.claude/',
      '.devdocs',
      '.devdocs/',
      'saved-forecasts/',
      'logs/',
      'tests/*.ts',
      'tests/archived-cdo-tests/',
    ],
  },

  // TypeScript. importX.flatConfigs.typescript is load-bearing: without its settings,
  // import-x cannot resolve a '.js' specifier to its '.ts' file, and no-cycle silently
  // reports nothing.
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.recommended, importX.flatConfigs.typescript],
    settings: { 'import-x/resolver-next': [createTypeScriptImportResolver()] },
    rules: { 'import-x/no-cycle': 'error' },
  },

  // stdout is the MCP transport. Everything in src/ logs through src/utils/logger.ts.
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },

  // The only files that may call console directly. Not `allow: ['error', 'warn']`: that
  // would also let a handler write to stderr past the logger's redaction.
  {
    files: [
      'src/utils/logger.ts', // the logger itself
      'src/index.ts', // the structured FATAL startup record, written beside the logger's line
      'src/config/tools.ts', // config parsing that runs before the logger exists
      'src/config/units.ts', // config parsing that runs before the logger exists
      'src/config/cache.ts', // config parsing that runs before the logger exists
    ],
    rules: { 'no-console': 'off' },
  },

  // Fakes cast to upstream shapes are the house pattern in tests/, and the gate does not
  // typecheck tests/ at all (GOTCHAS G103). Revisit when tests/ gains a tsconfig the gate runs.
  {
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Node CLIs; their output is stdout, so no no-console.
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
