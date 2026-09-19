import {
  describe, it, expect, afterEach,
} from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { FIELD, STATUS_APPROVED } from '../../scripts/assets/constants.js';
import { buildSlingMetadataUpdate } from '../../scripts/assets/sling-metadata.js';
import { isAlreadyEnriched } from '../../scripts/assets/metadata.js';
import { parseArgs, validateOptions } from '../../scripts/assets/config.js';
import {
  extractAssetUrls,
  extractDocumentUrls,
  extFromContentType,
} from '../../scripts/assets/scrape-site.js';

const repoRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const hookPath = join(
  repoRoot,
  '.claude/skills/rebrand-portal/hooks/guard-da-publish.sh',
);
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function tempProjectWithState(state) {
  const dir = mkdtempSync(join(tmpdir(), 'rebrand-portal-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.internal'), { recursive: true });
  writeFileSync(join(dir, '.internal/onboarding-state.json'), JSON.stringify(state), 'utf8');
  return dir;
}

function runGuard(projectDir, event) {
  return spawnSync('bash', [hookPath], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
    },
  });
}

describe('customer migration asset metadata guardrails', () => {
  it('stamps global country visibility on add-only Sling metadata writes', () => {
    const plan = buildSlingMetadataUpdate(
      { title: 'Hero', keywords: ['hero'], productCategory: 'products' },
      { company: 'acme', status: STATUS_APPROVED, allowedCountries: ['global'] },
      {},
    );

    expect(plan.entries).toContainEqual({ name: `./${FIELD.COMPANY}`, value: 'acme' });
    expect(plan.entries).toContainEqual({ name: `./${FIELD.STATUS}`, value: STATUS_APPROVED });
    expect(plan.entries).toContainEqual({
      name: `./${FIELD.ALLOWED_COUNTRIES}`,
      value: 'global',
    });
  });

  it('does not skip assets missing required visibility metadata', () => {
    expect(isAlreadyEnriched({
      [FIELD.COMPANY]: 'acme',
      [FIELD.TITLE]: 'Hero',
      [FIELD.STATUS]: STATUS_APPROVED,
    }, 'acme')).toBe(false);

    expect(isAlreadyEnriched({
      [FIELD.COMPANY]: 'acme',
      [FIELD.TITLE]: 'Hero',
      [FIELD.STATUS]: STATUS_APPROVED,
      [FIELD.ALLOWED_COUNTRIES]: ['global'],
      [FIELD.PRODUCT_CATEGORY]: 'products',
    }, 'acme')).toBe(true);
  });
});

describe('customer migration scope validation', () => {
  it('rejects reserved company keys', () => {
    const opts = parseArgs(['--customer-key', 'en']);
    expect(validateOptions(opts)).toContain('--customer-key "en" is reserved; use a real company key');
  });

  it('rejects DAM paths outside the customer folder', () => {
    const opts = parseArgs(['--customer-key', 'acme', '--dam-path', '/content/dam/other']);
    expect(validateOptions(opts)).toContain('--dam-path must stay under /content/dam/acme (got /content/dam/other)');
  });
});

describe('customer migration bring-in extraction', () => {
  it('extracts linked documents as customer assets', () => {
    const html = `
      <img src="/media/hero.jpg">
      <a href="/docs/catalog.pdf">Catalog</a>
      <a href="/docs/pricing.xlsx">Pricing</a>
    `;

    expect(extractDocumentUrls(html, 'https://example.com/shop')).toEqual([
      'https://example.com/docs/catalog.pdf',
      'https://example.com/docs/pricing.xlsx',
    ]);
    expect(extractAssetUrls(html, 'https://example.com/shop')).toContain('https://example.com/docs/catalog.pdf');
    expect(extFromContentType('application/pdf; charset=utf-8')).toBe('pdf');
  });
});

