import { describe, expect, it } from 'vitest';
import { DynamicMediaClient } from '../dynamicmedia-client.js';

const nativeQuery = [
  { match: { text: 'tea', mode: 'HYBRID' } },
  { term: { 'assetMetadata.dam:assetStatus': ['approved'] } },
];

describe('DynamicMediaClient native Smart Collection queries', () => {
  it('uses the saved query unchanged while owning paging and sorting controls', () => {
    const client = new DynamicMediaClient();
    const request = client.buildQueryRequest('ignored', {
      nativeQuery,
      hitsPerPage: 12,
      cursor: 'next-page',
      orderBy: 'repositoryMetadata.repo:modifyDate desc',
    });

    expect(request).toEqual({
      query: nativeQuery,
      limit: 12,
      cursor: 'next-page',
      orderBy: 'repositoryMetadata.repo:modifyDate desc',
    });
    expect(request.query).not.toBe(nativeQuery);
  });

  it('does not mutate the saved query', () => {
    const client = new DynamicMediaClient();
    const original = structuredClone(nativeQuery);

    client.buildQueryRequest('ignored', { nativeQuery });

    expect(nativeQuery).toEqual(original);
  });

  it('ANDs runtime facet refinements around the saved query', () => {
    const client = new DynamicMediaClient();
    const request = client.buildQueryRequest('ignored', {
      nativeQuery,
      facetFilters: [[{ key: 'dam:format', value: 'image/jpeg' }]],
    });

    expect(request.query).toEqual([{
      and: [
        { and: nativeQuery },
        { and: [{ term: { 'assetMetadata.dam:format': ['image/jpeg'] } }] },
      ],
    }]);
  });
});
