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
 *     [--report <report.json>] [--only <check,check>] [--write-report <path.json>]
 *
 * Tree-only checks (no --preview needed): header-logo, residue, structural-residue,
 *   icon-reference-resolution, welcome-header-home-link, icon-render.
 * Preview checks (need --preview + --company): nav-404-loop, applied-css.
 * Report checks (need --report): stale-card-images, card-count, hero-quality.
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
import { walk, captureAllBaseHexes } from './fs-walk.mjs';

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
  return { name: 'card-count', pass: true, reason: `${cards.length} card(s), one per populated category, all with href + image` };
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
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--repo-root') { opt.repoRoot = args[++i]; }
    else if (a === '--preview') { opt.preview = args[++i]; }
    else if (a === '--company') { opt.company = args[++i]; }
    else if (a === '--report') { opt.report = args[++i]; }
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
  if (opt.preview && want('nav-404-loop')) results.push(await checkNav404Loop(opt.preview, opt.company));
  if (opt.preview && want('applied-css')) results.push(await checkAppliedCss(opt.preview, repoRoot, baseBrand));
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
      results: Object.fromEntries(results.map((r) => [r.name, { pass: r.pass, reason: r.reason }])),
    };
    writeFileSync(opt.writeReport, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
