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

/** Opt-in: route llm.generate() through the LiteLLM proxy first. Off by default. */
const USE_LITELLM =
  String(process.env.LLM_USE_LITELLM || '').trim().toLowerCase() === 'true';

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

// Proxy aliases (not raw provider IDs). Only registered when the flag is on so
// flag-off behavior and tests stay identical.
if (USE_LITELLM) {
  MODELS.litellm = {
    // mode='general' → openai:economy → litellm:economy
    economy: env('LITELLM_MODEL_GENERAL_OPENAI', 'general-openai'),
    // mode='coach' / gemini mid → litellm:mid (fallback path; coach tools stay on Vertex)
    mid: env('LITELLM_MODEL_GENERAL_GEMINI', 'general-gemini'),
    premium: env('LITELLM_MODEL_PREMIUM', null),
  };
}

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
  // https://cloud.google.com/vertex-ai/generative-ai/pricing — Vertex AI, Global (Mundial).
  // Checked 2026-10-17. Thinking tokens are billed in `out` (respuesta y razonamiento).
  // cachedIn = context-cache reads; cacheWrite left null (page lists N/A / not a separate write rate).
  // No long-context tier listed for these models → long stays null.
  //
  // gemini-3.8-flash: promotional "Flash*" row (valid through 2026-12-31), NOT Cyber and NOT
  // the post-2027-01-01 standard row ($1.50 / $3.75). Re-check after that date.
  'gemini-3.8-flash': {
    in: 0.75, cachedIn: 0.075, cacheWrite: null, out: 3.75,
    longContextAbove: null,
    long: null,
  },
  // gemini-3.1-flash-lite: Global text/image/video input (not the higher audio-input rate).
  'gemini-3.1-flash-lite': {
    in: 0.25, cachedIn: 0.025, cacheWrite: null, out: 1.50,
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
/** Cross-provider fallback when LLM_USE_LITELLM is off. */
const OTHER = { gemini: 'openai', openai: 'gemini' };

module.exports = {
  MODELS,
  PRICES,
  MODEL_PRICES,
  TIMEOUT_MS,
  DEADLINE_MS,
  OTHER,
  USE_LITELLM,
  env,
};
