#!/usr/bin/env node
/**
 * brand-contract.mjs — the shape of `migration-work/brand.json`, plus the
 * loader/validator every other script reads it through.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Step 4g used to build its expected-value map "from excat's own edit to
 * styles/styles.css", on the stated premise that excat had already fetched the
 * source site and decided those values. When excat never ran (13/13 observed
 * runs abandoned its Step 1.2), that premise was false and the gate compared
 * styles.css against itself: expected == actual == whatever the agent invented.
 * It passed forever, including on the run that shipped a cream background and a
 * fabricated #D4AF37.
 *
 * brand.json is the independent source of truth that breaks that circle. It is
 * written ONCE by extract-brand.mjs directly from the rendered source site, and
 * is thereafter read-only input to verification. Nothing that verifies styles.css
 * may derive its expectations from styles.css.
 *
 * PROVENANCE IS THE POINT (invariant I10)
 * ---------------------------------------
 * Every colour that lands in the theme must trace back to something measured.
 * `tokenMap[].source` is how that is enforced mechanically:
 *   - "extracted" — newHex must appear among the measured `tokens.colors`.
 *   - "derived"   — newHex is a computed variant (tint/shade/contrast pick) and
 *                   MUST name the measured colour it came from in `derivedFrom`.
 * A colour that is neither is a fabrication, and validateBrand() rejects it.
 * This is what makes "don't invent brand colours" a check rather than advice.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEMA_VERSION = 1;

/** Path of the brand record, relative to a repo/worktree root. */
export function brandPath(repoRoot) {
  return join(repoRoot, 'migration-work', 'brand.json');
}

/** Path written instead of brand.json when extraction is rejected (gate/interstitial). */
export function rejectedBrandPath(repoRoot) {
  return join(repoRoot, 'migration-work', 'brand.rejected.json');
}

// ---- colour normalisation -------------------------------------------------
// excat returns computed styles, so colours arrive as `rgb(0, 44, 95)` /
// `rgba(...)`. Authored CSS uses `#002C5F`. Both must compare equal, or every
// fidelity check would fail on notation alone.

/** `rgb(0, 44, 95)` | `rgba(0,44,95,.5)` -> `#002c5f`. Returns null if unparseable. */
export function rgbToHex(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!m) return null;
  const part = (n) => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    return v.toString(16).padStart(2, '0');
  };
  const [r, g, b] = [part(m[1]), part(m[2]), part(m[3])];
  if (r === null || g === null || b === null) return null;
  return `#${r}${g}${b}`;
}

/**
 * Any CSS colour notation -> canonical lowercase `#rrggbb`.
 * Expands `#abc` shorthand; passes rgb()/rgba() through rgbToHex.
 * Returns null for keywords (`transparent`, `inherit`) and anything unrecognised —
 * callers must treat null as "not comparable", never as "no match".
 */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = v.match(/^#([0-9a-f]{6})$/);
  if (long) return `#${long[1]}`;
  return rgbToHex(v);
}

/**
 * Every textual form a hex may take in a stylesheet, so a grep for "did this
 * value land" cannot be defeated by notation. Covers `#rrggbb`, `#rgb` when
 * losslessly shortenable, and the `rgb(r g b)` / `rgb(r, g, b)` forms that
 * minifiers and `rgb(... / 8%)` alpha syntax produce.
 */
export function hexVariants(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return [];
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  const out = new Set([norm, norm.toUpperCase()]);
  if (norm[1] === norm[2] && norm[3] === norm[4] && norm[5] === norm[6]) {
    out.add(`#${norm[1]}${norm[3]}${norm[5]}`);
  }
  out.add(`rgb(${r}, ${g}, ${b})`);
  out.add(`rgb(${r} ${g} ${b})`);
  out.add(`rgba(${r}, ${g}, ${b}`);
  out.add(`rgb(${r} ${g} ${b} /`);
  return [...out];
}

/**
 * Collect every measured colour in a brand record, canonicalised.
 *
 * Includes `tokens.accents[]` as well as `tokens.colors`. excat samples only
 * background/text/link/linkHover/light/dark, which on a brand like Heineken is
 * white, grey, grey and three empties — the signature green lives on buttons,
 * the header and SVG fills. Accents are measured from the rendered page exactly
 * like the rest, so they are legitimate I10 provenance; excluding them would
 * leave an operator with a lawful palette that cannot express the brand, which
 * is precisely the pressure that produced a fabricated colour last time.
 */
