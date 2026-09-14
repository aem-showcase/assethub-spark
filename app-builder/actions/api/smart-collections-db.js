/**
 * Smart Collections API on `@adobe/aio-lib-db` — the document-DB port of the
 * Cloudflare D1 handler (cloudflare/src/api/smart-collections.js). Same HTTP
 * contract (paths, methods, request/response shapes) so the EDS frontend is
 * unchanged; only the storage layer differs.
 *
 * Modeling: one document per collection. The app UUID is stored as a plain `id`
 * field (the frontend's key); the auto `_id` is projected out of responses.
 * `criteria` is stored as a nested object (not a JSON string as in D1).
 */
import { getCollection } from '../storage/db.js';
import {
  SMART_COLLECTION_VISIBILITY,
  isValidCriteria,
  isValidTitle,
  isValidVisibility,
} from '../../../scripts/smart-collections/smart-collection-types.js';
import { jsonRes, noContent, readJson } from './_helpers.js';

const COLLECTION = 'smart_collections';

export async function smartCollectionsDbApi(request, env, user) {
  const userId = user?.sub;
  const userEmail = user?.email;
  if (!userId || !userEmail) return jsonRes(401, { error: 'User session is incomplete' });

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','smart-collections',<id>?]
  const resourceId = parts.length > 2 ? parts[2] : null;
  const { method } = request;

  let col;
  try {
    col = await getCollection(env, COLLECTION);
  } catch (err) {
    console.error('[smart-collections] db init failed:', err?.message);
    return jsonRes(500, { error: 'Storage unavailable' });
  }

  if (method === 'GET' && !resourceId) return listSmartCollections(col, userId);
  if (method === 'POST' && !resourceId) return createSmartCollection(col, request, userId, userEmail);
  if (method === 'PATCH' && resourceId) return updateSmartCollection(col, request, userId, resourceId);
  if (method === 'DELETE' && resourceId) return deleteSmartCollection(col, userId, resourceId);
  return jsonRes(404, { error: 'Not Found' });
}

async function listSmartCollections(col, userId) {
  try {
    const rows = await col
      .find({ $or: [{ user_id: userId }, { visibility: 'organization' }] })
      .project({ _id: 0 })
      .toArray();
    // Sort newest-first (D1: ORDER BY updated_at DESC). Small per-user set.
    rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return jsonRes(200, rows);
  } catch (err) {
    console.error('[smart-collections] list failed:', err?.message);
    return jsonRes(500, { error: 'Failed to list smart collections' });
  }
}

async function createSmartCollection(col, request, userId, userEmail) {
  const body = await readJson(request);
  if (!body) return jsonRes(400, { error: 'Invalid JSON body' });

  if (!isValidTitle(body.title)) {
    return jsonRes(400, { error: 'A non-empty title (max 200 characters) is required.' });
  }
  if (!isValidCriteria(body.criteria)) {
    return jsonRes(400, { error: 'Criteria (query, sort, and/or facetFilters) is required.' });
  }
  if (body.visibility !== undefined && !isValidVisibility(body.visibility)) {
    return jsonRes(400, { error: "visibility must be 'private' or 'organization'." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc = {
    id,
    user_id: userId,
    user_email: userEmail,
    title: body.title.trim(),
    description: body.description ? String(body.description).trim() : null,
    criteria: body.criteria,
    visibility: body.visibility || SMART_COLLECTION_VISIBILITY.PRIVATE,
    created_at: now,
    updated_at: now,
  };

  try {
    await col.insertOne({ ...doc });
  } catch (err) {
    console.error('[smart-collections] create failed:', err?.message);
    return jsonRes(500, { error: 'Failed to create smart collection' });
  }
  return jsonRes(201, doc);
}

async function updateSmartCollection(col, request, userId, id) {
  const body = await readJson(request);
  if (!body) return jsonRes(400, { error: 'Invalid JSON body' });

  if (body.title !== undefined && !isValidTitle(body.title)) {
    return jsonRes(400, { error: 'title must be a non-empty string (max 200 characters).' });
  }
  if (body.criteria !== undefined && !isValidCriteria(body.criteria)) {
    return jsonRes(400, { error: 'criteria must be an object.' });
  }
  if (body.visibility !== undefined && !isValidVisibility(body.visibility)) {
    return jsonRes(400, { error: "visibility must be 'private' or 'organization'." });
  }

  const now = new Date().toISOString();
  // Mirror D1's COALESCE: only overwrite fields explicitly provided (and, for
  // description, only when non-empty — matching the Worker's behaviour).
  const set = { updated_at: now };
  if (body.title !== undefined) set.title = body.title.trim();
  if (body.description !== undefined && body.description) set.description = String(body.description).trim();
  if (body.criteria !== undefined) set.criteria = body.criteria;
  if (body.visibility !== undefined) set.visibility = body.visibility;

  try {
    const res = await col.updateOne({ id, user_id: userId }, { $set: set });
    if (!res.matchedCount) {
      return jsonRes(404, { error: 'Smart collection not found or you do not have permission to modify it.' });
    }
  } catch (err) {
    console.error('[smart-collections] update failed:', err?.message);
    return jsonRes(500, { error: 'Failed to update smart collection' });
  }
  return jsonRes(200, { success: true, id, updated_at: now });
}

async function deleteSmartCollection(col, userId, id) {
  try {
    const res = await col.deleteOne({ id, user_id: userId });
    if (!res.deletedCount) {
      return jsonRes(404, { error: 'Smart collection not found or you do not have permission to delete it.' });
    }
  } catch (err) {
    console.error('[smart-collections] delete failed:', err?.message);
    return jsonRes(500, { error: 'Failed to delete smart collection' });
  }
  return noContent();
}
