#!/usr/bin/env node
/**
 * capture-base.mjs — Read the base brand's CURRENT values from the unedited tree.
 *
 * Every residue/applied check in the rebrand skill needs to know what the base brand's
 * values are on THIS repo, right now — NOT a value frozen into a doc. The docs used to
 * hardcode `baseSlug=frescopa`, `baseSurfaceHex=#F4E9DC`, `#2f2318`, `234 163 58`, etc. as
 * "illustrative examples"; every new company (Workday, Apple, …) then tripped over a stale
 * literal or the agent ignored the "read from the tree" hedge. This script reads them at
 * runtime and writes a `baseBrand` block to .internal/onboarding-state.json, so the docs
 * reference state fields and never a literal. When the template's base brand changes, no doc
 * changes — this script reads whatever is there.
 *
 * Run FROM THE WORKTREE, BEFORE any Step 4b edit (the values must be the unedited base).
 *
 *   node .claude/skills/rebrand-portal/scripts/rebrand/capture-base.mjs [--repo-root <dir>] [--print]
 *
 * --repo-root  repo root (default: cwd resolved to the git toplevel or cwd).
 * --print      print the captured baseBrand JSON to stdout (also always written to state).
 *
 * Exit codes: 0 = captured + written; 1 = usage/read error (styles.css or icons missing).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function resolveRepoRoot(arg) {
  if (arg) return resolve(arg);
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

/** Read a `--token-name: <value>;` declaration's value from a CSS `:root` block. */
function readToken(css, name) {
  // Match the FIRST :root declaration of the token (the base default), tolerate whitespace.
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const m = css.match(re);
  return m ? m[1].trim() : null;
}

/** Read a `var(--name, <fallback>)` fallback literal, the first occurrence. */
function readVarFallback(css, name) {
  const re = new RegExp(`var\\(\\s*--${name}\\s*,\\s*([^)]+)\\)`);
  const m = css.match(re);
  return m ? m[1].trim() : null;
}

/** Derive the base brand slug from icon filenames (`<slug>-icon.svg` / `<slug>-beans.svg`). */
function readBaseSlug(iconsDir) {
  if (!existsSync(iconsDir)) return null;
  const files = readdirSync(iconsDir);
  // The brand marks are `<slug>-icon.svg` and `<slug>-beans.svg`; the generic UI icons
  // (copy-icon.svg, delete-icon.svg, …) also match `*-icon.svg`, so prefer the slug that
  // ALSO has a `-beans.svg` sibling (the login-panel mark is brand-only).
  const beans = files.find((f) => /^([a-z0-9-]+)-beans\.svg$/.test(f));
  if (beans) return beans.replace(/-beans\.svg$/, '');
  // Fallback: a `<slug>_logo.svg` file.
  const logo = files.find((f) => /^([a-z0-9-]+)_logo\.svg$/.test(f));
  if (logo) return logo.replace(/_logo\.svg$/, '');
  return null;
}

function main() {
  const args = process.argv.slice(2);
  let repoRootArg = null;
  let doPrint = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--repo-root') { repoRootArg = args[i + 1]; i += 1; }
    else if (args[i] === '--print') doPrint = true;
  }
  const repoRoot = resolveRepoRoot(repoRootArg);

  const stylesPath = join(repoRoot, 'styles', 'styles.css');
  if (!existsSync(stylesPath)) fail(`styles/styles.css not found under ${repoRoot}`);
  const css = readFileSync(stylesPath, 'utf8');

  const baseSlug = readBaseSlug(join(repoRoot, 'icons'));
  if (!baseSlug) fail('could not derive baseSlug from icons/ (no <slug>-beans.svg or <slug>_logo.svg)');

  // Named brand tokens (the ones the rebrand actually changes) — NOT every hex in :root.
  // Capturing named tokens (not all hexes) keeps neutral chrome (#fff, greys) out of the
  // residue sweep, so the old->new map never false-positives on non-brand colors.
  const tokens = {
    lightColor: readToken(css, 'light-color'),
    primaryColor: readToken(css, 'primary-color'),
    primaryColorHover: readToken(css, 'primary-color-hover'),
    secondaryColor: readToken(css, 'secondary-color'),
    textColor: readToken(css, 'text-color'),
    textPrimary: readToken(css, 'text-primary'),
    linkColor: readToken(css, 'link-color'),
    linkHoverColor: readToken(css, 'link-hover-color'),
    colorDarkRed: readToken(css, 'color-dark-red'),
    accentSecondary: readToken(css, 'accent-secondary'),
    accentTertiary: readToken(css, 'accent-tertiary'),
  };

  const welcomePanelBg = readVarFallback(css, 'welcome-panel-bg');
  const welcomePanelAccentRgb = readVarFallback(css, 'welcome-panel-accent-rgb');
  const navHeight = readToken(css, 'nav-height');

  // baseSurfaceHex — the dominant surface behind cards/hero. It is --light-color.
  const baseSurfaceHex = tokens.lightColor;

  // oldHexes — the distinct BRAND hex literals (from the named tokens + welcome panel),
  // the source of the residue sweep's old->new map. Deduped, uppercased for consistency.
  const oldHexes = [...new Set(
    [...Object.values(tokens), welcomePanelBg]
      .filter(Boolean)
      .flatMap((v) => (v.match(/#[0-9a-fA-F]{3,6}/g) || []))
      .map((h) => h.toUpperCase()),
  )];

  const baseBrand = {
    baseSlug,
    baseSurfaceHex,
    tokens,
    welcomePanelBg,
    welcomePanelAccentRgb,
    navHeight,
    oldHexes,
    capturedAt: new Date().toISOString(),
  };

  const statePath = join(repoRoot, '.internal', 'onboarding-state.json');
  if (!existsSync(statePath)) {
    fail(`.internal/onboarding-state.json not found under ${repoRoot} — run Steps 1-2 first`);
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  // baseBrand is additive; bump the schema so a consumer knows the block may be present.
  if (typeof state.schemaVersion === 'number' && state.schemaVersion < 5) {
    state.schemaVersion = 5;
  }
  state.baseBrand = baseBrand;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  process.stderr.write(
    `>> captured baseBrand: slug=${baseSlug}, surface=${baseSurfaceHex}, `
    + `${oldHexes.length} brand hex(es) -> ${statePath}\n`,
  );
  if (doPrint) process.stdout.write(`${JSON.stringify(baseBrand, null, 2)}\n`);
}

// Run only when invoked directly, not when imported by a test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

// Exported for tests (the reader helpers are the load-bearing logic).
export { readToken, readVarFallback, readBaseSlug };
