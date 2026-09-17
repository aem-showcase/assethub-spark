import { describe, it, expect } from 'vitest';
import {
  mkdtempSync, writeFileSync, rmSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  slugify, parseEnvFile, parseArgs, validateOptions, resolveCreds, resolveAemEnvId,
  resolveDaToken, buildSourceHeaders,
} from '../../scripts/assets/config.js';

describe('config', () => {
  describe('slugify', () => {
    it('slugifies brand names', () => {
      expect(slugify('Santander AG')).toBe('santander-ag');
      expect(slugify('  ACME, Inc.  ')).toBe('acme-inc');
    });
  });

  describe('parseEnvFile', () => {
    it('parses key=value, ignores comments, strips quotes', () => {
      const parsed = parseEnvFile('# comment\nA=1\nB="two"\nC=\'three\'\n\nBAD');
      expect(parsed).toEqual({ A: '1', B: 'two', C: 'three' });
    });
  });

  describe('parseArgs', () => {
    it('derives damPath from customerKey and parses flags', () => {
      const opts = parseArgs(['--customer-key', 'Santander', '--dry-run', '--concurrency', '2']);
      expect(opts.customerKey).toBe('santander');
      expect(opts.damPath).toBe('/content/dam/santander');
      expect(opts.dryRun).toBe(true);
      expect(opts.concurrency).toBe(2);
      expect(opts.writeMode).toBeUndefined();
      expect(opts.productCategoryVocab).toBeUndefined();
    });

    it('turns on bring-in when a source URL is given', () => {
      const opts = parseArgs(['--customer-key', 'x', '--source-url', 'https://x.com']);
      expect(opts.bringIn).toBe(true);
      expect(opts.sourceUrl).toBe('https://x.com');
    });

    it('ignores removed write-mode and vocab flags', () => {
      const opts = parseArgs([
        '--customer-key', 'x',
        '--write-mode', 'bulk',
        '--product-category-vocab', 'a,b',
      ]);
      expect(opts.writeMode).toBeUndefined();
      expect(opts.productCategoryVocab).toBeUndefined();
    });

    it('ignores a removed metadata-mode flag — there is one enrichment path, no mode to select', () => {
      expect(parseArgs(['--customer-key', 'x']).metadataMode).toBeUndefined();
      expect(parseArgs(['--customer-key', 'x', '--metadata-mode', 'vision']).metadataMode).toBeUndefined();
    });
  });

  describe('validateOptions', () => {
    it('requires a customer key', () => {
      expect(validateOptions(parseArgs([]))).toContain('--customer-key is required');
    });

    it('rejects reserved customer keys', () => {
      const errs = validateOptions(parseArgs(['--customer-key', 'api']));
      expect(errs.some((e) => e.includes('reserved'))).toBe(true);
    });

    it('rejects DAM paths outside the customer folder', () => {
      const errs = validateOptions(parseArgs([
        '--customer-key', 'acme',
        '--dam-path', '/content/dam/other',
      ]));
      expect(errs.some((e) => e.includes('/content/dam/acme'))).toBe(true);
    });

    it('passes for a valid set', () => {
      expect(validateOptions(parseArgs(['--customer-key', 'x']))).toEqual([]);
    });
  });

  describe('resolveCreds', () => {
    it('prefers explicit env creds', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-envcreds-'));
      try {
        const out = resolveCreds({
          env: { SPARK_DM_CLIENT_ID: 'id', SPARK_DM_CLIENT_SECRET: 'sec' },
          secretsFile: join(dir, 'missing'),
          repoRoot: dir,
        });
        expect(out).toMatchObject({ clientId: 'id', clientSecret: 'sec', source: 'env' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reads SPARK_DM_* from a secrets file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-creds-'));
      const file = join(dir, '.secrets');
      try {
        writeFileSync(file, 'SPARK_DM_CLIENT_ID=abc\nSPARK_DM_CLIENT_SECRET=xyz\n');
        const out = resolveCreds({ secretsFile: file, env: {} });
        expect(out).toMatchObject({ clientId: 'abc', clientSecret: 'xyz', source: file });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('throws with guidance when nothing is found', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-nocreds-'));
      try {
        expect(() => resolveCreds({
          secretsFile: join(dir, 'missing'), repoRoot: dir, env: {},
        })).toThrow(/No DM credentials/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveAemEnvId', () => {
    it('prefers the explicit option', () => {
      expect(resolveAemEnvId({ aemEnvId: 'p1-e2', env: {} })).toBe('p1-e2');
    });

    it('reads AEM_ENV_ID from the environment', () => {
      expect(resolveAemEnvId({ env: { AEM_ENV_ID: 'p3-e4' } })).toBe('p3-e4');
    });

    it('reads AEM_ENV_ID from worker config', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-aemenv-'));
      try {
        mkdirSync(join(dir, 'cloudflare/src'), { recursive: true });
        writeFileSync(join(dir, 'cloudflare/src/config.js'), "export default { AEM_ENV_ID: 'p5-e6' };\n");
        expect(resolveAemEnvId({ repoRoot: dir, env: {} })).toBe('p5-e6');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveDaToken', () => {
    it('reads DA_TOKEN from the given token file', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-datoken-'));
      const file = join(dir, 'token.env');
      try {
        writeFileSync(file, 'DA_TOKEN=abc123\n');
        expect(resolveDaToken({ daTokenFile: file })).toBe('abc123');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('defaults to token.env at repoRoot when daTokenFile is not given', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-datoken-default-'));
      try {
        writeFileSync(join(dir, 'token.env'), 'DA_TOKEN=xyz789\n');
        expect(resolveDaToken({ repoRoot: dir })).toBe('xyz789');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns null (never throws) when the file is missing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-datoken-missing-'));
      try {
        expect(resolveDaToken({ daTokenFile: join(dir, 'missing.env') })).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns null when the file exists but has no DA_TOKEN key', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-datoken-empty-'));
      const file = join(dir, 'token.env');
      try {
        writeFileSync(file, 'SOME_OTHER_KEY=value\n');
        expect(resolveDaToken({ daTokenFile: file })).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // Source-fetch escapes (Todo 8/9/11). Each of these replaces a hand-written script or a
  // raw curl loop observed on a live run — work that happens off the supported path, where
  // none of the gates can see it.
  describe('source-fetch flags', () => {
    it('parses --cookie and repeated --header', () => {
      const opts = parseArgs([
        '--customer-key', 'acme',
        '--cookie', 'ak_bmsc=abc; sid=1',
        '--header', 'X-Bot: ok',
        '--header', 'Accept-Language: en-US',
      ]);
      expect(opts.cookie).toBe('ak_bmsc=abc; sid=1');
      expect(opts.headers).toEqual(['X-Bot: ok', 'Accept-Language: en-US']);
    });

    it('defaults headers to an empty list so buildSourceHeaders is always safe', () => {
      const opts = parseArgs(['--customer-key', 'acme']);
      expect(opts.headers).toEqual([]);
      expect(buildSourceHeaders(opts)).toEqual({});
    });

    it('builds a header object, with a value containing colons preserved', () => {
      expect(buildSourceHeaders({
        cookie: 'sid=1',
        headers: ['X-Bot: ok', 'Referer: https://x.com/page'],
      })).toEqual({
        Cookie: 'sid=1',
        'X-Bot': 'ok',
        Referer: 'https://x.com/page',
      });
    });

    it('rejects a --header without a colon', () => {
      const errors = validateOptions({ customerKey: 'acme', headers: ['X-Bot ok'] });
      expect(errors.join(' ')).toMatch(/--header "X-Bot ok" must be "Name: value"/);
    });

    it('rejects --rendered-html and --hero-map paths that do not exist', () => {
      const errors = validateOptions({
        customerKey: 'acme',
        renderedHtml: '/no/such/rendered.html',
        heroMap: '/no/such/hero.json',
      });
      expect(errors.join(' ')).toMatch(/--rendered-html file not found/);
      expect(errors.join(' ')).toMatch(/--hero-map file not found/);
    });

    it('accepts --rendered-html and --hero-map when the files exist', () => {
      const dir = mkdtempSync(join(tmpdir(), 'agent-srcflags-'));
      try {
        const html = join(dir, 'rendered.html');
        const hero = join(dir, 'hero.json');
        writeFileSync(html, '<img src="/a.png">');
        writeFileSync(hero, '{"grocery":"apples.jpg"}');
        const opts = parseArgs([
          '--customer-key', 'acme', '--rendered-html', html, '--hero-map', hero,
        ]);
        expect(opts.renderedHtml).toBe(html);
        expect(opts.heroMap).toBe(hero);
        expect(validateOptions(opts)).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
