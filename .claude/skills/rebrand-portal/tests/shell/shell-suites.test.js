import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');

/**
 * The shell suites under tests/da and tests/hooks were written, committed, and
 * then never executed: vitest.config.js only ever included tests/assets and
 * tests/rebrand, and nothing else ran them either. A test that does not run is
 * indistinguishable from a test that does not exist — the same failure mode as
 * a verify check that nothing gates.
 *
 * This wrapper adopts them into the normal suite. It also asserts the
 * directories are non-empty, so deleting the last shell test cannot quietly
 * turn this file into a no-op that reports green.
 */
const SUITE_DIRS = ['da', 'hooks'];

function suites(dir) {
  const d = join(SKILL, 'tests', dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.test.sh')).map((f) => join(d, f));
}

describe('shell test suites', () => {
  for (const dir of SUITE_DIRS) {
    const found = suites(dir);

    it(`tests/${dir} contains at least one suite`, () => {
      expect(found.length, `no *.test.sh found in tests/${dir}`).toBeGreaterThan(0);
    });

    for (const file of found) {
      it(`${dir}/${file.split('/').pop()} passes`, () => {
        try {
          execFileSync('bash', [file], {
            encoding: 'utf8', stdio: 'pipe', timeout: 120_000, cwd: SKILL,
          });
        } catch (e) {
          // Surface the suite's own output — its failure messages are far more
          // useful than a bare non-zero exit.
          throw new Error(`${file} failed (exit ${e.status}):\n${e.stdout || ''}\n${e.stderr || ''}`);
        }
      }, 130_000);
    }
  }
});
