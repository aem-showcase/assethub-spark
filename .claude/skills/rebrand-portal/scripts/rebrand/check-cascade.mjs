#!/usr/bin/env node
/**
 * check-cascade.mjs — read COMPUTED backgrounds off the rendered page and prove the
 * rebrand actually took effect, then write .internal/cascade-report.json for verify.mjs.
 *
 *   node .claude/skills/rebrand-portal/scripts/rebrand/check-cascade.mjs \
 *     --origin https://<branch>--<repo>--<org>.aem.page --company <companyKey> \
 *     [--repo-root <dir>] [--write-report .internal/cascade-report.json]
 *
 * WHY THIS EXISTS
 * ---------------
 * step-4g-verification.md has always required "read the actual computed value on the
 * deployed preview (not the local tree, not source-inspection — the rendered, cascaded
 * result)". verify.mjs has no browser, so that requirement was never executable, and the
 * run that shipped a cream background reported PASS on every colour check it *could* run.
 *
 * Every static check is blind to the same class of defect: the declaration is present and
 * correct, and something later in the cascade wins. That is precisely what happened —
 * `.section.category-tiles` set the `background:` shorthand on the same element as
 * `.section.search-hero`, at equal specificity, resetting the tint and the SVG. Nothing
 * that reads a stylesheet as text can see that. Only the rendered page can.
 *
 * WHY THE AEM ORIGIN, NOT THE WORKER PREVIEW
 * ------------------------------------------
 * The `<branch>.dev.frescopamedia.com` worker is behind Entra login, so a headless browser
 * gets a login page and would measure ITS colours — the same failure mode as the age gate.
 * The AEM content origin (`<branch>--<repo>--<org>.aem.page`) serves the same CSS and DOM
 * unauthenticated (verified: both `.plain.html` and `styles.css` return 200). Measure there.
 *
 * Browser comes from the excat plugin, same as extract-brand.mjs — no new dependency.
 *
 * Exit 0 = all measured surfaces correct; 1 = at least one wrong; 2 = usage;
 * 3 = excat/browser unavailable; 4 = navigation failed.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadBrand, normalizeHex } from './brand-contract.mjs';
import { resolveExcatRoot } from './extract-brand.mjs';

const PLAYWRIGHT_REL = join('hooks', 'import-validator', 'node_modules', 'playwright', 'index.mjs');

// The surfaces that actually paint the page the customer looks at. The home canvas is
// included deliberately: the base surface commonly survives there even when the search
// page is clean, which is exactly how the cream background escaped review.
const LANDMARKS = [
  'body',
  'main',
  'main .section.search-hero',
  'main .section.category-tiles',
  'main .section.welcome',
  '.cards-card-body',
  '.facet-filter-panel',
];

function fail(code, msg) { process.stderr.write(`${msg}\n`); process.exit(code); }

function resolveRepoRoot(arg) {
  if (arg) return resolve(arg);
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); } catch { return process.cwd(); }
}

function loadBaseBrand(repoRoot) {
  const p = join(repoRoot, '.internal', 'onboarding-state.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')).baseBrand || null; } catch { return null; }
}

/**
 * Walk up from an element to find what actually paints behind it. A section with a
 * transparent background is not "no colour" — it is the parent's colour showing through,
 * and that is the colour the customer sees. Resolving this is the difference between
 * measuring the DOM and measuring the page.
 */
