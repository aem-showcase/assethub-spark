import { describe, expect, it } from 'vitest';
import {
  cloneNativeQuery,
  getNativeSmartCollectionQuery,
  getSmartCollectionDisplayState,
  isDeliverySmartCollection,
} from '../smart-collection-query.js';

const nativeQuery = [
  { match: { text: 'tea', mode: 'HYBRID' } },
  { term: { 'assetMetadata.dam:assetStatus': ['approved'] } },
];

const smartCollection = {
  collectionMetadata: {
    collectionType: 'DELIVERY_SMART_COLLECTION',
    smartCollectionQuery: { query: nativeQuery },
  },
};

describe('native Smart Collection query helpers', () => {
  it('recognizes native Smart Collections and preserves their query exactly', () => {
    expect(isDeliverySmartCollection(smartCollection)).toBe(true);
    const result = getNativeSmartCollectionQuery(smartCollection);
    expect(result).toEqual(nativeQuery);
    expect(result).not.toBe(nativeQuery);
  });

  it('derives display text and mode without changing the query AST', () => {
    expect(getSmartCollectionDisplayState(nativeQuery)).toEqual({
      query: 'tea',
      searchMode: 'HYBRID',
    });
  });

  it('rejects regular collections and malformed native queries', () => {
    expect(getNativeSmartCollectionQuery({ collectionMetadata: {} })).toBeNull();
    expect(cloneNativeQuery([])).toBeNull();
    expect(cloneNativeQuery(['not-a-query-node'])).toBeNull();
  });

  it('ignores saved top-level request controls', () => {
    const result = getNativeSmartCollectionQuery({
      collectionType: 'DELIVERY_SMART_COLLECTION',
      smartCollectionQuery: {
        query: nativeQuery,
        limit: 1000,
        cursor: 'untrusted',
        useRealPermissions: true,
      },
    });
    expect(result).toEqual(nativeQuery);
  });
});
