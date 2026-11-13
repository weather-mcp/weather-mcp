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
    // Three projects. `unit` runs under tests/setup/no-network.ts, which refuses
    // every outbound socket. `integration` is offline too: it may open loopback
    // servers, and nothing else. `live` is the only project that reaches real
    // upstreams; it runs serially, with one retry and a timeout above the 55 s
    // tool budget plus the 10 s lightning window.
    //
    // `npm test` (and CI, and publish.yml) runs `--project unit --project
    // integration`. `npm run test:live` runs `--project live`. A bare
    // `vitest run` runs all three, live included, so use the npm scripts.
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
      {
        test: {
          name: 'live',
          globals: true,
          environment: 'node',
          include: ['tests/live/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
          retry: 1,
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
