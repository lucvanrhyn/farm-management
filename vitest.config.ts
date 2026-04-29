import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Single-config per-file environments via the `@vitest-environment` docblock
 * at the top of each test file. Node is the default (fast); component tests
 * and parse-file/storage tests opt in to `jsdom` explicitly.
 *
 * setupFiles runs in every test file's environment — the polyfill inside is
 * a no-op when `globalThis.crypto.subtle` already exists (Node 20+), and the
 * jest-dom matcher registration is harmless in node too.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['__tests__/setup-jsdom.ts'],
    // Exclude git worktrees — sibling sessions may check out the repo into
    // `.worktrees/<name>/` (manual perf-foundation flow) or
    // `.claude/worktrees/agent-*/` (harness-created isolated agent worktrees).
    // Both can contain their own `__tests__/**` that would pollute the
    // main-branch run with duplicate/stale suites.
    // Also exclude vitest/ts defaults kept explicitly.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.worktrees/**',
      '**/.claude/worktrees/**',
      // Playwright specs use @playwright/test runner, not Vitest.
      // Run them separately with `pnpm smoke`.
      'e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: [
        'lib/onboarding/**/*.ts',
        'components/onboarding/**/*.tsx',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
