/**
 * ISO-3166-1 alpha-2 country code to lowercase country name mapping.
 * Kept as an independent worker-side copy — asset metadata can tag `allowedCountries`
 * with either the ISO code or the full lowercase name, and `user.country` (from the
 * Entra ID `ctry` claim) is always an ISO code, so both forms must be checked when
 * building search/authorization filters.
 */
export const COUNTRY_CODE_TO_NAME = Object.freeze({
  us: 'usa',
  gb: 'uk',
  in: 'india',
  ca: 'canada',
  au: 'australia',
  de: 'germany',
  fr: 'france',
  it: 'italy',
  es: 'spain',
  pt: 'portugal',
  nl: 'netherlands',
  be: 'belgium',
  ch: 'switzerland',
  at: 'austria',
  se: 'sweden',
  no: 'norway',
  dk: 'denmark',
  fi: 'finland',
  pl: 'poland',
  ie: 'ireland',
  br: 'brazil',
  mx: 'mexico',
  jp: 'japan',
  cn: 'china',
  sg: 'singapore',
  ae: 'uae',
});

/** Inverse of COUNTRY_CODE_TO_NAME, for resolving a name back to its ISO code. */
export const COUNTRY_NAME_TO_CODE = Object.freeze(
  Object.fromEntries(Object.entries(COUNTRY_CODE_TO_NAME).map(([code, name]) => [name, code])),
);

/**
 * Resolve all values that should match a given ISO country code in asset metadata —
 * the raw code itself plus its mapped lowercase name, if known, so the auth filter
 * matches assets tagged with either form.
 * @param {string} isoCode - ISO-3166-1 alpha-2 country code (any case)
 * @returns {string[]} Values to match against `assetMetadata.allowedCountries`
 */
export function resolveCountryMatchValues(isoCode) {
  if (!isoCode) return [];
  const normalized = String(isoCode).trim().toLowerCase();
  if (!normalized) return [];
  const values = [isoCode];
  const name = COUNTRY_CODE_TO_NAME[normalized];
  if (name) values.push(name);
  return values;
}
