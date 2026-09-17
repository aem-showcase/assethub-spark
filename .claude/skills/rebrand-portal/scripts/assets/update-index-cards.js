/**
 * Rewrite the landing page's category cards from an enrichment report — the per-customer
 * authoring step that the migration used to do ad-hoc (and got wrong: image-less tiles,
 * link-less "Top Areas", raw delivery URLs that 404).
 *
 * It operates on the copied `/<company>/en/index` DA HTML, PRESERVING the existing block
 * wrappers (`<div class="carousel tiles">` for Browse-by-category, `<div class="cards">`
 * for the secondary "Top" section) and regenerating only their rows from `report.cards`.
 * Each row is authored in the exact shape the live base index uses (verified against
 * main--assethub-spark-standalone--mohitar1.aem.page/en/index.plain.html):
 *
 *   carousel slide / card tile:
 *     <div>
 *       <div><picture><source srcset="<daSourceUrl>"><img src="<daSourceUrl>" …></picture></div>
 *       <div><h3>Label</h3><p>blurb<br><strong><a href="<facet>">Browse →</a></strong></p></div>
 *     </div>
 *
 * Images are DA-hosted page images (report.cards[].cardImageUrl — a content.da.live source
 * URL uploaded by da-card-images.js), authored with ordinary <picture>/<source srcset>/<img>
 * markup exactly like any other authored image in this template. On preview/publish, Helix
 * rewrites this into its own public media_<hash>.<ext> path automatically. This is NOT the
 * worker's `/api/adobe/assets/...` proxy — that path depends on the visitor's session cookie
 * and is broken for a statically published doc (verified live, even for a signed-in user).
 *
 * Count is capped structurally: at most MAX_CARDS rows reach the carousel, regardless of
 * what report.cards contains. This is what makes exceeding the ceiling pointless rather
 * than merely forbidden — assets that arrived by any route (ad-hoc script, raw curl, an
 * oversized category contract) simply never appear in the delivered demo.
 *
 * The secondary "Top Brands" `.cards` block is REMOVED rather than populated. It shipped a
 * stale placeholder image twice, because the documented setting (`topAreasCount: 0`) took a
 * branch that skipped the block instead of clearing it, leaving the copied firefly_*
 * placeholders in place. A block that does not exist cannot go stale.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { MAX_CARDS } from './constants.js';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One carousel slide / card tile row for a card spec.
 * @param {{label,blurb,href,cardImageUrl,slug}} card
 * @param {{withBrowseLink?:boolean}} [opts]  Browse-by-category tiles carry a blurb + Browse
 *   link; a "Top" cards tile can be just image + linked heading. Default true.
 */
export function cardRowHtml(card, { withBrowseLink = true } = {}) {
  const img = escapeHtml(card.cardImageUrl);
  const alt = escapeHtml(card.label);
  const href = escapeHtml(card.href);
  const label = escapeHtml(card.label);
  const picture = `<picture><source srcset="${img}"><source srcset="${img}" media="(min-width: 600px)"><img loading="lazy" alt="${alt}" src="${img}"></picture>`;
  if (withBrowseLink) {
    const blurb = escapeHtml(card.blurb || '');
    return `<div><div>${picture}</div>`
      + `<div><h3>${label}</h3>`
      + `<p>${blurb}<br><strong><a href="${href}">Browse →</a></strong></p></div></div>`;
  }
  return `<div><div>${picture}</div>`
    + `<div><h3><a href="${href}">${label}</a></h3></div></div>`;
}

/**
 * Inner HTML for a whole block from a list of card specs.
 *
 * The ceiling is enforced HERE, at the lowest level that turns card specs into rows, not
 * only in updateIndexCards. Agent-written scripts import these primitives directly — a
 * live run's `apply-index-cards.mjs` imported `replaceBlockRows`, not the orchestrator —
 * so a cap that lives only in the top-level function is bypassed by exactly the route
 * that has actually been taken. Oversized input is trimmed, never expanded, never thrown
 * on: a caller with 200 cards gets a correct page, not an error it may work around.
 */
export function cardsBlockInnerHtml(cards, opts) {
  return (cards || []).slice(0, MAX_CARDS).map((c) => cardRowHtml(c, opts)).join('\n');
}

/**
 * Split block inner HTML into its top-level `<div>` rows. Used to enforce the row ceiling
 * against HTML a caller built itself, where there are no card objects to count.
 */
export function splitTopLevelRows(innerHtml) {
  const rows = [];
  const openRe = /<div\b[^>]*>/gi;
  let cursor = 0;
  for (let match = openRe.exec(innerHtml); match !== null; match = openRe.exec(innerHtml)) {
    if (match.index < cursor) continue;
    let depth = 1;
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = openRe.lastIndex;
    let end = -1;
    for (let tag = tagRe.exec(innerHtml); tag !== null; tag = tagRe.exec(innerHtml)) {
      if (tag[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) { end = tagRe.lastIndex; break; }
      } else {
        depth += 1;
      }
    }
    if (end === -1) break;
    rows.push(innerHtml.slice(match.index, end));
    cursor = end;
    openRe.lastIndex = end;
  }
  return rows;
}

