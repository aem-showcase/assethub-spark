import { describe, it, expect } from 'vitest';
import { buildScanQuery, isUnderFolder, enumerateFolder } from '../../scripts/assets/enumerate.js';
import { makeRes, makeClient } from './helpers.js';

const hit = (assetId, repoPath, extra = {}) => ({
  assetId,
  repositoryMetadata: { 'repo:path': repoPath, 'repo:name': repoPath.split('/').pop(), ...extra },
});

describe('enumerate', () => {
  describe('buildScanQuery', () => {
    it('builds a match-all FULLTEXT scan (no server-side path scoping)', () => {
      const body = buildScanQuery(50);
      expect(body.query).toEqual([{ match: { text: '*', mode: 'FULLTEXT' } }]);
      expect(body.limit).toBe(50);
      expect(body.cursor).toBeUndefined();
    });
    it('includes the cursor when provided', () => {
      expect(buildScanQuery(10, 'CUR').cursor).toBe('CUR');
    });
  });

  describe('isUnderFolder', () => {
    it('matches descendants of the folder', () => {
      expect(isUnderFolder('/content/dam/acme/a.jpg', '/content/dam/acme')).toBe(true);
      expect(isUnderFolder('/content/dam/acme/sub/b.jpg', '/content/dam/acme')).toBe(true);
    });
    it('rejects the folder node itself and sibling prefixes', () => {
      expect(isUnderFolder('/content/dam/acme', '/content/dam/acme')).toBe(false);
      expect(isUnderFolder('/content/dam/acmecorp/x.jpg', '/content/dam/acme')).toBe(false);
      expect(isUnderFolder(null, '/content/dam/acme')).toBe(false);
    });
    it('tolerates a trailing slash on the folder', () => {
      expect(isUnderFolder('/content/dam/acme/a.jpg', '/content/dam/acme/')).toBe(true);
    });
  });

  describe('enumerateFolder', () => {
    it('lists only the target DAM folder without tenant-wide search', async () => {
      const page = makeRes({
        body: {
          'a.jpg': { 'jcr:primaryType': 'dam:Asset', 'jcr:uuid': 'a1' },
          'b.jpg': { 'jcr:primaryType': 'dam:Asset', 'jcr:uuid': 'a2' },
          'jcr:content': {},
        },
      });
      const client = makeClient([page]);
      const out = await enumerateFolder({ client, folderPath: '/content/dam/acme' });
      expect(out.assets.map((a) => a.repoPath)).toEqual([
        '/content/dam/acme/a.jpg',
        '/content/dam/acme/b.jpg',
      ]);
      expect(out.scanned).toBe(2);
      expect(out.matched).toBe(2);
      expect(out.exceededWindow).toBe(false);
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0]).toMatchObject({
        op: 'sling',
        opts: {
          method: 'GET',
          path: '/content/dam/acme.1.json',
          includeApiKey: false,
        },
      });
    });

    it('accepts repository-style item arrays while still using the folder endpoint', async () => {
      const page = makeRes({
        body: {
          items: [
            hit('a1', '/content/dam/acme/a.jpg'),
            hit('a1', '/content/dam/acme/a.jpg'),
            hit('x1', '/content/dam/other/x.jpg'),
          ],
        },
      });
      const client = makeClient([page]);
      const out = await enumerateFolder({ client, folderPath: '/content/dam/acme' });
      expect(out.assets).toHaveLength(1);
      expect(out.assets[0].assetId).toBe('a1');
    });

    it('falls back from .1.json to .children.json on 404', async () => {
      const client = makeClient([
        makeRes({ status: 404, body: 'missing' }),
        makeRes({ body: { 'a.jpg': { 'jcr:primaryType': 'dam:Asset', 'jcr:uuid': 'a1' } } }),
      ]);
      const out = await enumerateFolder({
        client, folderPath: '/content/dam/acme',
      });
      expect(out.assets).toHaveLength(1);
      expect(client.calls.map((c) => c.opts.path)).toEqual([
        '/content/dam/acme.1.json',
        '/content/dam/acme.children.json',
      ]);
    });

    it('parses the real AEM search shape { hits: { results } } and repo:name when returned by a folder endpoint', async () => {
      const page = makeRes({
        body: {
          hits: {
            results: [
              hit('urn:aaid:aem:1', '/content/dam/acme/hero.jpg', { 'dc:format': 'image/jpeg' }),
            ],
          },
          cursor: null,
        },
      });
      const client = makeClient([page]);
      const out = await enumerateFolder({ client, folderPath: '/content/dam/acme' });
      expect(out.assets[0]).toMatchObject({
        assetId: 'urn:aaid:aem:1',
        repoPath: '/content/dam/acme/hero.jpg',
        repoName: 'hero.jpg',
      });
    });

    it('throws a rich error (status/body/headers) on a non-ok response', async () => {
      const page = makeRes({ status: 403, body: 'IMS Client ID not allowlisted' });
      const client = makeClient([page]);
      await expect(enumerateFolder({ client, folderPath: '/content/dam/acme' }))
        .rejects.toMatchObject({ status: 403 });
    });
  });
});
