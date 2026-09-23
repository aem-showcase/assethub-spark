import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkCascade } from '../../scripts/rebrand/verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');
const CASCADE = join(SKILL, 'scripts', 'rebrand', 'check-cascade.mjs');

function tmpReport(obj) {
  const d = mkdtempSync(join(tmpdir(), 'casc-'));
  const p = join(d, 'cascade-report.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

/**
 * The first live run of check-cascade.mjs measured ZERO surfaces and exited 4,
 * on a page where three of the landmarks were demonstrably present.
 *
 * Cause: PAINTED_BG_FN is a string holding an arrow-function *expression*.
 * Playwright treats a string first argument to page.evaluate() as an expression
 * to evaluate and silently ignores any extra argument, so the call returned a
 * function object (serialised as undefined) and never received the selector.
 * `if (!info) continue` then swallowed every landmark as "absent".
 *
 * This is the same trap already documented for excat's brand-extract.js. It came
 * back in our own file, so it gets a test rather than a comment.
 */
describe('check-cascade invokes its page function instead of merely evaluating it', () => {
  const raw = readFileSync(CASCADE, 'utf8');
  // Strip comments before matching. The first version of this test matched the
  // comment that *describes* the bug, so it failed on the fixed file — a source
  // scan that cannot tell code from prose is its own false signal.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  it('never passes the function string as a bare evaluate() argument', () => {
    expect(
      /page\.evaluate\(\s*PAINTED_BG_FN\s*,/.test(src),
      'page.evaluate(PAINTED_BG_FN, sel) ignores `sel` and returns undefined — '
      + 'wrap and call it instead.',
    ).toBe(false);
  });

  it('wraps the expression and calls it', () => {
    expect(src).toMatch(/\(\$\{PAINTED_BG_FN\}\)\(/);
  });

  it('treats an undefined probe result as a bug, not as an absent selector', () => {
    // Otherwise the next silent-return regression is indistinguishable from
    // "this landmark is not on the page", which is exactly how it hid.
    expect(src).toMatch(/info === undefined/);
  });

  it('refuses to run when there are no base hexes to compare against', () => {
    expect(src).toMatch(/oldHexes\.length/);
  });
});

describe('checkCascade rejects vacuous reports', () => {
  it('fails when the report has no surfaces', () => {
    const r = checkCascade(tmpReport({ baseHexes: ['#eba439'], surfaces: [] }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/no surfaces/);
  });

  it('fails when baseHexes is empty, even though every surface "passed"', () => {
    const r = checkCascade(tmpReport({
      baseHexes: [],
      surfaces: [
        { selector: 'body', computed: 'rgb(255, 255, 255)', pass: true },
        { selector: 'main', computed: 'rgb(255, 255, 255)', pass: true },
      ],
    }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/vacuously/);
  });

  it('fails when a surface still paints a base-brand colour', () => {
    const r = checkCascade(tmpReport({
      baseHexes: ['#eba439'],
      surfaces: [
        { selector: 'body', computed: 'rgb(255, 255, 255)', pass: true },
        {
          selector: 'main .section.category-tiles',
          computed: 'rgba(235, 164, 57, 0.08)',
          expected: 'anything but the base brand surface',
          pass: false,
          note: 'still painting the base brand colour #eba439',
        },
      ],
    }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/category-tiles/);
  });

  it('passes only when surfaces exist, base hexes exist, and all are correct', () => {
    const r = checkCascade(tmpReport({
      baseHexes: ['#eba439'],
      surfaces: [{ selector: 'body', computed: 'rgb(255, 255, 255)', pass: true }],
    }));
    expect(r.pass).toBe(true);
  });

  it('fails when the report is missing entirely', () => {
    expect(checkCascade(undefined).pass).toBe(false);
    expect(checkCascade('/nope/cascade-report.json').pass).toBe(false);
  });
});
