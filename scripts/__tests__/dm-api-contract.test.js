import { describe, expect, it } from 'vitest';
import {
  getDynamicMediaApiKeyForPath,
  isDynamicMediaCollectionsPath,
} from '../dm-api-contract.js';

describe('dm-api-contract', () => {
  it('uses the DM client id for collection CRUD paths', () => {
    expect(getDynamicMediaApiKeyForPath('/adobe/assets/collections', 'dm-client'))
      .toBe('dm-client');
    expect(getDynamicMediaApiKeyForPath('/adobe/assets/collections/abc/items', 'dm-client'))
      .toBe('dm-client');
  });

  it('uses the DM client id for non-collection paths', () => {
    expect(getDynamicMediaApiKeyForPath('/adobe/assets/search', 'dm-client')).toBe('dm-client');
    expect(getDynamicMediaApiKeyForPath('/adobe/assets/contentai/collections/search', 'dm-client'))
      .toBe('dm-client');
  });

  it('accepts full URLs and strips query strings', () => {
    expect(isDynamicMediaCollectionsPath(
      'https://delivery-p1-e1.adobeaemcloud.com/adobe/assets/collections?id=abc',
    )).toBe(true);
  });

  it('requires a DM client id for all paths', () => {
    expect(() => getDynamicMediaApiKeyForPath('/adobe/assets/search'))
      .toThrow(/dmClientId is required/);
    expect(() => getDynamicMediaApiKeyForPath('/adobe/assets/collections'))
      .toThrow(/dmClientId is required/);
  });
});
