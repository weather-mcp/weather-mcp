import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Scope collection to the tests tree. Without this, vitest falls back to
    // its default glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`), which reaches any
    // stray test file elsewhere in the repo — gitignored scratch directories
    // included, since a glob does not consult .gitignore. That silently inflates
    // the suite, and the test count is pinned in the README badge, the README
    // body, and CLAUDE.md, and checked against the live count by
    // ./scripts/check-doc-versions.sh.
    // `tests/**` deliberately keeps tests/integration/ in the default run.
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/tests/**',
      ],
    },
  },
});
