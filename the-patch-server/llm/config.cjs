'use strict';
/**
 * Central config for the multi-provider layer.
 * Model IDs come from env vars so we never hardcode names that change every few weeks.
 * Gemini defaults reuse what the existing server already uses.
 */
function env(name, fallback = null) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

const MODELS = {
  gemini: {
    economy: env('GEMINI_MODEL_ECONOMY', env('VERTEX_AI_INSIGHTS_MODEL', 'gemini-3.1-flash-lite')),
    mid: env('GEMINI_MODEL_MID', env('VERTEX_AI_MODEL', 'gemini-3.8-flash')),
    premium: env('GEMINI_MODEL_PREMIUM', null),
  },
  openai: {
    // No defaults on purpose: pick the model IDs from OpenAI's docs and set them in .env
    economy: env('OPENAI_MODEL_ECONOMY', null),
    mid: env('OPENAI_MODEL_MID', null),
    premium: env('OPENAI_MODEL_PREMIUM', null),
  },
};

/**
 * USD per 1,000,000 tokens. FILL THESE IN from each provider's pricing page.
 * Left null on purpose: until filled, costUsd is reported as null (not a wrong number).
 * Example reference list prices seen in Sep 2026 trackers (VERIFY before using):
 *   economy ~ $0.20-$0.25 in / $1.20-$1.50 out, mid ~ $2 in / $10-$12 out.
 */
const PRICES = {
  'gemini:economy': null, // { in: 0, out: 0 }
  'gemini:mid': null,
  'gemini:premium': null,
  'openai:economy': null,
  'openai:mid': null,
  'openai:premium': null,
};

/**
 * Verified per-model prices (USD per 1M tokens), used before PRICES so a cost is
 * only reported when the configured model ID is one we checked. Add a model here
 * only after confirming it on the provider's pricing page.
 *   cachedIn   = cached input reads, cacheWrite = tokens written to the prompt cache
 *   long       = rates for the WHOLE request when input tokens > longContextAbove
 */
const MODEL_PRICES = {
  // https://developers.openai.com/api/docs/pricing (Standard tier), checked 2026-10-09.
  'gpt-6-luna': {
    in: 0.10, cachedIn: 0.01, cacheWrite: 0.125, out: 0.50,
    longContextAbove: 272000,
    long: { in: 0.20, cachedIn: 0.02, cacheWrite: 0.25, out: 0.75 },
  },
  // Vertex AI, global endpoint — TO FILL from https://cloud.google.com/vertex-ai/generative-ai/pricing
  // While `in` or `out` is null, costUsd stays null (no guessed numbers). Thinking tokens
  // are already counted in outputTokens; cachedIn applies to usageMetadata.cachedContentTokenCount.
  // Set `long` + `longContextAbove` only if the page lists a long-context tier for the model.
  'gemini-3.8-flash': {
    in: null, cachedIn: null, cacheWrite: null, out: null,
    longContextAbove: null,
    long: null,
  },
  'gemini-3.1-flash-lite': {
    in: null, cachedIn: null, cacheWrite: null, out: null,
    longContextAbove: null,
    long: null,
  },
};

function positiveMs(name, fallback) {
  const n = Number(env(name, String(fallback)));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per attempt. Each attempt is also clipped to whatever is left of DEADLINE_MS. */
const TIMEOUT_MS = positiveMs('LLM_TIMEOUT_MS', 45000);
/** Whole llm.generate() call: first attempt + retry + fallback. */
const DEADLINE_MS = positiveMs('LLM_DEADLINE_MS', 30000);
const OTHER = { gemini: 'openai', openai: 'gemini' };

module.exports = { MODELS, PRICES, MODEL_PRICES, TIMEOUT_MS, DEADLINE_MS, OTHER, env };