/**
 * Replace the inner rows of the block whose opening tag has `class` containing every token
 * in `classTokens` (e.g. ['carousel','tiles'] or ['cards']), preserving the wrapper and its
 * attributes. Returns the rewritten HTML, or throws if the block isn't found.
 *
 * For card-bearing blocks the inner rows are capped at MAX_CARDS even when the caller
 * supplies raw HTML rather than card objects — this is the last chokepoint before rows
 * reach the page, so the ceiling is a property of writing rows at all.
 */
export function replaceBlockRows(html, classTokens, innerHtml) {
  const tokens = Array.isArray(classTokens) ? classTokens : [classTokens];
  const isCardBlock = tokens.some((t) => t === 'carousel' || t === 'cards');
  let rows = innerHtml;
  if (isCardBlock) {
    const split = splitTopLevelRows(innerHtml);
    if (split.length > MAX_CARDS) rows = split.slice(0, MAX_CARDS).join('\n');
  }
  // Find <div class="… tokens …"> — match the class attribute, then balance nested divs.
  const openRe = /<div\b[^>]*\bclass=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  for (let match = openRe.exec(html); match !== null; match = openRe.exec(html)) {
    const classValue = (match[1] || match[2] || '').split(/\s+/);
    if (!tokens.every((t) => classValue.includes(t))) continue;
    const start = match.index;
    const openEnd = openRe.lastIndex;
    // Balance <div>…</div> from openEnd.
    let depth = 1;
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = openEnd;
    let closeStart = -1;
    for (let tag = tagRe.exec(html); tag !== null; tag = tagRe.exec(html)) {
      if (tag[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) { closeStart = tag.index; break; }
      } else {
        depth += 1;
      }
    }
    if (closeStart === -1) break;
    const openTag = html.slice(start, openEnd);
    const closeTag = '</div>';
    return `${html.slice(0, start)}${openTag}\n${rows}\n${closeTag}${html.slice(closeStart + closeTag.length)}`;
  }
  throw new Error(`Block with class tokens [${tokens.join(', ')}] not found in index HTML`);
}

/**
 * Remove an entire block (wrapper included) whose opening tag carries every token in
 * `classTokens`. Returns the HTML unchanged when the block is absent, so calling this on
 * an already-cleaned page is a no-op.
 */
export function removeBlock(html, classTokens) {
  const tokens = Array.isArray(classTokens) ? classTokens : [classTokens];
  const openRe = /<div\b[^>]*\bclass=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  for (let match = openRe.exec(html); match !== null; match = openRe.exec(html)) {
    const classValue = (match[1] || match[2] || '').split(/\s+/);
    if (!tokens.every((t) => classValue.includes(t))) continue;
    const start = match.index;
    let depth = 1;
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = openRe.lastIndex;
    for (let tag = tagRe.exec(html); tag !== null; tag = tagRe.exec(html)) {
      if (tag[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) {
          return `${html.slice(0, start)}${html.slice(tag.index + '</div>'.length)}`;
        }
      } else {
        depth += 1;
      }
    }
    break;
  }
  return html;
}

/**
 * Rewrite the landing index HTML's category blocks from report.cards.
 *
 * At most MAX_CARDS rows are authored. An oversized report is TRIMMED, never expanded and
 * never rejected: this function is the last thing between a report and the delivered page,
 * so it is the right place for the ceiling to be a structural property rather than a rule.
 *
 * The secondary "Top Brands" `.cards` block is removed outright — see the module header.
 *
 * @param {string} indexHtml  current copied /<company>/en/index HTML
 * @param {{cards:Array}} report  enrichment report (report.cards)
 * @returns {string} rewritten HTML
 */
export function updateIndexCards(indexHtml, report) {
  const cards = (report && report.cards) || [];
  if (cards.length === 0) throw new Error('report.cards is empty — nothing to author');
  const carouselCards = cards.slice(0, MAX_CARDS);

  const out = replaceBlockRows(
    indexHtml,
    ['carousel', 'tiles'],
    cardsBlockInnerHtml(carouselCards, { withBrowseLink: true }),
  );
  return removeBlock(out, ['cards']);
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    if (eq === -1) {
      if (value === undefined || value.startsWith('--')) value = true;
      else i += 1;
    }
    opts[key] = value;
  }
  return opts;
}

export function main(argv = process.argv.slice(2), io = {}) {
  const read = io.readFile || ((p) => readFileSync(p, 'utf8'));
  const write = io.writeFile || ((p, c) => writeFileSync(p, c));
  const log = io.log || console;
  const opts = parseCliArgs(argv);
  const indexFile = opts['index-file'];
  const reportFile = opts['report-file'];
  if (!indexFile || !reportFile) {
    throw new Error('usage: update-index-cards.js --index-file <index.html> --report-file <report.json> [--out <file>]');
  }
  const report = JSON.parse(read(reportFile));
  const html = updateIndexCards(read(indexFile), report);
  const outFile = typeof opts.out === 'string' ? opts.out : indexFile;
  write(outFile, html);
  log.info?.(`[agent] wrote ${outFile} with ${Math.min((report.cards || []).length, MAX_CARDS)} category card(s)`);
  return html;
}

/* c8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`[agent] ${err?.stack || err?.message || err}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
