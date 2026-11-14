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

module.exports = {
  normalizeText,
  matchKeywords,
};
