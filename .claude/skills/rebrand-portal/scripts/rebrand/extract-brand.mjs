#!/usr/bin/env node
/**
 * extract-brand.mjs — measure brand tokens from the live source site and write
 * `migration-work/brand.json`.
 *
 *   node .claude/skills/rebrand-portal/scripts/rebrand/extract-brand.mjs \
 *     --url https://www.example.com/ [--repo-root <dir>] [--selectors '[]'] \
 *     [--timeout 45000] [--keep-open]
 *
 * WHY A WRAPPER INSTEAD OF "JUST RUN EXCAT'S SCRIPT"
 * -------------------------------------------------
 * The extractor itself is excat's (`sub-agents/excat-block-design-expert/
 * brand-extract.js`) and stays excat's — we read it from the installed plugin
 * rather than vendoring it, so upstream fixes arrive for free. What this file
 * owns is the *invocation*, because invoking it by hand has two failure modes
 * that are silent, and both were hit while investigating the Heineken run:
 *
 *   TRAP 1 — `src.replace('__DEFAULT_CONTENT_SELECTORS__', ...)` patches the
 *     FIRST occurrence, which is in the doc comment on line 17. The real
 *     declaration on line 24 is left intact, and the page throws
 *     `ReferenceError: __DEFAULT_CONTENT_SELECTORS__ is not defined`.
 *     => must be replaceAll().
 *
 *   TRAP 2 — the file's body is an arrow-function *expression* (`() => {...}`),
 *     not a statement. `page.evaluate(src)` evaluates it, gets a function
 *     object, and returns undefined. No error, no tokens, empty result.
 *     => must be evaluated as `(${src})()`.
 *
 * Neither trap announces itself, so every hand-rolled attempt either crashes
 * opaquely or "succeeds" with nothing. Fixing them once here is the difference
 * between extraction being reliable and being folklore.
 *
 * THE GATE PROBLEM
 * ----------------
 * Some sources sit behind an age gate, cookie wall or bot interstitial.
 * heineken.com redirects to /agegateway/ and the extractor reads *that* page
 * perfectly happily, returning plausible-but-wrong tokens (text rgb(153,153,153),
 * link rgb(56,96,190)) with no error whatsoever. Those are the values that end
 * up in the theme. Detecting this is not optional garnish — it is the whole
 * reason extraction can be trusted. See detectGate() below.
 *
 * Exit codes (distinct so callers and hooks can react differently):
 *   0 — extracted and written (or, with --check, the toolchain is ready)
 *   2 — usage error
 *   3 — toolchain not ready: the excat plugin, its Playwright package, or the
 *       Chromium binary that package drives could not be found. These are
 *       setup problems with distinct fixes, so each message names its own.
 *   4 — navigation or in-page extraction failed
 *   5 — HALT: landed on a gate/interstitial, or the yield was degenerate.
 *       Writes migration-work/brand.rejected.json for inspection and writes
 *       NO brand.json, so every downstream gate stays closed.
 */
import {
  readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import {
  SCHEMA_VERSION, brandPath, rejectedBrandPath, normalizeHex,
} from './brand-contract.mjs';

const EXTRACTOR_REL = join('sub-agents', 'excat-block-design-expert', 'brand-extract.js');
const PLAYWRIGHT_REL = join('hooks', 'import-validator', 'node_modules', 'playwright', 'index.mjs');

function fail(code, msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

// ---- locating excat -------------------------------------------------------
/**
 * CLAUDE_PLUGIN_ROOT is set when a skill or hook invokes us, but NOT in an
 * arbitrary shell, so fall back to discovering the install.
 *
 * There are two shapes, and only one is a cache:
 *
 *  - **copied**: the host copies the plugin into its own cache
 *    (`~/.claude/plugins/cache/...`). Multiple versions can coexist.
 *  - **live**: the host loads it straight from a directory marketplace and
 *    never copies it. Copilot CLI reports these as "Live Plugins (loaded from
 *    a local marketplace directory, never copied)" and records the path in
 *    `~/.copilot/settings.json` under `extraKnownMarketplaces`; Claude records
 *    directory marketplaces in `known_marketplaces.json`.
 *
 * Scanning only the caches made a live install look like no install at all —
 * `--check` reported "Could not locate the excat plugin" on a machine where
 * the host had the plugin loaded and working. A false negative here is
 * expensive: it tells an operator to fix something that is not broken.
 */
function marketplaceDirs(env) {
  const home = env.HOME || '';
  const out = [];
  const addPath = (p) => { if (p && typeof p === 'string') out.push(p); };

  // Copilot CLI
  try {
    const s = JSON.parse(readFileSync(join(home, '.copilot', 'settings.json'), 'utf8'));
    Object.values(s.extraKnownMarketplaces || {}).forEach((m) => addPath(m?.source?.path));
  } catch { /* absent or unreadable */ }

  // Claude Code
  try {
    const s = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), 'utf8'));
    Object.values(s || {}).forEach((m) => {
      if (m?.source?.source === 'directory') addPath(m.source.path);
      addPath(m?.installLocation);
    });
  } catch { /* absent or unreadable */ }

  return out;
}

