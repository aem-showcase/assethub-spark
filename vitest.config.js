// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use projects to define different configurations for different test types
    projects: [
      {
        // Configuration for DOM tests (*.dom.test.js)
        test: {
          name: 'dom-tests',
          include: [
            'scripts/**/__tests__/**/*.dom.test.js',
            'blocks/**/__tests__/**/*.dom.test.js',
          ],
          environment: 'jsdom',
          setupFiles: ['./vitest.dom.setup.js'],
        },
      },
      {
        // Configuration for regular tests (*.test.js, excluding *.dom.test.js)
        test: {
          name: 'unit-tests',
          include: [
            'scripts/**/__tests__/**/*.test.js',
            'blocks/**/__tests__/**/*.test.js',
          ],
          exclude: [
            'scripts/**/__tests__/**/*.dom.test.js',
            'blocks/**/__tests__/**/*.dom.test.js',
          ],
          environment: 'node',
        },
      },
      {
        // rebrand-portal skill tests. Separate from unit-tests because nearly
        // all of them spawn real OS processes -- guard hooks (bash + python3)
        // and packaged node scripts. Vitest's 5s default suits pure-JS tests;
        // for a suite whose unit of work is a process spawn it produces
        // load-dependent failures that look like product bugs and train people
        // to re-run until green.
        test: {
          name: 'skill-tests',
          include: [
            '.claude/skills/rebrand-portal/tests/assets/**/*.test.js',
            '.claude/skills/rebrand-portal/tests/rebrand/**/*.test.js',
            // Replays real session commands through the PreToolUse guards. A
            // guard that has never been run against a real command on a host is
            // indistinguishable from one that was never written.
            '.claude/skills/rebrand-portal/tests/hooks/**/*.test.js',
            // Adopts the tests/da and tests/hooks shell suites, which were
            // written but never included here and so never ran.
            '.claude/skills/rebrand-portal/tests/shell/**/*.test.js',
          ],
          exclude: [
            '.claude/skills/rebrand-portal/tests/assets/**/*.dom.test.js',
          ],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Integration / smoke tests – hit real endpoints with a session cookie
        test: {
          name: 'integration-tests',
          include: ['tests/integration/**/*.test.js'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 10_000,
        },
      },
      {
        // AuthZ tests – impersonate users via SUDO cookies to validate permission rules
        test: {
          name: 'authz-tests',
          include: ['tests/authz/**/*.test.js'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 10_000,
        },
      },
      {
        // Migration tests – unit tests for content stores migration scripts
        test: {
          name: 'migration-tests',
          include: ['migration/**/__tests__/**/*.test.js'],
          environment: 'node',
          testTimeout: 10_000,
        },
      },
    ],
  },
});
