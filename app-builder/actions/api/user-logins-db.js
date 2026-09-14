/**
 * User Logins API on `@adobe/aio-lib-db` — document-DB port of
 * cloudflare/src/api/user-logins.js.
 *
 * - `upsertUserLoginDb(env, loginData)`: called on every real login (from the
 *   dispatcher's auth callback). Upsert keyed by email; `first_login_date` is set
 *   once via `$setOnInsert`. Roles/permissions are stored as arrays (the D1
 *   version packed them into pipe-delimited strings).
 * - `exportUserLoginsCsvDb(request, env, user)`: GET /api/user-logins/csv,
 *   admin-only CSV export.
 *
 * Note: a large CSV export can exceed the 1 MB action response cap (limit #1) —
 * paginate/stream for production-scale data.
 */
import { getCollection } from '../storage/db.js';
import { jsonRes } from './_helpers.js';

const COLLECTION = 'user_logins';
const CSV_FILENAME_PREFIX = 'spark-user-logins';
const REQUIRED_PERMISSION = 'admin-reports';

/** Split a full name into first/last (mirrors the Worker). */
export function parseName(fullName) {
  if (!fullName?.trim()) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Upsert a login record by email. Never throws — login must succeed regardless. */
export async function upsertUserLoginDb(env, loginData) {
  try {
    const { email, userId, fullName, title, country, employeeType, company, roles, permissions } = loginData;
    if (!email) {
      console.warn('[user-logins] upsert skipped: no email');
      return;
    }
    const col = await getCollection(env, COLLECTION);
    const { firstName, lastName } = parseName(fullName);
    const now = new Date().toISOString();

    await col.updateOne(
      { email },
      {
        $set: {
          user_id: userId || '',
          full_name: fullName || '',
          first_name: firstName,
          last_name: lastName,
          title: title || '',
          country: country || '',
          employee_type: employeeType || '',
          company: company || '',
          roles: toArr(roles),
          permissions: toArr(permissions),
          last_login_date: now,
          last_updated: now,
        },
        $setOnInsert: { first_login_date: now },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('[user-logins] upsert failed:', err?.message);
  }
}

function formatDateForCSV(isoDate) {
  if (!isoDate) return '';
  try {
    const d = new Date(isoDate);
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${mins}`;
  } catch {
    return '';
  }
}

function escapeCSVField(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** GET /api/user-logins/csv — admin CSV export. */
export async function exportUserLoginsCsvDb(request, env, user) {
  if (request.method !== 'GET') return jsonRes(405, { success: false, error: 'Method not allowed' });
  if (!user?.permissions?.includes(REQUIRED_PERMISSION)) {
    console.warn('[user-logins csv] permission denied for', user?.email);
    return jsonRes(403, { success: false, error: `Permission denied. Requires ${REQUIRED_PERMISSION} permission.` });
  }

  try {
    const col = await getCollection(env, COLLECTION);
    const users = await col.find({}).project({ _id: 0 }).toArray();
    users.sort((a, b) => String(a.first_login_date).localeCompare(String(b.first_login_date)));

    const lines = [
      ['User ID', 'Full Name', 'First Name', 'Last Name', 'E-mail Address', 'Created Date',
        'Last Login Date', 'profile/country', 'profile/userType', 'profile/title', 'Roles', 'Permissions'].join(','),
    ];
    for (const u of users) {
      lines.push([
        escapeCSVField(u.user_id),
        escapeCSVField(u.full_name),
        escapeCSVField(u.first_name),
        escapeCSVField(u.last_name),
        escapeCSVField(u.email),
        escapeCSVField(formatDateForCSV(u.first_login_date)),
        escapeCSVField(formatDateForCSV(u.last_login_date)),
        escapeCSVField(u.country),
        escapeCSVField(u.employee_type),
        escapeCSVField(u.title),
        escapeCSVField(toArr(u.roles).join('|')),
        escapeCSVField(toArr(u.permissions).join('|')),
      ].join(','));
    }
    const csv = lines.join('\n');

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${CSV_FILENAME_PREFIX}-${dateStr}.csv"`,
        'cache-control': 'no-cache',
      },
      body: csv,
    };
  } catch (err) {
    console.error('[user-logins csv] export failed:', err?.message);
    return jsonRes(500, { success: false, error: 'Failed to export user logins', details: err?.message });
  }
}
