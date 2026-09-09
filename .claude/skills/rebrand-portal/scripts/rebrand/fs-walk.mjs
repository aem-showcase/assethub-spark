#!/usr/bin/env node
/**
 * fs-walk.mjs — shared recursive file walk + repo-wide hex capture for
 * capture-base.mjs and verify.mjs.
 *
 * Extracted so both scripts sweep the exact same file set with the exact same
 * exclusions and the exact same selector-lookup logic: a residue check that
 * derives its "current" hex snapshot differently than the one that captured
 * the baseline can't be trusted to compare like with like.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(p);
  }
  return acc;
}

/**
 * For a hex literal at `index` in `text`, find the selector of the nearest
 * enclosing `{...}` rule, or the nearest preceding `--custom-property:` name
 * if the hex sits inside a custom-property declaration rather than a rule
 * body. Regex-based nearest-brace lookup, not a CSS parser.
 */
export function nearestSelector(text, index) {
  const before = text.slice(0, index);
  const openIdx = before.lastIndexOf('{');
  const closeIdx = before.lastIndexOf('}');
  if (openIdx === -1 || openIdx < closeIdx) return null;
  const declMatch = before.slice(openIdx + 1).match(/(--[a-zA-Z0-9-]+)\s*:\s*[^;]*$/);
  if (declMatch) return declMatch[1];
  const selectorChunk = before.slice(0, openIdx);
  const lastSelector = selectorChunk.split(/[{}]/).pop().trim().split('\n').pop().trim();
  return lastSelector || null;
}

/**
 * Every hex literal in icons/*.svg, styles/*.css|scss, blocks/*.css|scss,
 * tagged with file (repo-relative) + nearest selector. This is the baseline
 * capture-base.mjs freezes into state, and the exact same derivation
 * verify.mjs's checkStructuralResidue re-runs post-rebrand to compare
 * like with like.
 */
export function captureAllBaseHexes(repoRoot) {
  const files = walk(join(repoRoot, 'icons'), ['.svg'])
    .concat(walk(join(repoRoot, 'styles'), ['.css', '.scss']))
    .concat(walk(join(repoRoot, 'blocks'), ['.css', '.scss']));
  const hexRe = /#[0-9a-fA-F]{3,6}\b/g;
  const entries = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const relFile = relative(repoRoot, file);
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = hexRe.exec(text)) !== null) {
      entries.push({
        hex: m[0].toUpperCase(),
        file: relFile,
        selector: nearestSelector(text, m.index),
      });
    }
  }
  return entries;
}