export function resolveExcatRoot(env = process.env) {
  const candidates = [];
  if (env.EXCAT_ROOT) candidates.push(env.EXCAT_ROOT);
  if (env.CLAUDE_PLUGIN_ROOT) candidates.push(env.CLAUDE_PLUGIN_ROOT);

  const home = env.HOME || '';
  const caches = [
    join(home, '.claude', 'plugins', 'cache', 'excat-marketplace', 'excat'),
    join(home, '.copilot', 'plugins', 'cache', 'excat-marketplace', 'excat'),
  ];
  for (const base of caches) {
    if (!existsSync(base)) continue;
    let versions = [];
    try {
      versions = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch { versions = []; }
    for (const v of versions) candidates.push(join(base, v));
  }

  // Live (never-copied) installs: the marketplace directory holds the plugin
  // under its own name, e.g. <marketplace>/excat.
  for (const dir of marketplaceDirs(env)) {
    candidates.push(join(dir, 'excat'));
    candidates.push(dir);
  }

  for (const c of candidates) {
    if (c && existsSync(join(c, EXTRACTOR_REL))) return c;
  }
  return null;
}

/**
 * The directory name and the VERSION file disagree on this machine (dir says
 * 2.1.6, VERSION says 2.1.1). Record both rather than picking a winner — when a
 * future extraction behaves differently, the provenance must be unambiguous.
 */
function excatVersion(root) {
  const dir = root.split('/').filter(Boolean).pop() || null;
  let file = null;
  try { file = readFileSync(join(root, 'VERSION'), 'utf8').trim() || null; } catch { /* absent */ }
  return { dir, file };
}

// ---- toolchain readiness --------------------------------------------------
/**
 * Three things must be present, and they fail for three different reasons:
 *
 *   1. the plugin        — installed via the host's plugin system
 *   2. playwright        — the npm package, shipped inside the plugin
 *   3. the Chromium binary — NOT inside the plugin. Playwright keeps browsers
 *      in a machine-global cache (~/Library/Caches/ms-playwright on macOS),
 *      populated by `playwright install`. A plugin copied between machines, or
 *      a cleaned browser cache, leaves 1 and 2 present and 3 missing.
 *
 * (3) used to surface as exit 4 "extraction failed", because the launch sat
 * inside the navigation try/catch — pointing whoever read it at the website
 * rather than at their own machine. Each case now exits 3 with its own fix.
 */
export function resolveToolchain(env = process.env) {
  const excatRoot = resolveExcatRoot(env);
  if (!excatRoot) {
    fail(3, [
      'Could not locate the excat plugin.',
      'The plugin supplies the brand extractor; installing it is a one-time',
      'setup step, never something a demo run should need to do.',
      'Install it with excat\'s own instructions:',
      '  https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst#cli-interface-setup-instructions',
      'Then see .claude/skills/rebrand-portal/docs/excat-setup.md and re-run.',
      'To point at a non-standard install: EXCAT_ROOT=/path/to/excat ...',
    ].join('\n'));
  }
  const pwPath = join(excatRoot, PLAYWRIGHT_REL);
  if (!existsSync(pwPath)) {
    fail(3, [
      `excat is at ${excatRoot}, but its Playwright package is missing at:`,
      `  ${pwPath}`,
      'The plugin was installed from a source tree whose dependencies were',
      "never installed (excat's node_modules are gitignored, so a fresh clone",
      'has none). Reinstall the plugin per excat\'s own setup instructions.',
    ].join('\n'));
  }
  return { excatRoot, pwPath };
}

/**
 * Launch outside the navigation try/catch, and translate Playwright's
 * "Executable doesn't exist" into the one command that fixes it — resolved
 * against this install, so the version in the path is never stale.
 */
export async function launchChromium({ excatRoot, pwPath }, { headless = true } = {}) {
  const { chromium } = await import(pathToFileURL(pwPath).href);
  try {
    return await chromium.launch({ headless, args: ['--no-sandbox'] });
  } catch (e) {
    if (/Executable doesn't exist|please run.*playwright install/is.test(e.message)) {
      fail(3, [
        'The excat plugin is installed, but the Chromium it drives is not on',
        'this machine. Playwright stores browsers in a machine-global cache,',
        'not inside the plugin, so this is normal on a new machine.',
        '',
        'Fix (one command, ~150MB, once per machine):',
        `  cd ${join(excatRoot, 'hooks', 'import-validator')} && npx playwright install chromium`,
        '',
        'Then re-run. Verify any time with: extract-brand.mjs --check',
      ].join('\n'));
    }
    fail(3, `could not start the browser: ${e.message}`);
  }
  return null;
}

// ---- passing interstitials ------------------------------------------------
// An age gate is not a wall; it is a form. The earlier conclusion that
// heineken.com "cannot be passed programmatically because of the CfDJ8…
// antiforgery tokens" was half right: those tokens defeat a *forged POST*, but
// they are already in the DOM, so driving the real form in the real browser
// carries them for free. Measured on heineken.com: select country, fill
// day/month/year, click ENTER -> /in/en/home/, navHeight 90px, real content.
//
// THE RULE THAT KEEPS THIS HONEST: passing a gate is never itself success.
// detectGate() runs again on whatever we land on, so a gate that survives the
// interaction still halts. All this does is remove the cases where the only
// thing standing between us and a real measurement was a form nobody filled in.
const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',
  'button#truste-consent-button',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  'button[aria-label="Accept all" i]',
  'button[title="Accept all" i]',
];

