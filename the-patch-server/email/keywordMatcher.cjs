'use strict';
/**
 * Pure keyword matching against email envelope fields (subject + from).
 * Lowercase + strip accents (NFD). No I/O.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * @param {{ subject?: string, from?: string }|null|undefined} message
 * @param {string[]|null|undefined} keywords
 * @returns {string[]} keywords that matched (original spelling from input list)
 */
function matchKeywords(message, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return [];
  const subject = normalizeText(message?.subject);
  const from = normalizeText(message?.from);
  const haystack = `${subject} ${from}`;
  const hits = [];
  for (const raw of keywords) {
    if (raw == null) continue;
    const needle = normalizeText(raw);
    if (!needle) continue;
    if (haystack.includes(needle)) hits.push(String(raw));
  }
  return hits;
}

const { KEYWORD_LIMITS } = require('./config.cjs');

/**
 * Validate + normalize a keywords array for storage.
 * @param {unknown} raw
 * @returns {{ ok: true, keywords: string[] } | { ok: false, error: string, message: string }}
 */
function validateKeywords(raw) {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'invalid_keywords',
      message: 'keywords must be an array of strings',
    };
  }
  if (raw.length > KEYWORD_LIMITS.maxCount) {
    return {
      ok: false,
      error: 'invalid_keywords',
      message: `At most ${KEYWORD_LIMITS.maxCount} keywords allowed`,
    };
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') {
      return {
        ok: false,
        error: 'invalid_keywords',
        message: 'Each keyword must be a string',
      };
    }
    const trimmed = item.trim();
    if (trimmed.length < KEYWORD_LIMITS.minLen || trimmed.length > KEYWORD_LIMITS.maxLen) {
      return {
        ok: false,
        error: 'invalid_keywords',
        message: `Each keyword must be ${KEYWORD_LIMITS.minLen}-${KEYWORD_LIMITS.maxLen} characters`,
      };
    }
    const norm = normalizeText(trimmed);
    if (seen.has(norm)) {
      return {
        ok: false,
        error: 'invalid_keywords',
        message: 'Duplicate keywords are not allowed',
      };
    }
    seen.add(norm);
    out.push(trimmed);
  }
  return { ok: true, keywords: out };
}

module.exports = {
  normalizeText,
  matchKeywords,
  validateKeywords,
};
