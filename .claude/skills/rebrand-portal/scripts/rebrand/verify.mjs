#!/usr/bin/env node
/**
 * verify.mjs — Step 4g rebrand verification as EXECUTABLE checks, not prose.
 *
 * The 4g doc used to describe these checks in prose the agent could skip or that stated a
 * codebase fact that had drifted from reality (e.g. "the header logo CSS uses max-height"
 * when it was still fixed-width). Each check here reads the ACTUAL tree or live preview and
 * returns a hard pass/fail, using the base brand values captured by capture-base.mjs (from
 * state), never a hardcoded literal.
 *
 *   node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
 *     [--repo-root <dir>] [--preview <host>] [--company <companyKey>] \
 *     [--report <report.json>] [--only <check,check>] [--write-report <path.json>] \
 *     [--cascade-report <cascade-report.json>]
 *
 * Tree-only checks (no --preview needed): header-logo, residue, structural-residue,
 *   icon-reference-resolution, welcome-header-home-link, icon-render,
 *   background-shorthand, background-asset-fidelity, brand-fidelity
 *   (brand-fidelity also uses --preview when given).
 * Preview checks (need --preview + --company): nav-404-loop, applied-css, card-ceiling,
 *   access-json.
 * Report checks (need --report): stale-card-images, card-count, hero-quality.
 * Cascade check (needs --cascade-report): cascade.
 *
 * --write-report writes a JSON report ({ checkedAt, checkedCommit, results }) for
 * whatever ran, so hooks/guard-step5-verify-gate.sh has a structured, staleness-
 * checkable artifact to read instead of re-parsing stderr.
 *
 * Exit 0 = every applicable check passed; 1 = a check FAILED; 2 = usage/setup error.
 */
import {
  readFileSync, existsSync, readdirSync, writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { walk, captureAllBaseHexes } from './fs-walk.mjs';
import {
  loadBrand, measuredColors, normalizeHex, hexVariants,
} from './brand-contract.mjs';
import { MAX_CARDS } from '../assets/constants.js';

function resolveRepoRoot(arg) {
  if (arg) return resolve(arg);
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function loadBaseBrand(repoRoot) {
  const statePath = join(repoRoot, '.internal', 'onboarding-state.json');
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')).baseBrand || null;
  } catch {
    return null;
  }
}

// ---- CHECK: header-logo (tree) --------------------------------------------------
// Two live-shipped failure modes, both caught here by reading the ACTUAL rule:
//   1. Fixed `width` + `height: auto` with no max-height — renders a square-aspect
//      mark far taller than the header, spilling over the hero.
//   2. `width: auto` + `height: auto` (relying only on max-height) — inside the
//      nested inline-flex brand chain (nav-brand > a > span.icon > img) the image
//      has no definite height to resolve against and COLLAPSES to 0×0, so the logo
//      renders invisible (not broken — just gone). The fix that works is an
//      explicit non-auto `height` (e.g. calc(var(--nav-height) - N) or 100%),
//      typically with object-fit:contain. So a brand-logo img/svg rule MUST carry
//      an explicit non-auto height, not height:auto alone.
export function checkHeaderLogo(repoRoot) {
  const cssPath = join(repoRoot, 'blocks', 'header', 'header.css');
  if (!existsSync(cssPath)) return { name: 'header-logo', pass: false, reason: 'blocks/header/header.css not found' };
  const css = readFileSync(cssPath, 'utf8');
  // Extract the two brand-logo rule bodies.
  const targets = [
    /header nav \.nav-brand img\s*\{([^}]*)\}/,
    /header \.nav-brand \.icon img,\s*\n?\s*header \.nav-brand \.icon svg\s*\{([^}]*)\}/,
  ];
  const problems = [];
  for (const re of targets) {
    const m = css.match(re);
    if (!m) continue;
    const body = m[1];
    const hasFixedWidth = /(?:^|[;{\s])width\s*:\s*\d+px/.test(body);
    const hasMaxHeight = /max-height\s*:/.test(body);
    // Does the rule set an explicit, non-auto `height`? (e.g. calc(...), NNpx, 100%)
    const heightDecl = body.match(/(?:^|[;{\s])height\s*:\s*([^;}]+)/);
    const hasExplicitHeight = Boolean(heightDecl) && !/^\s*auto\s*$/i.test(heightDecl[1]);
    if (hasFixedWidth && !hasMaxHeight) {
      problems.push(`a brand-logo rule uses fixed width without max-height:\n${body.trim()}`);
    }
    if (!hasMaxHeight) {
      problems.push('a brand-logo rule has no max-height bound against --nav-height');
    }
    if (!hasExplicitHeight) {
      problems.push(
        'a brand-logo img/svg rule has no explicit non-auto height (height:auto alone '
        + 'collapses to 0×0 in the nested nav-brand flex chain — invisible logo, shipped live)',
      );
    }
  }
  if (problems.length) {
    return {
      name: 'header-logo',
      pass: false,
      reason: `${problems.join('; ')} — fix header.css: width:auto; max-width:<px>; `
        + 'height:calc(var(--nav-height) - N); max-height:calc(var(--nav-height) - N); object-fit:contain',
    };
  }
  return { name: 'header-logo', pass: true, reason: 'brand-logo rules bound by max-height and carry an explicit non-auto height' };
}

// ---- CHECK: residue (tree) ------------------------------------------------------
// Grep the captured old brand hexes + baseSlug across icons/, styles/, blocks/,
// scripts/analytics/. Any hit is un-rebranded residue.

