/* eslint-disable import/prefer-default-export */
/**
 * Utilities for safe, privacy-conscious log formatting.
 * (Copied verbatim from cloudflare/src/util/log-utils.js — platform-agnostic.)
 */

/**
 * Mask an email address for safe logging — shows first char and domain only.
 * @param {string} email
 * @returns {string} e.g. "john.smith@example.com" -> "j***@example.com"
 */
export function maskEmail(email) {
  if (!email) return '(none)';
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  return `${email[0]}***${email.slice(atIdx)}`;
}
