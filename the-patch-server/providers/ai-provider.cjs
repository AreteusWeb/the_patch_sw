/**
 * ai-provider.cjs — Generative AI wrapper/adapter for the AI Coach.
 *
 * server.cjs only knows generateCoachReply(...) and getCoachTools().
 * The real implementation (Vertex AI Gemini or a local mock) is selected
 * here based on APP_MODE.
 */

const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();

let impl;
if (APP_MODE === 'local') {
  impl = require('./ai-provider.local.cjs');
} else {
  impl = require('./ai-provider.gcp.cjs');
}

module.exports = {
  /**
   * @param {{
   *   systemPrompt: string,
   *   history: Array<{role:string,text:string}>,
   *   userMessage: string,
   *   tools?: array,
   *   toolHandlers?: Record<string, Function>,
   * }} args
   * @returns {Promise<{ text: string, toolCalls: array }>}
   */
  generateCoachReply: impl.generateCoachReply,
  /**
   * @param {{ messages: Array<{ role?: string, text?: string }> }} args
   * @returns {Promise<string>}
   */
  generateSessionSummary: impl.generateSessionSummary,
  /** Vertex-format tool declarations for the coach endpoint. */
  getCoachTools: impl.getCoachTools,
  /** Unsplash reference-image search (hotlink + attribution metadata). */
  searchReferenceImage: impl.searchReferenceImage,
  /**
   * Exercise video lookup (curated Pexels and/or YouTube).
   * Live search uses YouTube Data API when curated does not match.
   */
  searchReferenceVideo: impl.searchReferenceVideo,
  /** YouTube Data API exercise tutorial search. */
  searchYouTubeExerciseVideo: impl.searchYouTubeExerciseVideo,
  /**
   * Deterministic Amazon search URL builder (never invents /dp/ASINs).
   */
  getProductSearchLink: impl.getProductSearchLink,
};
