/**
 * Smart Collections API Client
 * Thin fetch wrapper around /api/smart-collections (Cloudflare Worker + D1), matching the
 * request conventions used by scripts/collections/collections-api-client.js (credentials
 * included, JSON body/response). Errors are thrown with `.status` set so callers can
 * distinguish 404 (not found/forbidden) from other failures.
 */

const BASE_URL = '/api/smart-collections';

/**
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function parseJsonResponse(response) {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const message = data?.error || `Smart Collections request failed: ${response.status} ${response.statusText}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return data;
}

/**
 * List smart collections owned by the current user or shared organization-wide.
 * @returns {Promise<import('./smart-collection-types.js').SmartCollection[]>}
 */
export function listSmartCollections() {
  return request(BASE_URL, { method: 'GET' });
}

/**
 * Create a new smart collection.
 * @param {import('./smart-collection-types.js').CreateSmartCollectionDTO} dto
 * @returns {Promise<import('./smart-collection-types.js').SmartCollection>}
 */
export function createSmartCollection(dto) {
  return request(BASE_URL, { method: 'POST', body: JSON.stringify(dto) });
}

/**
 * Partially update a smart collection (owner-only).
 * @param {string} id
 * @param {import('./smart-collection-types.js').UpdateSmartCollectionDTO} dto
 * @returns {Promise<{success: boolean, id: string, updated_at: string}>}
 */
export function updateSmartCollection(id, dto) {
  return request(`${BASE_URL}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

/**
 * Delete a smart collection (owner-only).
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteSmartCollection(id) {
  return request(`${BASE_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
