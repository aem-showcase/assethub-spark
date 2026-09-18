import {
  describe, it, expect, vi,
} from 'vitest';
import {
  DmCollectionsClient,
  buildCompanyAssetSearchBody,
  buildCompanyCollectionsSearchBody,
  assetHitToRecord,
  collectionHitToRecord,
} from '../../scripts/assets/dm-collections-client.js';
import { makeRes } from './helpers.js';

function stubTokenProvider() {
  return {
    getToken: vi.fn(async () => 'tok'),
    refresh: vi.fn(async () => 'tok2'),
  };
}

const HOST = 'https://delivery-p1-e1.adobeaemcloud.com';

describe('dm-collections-client', () => {
  describe('buildCompanyAssetSearchBody', () => {
    it('scopes the query to the company via a nested term', () => {
      const body = buildCompanyAssetSearchBody({ company: 'acme', limit: 10 });
      expect(body.limit).toBe(10);
      const { and } = body.query[0];
      const termBlock = and.find((c) => c.and);
      expect(termBlock.and[0]).toEqual({ term: { 'assetMetadata.company': ['acme'] } });
    });

    describe('buildCompanyCollectionsSearchBody', () => {
      it('scopes collection search to collections stamped for the company', () => {
        const body = buildCompanyCollectionsSearchBody({ company: 'disney-in', limit: 10 });
        expect(body.limit).toBe(10);
        const { and } = body.query[0];
        expect(and).toContainEqual({ exists: { field: 'collectionMetadata.custom:metadata.company' } });
        expect(and).toContainEqual({
          term: { 'collectionMetadata.custom:metadata.company': ['disney-in'] },
        });
      });
    });
    it('adds a cursor when provided', () => {
      const body = buildCompanyAssetSearchBody({ company: 'acme', cursor: 'c1' });
      expect(body.cursor).toBe('c1');
    });
  });

  describe('assetHitToRecord', () => {
    it('extracts assetId + facet metadata', () => {
      const rec = assetHitToRecord({
        assetId: 'urn:1',
        assetMetadata: {
          'dc:title': 'Hero', productCategory: 'coffee', campaign: 'spring', company: 'acme',
        },
      });

      describe('collectionHitToRecord', () => {
        it('extracts id, title and company metadata', () => {
          expect(collectionHitToRecord({
            collectionId: 'c1',
            collectionMetadata: {
              title: 'Disney India — Cruise',
              itemCount: 3,
              'custom:metadata': { company: 'disney-in' },
            },
          })).toEqual({
            collectionId: 'c1',
            title: 'Disney India — Cruise',
            company: 'disney-in',
            itemCount: 3,
          });
        });
      });
      expect(rec).toEqual({
        assetId: 'urn:1',
        title: 'Hero',
        productCategory: 'coffee',
        campaign: 'spring',
        channel: null,
        company: 'acme',
      });
    });
  });

  describe('searchCompanyAssets', () => {
    it('sends the DM search headers/api-key and normalizes hits', async () => {
      const fetchFn = vi.fn(async () => makeRes({
        body: { hits: { results: [{ assetId: 'a1', assetMetadata: { productCategory: 'coffee' } }] } },
      }));
      const client = new DmCollectionsClient({
        tokenProvider: stubTokenProvider(), clientId: 'dm-client', deliveryHost: HOST, fetchFn,
      });

      describe('searchCompanyCollections', () => {
        it('uses the Content Hub collections api-key and search headers', async () => {
          const fetchFn = vi.fn(async () => makeRes({
            body: {
              hits: {
                results: [{
                  collectionId: 'c1',
                  collectionMetadata: {
                    title: 'Disney India — Cruise',
                    'custom:metadata': { company: 'disney-in' },
                  },
                }],
              },
            },
          }));
          const client = new DmCollectionsClient({
            tokenProvider: stubTokenProvider(), clientId: 'dm-client', deliveryHost: HOST, fetchFn,
          });

          const collections = await client.searchCompanyCollections({ company: 'disney-in', limit: 50 });

          expect(collections).toEqual([{
            collectionId: 'c1',
            title: 'Disney India — Cruise',
            company: 'disney-in',
            itemCount: null,
          }]);
          const [url, init] = fetchFn.mock.calls[0];
          expect(url).toBe(`${HOST}/adobe/experimental/collectionsearch-expires-20260915/assets/collections/search`);
          expect(init.headers['x-api-key']).toBe('aem-assets-content-hub-1');
          expect(init.headers['x-ch-request']).toBe('search');
          expect(init.headers['x-polaris-search-provider']).toBe('3');
        });
      });
      const assets = await client.searchCompanyAssets({ company: 'acme', limit: 50 });
      expect(assets).toEqual([{
        assetId: 'a1', title: 'Untitled Asset', productCategory: 'coffee', campaign: null, channel: null, company: null,
      }]);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(`${HOST}/adobe/assets/search`);
      expect(init.headers['x-api-key']).toBe('dm-client');
      expect(init.headers['x-ch-request']).toBe('search');
      expect(init.headers['x-polaris-search-provider']).toBe('3');
      expect(init.headers.Authorization).toBe('Bearer tok');
    });

    it('paginates via cursor until limit reached', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(makeRes({ body: { hits: { results: [{ assetId: 'a1' }] }, cursor: 'c1' } }))
        .mockResolvedValueOnce(makeRes({ body: { hits: { results: [{ assetId: 'a2' }] }, cursor: null } }));
      const client = new DmCollectionsClient({
        tokenProvider: stubTokenProvider(), clientId: 'k', deliveryHost: HOST, fetchFn,
      });
      const assets = await client.searchCompanyAssets({ company: 'acme', limit: 100 });
      expect(assets.map((a) => a.assetId)).toEqual(['a1', 'a2']);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('refreshes the token once on 401 and retries', async () => {
      const tokenProvider = stubTokenProvider();
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(makeRes({ status: 401 }))
        .mockResolvedValueOnce(makeRes({ body: { hits: { results: [] } } }));
      const client = new DmCollectionsClient({
        tokenProvider, clientId: 'k', deliveryHost: HOST, fetchFn,
      });
      await client.searchCompanyAssets({ company: 'acme' });
      expect(tokenProvider.refresh).toHaveBeenCalledTimes(1);
      const secondInit = fetchFn.mock.calls[1][1];
      expect(secondInit.headers.Authorization).toBe('Bearer tok2');
    });
  });

  describe('createCollection', () => {
    it('stamps custom:metadata.company, accessLevel and asset items with the collections api-key', async () => {
      const fetchFn = vi.fn(async () => makeRes({ body: { collectionId: 'col-1' } }));
      const client = new DmCollectionsClient({
        tokenProvider: stubTokenProvider(), clientId: 'dm-client', deliveryHost: HOST, fetchFn,
      });
      const out = await client.createCollection({
        title: 'Acme — Coffee', company: 'acme', assetIds: ['a1', 'a2'],
      });
      expect(out).toEqual({ collectionId: 'col-1' });
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(`${HOST}/adobe/assets/collections`);
      expect(init.headers['x-api-key']).toBe('aem-assets-content-hub-1');
      const body = JSON.parse(init.body);
      expect(body['custom:metadata']).toEqual({ company: 'acme' });
      expect(body.accessLevel).toBe('public');
      expect(body.items).toEqual([{ type: 'asset', id: 'a1' }, { type: 'asset', id: 'a2' }]);
    });

    it('derives the collections api-key from the shared path contract', async () => {
      const fetchFn = vi.fn(async () => makeRes({ body: { collectionId: 'col-1' } }));
      const client = new DmCollectionsClient({
        tokenProvider: stubTokenProvider(), clientId: 'different-dm-client', deliveryHost: HOST, fetchFn,
      });

      await client.createCollection({ title: 'Acme', company: 'acme' });

      expect(fetchFn.mock.calls[0][1].headers['x-api-key']).toBe('aem-assets-content-hub-1');
    });

    it('throws a descriptive error on non-2xx', async () => {
      const fetchFn = vi.fn(async () => makeRes({ status: 500, body: 'boom' }));
      const client = new DmCollectionsClient({
        tokenProvider: stubTokenProvider(), clientId: 'k', deliveryHost: HOST, fetchFn,
      });
      await expect(client.createCollection({ title: 't', company: 'acme' }))
        .rejects.toThrow(/DM POST \/adobe\/assets\/collections failed: 500/);
    });
  });
});