// A hex like #58181D also survives as the decimal rgb() form the browser and
// many hand-authored rules use: `rgb(88 24 29 / 14%)` or `rgb(88, 24, 29)`. The
// plain `#rrggbb` grep misses those entirely (verified live: 15+ decimal-form
// survivors passed a clean residue run). Match both forms.
function hexToRgbTriplet(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = m[1];
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

// Build a matcher for one old hex that hits `#rrggbb` (any case) and the
// `rgb(r g b …)` / `rgb(r,g,b …)` decimal forms, tolerant of space/comma
// separators and an optional `/ alpha`. Anchored on the three components in
// order so it won't false-hit an unrelated number run.
function oldHexMatchers(hex) {
  const upper = hex.toUpperCase().startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
  const matchers = [{ label: upper, test: (upperText) => upperText.includes(upper) }];
  const rgb = hexToRgbTriplet(hex);
  if (rgb) {
    const [r, g, b] = rgb;
    const re = new RegExp(`rgba?\\(\\s*${r}\\s*[ ,]\\s*${g}\\s*[ ,]\\s*${b}\\b`, 'i');
    matchers.push({ label: `rgb(${r} ${g} ${b})`, test: (_u, rawText) => re.test(rawText) });
  }
  return matchers;
}

export function checkResidue(repoRoot, baseBrand) {
  if (!baseBrand) return { name: 'residue', pass: false, reason: 'no baseBrand in state — run capture-base.mjs first' };
  const dirs = ['icons', 'styles', 'blocks', join('scripts', 'analytics')].map((d) => join(repoRoot, d));
  const files = dirs.flatMap((d) => walk(d, ['.css', '.svg', '.js', '.scss']));
  const matchers = (baseBrand.oldHexes || []).flatMap((h) => oldHexMatchers(h));
  const slug = baseBrand.baseSlug;
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const upper = text.toUpperCase();
    for (const m of matchers) {
      if (m.test(upper, text)) hits.push(`${f}: old hex ${m.label}`);
    }
    // Strip the infra deploy host (e.g. 'frescopamedia.com') before the slug test —
    // it's the production domain baked into every checkout, not customer brand residue.
    const slugTestText = text.replace(/frescopamedia(?:\.com)?/gi, '');
    if (slug && new RegExp(slug, 'i').test(slugTestText)) hits.push(`${f}: baseSlug '${slug}'`);
  }
  if (hits.length) {
    return { name: 'residue', pass: false, reason: `${hits.length} residue hit(s):\n  ${hits.slice(0, 40).join('\n  ')}` };
  }
  return { name: 'residue', pass: true, reason: `no old-brand hex/slug (incl. rgb() form) in ${files.length} files` };
}

// ---- CHECK: structural-residue (tree) -------------------------------------------
// checkResidue only catches the 11 named :root tokens. capture-base.mjs also
// captures EVERY hex literal repo-wide (baseBrand.allBaseHexes), tagged by
// file+selector. Comparing "is this hex unchanged" across the WHOLE repo is
// too broad on its own — most of the repo's hexes are neutral UI chrome
// (#1E1E1E strokes, #707070/#333 greys, pure #FFF) that legitimately never
// change on any rebrand, and flagging all of them would flood every run with
// noise no agent could act on. So this check narrows the comparison to
// BRAND-ADJACENT FILES ONLY: a file qualifies if it contains at least one hex
// from baseBrand.oldHexes (the 11 named brand tokens) in EITHER the pre-capture
// baseline or the current tree — i.e. a file already known to carry brand
// color at all. Within a qualifying file, any hex that is byte-identical to
// the pre-capture baseline AT THE SAME selector is residue. This is exactly
// the Woolworths case: theme.css carries #00647D/#004d61 (named brand tokens,
// qualifying the file) alongside #003d4d (a one-off literal, never a named
// token, invisible to checkResidue) — once the file qualifies, #003d4d
// surviving unchanged is now caught.
function loadSemanticAllowlist(repoRoot) {
  const p = join(repoRoot, '.claude', 'skills', 'rebrand-portal', 'scripts', 'rebrand', 'semantic-color-allowlist.json');
  if (!existsSync(p)) return { selectorPatterns: [], filePatterns: [] };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return {
      selectorPatterns: (raw.selectorPatterns || []).map((s) => new RegExp(s, 'i')),
      filePatterns: (raw.filePatterns || []).map((s) => new RegExp(s, 'i')),
    };
  } catch {
    return { selectorPatterns: [], filePatterns: [] };
  }
}

function isAllowlisted(allowlist, file, selector) {
  if (allowlist.filePatterns.some((re) => re.test(file))) return true;
  if (selector && allowlist.selectorPatterns.some((re) => re.test(selector))) return true;
  return false;
}

export function checkStructuralResidue(repoRoot, baseBrand) {
  if (!baseBrand) {
    return { name: 'structural-residue', pass: false, reason: 'no baseBrand in state — run capture-base.mjs first' };
  }
  const baseline = baseBrand.allBaseHexes;
  if (!Array.isArray(baseline)) {
    return {
      name: 'structural-residue',
      pass: false,
      reason: 'no baseBrand.allBaseHexes in state — re-run capture-base.mjs (needs the repo-wide hex capture)',
    };
  }
  const namedBrandHexes = new Set((baseBrand.oldHexes || []).map((h) => h.toUpperCase()));
  if (namedBrandHexes.size === 0) {
    return {
      name: 'structural-residue',
      pass: false,
      reason: 'baseBrand.oldHexes is empty — cannot determine which files are brand-adjacent',
    };
  }
  const allowlist = loadSemanticAllowlist(repoRoot);
  const current = captureAllBaseHexes(repoRoot);

  // A file "qualifies" (is brand-adjacent) if it carries at least one named
  // brand hex, in either the baseline or the current tree.
  const qualifyingFiles = new Set();
  for (const entry of baseline) if (namedBrandHexes.has(entry.hex)) qualifyingFiles.add(entry.file);
  for (const entry of current) if (namedBrandHexes.has(entry.hex)) qualifyingFiles.add(entry.file);

  // Index the pre-capture baseline by "file::selector" -> Set(hex) for O(1) lookup.
  const byKey = new Map();
  for (const entry of baseline) {
    const key = `${entry.file}::${entry.selector || ''}`;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(entry.hex);
  }
  const hits = [];
  for (const entry of current) {
    if (!qualifyingFiles.has(entry.file)) continue;
    if (isAllowlisted(allowlist, entry.file, entry.selector)) continue;
    const key = `${entry.file}::${entry.selector || ''}`;
    const wasHere = byKey.get(key);
    if (wasHere && wasHere.has(entry.hex)) {
      hits.push(`${entry.file} (${entry.selector || 'top-level'}): unchanged old-brand hex ${entry.hex}`);
    }
  }
  if (hits.length) {
    return {
      name: 'structural-residue',
      pass: false,
      reason: `${hits.length} structural residue hit(s) in ${qualifyingFiles.size} brand-adjacent file(s) — a hex `
        + `at this file+selector matches the pre-rebrand baseline exactly and was never `
        + `changed:\n  ${hits.slice(0, 40).join('\n  ')}`,
    };
  }
  return {
    name: 'structural-residue',
    pass: true,
    reason: `no unchanged old-brand hex at any pre-captured file+selector across ${qualifyingFiles.size} brand-adjacent file(s)`,
  };
}

