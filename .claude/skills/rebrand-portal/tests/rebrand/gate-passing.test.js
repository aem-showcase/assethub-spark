import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { measuredColors, validateBrand } from '../../scripts/rebrand/brand-contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');
const EXTRACT = join(SKILL, 'scripts', 'rebrand', 'extract-brand.mjs');

/**
 * An age gate is a form, not a wall.
 *
 * The first version of this work halted on heineken.com and called that a
 * success, on the stated grounds that the CfDJ8… antiforgery tokens made the
 * gate impassable. That was half right: those tokens defeat a *forged POST*,
 * but they are already in the DOM, so driving the real form in the real browser
 * carries them. Filling country + DOB and clicking ENTER reaches
 * /in/en/home/ and yields real tokens (HeinekenSerif18 / PT Sans, navHeight 90px).
 *
 * "Halts correctly" is not the same as "gets the job done".
 */
describe('gate passing', () => {
  const src = readFileSync(EXTRACT, 'utf8');

  it('exports a gate-passing routine', () => {
    expect(src).toMatch(/export async function passInterstitials/);
  });

  it('is enabled by default, with an explicit opt-out', () => {
    expect(src).toMatch(/gateInteraction:\s*true/);
    expect(src).toMatch(/--no-gate-interaction/);
  });

  it('re-detects the gate AFTER interacting, so passing is never itself success', () => {
    // The ordering is the whole safety property: interaction may only ever turn
    // a halt into a real measurement, never a halt into a false pass.
    const interact = src.indexOf('gateActions = await passInterstitials');
    const detect = src.lastIndexOf('const gateSignals = detectGate(');
    expect(interact).toBeGreaterThan(-1);
    expect(detect).toBeGreaterThan(interact);
  });

  it('records what it did in provenance, so a measurement is auditable', () => {
    expect(src).toMatch(/gateInteraction: gateActions\.length \? gateActions : null/);
  });

  it('dismisses consent before the age form', () => {
    // A cookie overlay intercepts clicks on the age form underneath it.
    expect(src.indexOf('CONSENT_SELECTORS')).toBeLessThan(src.indexOf('AGE_CONFIRM_SELECTORS'));
  });

  it('calls the accent probe rather than merely evaluating it (trap 2)', () => {
    expect(src).toMatch(/\(\$\{ACCENT_FN\}\)\(\)/);
  });
});

/**
 * excat reports background/text/link/linkHover/light/dark only. Measured on the
 * real Heineken home page that is: white, grey, grey, and three empty strings.
 * The signature green (#13670b, dominant by ~70x) is on buttons, the header and
 * SVG fills — none of which excat samples.
 *
 * Without accents an operator has a lawful palette that cannot express the
 * brand, and the only way to ship the green is to invent it. That pressure is
 * what produced #D4AF37.
 */
describe('accents count as measured colour (I10)', () => {
  const heineken = {
    schemaVersion: 1,
    provenance: {
      sourceUrl: 'https://www.heineken.com/',
      finalUrl: 'https://www.heineken.com/in/en/home/',
      extractedAt: '2026-09-17T09:00:00.000Z',
      extractor: 'excat',
      gatePassed: true,
    },
    tokens: {
      colors: {
        background: 'rgb(255, 255, 255)', text: 'rgb(153, 153, 153)', link: 'rgb(100, 100, 100)', linkHover: null, light: '', dark: '',
      },
      accents: [
        { hex: '#13670b', weight: 658328, why: ['background', 'border'] },
        { hex: '#1b4677', weight: 9444, why: ['background'] },
      ],
      spacing: { navHeight: '90px', contentMaxWidth: '1920px' },
    },
    tokenMap: [],
  };

  it('includes accent hexes among the measured colours', () => {
    const m = measuredColors(heineken);
    expect(m).toContain('#13670b');
    expect(m).toContain('#ffffff');
  });

  it('still works when there are no accents', () => {
    expect(measuredColors({ tokens: { colors: { background: '#fff' } } })).toEqual(['#ffffff']);
  });

  it('ignores malformed accent entries instead of throwing', () => {
    const m = measuredColors({ tokens: { colors: {}, accents: [null, {}, { hex: 'nope' }, { hex: '#13670b' }] } });
    expect(m).toEqual(['#13670b']);
  });

  it('lets the MEASURED green ship', () => {
    const b = {
      ...heineken,
      tokenMap: [{
        role: 'link', cssVar: '--link-color', oldHex: '#111111', newHex: '#13670b', source: 'extracted',
      }],
    };
    expect(validateBrand(b).errors).toEqual([]);
  });

  it('still rejects a REMEMBERED green that was never measured', () => {
    // #008200 is the colour recall offers for Heineken. It is not on the page.
    const b = {
      ...heineken,
      tokenMap: [{
        role: 'link', cssVar: '--link-color', oldHex: '#111111', newHex: '#008200', source: 'extracted',
      }],
    };
    const { errors } = validateBrand(b);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/#008200 is not among the measured colours/);
  });

  it('allows a shade derived from a measured accent', () => {
    const b = {
      ...heineken,
      tokenMap: [{
        role: 'link', cssVar: '--link-color', oldHex: '#111', newHex: '#0d4a08', source: 'derived', derivedFrom: '#13670b',
      }],
    };
    expect(validateBrand(b).errors).toEqual([]);
  });
});