describe('customer migration publish guard hook', () => {
  it('allows DA writes under the company folder and blocks root writes', () => {
    // Foldered demos live under /companies/<companyKey>; daFolder is set to the nested path.
    const projectDir = tempProjectWithState({
      customer: { daFolder: '/companies/acme' },
    });

    const allowed = runGuard(projectDir, {
      tool_input: {
        command: 'curl -X POST https://admin.hlx.page/preview/org/repo/main/companies/acme/en/',
      },
    });
    expect(allowed.status).toBe(0);

    const blocked = runGuard(projectDir, {
      tool_input: {
        command: 'curl -X POST https://admin.hlx.page/preview/org/repo/main/en/',
      },
    });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('outside the company folder');

    // The copy helper writes to /companies/<companyKey>; a mismatched key is blocked there.
    const blockedWrapper = runGuard(projectDir, {
      tool_input: {
        command: '.claude/skills/rebrand-portal/scripts/da/copy-folder.sh org repo other',
      },
    });
    expect(blockedWrapper.status).toBe(2);
    expect(blockedWrapper.stderr).toContain('DA copy script destination -> /companies/other');
  });

  it('rejects reserved company keys in the DA copy script before token lookup', () => {
    const result = spawnSync(
      'bash',
      [
        join(repoRoot, '.claude/skills/rebrand-portal/scripts/da/copy-folder.sh'),
        'org',
        'repo',
        'en',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("companyKey 'en' is reserved");
  });

  it('rejects DA copy destinations that do not match existing migration state', () => {
    const projectDir = tempProjectWithState({
      customer: { daFolder: '/companies/acme' },
    });

    const result = spawnSync(
      'bash',
      [
        join(repoRoot, '.claude/skills/rebrand-portal/scripts/da/copy-folder.sh'),
        'org',
        'repo',
        'other',
      ],
      {
        cwd: projectDir,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("companyKey 'other' -> /companies/other does not match state company folder /companies/acme");
  });
});

/**
 * Registration parity.
 *
 * Every guard must be registered on every CLI that can run this skill. A live demo ran
 * under Copilot CLI with all five guards registered only for Claude Code, so none of them
 * fired — every enforcement improvement in the skill was inert for that entire session.
 * Drift here must fail in CI, not silently on a customer run.
 */
describe('guard hook registration parity', () => {
  const guards = [
    'guard-da-publish.sh',
    'guard-auth-bypass-commit.sh',
    'guard-secret-read.sh',
    'guard-step5-verify-gate.sh',
    'guard-brand-extraction.sh',
    // Closes the one route the in-script barriers cannot reach: an agent-written script
    // or raw curl that authors the page itself. Every route still has to publish.
    'guard-live-publish-ceiling.sh',
  ];

  // Only hosts that are actually configured for this repo. `.codex/hooks.json` was
  // removed deliberately (commit e9817a9); asserting it here would re-impose a host
  // config the repo owner chose to drop. Add a host back to this list when it is
  // reintroduced — that is what keeps the remaining hosts from drifting apart.
  const hostConfigs = [
    '.claude/settings.json',
    '.github/hooks/rebrand-portal-guards.json',
  ];

  it.each(hostConfigs)('%s registers every rebrand-portal guard', (relPath) => {
    const raw = readFileSync(join(repoRoot, relPath), 'utf8');
    JSON.parse(raw); // must stay valid JSON or the host silently loads nothing
    guards.forEach((guard) => {
      expect(raw, `${relPath} is missing ${guard}`).toContain(guard);
    });
  });

  it.each(guards)('%s exists and is executable', (guard) => {
    const p = join(repoRoot, '.claude/skills/rebrand-portal/hooks', guard);
    expect(existsSync(p)).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(statSync(p).mode & 0o111).toBeGreaterThan(0);
  });
});

/**
 * Host dialect parity: Claude Code sends tool_name/tool_input, Copilot CLI sends
 * toolName/toolArgs with lowercase tool names. A guard that reads only one dialect is
 * registered but inert on the other host — indistinguishable from not being registered.
 */
describe('guard host-dialect parity', () => {
  const secretFile = ['.internal', 'token.env'].join('/');
  const cases = [
    ['guard-da-publish.sh', { command: 'curl -X POST https://admin.hlx.page/live/o/r/main/en/index' }, 2],
    ['guard-secret-read.sh', { command: `cat ${secretFile}` }, 2],
    ['guard-secret-read.sh', { command: 'ls -la' }, 0],
  ];

  it.each(cases)('%s treats both dialects alike (%#)', (guard, args, expected) => {
    const p = join(repoRoot, '.claude/skills/rebrand-portal/hooks', guard);
    const run = (event) => spawnSync('bash', [p], {
      input: JSON.stringify(event),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot },
    }).status;

    const claude = run({ tool_name: 'Bash', tool_input: args });
    const copilot = run({ toolName: 'bash', toolArgs: args });
    expect(claude).toBe(expected);
    expect(copilot).toBe(claude);
  });
});