export function measuredColors(brand) {
  const out = new Set();
  const colors = brand?.tokens?.colors;
  if (colors && typeof colors === 'object') {
    for (const raw of Object.values(colors)) {
      const hex = normalizeHex(raw);
      if (hex) out.add(hex);
    }
  }
  const accents = brand?.tokens?.accents;
  if (Array.isArray(accents)) {
    for (const a of accents) {
      const hex = normalizeHex(a && a.hex);
      if (hex) out.add(hex);
    }
  }
  return [...out];
}

// ---- validation -----------------------------------------------------------

const REQUIRED_PROVENANCE = ['sourceUrl', 'finalUrl', 'extractedAt', 'extractor', 'gatePassed'];

/**
 * Structural + provenance validation.
 * Returns { ok, errors } — never throws, so hooks can report rather than crash.
 *
 * `strict` (default true) additionally enforces I10: every tokenMap newHex is
 * either measured or explicitly derived from a measured colour.
 */
export function validateBrand(data, { strict = true } = {}) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['brand.json is not an object'] };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}, got ${JSON.stringify(data.schemaVersion)}`);
  }

  const p = data.provenance;
  if (!p || typeof p !== 'object') {
    errors.push('missing provenance block');
  } else {
    for (const k of REQUIRED_PROVENANCE) {
      if (p[k] === undefined || p[k] === null || p[k] === '') errors.push(`provenance.${k} is missing`);
    }
    if (p.gatePassed !== true && strict) {
      errors.push('provenance.gatePassed is not true — extraction was rejected or unverified');
    }
    if (p.extractedAt && Number.isNaN(Date.parse(p.extractedAt))) {
      errors.push(`provenance.extractedAt is not a valid date: ${p.extractedAt}`);
    }
  }

  const colors = data?.tokens?.colors;
  if (!colors || typeof colors !== 'object' || !Object.keys(colors).length) {
    errors.push('tokens.colors is missing or empty — nothing was measured');
  }

  if (!Array.isArray(data.tokenMap)) {
    errors.push('tokenMap must be an array');
  } else {
    const measured = measuredColors(data);
    data.tokenMap.forEach((e, i) => {
      const at = `tokenMap[${i}]`;
      if (!e || typeof e !== 'object') { errors.push(`${at} is not an object`); return; }
      if (!e.cssVar || !String(e.cssVar).startsWith('--')) {
        errors.push(`${at}.cssVar must be a CSS custom property name (--foo)`);
      }
      const newHex = normalizeHex(e.newHex);
      if (!newHex) { errors.push(`${at}.newHex is not a valid colour: ${JSON.stringify(e.newHex)}`); return; }
      if (e.oldHex && !normalizeHex(e.oldHex)) {
        errors.push(`${at}.oldHex is not a valid colour: ${JSON.stringify(e.oldHex)}`);
      }
      if (!strict) return;

      // I10 — provenance or it doesn't ship.
      if (e.source === 'extracted') {
        if (!measured.includes(newHex)) {
          errors.push(`${at} claims source "extracted" but ${newHex} is not among the measured colours (${measured.join(', ') || 'none'})`);
        }
      } else if (e.source === 'derived') {
        const from = normalizeHex(e.derivedFrom);
        if (!from) {
          errors.push(`${at} is "derived" but derivedFrom is missing or invalid — a derived colour must name the measured colour it came from (I10)`);
        } else if (!measured.includes(from)) {
          errors.push(`${at} is derived from ${from}, which was never measured (I10)`);
        }
      } else {
        errors.push(`${at}.source must be "extracted" or "derived", got ${JSON.stringify(e.source)} — an unprovenanced colour is a fabrication (I10)`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Read + validate in one step.
 * Returns { found, path, data, valid, errors }. Never throws.
 */
export function loadBrand(repoRoot, opts = {}) {
  const path = brandPath(repoRoot);
  if (!existsSync(path)) {
    return {
      found: false, path, data: null, valid: false, errors: ['migration-work/brand.json does not exist — brand extraction has not been run'],
    };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return {
      found: true, path, data: null, valid: false, errors: [`brand.json is not valid JSON: ${e.message}`],
    };
  }
  const { ok, errors } = validateBrand(data, opts);
  return {
    found: true, path, data, valid: ok, errors,
  };
}
