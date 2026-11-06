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

/** Opt-in: General aiModel='low' (LiteLLM alias general-deepseek). Off by default. */
const DEEPSEEK_ENABLED =
  String(process.env.DEEPSEEK_ENABLED || '').trim().toLowerCase() === 'true';

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
    // General aiModel='low' → LiteLLM alias (upstream: deepseek-v4-flash, not deepseek-chat)
    low: env('LITELLM_MODEL_GENERAL_DEEPSEEK', 'general-deepseek'),
    premium: env('LITELLM_MODEL_PREMIUM', null),
  };
}

/**
 * LiteLLM proxy alias → real upstream model id (for MODEL_PRICES / usage bucketing).
 * Alias keys follow LITELLM_MODEL_GENERAL_*; upstream ids are overridable via
 * LITELLM_UPSTREAM_* so gateway renames don't break costUsd.
 */
const LITELLM_ALIAS_TO_MODEL = {
  [env('LITELLM_MODEL_GENERAL_OPENAI', 'general-openai')]:
    env('LITELLM_UPSTREAM_GENERAL_OPENAI', 'gpt-6-luna'),
  [env('LITELLM_MODEL_GENERAL_GEMINI', 'general-gemini')]:
    env('LITELLM_UPSTREAM_GENERAL_GEMINI', 'gemini-3.8-flash'),
  [env('LITELLM_MODEL_GENERAL_DEEPSEEK', 'general-deepseek')]:
    env('LITELLM_UPSTREAM_GENERAL_DEEPSEEK', 'deepseek-v4-flash'),
};

/** Real model id → openai | gemini | deepseek for usage aggregation. */
const REAL_MODEL_TO_PROVIDER = {
  'gpt-6-luna': 'openai',
  'gemini-3.8-flash': 'gemini',
  'gemini-3.1-flash-lite': 'gemini',
  'deepseek-v4-flash': 'deepseek',
};

/** Map a LiteLLM alias (or passthrough id) to the upstream model used for pricing. */
function resolveLitellmUpstream(aliasOrModel) {
  const id = String(aliasOrModel || '').trim();
  if (!id) return null;
  if (Object.prototype.hasOwnProperty.call(LITELLM_ALIAS_TO_MODEL, id)) {
    return LITELLM_ALIAS_TO_MODEL[id];
  }
  return id;
}

/** Billable provider bucket from a real model or LiteLLM alias. */
function billableProviderForModel(aliasOrModel) {
  const real = resolveLitellmUpstream(aliasOrModel);
  if (!real) return null;
  if (REAL_MODEL_TO_PROVIDER[real]) return REAL_MODEL_TO_PROVIDER[real];
  if (/deepseek/i.test(real)) return 'deepseek';
  if (/gemini/i.test(real)) return 'gemini';
  if (/gpt|openai|luna/i.test(real)) return 'openai';
  return null;
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
  'deepseek:low': null,
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
  // LiteLLM alias general-deepseek → deepseek-v4-flash (not deepseek-chat).
  // https://api-docs.deepseek.com/quick_start/pricing — checked 2026-10-30.
  // Stored rates are PICO (conservative for quotas); real cost varies by time of day.
  // VALLE: in 0.15 / cachedIn 0.003 / out 0.60. cacheWrite is not billed separately.
  'deepseek-v4-flash': {
    in: 0.30, cachedIn: 0.006, cacheWrite: null, out: 1.20,
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

/**
 * LiteLLM end-user max_budget (USD) per Firestore users/{uid}.plan.
 * Keys must match the lowercase plan string stored on the user doc
 * (server reads userDoc.plan → toLowerCase; default when missing: 'free').
 * In this repo nothing else writes plan yet — confirmed alignment target:
 *   essential | pro | free | patch_pro
 * free: $0.50 so users without a paid plan still get a LiteLLM cap
 * (null would skip /customer/new and leave them unlimited).
 */
const PLAN_BUDGETS = {
  free: 0.50,
  essential: 6.99,
  pro: 13.99,
  patch_pro: 13.99,
};

/** Rolling budget window sent to LiteLLM /customer/new. */
const BUDGET_DURATION = '30d';

module.exports = {
  MODELS,
  PRICES,
  MODEL_PRICES,
  TIMEOUT_MS,
  DEADLINE_MS,
  OTHER,
  USE_LITELLM,
  DEEPSEEK_ENABLED,
  PLAN_BUDGETS,
  BUDGET_DURATION,
  LITELLM_ALIAS_TO_MODEL,
  REAL_MODEL_TO_PROVIDER,
  resolveLitellmUpstream,
  billableProviderForModel,
  env,
};