// ---- CHECK: icon-reference-resolution (tree) ------------------------------------
// No check today diffs CSS `url(/icons/...)` references against what actually
// exists in icons/. checkIconRender only validates ONE hardcoded file
// (icons/<company>-icon.svg). A referenced-but-missing icon (chevron-down.svg,
// image-placeholder.svg, cart-icon-failure.svg were exactly this — referenced
// in CSS, never present on disk) renders as a silently blank/broken icon.
export function checkIconReferenceResolution(repoRoot) {
  const iconsDir = join(repoRoot, 'icons');
  const existing = new Set(existsSync(iconsDir) ? readdirSync(iconsDir) : []);
  const files = walk(join(repoRoot, 'styles'), ['.css', '.scss'])
    .concat(walk(join(repoRoot, 'blocks'), ['.css', '.scss']));
  const urlRe = /url\(\s*['"]?\/icons\/([^'")\s]+)['"]?\s*\)/g;
  const missing = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = urlRe.exec(text)) !== null) {
      const iconFile = m[1];
      if (!existing.has(iconFile)) {
        missing.push(`${f}: references /icons/${iconFile} (not found in icons/)`);
      }
    }
  }
  if (missing.length) {
    return {
      name: 'icon-reference-resolution',
      pass: false,
      reason: `${missing.length} referenced-but-missing icon(s):\n  ${missing.slice(0, 40).join('\n  ')}`,
    };
  }
  return { name: 'icon-reference-resolution', pass: true, reason: `every CSS icon reference in ${files.length} files resolves to a file in icons/` };
}