const AGE_CONFIRM_SELECTORS = [
  'button.theme-button',
  'button[type="submit"]',
  'input[type="submit"]',
];

const AGE_CONFIRM_TEXTS = [
  'enter', 'i am of legal drinking age', 'yes, i am over', 'yes i am over',
  'i am over 18', 'i am over 21', 'yes', 'confirm', 'continue',
];

/**
 * Best-effort: dismiss a consent banner and satisfy an age gate.
 * Returns the list of actions actually taken, which is recorded in provenance
 * so an operator can see exactly how a measurement was obtained.
 *
 * @param {object} page       Playwright page, already navigated and settled.
 * @param {object} opt        { url, dob: 'YYYY-MM-DD', country, timeout }
 */
export async function passInterstitials(page, opt) {
  const actions = [];
  const seen = async (loc) => (await loc.count()) > 0 && await loc.first().isVisible().catch(() => false);

  // 1. Consent first: a cookie overlay commonly intercepts clicks on the age form.
  for (const sel of CONSENT_SELECTORS) {
    const el = page.locator(sel).first();
    // eslint-disable-next-line no-await-in-loop
    if (await seen(el)) {
      // eslint-disable-next-line no-await-in-loop
      await el.click({ timeout: 5000 }).catch(() => {});
      actions.push(`consent: clicked ${sel}`);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(700);
      break;
    }
  }

  // 2. Country, when the gate asks. Option values are ISO-3166 alpha-2 in every
  //    gate observed, and the locale already sits in the URL (/in/en/ -> IN), so
  //    derive it rather than shipping a 243-row name table.
  const country = page.locator('select[name="country" i], select.country-select').first();
  if (await seen(country)) {
    const codes = [];
    if (opt.country) codes.push(opt.country.toUpperCase());
    try {
      for (const seg of new URL(opt.url).pathname.split('/').filter(Boolean)) {
        const m = seg.match(/^([a-z]{2})(?:[-_][a-z]{2})?$/i);
        if (m) codes.push(m[1].toUpperCase());
      }
    } catch { /* handled elsewhere */ }
    const opts = await country.locator('option')
      .evaluateAll((els) => els.map((e) => ({ v: e.value, t: (e.textContent || '').trim() })));
    const hit = codes.map((c) => opts.find((o) => (o.v || '').toUpperCase() === c)).find(Boolean);
    if (hit) {
      await country.selectOption(hit.v).catch(() => {});
      actions.push(`country: selected ${hit.t} (${hit.v})`);
      await page.waitForTimeout(900); // province lists are populated on change
    }
    const prov = page.locator('select[name="province" i], select.province-select').first();
    if (await seen(prov)) {
      const n = await prov.locator('option').count();
      if (n > 1) {
        const v = await prov.locator('option').nth(1).getAttribute('value');
        if (v) { await prov.selectOption(v).catch(() => {}); actions.push(`province: selected ${v}`); }
      }
    }
  }

  // 3. Date of birth. Split day/month/year inputs, or single selects.
  const [y, m, d] = (opt.dob || '1980-01-01').split('-');
  let filled = 0;
  for (const [name, val] of [['day', d], ['month', m], ['year', y]]) {
    const f = page.locator(`input[name="${name}" i]`).first();
    // eslint-disable-next-line no-await-in-loop
    if (await seen(f)) { await f.fill(val).catch(() => {}); filled += 1; continue; }
    const s = page.locator(`select[name="${name}" i]`).first();
    // eslint-disable-next-line no-await-in-loop
    if (await seen(s)) {
      // eslint-disable-next-line no-await-in-loop
      await s.selectOption(String(Number(val))).catch(async () => { await s.selectOption(val).catch(() => {}); });
      filled += 1;
    }
  }
  if (filled) actions.push(`dob: filled ${filled} field(s) with ${opt.dob || '1980-01-01'}`);

  // 4. Submit, then wait for whatever navigation or re-render follows.
  let clicked = null;
  for (const text of AGE_CONFIRM_TEXTS) {
    const el = page.locator(`button:has-text("${text}"), a[role="button"]:has-text("${text}")`).first();
    // eslint-disable-next-line no-await-in-loop
    if (await seen(el)) { clicked = `text:${text}`; await el.click({ timeout: 8000 }).catch(() => {}); break; }
  }
  if (!clicked) {
    for (const sel of AGE_CONFIRM_SELECTORS) {
      const el = page.locator(sel).first();
      // eslint-disable-next-line no-await-in-loop
      if (await seen(el)) { clicked = sel; await el.click({ timeout: 8000 }).catch(() => {}); break; }
    }
  }
  if (clicked) {
    actions.push(`submit: clicked ${clicked}`);
    await page.waitForLoadState('networkidle', { timeout: opt.timeout }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return actions;
}

// ---- accent measurement ---------------------------------------------------
// excat's extractor reports background/text/link/linkHover/light/dark. On
// heineken.com that yields white, grey, grey and three empties — a palette that
// cannot express the brand at all. The signature green is on buttons, the
// header and SVG fills, none of which excat samples.
//
// That gap is not cosmetic. I10 says a colour may only ship if it was measured,
// so a record without the green leaves an operator with no lawful way to use
// it — and the pressure to invent one is exactly what produced #D4AF37. So
// measure the accents too, and record how each was seen.
//
// Deliberately conservative: greys, near-white and near-black are excluded
// (they are chrome, not brand), and weighting is by painted area so a dominant
// brand surface outranks incidental colour. On heineken.com this returns
// #13670b first, by a factor of ~70.
const ACCENT_FN = `() => {
  const tally = {};
  const add = (c, w, why) => {
    if (!c) return;
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
    if (!m) return;
    const r = +m[1], g = +m[2], b = +m[3];
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a < 0.2) return;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 25) return;
    if (max < 25) return;
    const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    tally[hex] = tally[hex] || { hex: hex, weight: 0, why: {} };
    tally[hex].weight += w;
    tally[hex].why[why] = true;
  };
  const els = document.querySelectorAll('*');
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i];
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area > 100) add(cs.backgroundColor, area, 'background');
    if (el.matches('a,button,[role=button]')) add(cs.color, 5000, 'interactive-text');
    if (cs.borderTopWidth !== '0px') add(cs.borderTopColor, 500, 'border');
    add(cs.fill, 800, 'svg-fill');
  }
  return Object.keys(tally).map(function (k) {
    return { hex: k, weight: Math.round(tally[k].weight), why: Object.keys(tally[k].why) };
  }).sort(function (x, y) { return y.weight - x.weight; }).slice(0, 10);
}`;

// ---- gate detection -------------------------------------------------------
const GATE_TITLE_RE = /age\s*gate|agegateway|verify\s+your\s+age|are\s+you\s+(?:of\s+legal|over|21|18)|drinkaware|cookie\s+(?:policy|consent|preferences)|consent\s+manager|access\s+denied|forbidden|just\s+a\s+moment|attention\s+required|captcha|are\s+you\s+a\s+human|enable\s+javascript|unsupported\s+browser/i;
const GATE_PATH_RE = /agegate|age-gate|agegateway|age_check|gate|consent|cookie-?(?:policy|consent)|captcha|challenge|blocked|denied|unsupported/i;

/**
 * Three independent signals. ANY of them halts — this is deliberately
 * trigger-happy, because the cost of a false halt is one operator decision
 * while the cost of a false pass is a whole demo built on invented colours.
 *
 * On heineken.com all three fire at once; each was verified to fire alone.
 */
export function detectGate({
  requestedUrl, finalUrl, title, result,
}) {
  const signals = [];

  // 1. We did not end up where we asked to be, and the destination looks like a gate.
  try {
    const a = new URL(requestedUrl);
    const b = new URL(finalUrl);
    const pathChanged = a.pathname.replace(/\/+$/, '') !== b.pathname.replace(/\/+$/, '');
    if (a.host !== b.host || pathChanged) {
      if (GATE_PATH_RE.test(b.pathname) || a.host !== b.host) {
        signals.push(`redirected from ${requestedUrl} to ${finalUrl}`);
      }
    }
  } catch { /* unparseable URL is handled by navigation, not here */ }

  // 2. The document says what it is.
  if (title && GATE_TITLE_RE.test(title)) signals.push(`page title looks like an interstitial: ${JSON.stringify(title)}`);

  // 3. Degenerate yield. A real content page essentially always has a nav with
  //    height and a constrained content column. An interstitial has neither.
  //    Requiring BOTH to be empty keeps this from firing on unusual-but-real
  //    layouts; on the Heineken gate both are empty.
  const sp = result?.spacing || {};
  const noNav = !sp.navHeight || sp.navHeight === '0px';
  const noWidth = !sp.contentMaxWidth || sp.contentMaxWidth === 'none' || sp.contentMaxWidth === '0px';
  if (noNav && noWidth) {
    signals.push(`degenerate yield: navHeight=${JSON.stringify(sp.navHeight)} and contentMaxWidth=${JSON.stringify(sp.contentMaxWidth)} — no nav and no content column is not a real content page`);
  }

  return signals;
}

/** Soft quality notes — recorded, not fatal. */
function collectWarnings(result) {
  const w = [];
  if (!result?.fonts?.heading?.family) w.push('no heading font family measured');
  if (!result?.fonts?.body?.family) w.push('no body font family measured');
  if (!Array.isArray(result?.favicons) || !result.favicons.length) w.push('no favicons found — logo sourcing will need a manual asset');
  const colors = result?.colors || {};
  const named = ['background', 'text', 'link'].filter((k) => !normalizeHex(colors[k]));
  if (named.length) w.push(`unparseable or missing colour(s): ${named.join(', ')}`);
  return w;
}

// ---- main -----------------------------------------------------------------
function parseArgs(argv) {
  const opt = {
    url: null,
    repoRoot: null,
    selectors: '[]',
    timeout: 45000,
    keepOpen: false,
    // Default ON: an unfilled form was the only thing blocking a real
    // measurement on every gated source observed. Detection still runs after.
    gateInteraction: true,
    dob: '1980-01-01',
    country: null,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') opt.url = argv[++i];
    else if (a === '--repo-root') opt.repoRoot = argv[++i];
    else if (a === '--selectors') opt.selectors = argv[++i];
    else if (a === '--timeout') opt.timeout = Number(argv[++i]);
    else if (a === '--keep-open') opt.keepOpen = true;
    else if (a === '--no-gate-interaction') opt.gateInteraction = false;
    else if (a === '--dob') opt.dob = argv[++i];
    else if (a === '--country') opt.country = argv[++i];
    else if (a === '--check') opt.check = true;
  }
  return opt;
}

/**
 * The prerequisite check a human can run before starting a 60-minute demo.
 * It launches the browser rather than stat-ing files: the old documented check
 * (`ls .../node_modules/playwright/index.mjs`) passes on a machine with no
 * Chromium at all, which is precisely the machine that fails 20 minutes in.
 */
async function runCheck() {
  const tc = resolveToolchain();
  const browser = await launchChromium(tc, { headless: true });
  const version = browser.version();
  await browser.close().catch(() => {});
  process.stdout.write([
    'OK — design extraction is ready.',
    `  plugin:    ${tc.excatRoot}`,
    `  extractor: ${EXTRACTOR_REL}`,
    `  browser:   ${version}`,
    '',
  ].join('\n'));
  process.exit(0);
}

function resolveRepoRoot(arg) {
  if (arg) return resolve(arg);
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.check) await runCheck();
  if (!opt.url) {
    fail(2, 'usage: extract-brand.mjs --url <sourceUrl> [--repo-root <dir>] [--selectors \'["sel"]\'] [--timeout ms]\n       extract-brand.mjs --check   (verify the plugin and browser are ready)');
  }
  if (!URL.canParse(opt.url)) fail(2, `--url is not a valid absolute URL: ${opt.url}`);

  // excat's SKILL.md Step 1.2.3 is explicit that `[]` is the correct value when
  // no page-templates.json exists. Every abandoned run treated its absence as a
  // blocker; it is not one, and defaulting to [] here removes the decision.
  let selectors;
  try {
    selectors = JSON.parse(opt.selectors);
    if (!Array.isArray(selectors)) throw new Error('not an array');
  } catch (e) {
    fail(2, `--selectors must be a JSON array of CSS selectors (default "[]"): ${e.message}`);
  }

  const repoRoot = resolveRepoRoot(opt.repoRoot);
  const { excatRoot, pwPath } = resolveToolchain();

  const rawSrc = readFileSync(join(excatRoot, EXTRACTOR_REL), 'utf8');
  // TRAP 1: replaceAll, not replace. The doc comment on line 17 shadows the
  // real declaration on line 24.
  const src = rawSrc.replaceAll('__DEFAULT_CONTENT_SELECTORS__', JSON.stringify(selectors));
  if (src.includes('__DEFAULT_CONTENT_SELECTORS__')) {
    fail(4, 'placeholder substitution failed — extractor still contains __DEFAULT_CONTENT_SELECTORS__');
  }

  // Launched BEFORE the try below on purpose: a missing browser is a setup
  // problem (exit 3), not a failure of the customer's website (exit 4).
  const browser = await launchChromium({ excatRoot, pwPath }, { headless: !opt.keepOpen });

  let result; let finalUrl; let title;
  let gateActions = [];
  let accents = [];
  try {
    const ctx = await browser.newContext({
      // Match excat's own MCP config: a desktop UA, because many sources serve a
      // stripped mobile or bot variant otherwise — and a stripped variant would
      // yield real-looking-but-unrepresentative tokens.
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    await page.goto(opt.url, { waitUntil: 'domcontentloaded', timeout: opt.timeout });
    // Let webfonts and late CSS settle — measuring before they land reports
    // fallback fonts as if they were the brand's.
    await page.waitForLoadState('networkidle', { timeout: opt.timeout }).catch(() => {});
    await page.waitForTimeout(1200);

    // If we landed on a gate, try to pass it like a person would. Detection runs
    // again below on whatever we end up on, so this can only ever turn a halt
    // into a real measurement — never a halt into a false pass.
    if (opt.gateInteraction) {
      const pre = detectGate({
        requestedUrl: opt.url,
        finalUrl: page.url(),
        title: await page.title().catch(() => ''),
        result: null,
      });
      if (pre.length) {
        gateActions = await passInterstitials(page, opt);
        await page.waitForTimeout(800);
      }
    }

    finalUrl = page.url();
    title = await page.title().catch(() => '');
    // TRAP 2: the source is an expression; it must be called.
    result = await page.evaluate(`(${src})()`);
    // Same trap, same fix — ACCENT_FN is an expression too.
    accents = await page.evaluate(`(${ACCENT_FN})()`);
  } catch (e) {
    fail(4, `extraction failed against ${opt.url}: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (!result || typeof result !== 'object') {
    fail(4, 'extractor returned no object — the page evaluated but produced nothing.');
  }

  const provenance = {
    sourceUrl: opt.url,
    finalUrl,
    pageTitle: title || null,
    extractedAt: new Date().toISOString(),
    extractor: 'excat/sub-agents/excat-block-design-expert/brand-extract.js',
    excatRoot,
    excatVersion: excatVersion(excatRoot),
    defaultContentSelectors: selectors,
    gateInteraction: gateActions.length ? gateActions : null,
    gatePassed: false,
    warnings: [],
  };

  const gateSignals = detectGate({
    requestedUrl: opt.url, finalUrl, title, result,
  });

  mkdirSync(dirname(brandPath(repoRoot)), { recursive: true });

  if (gateSignals.length) {
    provenance.gateSignals = gateSignals;
    writeFileSync(
      rejectedBrandPath(repoRoot),
      `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, provenance, tokens: result }, null, 2)}\n`,
    );
    process.stderr.write(
      `HALT: the page that was measured does not look like the real source page.\n${
        gateSignals.map((s) => `  - ${s}`).join('\n')
      }\n\nWrote ${rejectedBrandPath(repoRoot)} (NOT brand.json) so nothing downstream consumes these values.\n`
      + 'These tokens are plausible but wrong — an interstitial has its own colours and fonts.\n'
      + `${opt.gateInteraction
        ? 'Automatic gate-passing ran and did not clear it'
          + `${gateActions.length ? ` (tried: ${gateActions.join('; ')})` : ' (found nothing to interact with)'}.\n`
        : 'Automatic gate-passing was disabled (--no-gate-interaction); re-run without that flag first.\n'}`
      + 'Do NOT hand-write brand.json to get past this. Options, in order of preference:\n'
      + '  1. If the gate wanted a country or an older date, pass --country XX / --dob YYYY-MM-DD.\n'
      + '  2. Find a source URL that renders real content (a regional /<cc>/en/ landing page,\n'
      + '     a press/newsroom page, or the brand-guidelines page).\n'
      + '  3. Re-run with --keep-open, clear the gate by hand, then re-run.\n'
      + '  4. Ask the customer for the brand reference, and record it with\n'
      + '     source:"extracted" only if it is genuinely measured.\n',
    );
    process.exit(5);
  }

  provenance.gatePassed = true;
  provenance.warnings = collectWarnings(result);

  const brand = {
    schemaVersion: SCHEMA_VERSION,
    provenance,
    tokens: { ...result, accents: Array.isArray(accents) ? accents : [] },
    // Filled in during Step 4b once the role mapping is decided. Left empty here
    // on purpose: this script measures, it does not choose. Verification fails
    // on an empty tokenMap, so the mapping cannot be skipped.
    tokenMap: [],
  };
  writeFileSync(brandPath(repoRoot), `${JSON.stringify(brand, null, 2)}\n`);

  const c = result.colors || {};
  process.stderr.write(
    `Extracted from ${finalUrl}\n`
    + `  background ${c.background || '?'}  text ${c.text || '?'}  link ${c.link || '?'}\n`
    + `  heading font ${result.fonts?.heading?.family || '?'}  body font ${result.fonts?.body?.family || '?'}\n`
    + `  navHeight ${result.spacing?.navHeight || '?'}  contentMaxWidth ${result.spacing?.contentMaxWidth || '?'}\n`
    + `${(brand.tokens.accents || []).length
      ? `  accents ${brand.tokens.accents.slice(0, 4).map((a) => `${a.hex} (${a.why.join('/')})`).join('  ')}\n` : ''}`
    + `${provenance.warnings.length ? `  warnings: ${provenance.warnings.join('; ')}\n` : ''}`
    + `Wrote ${brandPath(repoRoot)}\n`
    + 'Next: fill tokenMap[] with the old->new role mapping (source:"extracted" or "derived"+derivedFrom).\n',
  );
  process.exit(0);
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]).endsWith('extract-brand.mjs');
if (invokedDirectly) main();
