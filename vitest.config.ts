import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scope collection to the tests tree. Without this, vitest falls back to
    // its default glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`), which reaches any
    // stray test file elsewhere in the repo — gitignored scratch directories
    // included, since a glob does not consult .gitignore. That silently inflates
    // the suite, and the test count is pinned in the README badge, the README
    // body, and CLAUDE.md, and checked against the live count by
    // ./scripts/check-doc-versions.sh.
    // Bare `vitest run` runs both projects, so tests/integration/ stays in the
    // default run. `--project unit` is the guarded, offline set: every unit
    // file runs under tests/setup/no-network.ts, which refuses every outbound
    // socket. That is what CI runs.
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/no-network.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
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
