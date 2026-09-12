/**
 * Smart Collections API — persisted dynamic search queries (query + sort + facetFilters).
 * CRUD backed by Cloudflare D1 (SMART_COLLECTIONS binding). Auth is already enforced by
 * withAuthentication (cloudflare/src/auth.js) before any /api/* route runs, so `request.user`
 * is always populated here; ownership is scoped by request.user.sub (Entra sub, same identity
 * used by audit_events.user_id).
 *
 * Distinct from the unrelated "Collections" feature (Dynamic Media asset collections).
 */

import { error, json } from 'itty-router';
import {
  SMART_COLLECTION_VISIBILITY,
  isValidCriteria,
  isValidTitle,
  isValidVisibility,
} from '../../../scripts/smart-collections/smart-collection-types.js';

/**
 * Main Smart Collections API handler - routes requests to the appropriate operation.
 * Path format: /api/smart-collections or /api/smart-collections/<id>
 */
export async function smartCollectionsApi(request, env) {
  const userId = request.user?.sub;
  const userEmail = request.user?.email;
  if (!userId || !userEmail) {
    return error(401, { error: 'User session is incomplete' });
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // pathParts = ['api', 'smart-collections', <id>?]
  const resourceId = pathParts.length > 2 ? pathParts[2] : null;
  const { method } = request;

  if (method === 'GET' && !resourceId) {
    return listSmartCollections(request, env, userId);
  }
  if (method === 'POST' && !resourceId) {
    return createSmartCollection(request, env, userId, userEmail);
  }
  if (method === 'PATCH' && resourceId) {
    return updateSmartCollection(request, env, userId, resourceId);
  }
  if (method === 'DELETE' && resourceId) {
    return deleteSmartCollection(request, env, userId, resourceId);
  }

  return error(404, { error: 'Not Found' });
}

/**
 * Parse the stored `criteria` JSON column for a D1 row, tolerating malformed rows instead of
 * failing the whole list.
 */
function parseCriteria(row) {
  try {
    return { ...row, criteria: JSON.parse(row.criteria) };
  } catch (err) {
    console.warn('[smart-collections] Failed to parse criteria for row', row.id, err?.message);
    return { ...row, criteria: {} };
  }
}

/**
 * GET /api/smart-collections — list collections owned by the user or shared organization-wide.
 */
export async function listSmartCollections(_request, env, userId) {
  try {
    const { results } = await env.SMART_COLLECTIONS.prepare(
      `SELECT * FROM smart_collections
       WHERE user_id = ?1 OR visibility = 'organization'
       ORDER BY updated_at DESC`,
    )
      .bind(userId)
      .all();

    return json(results.map(parseCriteria));
  } catch (err) {
    console.error('[smart-collections] list failed:', err?.message);
    return error(500, { error: 'Failed to list smart collections' });
  }
}

/**
 * POST /api/smart-collections — create a new smart collection.
 */
export async function createSmartCollection(request, env, userId, userEmail) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, { error: 'Invalid JSON body' });
  }

  if (!isValidTitle(body.title)) {
    return error(400, { error: 'A non-empty title (max 200 characters) is required.' });
  }
  if (!isValidCriteria(body.criteria)) {
    return error(400, { error: 'Criteria (query, sort, and/or facetFilters) is required.' });
  }
  if (body.visibility !== undefined && !isValidVisibility(body.visibility)) {
    return error(400, { error: "visibility must be 'private' or 'organization'." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = body.title.trim();
  const description = body.description ? String(body.description).trim() : null;
  const visibility = body.visibility || SMART_COLLECTION_VISIBILITY.PRIVATE;
  const criteria = JSON.stringify(body.criteria);

  try {
    await env.SMART_COLLECTIONS.prepare(
      `INSERT INTO smart_collections
       (id, user_id, user_email, title, description, criteria, visibility, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
      .bind(id, userId, userEmail, title, description, criteria, visibility, now)
      .run();
  } catch (err) {
    console.error('[smart-collections] create failed:', err?.message);
    return error(500, { error: 'Failed to create smart collection' });
  }

  return json(
    {
      id,
      user_id: userId,
      user_email: userEmail,
      title,
      description,
      criteria: body.criteria,
      visibility,
      created_at: now,
      updated_at: now,
    },
    { status: 201 },
  );
}

/**
 * PATCH /api/smart-collections/:id — partial update. Owner-only, even for
 * organization-visible collections.
 */
export async function updateSmartCollection(request, env, userId, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, { error: 'Invalid JSON body' });
  }

  if (body.title !== undefined && !isValidTitle(body.title)) {
    return error(400, { error: 'title must be a non-empty string (max 200 characters).' });
  }
  if (body.criteria !== undefined && !isValidCriteria(body.criteria)) {
    return error(400, { error: 'criteria must be an object.' });
  }
  if (body.visibility !== undefined && !isValidVisibility(body.visibility)) {
    return error(400, { error: "visibility must be 'private' or 'organization'." });
  }

  const now = new Date().toISOString();

  try {
    const res = await env.SMART_COLLECTIONS.prepare(
      `UPDATE smart_collections
       SET title = COALESCE(?1, title),
           description = COALESCE(?2, description),
           criteria = COALESCE(?3, criteria),
           visibility = COALESCE(?4, visibility),
           updated_at = ?5
       WHERE id = ?6 AND user_id = ?7`,
    )
      .bind(
        body.title !== undefined ? body.title.trim() : null,
        body.description !== undefined ? (body.description ? String(body.description).trim() : null) : null,
        body.criteria !== undefined ? JSON.stringify(body.criteria) : null,
        body.visibility !== undefined ? body.visibility : null,
        now,
        id,
        userId,
      )
      .run();

    if (!res.meta.changes) {
      return error(404, { error: 'Smart collection not found or you do not have permission to modify it.' });
    }
  } catch (err) {
    console.error('[smart-collections] update failed:', err?.message);
    return error(500, { error: 'Failed to update smart collection' });
  }

  return json({ success: true, id, updated_at: now });
}

/**
 * DELETE /api/smart-collections/:id — owner-only delete.
 */
export async function deleteSmartCollection(_request, env, userId, id) {
  try {
    const res = await env.SMART_COLLECTIONS.prepare(
      'DELETE FROM smart_collections WHERE id = ?1 AND user_id = ?2',
    )
      .bind(id, userId)
      .run();

    if (!res.meta.changes) {
      return error(404, { error: 'Smart collection not found or you do not have permission to delete it.' });
    }
  } catch (err) {
    console.error('[smart-collections] delete failed:', err?.message);
    return error(500, { error: 'Failed to delete smart collection' });
  }

  return new Response(null, { status: 204 });
}