const PAINTED_BG_FN = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const own = getComputedStyle(el);
  let node = el;
  let painted = null;
  while (node) {
    const cs = getComputedStyle(node);
    const bg = cs.backgroundColor;
    const m = bg && bg.match(/rgba?\\(\\s*[\\d.]+[\\s,]+[\\d.]+[\\s,]+[\\d.]+(?:[\\s,/]+([\\d.]+))?/);
    const alpha = m && m[1] !== undefined ? parseFloat(m[1]) : 1;
    if (bg && bg !== 'transparent' && alpha > 0) { painted = { color: bg, from: node === el ? selector : (node.tagName.toLowerCase() + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\\s+/).join('.') : '')) }; break; }
    node = node.parentElement;
  }
  return {
    present: true,
    ownBackgroundColor: own.backgroundColor,
    ownBackgroundImage: own.backgroundImage,
    painted: painted ? painted.color : null,
    paintedBy: painted ? painted.from : null,
  };
}`;

function parseArgs(argv) {
  const o = {
    origin: null, company: null, repoRoot: null, writeReport: null, timeout: 45000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--origin' || a === '--preview') o.origin = argv[++i];
    else if (a === '--company') o.company = argv[++i];
    else if (a === '--repo-root') o.repoRoot = argv[++i];
    else if (a === '--write-report') o.writeReport = argv[++i];
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
  }
  return o;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.origin || !opt.company) {
    fail(2, 'usage: check-cascade.mjs --origin https://<branch>--<repo>--<org>.aem.page --company <companyKey> [--write-report <path>]');
  }
  const repoRoot = resolveRepoRoot(opt.repoRoot);
  const origin = opt.origin.startsWith('http') ? opt.origin.replace(/\/+$/, '') : `https://${opt.origin}`;

  const brand = loadBrand(repoRoot);
  if (!brand.found || !brand.valid) {
    fail(2, `brand.json unusable — ${brand.errors.join('; ')}\nRun extract-brand.mjs first; the cascade check needs measured values to compare against.`);
  }
  const baseBrand = loadBaseBrand(repoRoot);
  const oldHexes = (baseBrand?.oldHexes || []).map((h) => normalizeHex(h)).filter(Boolean);
  // Without base hexes there is nothing for a surface to be wrong *about*: `isBase` is
  // false everywhere, every surface passes, and the check reports a confident 7/7 while
  // asserting nothing. That vacuous-pass shape is the whole reason this work exists, so
  // refuse to run rather than emit a green report that means nothing.
  if (!oldHexes.length) {
    fail(2, 'no base-brand hexes in .internal/onboarding-state.json (baseBrand.oldHexes) — '
      + 'without them every surface would trivially pass and the report would be meaningless. '
      + 'Run the base-brand capture step first.');
  }

  const excatRoot = resolveExcatRoot();
  if (!excatRoot) fail(3, 'excat plugin not found — see docs/excat-setup.md. It ships the browser this check needs.');
  const pwPath = join(excatRoot, PLAYWRIGHT_REL);
  if (!existsSync(pwPath)) fail(3, `excat bundled Playwright missing at ${pwPath}`);
  const { chromium } = await import(pathToFileURL(pwPath).href);

  const pages = [
    { label: 'home', url: `${origin}/companies/${opt.company}/en/` },
    { label: 'search', url: `${origin}/companies/${opt.company}/en/search` },
  ];

  const surfaces = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    for (const pg of pages) {
      const page = await ctx.newPage();
      let status = null;
      try {
        const resp = await page.goto(pg.url, { waitUntil: 'domcontentloaded', timeout: opt.timeout });
        status = resp ? resp.status() : null;
        await page.waitForLoadState('networkidle', { timeout: opt.timeout }).catch(() => {});
        await page.waitForTimeout(800);
      } catch (e) {
        surfaces.push({
          page: pg.label, selector: '(navigation)', pass: false, computed: null, expected: 'page loads', note: e.message,
        });
        await page.close();
        continue;
      }
      if (status && status >= 400) {
        surfaces.push({
          page: pg.label, selector: '(navigation)', pass: false, computed: String(status), expected: '200', note: `${pg.url} returned ${status}`,
        });
        await page.close();
        continue;
      }
      for (const sel of LANDMARKS) {
        // PAINTED_BG_FN is a STRING holding an arrow-function *expression*. Playwright
        // treats a string first argument as an expression to evaluate and IGNORES any
        // extra argument, so `page.evaluate(PAINTED_BG_FN, sel)` evaluates to a function
        // object, returns undefined, and never receives `sel`. That is the same silent
        // trap documented in extract-brand.mjs, and it made this check measure nothing
        // at all while still exiting cleanly. Invoke the expression explicitly instead.
        // eslint-disable-next-line no-await-in-loop
        const info = await page.evaluate(`(${PAINTED_BG_FN})(${JSON.stringify(sel)})`);
        if (info === undefined) {
          // A bug in the probe, not an absent selector: `null` means "not on this page".
          fail(4, `cascade probe returned undefined for ${sel} — the page function did not execute.`);
        }
        if (!info) continue; // selector absent on this page — not a defect
        const computedHex = normalizeHex(info.painted);
        // THE anti-regression assertion: any surface still painting a captured base-brand
        // colour is a hard fail regardless of what the stylesheet says. This is the check
        // that would have caught the cream background.
        const isBase = computedHex && oldHexes.includes(computedHex);
        surfaces.push({
          page: pg.label,
          selector: sel,
          computed: info.painted,
          computedHex,
          paintedBy: info.paintedBy,
          ownBackgroundImage: info.ownBackgroundImage,
          expected: isBase ? `anything but the base brand surface (${oldHexes.join(', ')})` : 'not a base-brand colour',
          pass: !isBase,
          note: isBase ? `still painting the base brand colour ${computedHex} via ${info.paintedBy} — the rebrand did not take effect here` : undefined,
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await page.close();
    }
  } catch (e) {
    fail(4, `cascade check failed: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const failing = surfaces.filter((s) => !s.pass);
  const report = {
    checkedAt: new Date().toISOString(),
    origin,
    company: opt.company,
    brandSource: brand.data.provenance?.finalUrl || brand.data.provenance?.sourceUrl || null,
    baseHexes: oldHexes,
    surfaces,
  };
  if (opt.writeReport) {
    mkdirSync(dirname(resolve(opt.writeReport)), { recursive: true });
    writeFileSync(resolve(opt.writeReport), `${JSON.stringify(report, null, 2)}\n`);
  }

  for (const s of surfaces) {
    process.stderr.write(`[${s.pass ? 'PASS' : 'FAIL'}] ${s.page} ${s.selector}: ${s.computed}${s.note ? ` — ${s.note}` : ''}\n`);
  }
  if (!surfaces.length) fail(4, 'no surfaces measured — neither page rendered anything recognisable');
  process.stderr.write(`${surfaces.length - failing.length}/${surfaces.length} surfaces correct${opt.writeReport ? `; wrote ${opt.writeReport}` : ''}\n`);
  process.exit(failing.length ? 1 : 0);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]).endsWith('check-cascade.mjs');
if (invokedDirectly) main();

export { LANDMARKS };
