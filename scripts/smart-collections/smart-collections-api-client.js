/**
 * Smart Collections API Client.
 *
 * Smart Collections are Dynamic Media collections tagged with
 * `collectionType: 'DELIVERY_SMART_COLLECTION'`. This module is a thin domain wrapper around
 * {@link DynamicMediaCollectionsClient} (which talks to the native `/adobe/assets/collections`
 * API through the Cloudflare Worker proxy, injecting auth server-side). It hides the
 * collection-metadata/etag plumbing and exposes a small CRUD surface plus a normalizer that
 * maps a raw API collection to the {@link SmartCollection} shape used across the UI.
 */

import { DynamicMediaCollectionsClient } from '../collections/collections-api-client.js';
import { CollectionAclField } from '../collections/collection-search-constants.js';
import {
  SMART_COLLECTION_TYPE,
  SMART_COLLECTION_ACCESS_LEVEL,
  DEFAULT_SMART_COLLECTION_LAYOUT,
} from './smart-collection-types.js';

/** Per-request page size for scanning collections (the collection-search endpoint rejects
 * larger page sizes with 400), and the max pages we scan when listing Smart Collections. */
const LIST_PAGE_SIZE = 40;
const LIST_MAX_PAGES = 10;

let sharedClient = null;

/**
 * Lazily create a single collections client bound to the current user.
 * @returns {DynamicMediaCollectionsClient}
 */
function getClient() {
  if (!sharedClient) {
    sharedClient = new DynamicMediaCollectionsClient({
      user: typeof window !== 'undefined' ? window.user : undefined,
    });
  }
  return sharedClient;
}

/**
 * @param {Object} apiCollection - Raw collection object from the API (search hit or metadata).
 * @returns {boolean}
 */
export function isSmartCollection(apiCollection) {
  const metadata = apiCollection?.collectionMetadata || {};
  return (metadata.collectionType || apiCollection?.collectionType) === SMART_COLLECTION_TYPE;
}

/**
 * Normalize a raw API collection into the {@link SmartCollection} shape.
 * @param {Object} apiCollection
 * @returns {import('./smart-collection-types.js').SmartCollection}
 */
export function transformApiToSmartCollection(apiCollection) {
  const metadata = apiCollection?.collectionMetadata || {};
  const repoMetadata = apiCollection?.repositoryMetadata || {};
  const acl = metadata['custom:metadata']?.['custom:acl'] || null;
  const ownerEmail = acl?.['custom:assetCollectionOwner'] || '';
  const currentUserEmail = (typeof window !== 'undefined' ? window.user?.email : '') || '';

  return {
    id: apiCollection?.collectionId || apiCollection?.id,
    title: metadata.title || 'Untitled Smart Collection',
    description: metadata.description || '',
    smartCollectionQuery:
      metadata.smartCollectionQuery || apiCollection?.smartCollectionQuery || null,
    accessLevel: metadata.accessLevel || SMART_COLLECTION_ACCESS_LEVEL.PRIVATE,
    accessPrincipals: metadata.accessPrincipals || apiCollection?.accessPrincipals || [],
    layout: metadata.layout || DEFAULT_SMART_COLLECTION_LAYOUT,
    thumbnail: metadata.thumbnail || apiCollection?.thumbnail || '',
    ownerEmail,
    isOwner: !!ownerEmail && ownerEmail.toLowerCase() === currentUserEmail.toLowerCase(),
    updatedAt: metadata.lastModifiedDate
      || repoMetadata['repo:modifyDate']
      || repoMetadata['repo-modifyDate']
      || '',
    apiData: apiCollection,
  };
}

/**
 * List Smart Collections available to the current user (own + shared/public), newest first.
 * @returns {Promise<import('./smart-collection-types.js').SmartCollection[]>}
 */
export async function listSmartCollections() {
  const client = getClient();
  const smart = [];
  let cursor;
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    // Sequential by necessity: each page request needs the previous page's cursor.
    // eslint-disable-next-line no-await-in-loop
    const { items = [], cursor: nextCursor } = await client.searchCollections({
      relationship: 'all',
      limit: LIST_PAGE_SIZE,
      cursor,
    });
    smart.push(...items.filter(isSmartCollection));
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }
  return smart.map(transformApiToSmartCollection);
}

/**
 * Fetch a single Smart Collection's full metadata (including `smartCollectionQuery`).
 * @param {string} id - collectionId.
 * @returns {Promise<import('./smart-collection-types.js').SmartCollection>}
 */
