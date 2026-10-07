import config from '../config.js';
import { backendFor } from '../platform/backends.js';
import { CacheOverride } from 'fastly:cache-override';

/**
 * Helix sheet helpers. Ported from cloudflare/src/util/helixutil.js.
 * Only the fetch is adapted for Fastly (declared backend + CacheOverride instead of
 * cf.cacheEverything); the sheet parsing/merging logic is unchanged.
 */
export function handleArrays(obj, arrays) {
  arrays?.forEach((array) => {
    if (obj[array]) {
      obj[array] = obj[array].split(',').map((item) => item.trim());
    } else {
      obj[array] = [];
    }
  });
}

export function convertToMap(rows, options) {
  rows = rows || [];
  return rows.reduce((map, row) => {
    const key = row[options.key];
    if (options.value) {
      map[key] = row[options.value];
    } else {
      map[key] = { ...row };
      handleArrays(map[key], options.arrays);
    }
    return map;
  }, {});
}

export function convertRows(rows, options) {
  rows = rows || [];
  rows.forEach((row) => handleArrays(row, options.arrays));
  return rows;
}

export async function fetchHelixSheet(request, env, path, options) {
  const helixOrigin = request?.helixOrigin || env.HELIX_ORIGIN;
  let url = `${helixOrigin}${path}`;
  if (!url.endsWith('.json')) url += '.json';
  if (options?.params) url += `?${new URLSearchParams(options.params).toString()}`;

  // NOTE (CF->Fastly): Cloudflare auto-decompresses subrequest response bodies; Fastly
  // Compute does not. Since we read this body with response.json(), request an identity
  // (uncompressed) response — otherwise json() parses raw gzip/br bytes and throws
  // "malformed UTF-8 character sequence". (The page proxy in helix.js still forwards the
  // browser's accept-encoding, because there the compressed body is passed straight
  // through to the browser, which decompresses it.)
  const headers = {};
  if (env.HELIX_ORIGIN_AUTHENTICATION) {
    const token = await env.HELIX_ORIGIN_AUTHENTICATION.get();
    if (token) headers.authorization = `token ${token}`;
  }
  const pushInvalidation = config.HELIX_PUSH_INVALIDATION !== 'disabled';
  if (pushInvalidation) headers['x-push-invalidation'] = 'enabled';

  const response = await fetch(url, {
    headers,
    backend: backendFor(url),
    cacheOverride: new CacheOverride('pass'),
  });

  if (!response.ok) {
    console.error('Failed to fetch spreadsheet:', response.status, response.statusText);
    return;
  }

  const json = await response.json();

  if (options?.mergeSheets) {
    const opts = options.mergeSheets;
    const names = json[':names'];
    const sheets = names ? names.map((n) => json[n]?.data).filter(Boolean) : [json.data].filter(Boolean);
    if (opts.key) {
      const merged = {};
      sheets.forEach((data) => {
        const map = convertToMap(data, opts);
        Object.entries(map).forEach(([k, v]) => {
          if (merged[k]) merged[k] = opts.merge(merged[k], v);
          else merged[k] = v;
        });
      });
      return merged;
    }
    return sheets.reduce((all, data) => all.concat(convertRows(data, opts)), []);
  } else if (options?.sheets) {
    return Object.fromEntries(
      Object.entries(options.sheets).map(([name, opt]) => {
        const sheet = json[name];
        if (sheet) {
          if (opt?.key) return [name, convertToMap(sheet.data, opt)];
          return [name, convertRows(sheet.data, opt)];
        }
        return [name, []];
      }),
    );
  } else if (options?.sheet) {
    if (options.sheet.key) return convertToMap(json.data, options.sheet);
    return convertRows(json.data, options.sheet);
  }

  return json;
}
