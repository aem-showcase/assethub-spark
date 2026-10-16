import { describe, expect, it } from 'vitest';
import { getApiParams } from '../collection-list-filters.js';
import {
  CollectionAccessFilter,
  CollectionCreatedByMeVisibility,
  CollectionCreatorFilter,
  CollectionKind,
  CollectionListSegment,
} from '../collection-search-constants.js';

describe('getApiParams', () => {
  it('maps Smart Collections created by me to owned private and public Smart Collections', () => {
    expect(getApiParams(
      CollectionAccessFilter.SMART_COLLECTIONS,
      CollectionCreatorFilter.ME,
    )).toEqual({
      relationship: CollectionListSegment.CREATED_BY_ME,
      visibility: CollectionCreatedByMeVisibility.ALL,
      collectionKind: CollectionKind.SMART,
    });
  });

  it('maps Smart Collections created by anyone to all accessible Smart Collections', () => {
    expect(getApiParams(
      CollectionAccessFilter.SMART_COLLECTIONS,
      CollectionCreatorFilter.ANYONE,
    )).toEqual({
      relationship: CollectionListSegment.ALL,
      collectionKind: CollectionKind.SMART,
    });
  });

  it.each([
    [CollectionAccessFilter.ALL, CollectionCreatorFilter.ANYONE, {
      relationship: CollectionListSegment.ALL,
    }],
    [CollectionAccessFilter.ONLY_ME, CollectionCreatorFilter.ANYONE, {
      relationship: CollectionListSegment.CREATED_BY_ME,
      visibility: CollectionCreatedByMeVisibility.PRIVATE,
    }],
    [CollectionAccessFilter.VIEW_ONLY, CollectionCreatorFilter.ANYONE, {
      relationship: CollectionListSegment.PUBLIC_VIEW,
    }],
    [CollectionAccessFilter.EDIT, CollectionCreatorFilter.ANYONE, {
      relationship: CollectionListSegment.PUBLIC,
    }],
    [CollectionAccessFilter.SHARED_WITH_ME, CollectionCreatorFilter.ME, { empty: true }],
    [CollectionAccessFilter.SHARED_BY_ME, CollectionCreatorFilter.ANYONE, { empty: true }],
  ])('preserves the existing %s/%s mapping', (access, creator, expected) => {
    expect(getApiParams(access, creator)).toEqual(expected);
  });
});