// ---- CHECK: welcome-header-home-link (tree) -------------------------------------
// blocks/header/header.js's `getMetadata('header') === 'no'` minimal-header path
// (welcome/login pages) renders a raw template literal that historically hardcoded
// href="/" — never run through localizePath(), unlike every other link in this
// file. On a foldered demo (/companies/<company>/<locale>/...) a bare "/" does not
// resolve to the company's home even when the icon renders. checkResidue cannot
// reach this — "/" carries no brand hex or slug signature, so it's not residue.
export function checkWelcomeHeaderHomeLink(repoRoot) {
  const headerPath = join(repoRoot, 'blocks', 'header', 'header.js');
  if (!existsSync(headerPath)) {
    return { name: 'welcome-header-home-link', pass: false, reason: 'blocks/header/header.js not found' };
  }
  const js = readFileSync(headerPath, 'utf8');
  const anchor = js.indexOf("getMetadata('header') === 'no'");
  if (anchor === -1) {
    return {
      name: 'welcome-header-home-link',
      pass: false,
      reason: "header.js no longer has a getMetadata('header') === 'no' minimal-header path — "
        + 'update this check if the welcome-header mechanism moved, do not silently skip it',
    };
  }
  // The minimal-header block sets its home link's href a few lines after the anchor,
  // either as a template-literal attribute or via setAttribute — either form must
  // resolve through localizePath(), never a bare "/" literal (which does not land on
  // the company's home on a foldered /companies/<company>/<locale>/... demo).
  const block = js.slice(anchor, anchor + 800);
  const bareHrefPatterns = [
    /<a\s+href=(["'`])\/\1/, // <a href="/">
    /setAttribute\(\s*['"]href['"]\s*,\s*(["'`])\/\1\s*\)/, // .setAttribute('href', '/')
  ];
  if (bareHrefPatterns.some((re) => re.test(block))) {
    return {
      name: 'welcome-header-home-link',
      pass: false,
      reason: 'welcome-header home link is a bare "/" literal — never run through localizePath(), so it does not '
        + "resolve to the company's home on a foldered demo. Fix: localizePath('/').",
    };
  }
  if (!block.includes('localizePath')) {
    return {
      name: 'welcome-header-home-link',
      pass: false,
      reason: 'welcome-header block does not call localizePath() for its home link — '
        + "cannot confirm it resolves to the company's home on a foldered demo.",
    };
  }
  return { name: 'welcome-header-home-link', pass: true, reason: 'welcome-header home link resolves via localizePath(), not a bare "/" literal' };
}

// ---- CHECK: nav-404-loop (preview) ----------------------------------------------
// Request a deliberately-missing /<company>/... path; follow one hop; the 302 destination
// (the 404 page) must itself return 200, NOT another redirect to the same URL (a loop).
async function fetchNoRedirect(url) {
  return fetch(url, { redirect: 'manual' });
}

export async function checkNav404Loop(previewHost, company) {
  if (!previewHost || !company) {
    return { name: 'nav-404-loop', pass: false, reason: 'needs --preview and --company' };
  }
  const base = previewHost.startsWith('http') ? previewHost : `https://${previewHost}`;
  // Foldered demos are served under /companies/<company>/en/; probe there, not the flat
  // top-level /<company>/en/ (which 404s simply because nothing is served at the root, giving
  // a meaningless result for the real portal route).
  const missing = `${base}/companies/${company}/en/__definitely-missing-${Date.now()}`;
  try {
    const r1 = await fetchNoRedirect(missing);
    if (r1.status !== 302 && r1.status !== 301) {
      // Not redirected to a 404 page at all — either 404 directly (acceptable) or 200 (odd).
      if (r1.status === 404) return { name: 'nav-404-loop', pass: true, reason: 'missing path 404s directly (no redirect)' };
      return { name: 'nav-404-loop', pass: true, reason: `missing path returned ${r1.status} (no redirect chain)` };
    }
    const loc = r1.headers.get('location');
    if (!loc) return { name: 'nav-404-loop', pass: false, reason: '302 with no Location header' };
    const dest = new URL(loc, base).toString();
    const r2 = await fetchNoRedirect(dest);
    if ((r2.status === 301 || r2.status === 302)) {
      const loc2 = r2.headers.get('location');
      const dest2 = loc2 ? new URL(loc2, base).toString() : null;
      if (dest2 === dest) {
        return { name: 'nav-404-loop', pass: false, reason: `LOOP: 404 page ${dest} redirects to itself` };
      }
      // One more hop is tolerable (e.g. auth gate on the 404 page); flag but do not hard-fail
      // unless it loops. Report the chain for the operator.
      return { name: 'nav-404-loop', pass: true, reason: `404 page ${dest} -> ${dest2} (no self-loop)` };
    }
    if (r2.status === 200) return { name: 'nav-404-loop', pass: true, reason: `404 page ${dest} resolves 200` };
    return { name: 'nav-404-loop', pass: false, reason: `404 page ${dest} returned ${r2.status} (not 200) — likely unprovisioned` };
  } catch (e) {
    return { name: 'nav-404-loop', pass: false, reason: `fetch error: ${e.message}` };
  }
}

// ---- CHECK: applied-css (preview) -----------------------------------------------
// The deployed worker must serve the rebranded styles.css, and no captured base surface hex
// may survive in it. (Full computed-value checks need a browser; this asserts the SERVED CSS
// carries the new tokens and none of the old brand surface hexes — a strong, scriptable gate.)
export async function checkAppliedCss(previewHost, repoRoot, baseBrand) {
  if (!previewHost) return { name: 'applied-css', pass: false, reason: 'needs --preview' };
  if (!baseBrand) return { name: 'applied-css', pass: false, reason: 'no baseBrand in state' };
  const base = previewHost.startsWith('http') ? previewHost : `https://${previewHost}`;
  try {
    const res = await fetch(`${base}/styles/styles.css`, { headers: { 'accept-encoding': 'identity' } });
    if (!res.ok) return { name: 'applied-css', pass: false, reason: `served styles.css returned ${res.status}` };
    const served = (await res.text()).toUpperCase();
    const survivors = (baseBrand.oldHexes || [])
      .map((h) => h.toUpperCase())
      .filter((h) => served.includes(h));
    if (survivors.length) {
      return { name: 'applied-css', pass: false, reason: `served styles.css still carries old brand hex(es): ${survivors.join(', ')}` };
    }
    return { name: 'applied-css', pass: true, reason: 'served styles.css carries no old brand hex' };
  } catch (e) {
    return { name: 'applied-css', pass: false, reason: `fetch error: ${e.message}` };
  }
}

function previewBase(previewHost) {
  return previewHost.startsWith('http') ? previewHost : `https://${previewHost}`;
}

function accessJsonBase(previewHost) {
  const base = previewBase(previewHost);
  const url = new URL(base);
  const match = url.hostname.match(/^(.+)\.dev\.frescopamedia\.com$/);
  if (match) {
    return `https://${match[1]}--assethub-spark--aem-showcase.aem.page`;
  }
  return base;
}

function isSheetJson(json) {
  return json
    && typeof json === 'object'
    && Array.isArray(json.data)
    && (json[':type'] === 'sheet'
      || ['total', 'limit', 'offset'].some((key) => Object.hasOwn(json, key)));
}

function permissionList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function hasPreviewGrant(rows = []) {
  return rows.some((row) => permissionList(row.permissions).includes('preview'));
}

async function fetchAccessJson(url, fetchFn) {
  const res = await fetchFn(url, { redirect: 'manual' });
  if (!res.ok) {
    return { ok: false, reason: `${url} returned ${res.status}` };
  }
  try {
    const json = await res.json();
    if (!isSheetJson(json)) {
      return {
        ok: false,
        reason: `${url} is not an EDS sheet JSON response`,
      };
    }
    return { ok: true, json };
  } catch (e) {
    return { ok: false, reason: `${url} did not return parseable JSON: ${e.message}` };
  }
}

// ---- CHECK: access-json (preview) ----------------------------------------------
// Foldered demos authenticate through company-scoped access sheets, not root
// /config/access. DA Author showing the sheets is not enough; the worker reads the
// published .json endpoints from the branch AEM origin. The worker route itself protects
// /config/access, so this check intentionally reads the underlying origin JSON.
export async function checkAccessJson(previewHost, company, fetchFn = fetch) {
  if (!previewHost || !company) {
    return { name: 'access-json', pass: false, reason: 'needs --preview and --company' };
  }
  const base = accessJsonBase(previewHost);
  const prefix = `${base}/companies/${company}/config/access`;
  const applicationUrl = `${prefix}/application.json`;
  const usersUrl = `${prefix}/users.json`;

  try {
    const application = await fetchAccessJson(applicationUrl, fetchFn);
    if (!application.ok) return { name: 'access-json', pass: false, reason: application.reason };
    if (!hasPreviewGrant(application.json.data)) {
      return {
        name: 'access-json',
        pass: false,
        reason: `${applicationUrl} has no row granting preview permission`,
      };
    }

    const users = await fetchAccessJson(usersUrl, fetchFn);
    if (!users.ok) return { name: 'access-json', pass: false, reason: users.reason };

    return {
      name: 'access-json',
      pass: true,
      reason: 'company-scoped access application/users sheets are published as JSON and grant preview',
    };
  } catch (e) {
    return { name: 'access-json', pass: false, reason: `fetch error: ${e.message}` };
  }
}

// ---- CHECK: brand-fidelity (tree + optional preview) ----------------------------
// The check that had no equivalent before, and whose absence let the cream background ship.
//
// Every other colour check here is RESIDUE-shaped: "the old value is gone." That is a
// necessary condition and a badly insufficient one — a stylesheet where the old cream was
// deleted and nothing correct replaced it passes `residue` cleanly. What was never asserted
// is FIDELITY: "the new value is present, and it is the value that was actually measured
// from the source site."
//
// Expected values come from migration-work/brand.json — written by extract-brand.mjs
// straight from the rendered source — and NEVER from styles.css. That direction matters:
// the old 4g procedure read its expectations out of excat's edit to styles.css and then
// compared them against styles.css, so expected == actual by construction and the gate
// could not fail. Reading brand.json instead is what makes this a real comparison.
export async function checkBrandFidelity(repoRoot, previewHost) {
  const name = 'brand-fidelity';
  const loaded = loadBrand(repoRoot);
  if (!loaded.found || !loaded.valid) {
    return { name, pass: false, reason: `brand.json unusable — ${loaded.errors.join('; ')}` };
  }
  const brand = loaded.data;
  const map = brand.tokenMap || [];
  if (!map.length) {
    return {
      name,
      pass: false,
      reason: 'brand.json has an empty tokenMap — tokens were measured but never mapped to roles. '
        + 'Fill tokenMap[] (old->new->cssVar, with source "extracted" or "derived"+derivedFrom) in Step 4b.',
    };
  }

  const cssPath = join(repoRoot, 'styles', 'styles.css');
  if (!existsSync(cssPath)) return { name, pass: false, reason: 'styles/styles.css not found' };
  const local = readFileSync(cssPath, 'utf8');

  // 1. Every mapped variable must be declared with its measured value in the tree.
  const problems = [];
  for (const e of map) {
    const want = normalizeHex(e.newHex);
    const decl = new RegExp(`${e.cssVar.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`, 'i');
    const m = local.match(decl);
    if (!m) { problems.push(`${e.cssVar} is not declared in styles/styles.css`); continue; }
    const got = normalizeHex(m[1].trim());
    if (!got) {
      // A var() indirection is legitimate; only flag a literal that won't parse.
      if (!/var\(/i.test(m[1])) problems.push(`${e.cssVar} is ${m[1].trim()}, which is not a resolvable colour`);
      continue;
    }
    if (got !== want) {
      problems.push(`${e.cssVar} is ${got} but the source site measured ${want} (${e.role || 'unnamed role'})`);
    }
  }
  if (problems.length) {
    return { name, pass: false, reason: `theme does not match the measured source:\n  ${problems.join('\n  ')}` };
  }

  // 2. If a preview exists, the SERVED stylesheet must carry them too — a correct tree
  //    that never deployed looks identical to a correct deployment from the tree alone.
  if (previewHost) {
    const base = previewHost.startsWith('http') ? previewHost : `https://${previewHost}`;
    try {
      const res = await fetch(`${base}/styles/styles.css`, { headers: { 'accept-encoding': 'identity' } });
      if (!res.ok) return { name, pass: false, reason: `served styles.css returned ${res.status}` };
      const served = await res.text();
      const missing = map
        .filter((e) => !hexVariants(e.newHex).some((v) => served.includes(v)))
        .map((e) => `${e.cssVar}=${normalizeHex(e.newHex)}`);
      if (missing.length) {
        return {
          name,
          pass: false,
          reason: `served styles.css is missing measured value(s): ${missing.join(', ')} — the tree is right but the deploy is stale`,
        };
      }
    } catch (e) {
      return { name, pass: false, reason: `fetch error: ${e.message}` };
    }
  }

  const src = brand.provenance?.finalUrl || brand.provenance?.sourceUrl;
  return {
    name,
    pass: true,
    reason: `${map.length} token(s) match the values measured from ${src}${previewHost ? ', in the tree and as served' : ' (tree only — pass --preview to also check the deploy)'}`,
  };
}

// ---- CHECK: background-shorthand (tree) -----------------------------------------
// The exact mechanism behind the background that stayed cream, caught statically.
//
// `search-hero` and `category-tiles` are two classes on ONE element. `.section.search-hero`
// set a layered background (gradient tint + big.svg); `.section.category-tiles` later set the
// `background:` SHORTHAND. Equal specificity, later rule wins — and because it is the
// shorthand it resets background-image, -size, -position and every other layer, not just the
// colour. The tint and the SVG vanished and the base surface painted through.
//
// The tell is purely structural: a `background:` shorthand on a `.section.*` rule, where some
// other `.section.*` rule of equal specificity builds a layered background. No browser needed.
export function checkBackgroundShorthand(repoRoot) {
  const name = 'background-shorthand';
  const cssPath = join(repoRoot, 'styles', 'styles.css');
  if (!existsSync(cssPath)) return { name, pass: false, reason: 'styles/styles.css not found' };
  const css = readFileSync(cssPath, 'utf8');

  // selector { ...decls... } — good enough for a flat stylesheet; nested at-rules only
  // risk a missed detection, never a false positive.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }));

  const sectionRules = rules.filter((r) => /(^|,|\s)[.\w[\]="'-]*\.section\b/.test(r.selector));
  const layered = new Set();
  for (const r of sectionRules) {
    if (/background-image\s*:|background\s*:[^;]*(?:url\(|gradient\()/i.test(r.body)) layered.add(r.selector);
  }
  if (!layered.size) {
    return { name, pass: true, reason: 'no layered .section background to clobber' };
  }

  const offenders = [];
  for (const r of sectionRules) {
    // A shorthand that carries no image/gradient of its own resets every layer.
    const m = r.body.match(/(^|[;{\s])background\s*:\s*([^;]+);/i);
    if (!m) continue;
    if (/url\(|gradient\(/i.test(m[2])) continue;
    if (layered.has(r.selector)) continue;
    offenders.push(`${r.selector} { background: ${m[2].trim()} }`);
  }
  if (offenders.length) {
    return {
      name,
      pass: false,
      reason: 'background SHORTHAND on a .section rule resets the layered background set by '
        + `${[...layered].join(', ')} (equal specificity, later rule wins — this is how a `
        + 'surface silently reverts to the base colour). Use background-color instead:\n  '
        + offenders.join('\n  '),
    };
  }
  return { name, pass: true, reason: `${layered.size} layered .section background(s), none clobbered by a shorthand` };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function embeddedImageSha(svg) {
  const m = svg.match(/\b(?:xlink:href|href)=["']data:image\/[^;,]+;base64,([^"']+)["']/i);
  return m ? sha256(m[1]) : null;
}

function effectiveAssetHash(asset) {
  return asset?.embeddedImageSha256 || asset?.fileSha256 || null;
}

function currentBackgroundAsset(repoRoot, relPath) {
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  return {
    fileSha256: sha256(raw),
    embeddedImageSha256: embeddedImageSha(raw),
  };
}

function assetMapEntryMatches(entry, relPath) {
  return entry && typeof entry === 'object' && entry.path === relPath;
}

function derivedFromMeasured(entry, brand) {
  const measured = measuredColors(brand);
  const from = Array.isArray(entry.derivedFrom) ? entry.derivedFrom : [entry.derivedFrom];
  const normalized = from.map((v) => normalizeHex(v)).filter(Boolean);
  return normalized.length > 0 && normalized.every((hex) => measured.includes(hex));
}

export function checkBackgroundAssetFidelity(repoRoot, baseBrand) {
  const name = 'background-asset-fidelity';
  const relPath = 'styles/backgrounds/big.svg';
  const captured = baseBrand?.backgroundAssets?.[relPath];
  if (!captured || !effectiveAssetHash(captured)) {
    return {
      name,
      pass: false,
      reason: `${relPath} was not captured in baseBrand.backgroundAssets — rerun capture-base.mjs before Step 4 edits`,
    };
  }

  const current = currentBackgroundAsset(repoRoot, relPath);
  if (!current || !effectiveAssetHash(current)) {
    return { name, pass: false, reason: `${relPath} is missing or unreadable` };
  }

  if (effectiveAssetHash(current) === effectiveAssetHash(captured)) {
    return {
      name,
      pass: false,
      reason: `${relPath} still contains the captured base embedded image. Retint or replace the decorative background using measured colors from migration-work/brand.json, then record the mapping in brand.json assetMap[].`,
    };
  }

  const loaded = loadBrand(repoRoot);
  if (!loaded.found || !loaded.valid) {
    return { name, pass: false, reason: `brand.json unusable — ${loaded.errors.join('; ')}` };
  }

  const entry = (loaded.data.assetMap || []).find((e) => assetMapEntryMatches(e, relPath));
  if (!entry) {
    return {
      name,
      pass: false,
      reason: `${relPath} changed but migration-work/brand.json has no assetMap[] entry documenting the background derivation`,
    };
  }

  if (entry.source !== 'derived' && entry.source !== 'extracted') {
    return {
      name,
      pass: false,
      reason: `assetMap entry for ${relPath} must use source "derived" or "extracted", got ${JSON.stringify(entry.source)}`,
    };
  }

  if (!derivedFromMeasured(entry, loaded.data)) {
    return {
      name,
      pass: false,
      reason: `assetMap entry for ${relPath} must list derivedFrom color(s) measured in migration-work/brand.json tokens.colors or tokens.accents[]`,
    };
  }

  if (entry.oldEmbeddedImageSha256 && entry.oldEmbeddedImageSha256 !== captured.embeddedImageSha256) {
    return {
      name,
      pass: false,
      reason: `assetMap oldEmbeddedImageSha256 for ${relPath} does not match the captured base background hash`,
    };
  }

  if (entry.newEmbeddedImageSha256 && entry.newEmbeddedImageSha256 !== current.embeddedImageSha256) {
    return {
      name,
      pass: false,
      reason: `assetMap newEmbeddedImageSha256 for ${relPath} does not match the current background hash`,
    };
  }

  return {
    name,
    pass: true,
    reason: `${relPath} changed from the captured base asset and is documented in brand.json assetMap[]`,
  };
}

// ---- CHECK: cascade (reads cascade-report.json) ---------------------------------
// 4g has always demanded "read the actual computed value on the deployed preview", which
// verify.mjs could not do — it has no browser. That check was therefore never performed,
// while reading as though it were. check-cascade.mjs now performs it using the browser
// excat already ships, and this check gates on its result so the requirement is enforced
// rather than merely written down.
export function checkCascade(cascadeReportPath) {
  const name = 'cascade';
  if (!cascadeReportPath || !existsSync(cascadeReportPath)) {
    return {
      name,
      pass: false,
      reason: 'no cascade report — run scripts/rebrand/check-cascade.mjs --preview <host> --company <key> '
        + '--write-report .internal/cascade-report.json (it uses the browser bundled with excat)',
    };
  }
  let report;
  try { report = JSON.parse(readFileSync(cascadeReportPath, 'utf8')); } catch (e) {
    return { name, pass: false, reason: `bad cascade report json: ${e.message}` };
  }
  const surfaces = report.surfaces || [];
  if (!surfaces.length) return { name, pass: false, reason: 'cascade report contains no surfaces' };
  // A report produced with no base hexes cannot have failed: every surface is compared
  // against an empty set and trivially passes. Treat it as unusable rather than green.
  if (!(report.baseHexes || []).length) {
    return {
      name,
      pass: false,
      reason: 'cascade report has no baseHexes, so every surface passed vacuously — '
        + 're-run check-cascade.mjs after the base-brand capture step.',
    };
  }
  const bad = surfaces.filter((s) => !s.pass);
  if (bad.length) {
    return {
      name,
      pass: false,
      reason: `computed background wrong on ${bad.length} surface(s):\n  ${
        bad.map((s) => `${s.selector}: computed ${s.computed}, expected ${s.expected}${s.note ? ` (${s.note})` : ''}`).join('\n  ')}`,
    };
  }
  return { name, pass: true, reason: `${surfaces.length} rendered surface(s) match the measured brand` };
}

// ---- CHECK: stale-card-images (report) ------------------------------------------
// No published card image may point at a base-template asset (firefly_*, or any src not
// produced by this run's enrichment report). Guards the "Top Brands stale placeholder" case.
export function checkStaleCardImages(reportPath) {
  if (!reportPath || !existsSync(reportPath)) {
    return { name: 'stale-card-images', pass: false, reason: 'needs --report <report.json>' };
  }
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch (e) {
    return { name: 'stale-card-images', pass: false, reason: `bad report json: ${e.message}` };
  }
  const cards = report.cards || [];
  const stale = cards
    .map((c) => c.cardImageUrl || c.image || '')
    .filter((u) => /firefly_|gemini|reward-banner|north-roast|quiet-leaf|frescopa/i.test(u));
  if (stale.length) {
    return { name: 'stale-card-images', pass: false, reason: `stale base-template card image(s): ${stale.join(', ')}` };
  }
  return { name: 'stale-card-images', pass: true, reason: `${cards.length} card image(s) all run-produced` };
}

// ---- CHECK: icon-render (tree) --------------------------------------------------
// The header wordmark icon must actually RENDER when loaded as an <img> (which EDS icon
// shortcodes do). An SVG built from <text> renders blank there because the font does not
// load in the isolated <img> SVG context — it must carry drawable geometry (<path>, and a
// text-only wordmark with no path is the verified blank-logo trap). Step 4g item 5 already
// asserts the file EXISTS; existence is not rendering.
export function checkIconRender(repoRoot, company) {
  if (!company) return { name: 'icon-render', pass: false, reason: 'needs --company' };
  const iconPath = join(repoRoot, 'icons', `${company}-icon.svg`);
  if (!existsSync(iconPath)) {
    return { name: 'icon-render', pass: false, reason: `icons/${company}-icon.svg not found` };
  }
  const svg = readFileSync(iconPath, 'utf8');
  // A <text> element is the blank-render trap: it needs a font that does not load in the
  // isolated <img> SVG context, so the wordmark disappears. Decorative <rect>/<line> bars do
  // NOT redeem it — the actual letterforms are the text. Any <text> in a wordmark icon fails;
  // the fix is vector letterform <path>s (or embedding the real logo asset), not adding shapes
  // around the text. An <image> href (embedded raster logo) is fine, as is a pure-<path> mark.
  if (/<text\b/i.test(svg)) {
    return {
      name: 'icon-render',
      pass: false,
      reason: `icons/${company}-icon.svg renders its wordmark with <text> — blank as an <img> (font not loaded). Regenerate the letterforms as vector <path> outlines, or embed the real logo.`,
    };
  }
  const hasDrawableGeometry = /<(?:path|polygon|polyline|circle|ellipse|image)\b/i.test(svg);
  if (!hasDrawableGeometry) {
    return { name: 'icon-render', pass: false, reason: `icons/${company}-icon.svg has no drawable geometry (no <path>/<image>) — nothing to render` };
  }
  return { name: 'icon-render', pass: true, reason: `icons/${company}-icon.svg carries drawable vector geometry (no <text>)` };
}

// ---- CHECK: card-count (report) -------------------------------------------------
// Every source-derived contract category must render as a card in the carousel, each with an
// image and a facet link. Guards the "only 4 of 6 categories show / the rest got carved into
// a stale Top Brands section" failure: report.cards must cover every category the enrichment
// found, and no card may be missing its href or image.
export function checkCardCount(reportPath) {
  if (!reportPath || !existsSync(reportPath)) {
    return { name: 'card-count', pass: false, reason: 'needs --report <report.json>' };
  }
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch (e) {
    return { name: 'card-count', pass: false, reason: `bad report json: ${e.message}` };
  }
  const cards = report.cards || [];
  const covered = ((report.categoryCoverage || {}).categories || [])
    .filter((c) => (c.assetCount || 0) > 0);
  if (covered.length && cards.length < covered.length) {
    const cardSlugs = new Set(cards.map((c) => c.slug));
    const dropped = covered.map((c) => c.slug).filter((s) => !cardSlugs.has(s));
    return {
      name: 'card-count',
      pass: false,
      reason: `${cards.length} card(s) but ${covered.length} populated categor(ies) — missing card(s) for: ${dropped.join(', ')}. All contract categories belong in the carousel, not a secondary section.`,
    };
  }
  const brokenCards = cards.filter((c) => !c.href || !(c.cardImageUrl || c.image));
  if (brokenCards.length) {
    return {
      name: 'card-count',
      pass: false,
      reason: `${brokenCards.length} card(s) missing href or image: ${brokenCards.map((c) => c.slug).join(', ')}`,
    };
  }
  if (cards.length > MAX_CARDS) {
    return {
      name: 'card-count',
      pass: false,
      reason: `${cards.length} card(s); the demo carries exactly ${MAX_CARDS} categories. Narrow the contract to the strongest categories rather than widening the page.`,
    };
  }
  return { name: 'card-count', pass: true, reason: `${cards.length} card(s), one per populated category, all with href + image` };
}

// ---- CHECK: card-ceiling (preview) ----------------------------------------------
// The ceiling asserted against the DELIVERED ARTIFACT rather than the run's own report.
//
// Every previous card check read report.json — the file the run writes about itself. A run
// that authored the page by some other route (hand-edited HTML, an ad-hoc script, raw curl)
// produces a report that says nothing about what actually shipped. `stale-card-images`
// shipped twice for exactly this reason. This check fetches the published page and counts
// what a visitor sees.
export async function checkCardCeiling(previewHost, company) {
  if (!previewHost || !company) {
    return { name: 'card-ceiling', pass: false, reason: 'needs --preview and --company' };
  }
  const base = previewHost.startsWith('http') ? previewHost : `https://${previewHost}`;
  const url = `${base}/companies/${company}/en/index.plain.html`;
  let html;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { name: 'card-ceiling', pass: false, reason: `${url} returned ${res.status}` };
    }
    html = await res.text();
  } catch (e) {
    return { name: 'card-ceiling', pass: false, reason: `fetch error: ${e.message}` };
  }

  const block = extractBlockInner(html, ['carousel', 'tiles']);
  if (block === null) {
    return { name: 'card-ceiling', pass: false, reason: `no .carousel.tiles block found at ${url}` };
  }
  const rows = countTopLevelDivs(block);
  if (rows > MAX_CARDS) {
    return {
      name: 'card-ceiling',
      pass: false,
      reason: `${rows} category cards are published at ${url}; the demo carries exactly ${MAX_CARDS}.`,
    };
  }
  // A leftover "Top Brands" .cards block is the other way the page grows past its shape.
  if (extractBlockInner(html, ['cards']) !== null) {
    return {
      name: 'card-ceiling',
      pass: false,
      reason: `a secondary .cards ("Top Brands") block is still published at ${url}; it must be removed, not repopulated.`,
    };
  }
  return { name: 'card-ceiling', pass: true, reason: `${rows} published category card(s), no secondary cards block` };
}

/** Inner HTML of the first <div> carrying every class token, or null. */
function extractBlockInner(html, classTokens) {
  const openRe = /<div\b[^>]*\bclass=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  for (let match = openRe.exec(html); match !== null; match = openRe.exec(html)) {
    const classValue = (match[1] || match[2] || '').split(/\s+/);
    if (!classTokens.every((t) => classValue.includes(t))) continue;
    const openEnd = openRe.lastIndex;
    let depth = 1;
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = openEnd;
    for (let tag = tagRe.exec(html); tag !== null; tag = tagRe.exec(html)) {
      if (tag[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) return html.slice(openEnd, tag.index);
      } else {
        depth += 1;
      }
    }
    return null;
  }
  return null;
}

/** Count direct-child <div> elements of a block's inner HTML (one per authored row). */
function countTopLevelDivs(inner) {
  const tagRe = /<\/?div\b[^>]*>/gi;
  let depth = 0;
  let count = 0;
  for (let tag = tagRe.exec(inner); tag !== null; tag = tagRe.exec(inner)) {
    if (tag[0].startsWith('</')) {
      depth -= 1;
    } else {
      if (depth === 0) count += 1;
      depth += 1;
    }
  }
  return count;
}

// ---- CHECK: hero-quality (report) -----------------------------------------------
// A card's representative (hero image) must be real imagery, not a flat logo/wordmark/UI
// chrome. Signal = AEM's own smart-tag count on the chosen representative (the same evidence
// representatives.js ranks by); AEM's vision pipeline tags a photograph richly and a flat
// graphic barely or not at all. Advisory: a zero-signal hero is flagged so it can be re-picked
// or noted — never a filename denylist.
export function checkHeroQuality(reportPath) {
  if (!reportPath || !existsSync(reportPath)) {
    return { name: 'hero-quality', pass: false, reason: 'needs --report <report.json>' };
  }
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch (e) {
    return { name: 'hero-quality', pass: false, reason: `bad report json: ${e.message}` };
  }
  const items = Object.entries((report.representatives || {}).items || {});
  // Only reps that actually carry the smartTags field are measurable. A rep without it comes
  // from an older report that predates the field — unmeasurable, not a failure (noted, not
  // failed). A rep WITH the field but zero tags = AEM's vision pipeline found no content =
  // a flat logo/wordmark/chrome hero → fail so it gets re-picked.
  const measurable = items.filter(([, rep]) => Array.isArray(rep.smartTags));
  const flat = measurable
    .filter(([, rep]) => rep.smartTags.length === 0)
    .map(([slug, rep]) => `${slug} (${rep.repoName || rep.assetId || '?'})`);
  if (flat.length) {
    return {
      name: 'hero-quality',
      pass: false,
      reason: `card hero(es) with no AEM smart-tag signal (likely logo/wordmark/chrome), re-pick a real photo: ${flat.join('; ')}`,
    };
  }
  if (!measurable.length) {
    return { name: 'hero-quality', pass: true, reason: `${items.length} hero(es) but none carry smartTags (older report) — unmeasurable, re-run enrichment to record signal` };
  }
  return { name: 'hero-quality', pass: true, reason: `${measurable.length} card hero(es) carry AEM smart-tag signal` };
}

function currentCommit(repoRoot) {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = {
    repoRoot: null, preview: null, company: null, report: null, only: null, writeReport: null,
    cascadeReport: null,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--repo-root') { opt.repoRoot = args[++i]; }
    else if (a === '--preview') { opt.preview = args[++i]; }
    else if (a === '--company') { opt.company = args[++i]; }
    else if (a === '--report') { opt.report = args[++i]; }
    else if (a === '--cascade-report') { opt.cascadeReport = args[++i]; }
    else if (a === '--only') { opt.only = args[++i].split(',').map((s) => s.trim()); }
    else if (a === '--write-report') { opt.writeReport = args[++i]; }
  }
  const repoRoot = resolveRepoRoot(opt.repoRoot);
  const baseBrand = loadBaseBrand(repoRoot);

  const results = [];
  const want = (name) => !opt.only || opt.only.includes(name);

  if (want('header-logo')) results.push(checkHeaderLogo(repoRoot));
  if (want('residue')) results.push(checkResidue(repoRoot, baseBrand));
  if (want('structural-residue')) results.push(checkStructuralResidue(repoRoot, baseBrand));
  if (want('icon-reference-resolution')) results.push(checkIconReferenceResolution(repoRoot));
  if (want('welcome-header-home-link')) results.push(checkWelcomeHeaderHomeLink(repoRoot));
  if (want('icon-render')) results.push(checkIconRender(repoRoot, opt.company));
  if (want('background-shorthand')) results.push(checkBackgroundShorthand(repoRoot));
  if (want('background-asset-fidelity')) results.push(checkBackgroundAssetFidelity(repoRoot, baseBrand));
  if (want('brand-fidelity')) results.push(await checkBrandFidelity(repoRoot, opt.preview));
  if (want('cascade')) results.push(checkCascade(opt.cascadeReport));
  if (opt.preview && want('nav-404-loop')) results.push(await checkNav404Loop(opt.preview, opt.company));
  if (opt.preview && want('applied-css')) results.push(await checkAppliedCss(opt.preview, repoRoot, baseBrand));
  if (opt.preview && want('card-ceiling')) results.push(await checkCardCeiling(opt.preview, opt.company));
  if (opt.preview && want('access-json')) results.push(await checkAccessJson(opt.preview, opt.company));
  if (opt.report && want('stale-card-images')) results.push(checkStaleCardImages(opt.report));
  if (opt.report && want('card-count')) results.push(checkCardCount(opt.report));
  if (opt.report && want('hero-quality')) results.push(checkHeroQuality(opt.report));

  let failed = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    process.stderr.write(`[${tag}] ${r.name}: ${r.reason}\n`);
    if (!r.pass) failed += 1;
  }
  if (!results.length) {
    process.stderr.write('no checks ran (pass --preview/--report for preview checks)\n');
    process.exit(2);
  }

  if (opt.writeReport) {
    const report = {
      checkedAt: new Date().toISOString(),
      checkedCommit: currentCommit(repoRoot),
      // Which demo these results describe. Tree checks are worktree-scoped, but the
      // preview checks (card-ceiling especially) assert against a specific published
      // company page — without this a report from one demo could be used to wave
      // through the publish of another.
      company: opt.company || null,
      preview: opt.preview || null,
      results: Object.fromEntries(results.map((r) => [r.name, { pass: r.pass, reason: r.reason }])),
    };
    writeFileSync(opt.writeReport, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
