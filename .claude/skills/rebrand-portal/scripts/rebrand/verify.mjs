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
 *     [--report <report.json>] [--only <check,check>]
 *
 * Tree-only checks (no --preview needed): header-logo, residue.
 * Preview checks (need --preview + --company): nav-404-loop, applied-css.
 * Report check (needs --report + --preview): stale-card-images.
 *
 * Exit 0 = every applicable check passed; 1 = a check FAILED; 2 = usage/setup error.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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
function walk(dir, exts, acc = []) {
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
  // The per-branch preview worker deploys to `<branch>.dev.frescopamedia.com` (see I3), so
  // `frescopamedia` is the shared DEPLOY-HOST domain — infrastructure, not base branding —
  // and legitimately appears in the PDF-embed client-id host map (adobe-pdf-viewer.js), both as
  // the domain key and in its `REPLACE_WITH_FRESCOPA_PDF_EMBED_CLIENT_ID` placeholder. Neither is
  // a rebrand target and both are identical on every demo; strip them before the slug test so
  // they never register as un-rebranded residue.
  const INFRA_DOMAINS = /frescopamedia|frescopa_pdf_embed_client_id/gi;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const upper = text.toUpperCase();
    for (const m of matchers) {
      if (m.test(upper, text)) hits.push(`${f}: old hex ${m.label}`);
    }
    const slugText = text.replace(INFRA_DOMAINS, '');
    if (slug && new RegExp(slug, 'i').test(slugText)) hits.push(`${f}: baseSlug '${slug}'`);
  }
  if (hits.length) {
    return { name: 'residue', pass: false, reason: `${hits.length} residue hit(s):\n  ${hits.slice(0, 40).join('\n  ')}` };
  }
  return { name: 'residue', pass: true, reason: `no old-brand hex/slug (incl. rgb() form) in ${files.length} files` };
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

async function main() {
  const args = process.argv.slice(2);
  const opt = { repoRoot: null, preview: null, company: null, report: null, only: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--repo-root') { opt.repoRoot = args[++i]; }
    else if (a === '--preview') { opt.preview = args[++i]; }
    else if (a === '--company') { opt.company = args[++i]; }
    else if (a === '--report') { opt.report = args[++i]; }
    else if (a === '--only') { opt.only = args[++i].split(',').map((s) => s.trim()); }
  }
  const repoRoot = resolveRepoRoot(opt.repoRoot);
  const baseBrand = loadBaseBrand(repoRoot);

  const results = [];
  const want = (name) => !opt.only || opt.only.includes(name);

  if (want('header-logo')) results.push(checkHeaderLogo(repoRoot));
  if (want('residue')) results.push(checkResidue(repoRoot, baseBrand));
  if (opt.preview && want('nav-404-loop')) results.push(await checkNav404Loop(opt.preview, opt.company));
  if (opt.preview && want('applied-css')) results.push(await checkAppliedCss(opt.preview, repoRoot, baseBrand));
  if (opt.report && want('stale-card-images')) results.push(checkStaleCardImages(opt.report));

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
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
