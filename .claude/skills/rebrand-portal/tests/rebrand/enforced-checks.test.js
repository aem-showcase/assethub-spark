import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');
const VERIFY = join(SKILL, 'scripts', 'rebrand', 'verify.mjs');
const HOOK = join(SKILL, 'hooks', 'guard-step5-verify-gate.sh');

/**
 * THE META-TEST.
 *
 * `stale-card-images` was written, tested, given its own eval, and merged — and
 * then gated nothing at all, because nobody added it to the hook's mandatory
 * list. The one document that mentioned it said "Skip". The defect it was built
 * to catch recurred on a later demo, with the same orphan pages.
 *
 * The failure was not the check. It was that a check could exist in a state
 * where no one had decided whether it blocks. This test removes that state:
 * every check verify.mjs can run must be either MANDATORY or explicitly WAIVED
 * with a reason, and adding a check without choosing fails the build.
 */

function dispatchedChecks() {
  const src = readFileSync(VERIFY, 'utf8');
  // The dispatch block is the authoritative list — it is what actually runs,
  // as opposed to what is exported or documented.
  return [...src.matchAll(/want\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
}

function hookSets() {
  const src = readFileSync(HOOK, 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!m) return [];
    return [...m[1].matchAll(/"([a-z0-9-]+)"\s*(?::|,|$)/gm)].map((x) => x[1]);
  };
  return { mandatory: grab('MANDATORY_CHECKS'), waived: grab('WAIVED_CHECKS') };
}

describe('every verify.mjs check is consciously gated or consciously waived', () => {
  it('finds the check list and both hook sets', () => {
    expect(dispatchedChecks().length).toBeGreaterThan(5);
    const { mandatory, waived } = hookSets();
    expect(mandatory.length).toBeGreaterThan(0);
    expect(waived.length).toBeGreaterThan(0);
  });

  it('classifies every dispatched check', () => {
    const checks = dispatchedChecks();
    const { mandatory, waived } = hookSets();
    const unclassified = checks.filter((c) => !mandatory.includes(c) && !waived.includes(c));
    expect(
      unclassified,
      `These verify.mjs checks are neither enforced nor explicitly waived, so they gate `
      + `nothing: ${unclassified.join(', ')}. Add each to MANDATORY_CHECKS in `
      + `hooks/guard-step5-verify-gate.sh, or to WAIVED_CHECKS with the reason it is safe `
      + `to skip. This is exactly how stale-card-images shipped and then caught nothing.`,
    ).toEqual([]);
  });

  it('never lists a check as both mandatory and waived', () => {
    const { mandatory, waived } = hookSets();
    expect(mandatory.filter((c) => waived.includes(c))).toEqual([]);
  });

  it('does not enforce a check that verify.mjs cannot run', () => {
    // A typo in the hook would silently block every Step 5 forever, because the
    // check would always be "missing" from the report.
    const checks = dispatchedChecks();
    const { mandatory } = hookSets();
    const unknown = mandatory.filter((c) => !checks.includes(c));
    expect(unknown, `Hook requires check(s) verify.mjs does not dispatch: ${unknown.join(', ')}`).toEqual([]);
  });

  it('enforces the checks that cover the three shipped defects', () => {
    // Regression lock on the specific gaps, so a future refactor cannot quietly
    // demote them to waived.
    const { mandatory } = hookSets();
    expect(mandatory).toContain('brand-fidelity');
    expect(mandatory).toContain('background-shorthand');
    expect(mandatory).toContain('stale-card-images');
    expect(mandatory).toContain('icon-render');
    expect(mandatory).toContain('access-json');
  });
});

describe('the Step 4g doc does not resurrect the circular gate', () => {
  it('no longer sources expected values from excat\'s own stylesheet edit', () => {
    const doc = readFileSync(join(SKILL, 'docs', 'step-4g-verification.md'), 'utf8');
    // The original instruction, which made expected == actual by construction.
    const circular = /Build the selector → expected-value map from excat's own edit\*\* —\n\s*not from any external fetch/;
    expect(circular.test(doc)).toBe(false);
  });

  it('points the expected values at the measured record instead', () => {
    const doc = readFileSync(join(SKILL, 'docs', 'step-4g-verification.md'), 'utf8');
    expect(doc).toMatch(/migration-work\/brand\.json/);
    expect(doc).toMatch(/must come from outside the artifact being checked/);
  });
});