export async function getSmartCollection(id) {
  const apiCollection = await getClient().getCollectionMetadata(id);
  return transformApiToSmartCollection(apiCollection);
}

/**
 * Build the native `/adobe/assets/collections` create/update body from a Smart Collection DTO.
 * @param {Object} dto
 * @returns {Object}
 */
function buildCollectionPayload(dto) {
  const ownerEmail = (typeof window !== 'undefined' ? window.user?.email : '') || '';
  const payload = {
    collectionType: SMART_COLLECTION_TYPE,
    title: dto.title,
    description: dto.description || '',
    accessLevel: dto.accessLevel || SMART_COLLECTION_ACCESS_LEVEL.PRIVATE,
    layout: dto.layout || DEFAULT_SMART_COLLECTION_LAYOUT,
    smartCollectionQuery: dto.smartCollectionQuery,
    'custom:metadata': {
      'custom:acl': {
        [CollectionAclField.OWNER]: ownerEmail,
        [CollectionAclField.VIEWER]: [],
      },
    },
  };
  if (dto.thumbnail) payload.thumbnail = dto.thumbnail;
  if (Array.isArray(dto.accessPrincipals) && dto.accessPrincipals.length > 0) {
    payload.accessPrincipals = dto.accessPrincipals;
  }
  return payload;
}

/**
 * Create a new Smart Collection.
 * @param {Object} dto - { title, description?, accessLevel?, accessPrincipals?, layout?,
 *   thumbnail?, smartCollectionQuery }
 * @returns {Promise<import('./smart-collection-types.js').SmartCollection>}
 */
export async function createSmartCollection(dto) {
  const created = await getClient().createCollection(buildCollectionPayload(dto));
  return transformApiToSmartCollection(created);
}

/**
 * Partially update a Smart Collection (owner-only, enforced server-side). Only the provided
 * fields are changed; the collection's existing metadata is preserved.
 * @param {string} id - collectionId.
 * @param {Object} patch - Any subset of { title, description, accessLevel, accessPrincipals,
 *   layout, thumbnail, smartCollectionQuery }.
 * @returns {Promise<import('./smart-collection-types.js').SmartCollection>}
 */
export async function updateSmartCollection(id, patch) {
  const client = getClient();
  // Read current metadata once — needed for the ETag and to preserve custom:metadata
  // (owner ACL + company stamp). Passing this snapshot back to updateCollectionMetadata
  // also avoids a redundant GET.
  const current = await client.getCollectionMetadata(id);
  const currentCustom = current?.collectionMetadata?.['custom:metadata'] || {};
  const currentAcl = currentCustom['custom:acl'] || {};

  const updateData = {};
  if (patch.title !== undefined) updateData.title = patch.title;
  if (patch.description !== undefined) updateData.description = patch.description;
  if (patch.accessLevel !== undefined) updateData.accessLevel = patch.accessLevel;
  if (patch.accessPrincipals !== undefined) updateData.accessPrincipals = patch.accessPrincipals;
  if (patch.layout !== undefined) updateData.layout = patch.layout;
  if (patch.thumbnail !== undefined) updateData.thumbnail = patch.thumbnail;
  if (patch.smartCollectionQuery !== undefined) {
    updateData.smartCollectionQuery = patch.smartCollectionQuery;
  }

  // updateCollectionMetadata shallow-merges updateData over the stored collectionMetadata, so
  // any custom:metadata we send REPLACES the stored one. Rebuild it from the current value and
  // guarantee the owner ACL is present so the collection stays visible under the ACL-filtered
  // collections search (this also repairs Smart Collections created without an owner ACL).
  const ownerEmail = currentAcl[CollectionAclField.OWNER]
    || (typeof window !== 'undefined' ? window.user?.email : '') || '';
  updateData['custom:metadata'] = {
    ...currentCustom,
    'custom:acl': {
      ...currentAcl,
      [CollectionAclField.OWNER]: ownerEmail,
      [CollectionAclField.VIEWER]: currentAcl[CollectionAclField.VIEWER] || [],
    },
  };

  const updated = await client.updateCollectionMetadata(id, updateData, {
    currentCollection: current,
  });
  return transformApiToSmartCollection(updated);
}

/**
 * Delete a Smart Collection (owner-only, enforced server-side).
 * @param {string} id - collectionId.
 * @returns {Promise<void>}
 */
export async function deleteSmartCollection(id) {
  await getClient().deleteCollection(id);
}
