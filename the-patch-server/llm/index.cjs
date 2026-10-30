'use strict';
/**
 * Single entry point: generate({ messages, system, mode|provider, tier, ... })
 * Returns { text, provider, model, tier, usage, costUsd, latencyMs, attempts, fellBack, routeReason }
 * - Same message format for every provider: [{ role: 'user'|'assistant', content: '...' }]
 * - One retry on 429 / 5xx / timeout, then fallback:
 *     LLM_USE_LITELLM off → the other provider (same tier), unchanged.
 *     LLM_USE_LITELLM on  → LiteLLM first, then the direct adapter for the same logical provider.
 *     aiModel='low' (DEEPSEEK_ENABLED) → LiteLLM general-deepseek, then OpenAI economy.
 *   Any other error (400, auth, missing config) is thrown without fallback.
 * - Overall deadline (LLM_DEADLINE_MS, default 30 s) across all attempts; a timed-out
 *   attempt is aborted via AbortSignal. Throws code 'EDEADLINE' when time runs out.
 * - Logs one structured line per call (swap in your own logger with setUsageLogger)
 */
const {
  MODELS, PRICES, MODEL_PRICES, TIMEOUT_MS, DEADLINE_MS, OTHER, USE_LITELLM,
  DEEPSEEK_ENABLED,
} = require('./config.cjs');
const { route } = require('./router.cjs');

if (USE_LITELLM) {
  const base = String(process.env.LITELLM_BASE_URL || '').trim();
  if (!base) {
    throw new Error(
      '[llm] LLM_USE_LITELLM=true but LITELLM_BASE_URL is not set. ' +
        'Set LITELLM_BASE_URL (e.g. http://localhost:4000/v1). ' +
        'If requests 404, try with or without the /v1 suffix.'
    );
  }
}

let adapters = {
  get gemini() { return require('./adapters/gemini.cjs'); },
  get openai() { return require('./adapters/openai.cjs'); },
};
// Register 'litellm' only when the flag is on — flag-off never loads the file.
if (USE_LITELLM) {
  Object.defineProperty(adapters, 'litellm', {
    configurable: true,
    enumerable: true,
    get() { return require('./adapters/litellm.cjs'); },
  });
}
function _setAdapters(a) { adapters = a; } // for tests

let usageLogger = (rec) => console.log('[llm-usage]', JSON.stringify(rec));
function setUsageLogger(fn) { usageLogger = fn; }

const RETRY_BACKOFF_MS = 500;
/** Don't start a retry or fallback with less time than this left before the deadline. */
const MIN_ATTEMPT_MS = 1000;

function withTimeout(promise, ms, controller) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => {
      if (controller) controller.abort();
      const e = new Error(`LLM call timed out after ${ms} ms`); e.code = 'ETIMEDOUT'; rej(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function remainingMs(state) {
  return state.deadlineAt - Date.now();
}

function deadlineError(state, cause) {
  const e = new Error(`LLM deadline of ${state.deadlineMs} ms exceeded after ${state.attempts} attempt(s)`);
  e.code = 'EDEADLINE';
  if (cause) e.cause = cause;
  return e;
}

function isRetryable(err) {
  const s = err && (err.status || err.code || (err.response && err.response.status));
  if (s === 429 || s === 'ETIMEDOUT') return true;
  if (typeof s === 'number' && s >= 500) return true;
  return false;
}

/**
 * Estimated USD from measured token counts. Cached reads and cache writes are
 * priced separately when the price entry has them (they're part of inputTokens,
 * not on top of it); otherwise they fall back to the normal input rate.
 */
function computeCost(provider, model, tier, usage) {
  const base = MODEL_PRICES[model] || PRICES[`${provider}:${tier}`];
  // An entry with null rates is a placeholder waiting for official prices.
  if (!base || base.in == null || base.out == null) return null;
  const p = base.long && base.long.in != null && base.longContextAbove && usage.inputTokens > base.longContextAbove
    ? base.long : base;
  const cached = usage.cachedInputTokens || 0;
  const writes = usage.cacheWriteTokens || 0;
  const ordinary = Math.max(0, usage.inputTokens - cached - writes);
  return (
    ordinary * p.in +
    cached * (p.cachedIn ?? p.in) +
    writes * (p.cacheWrite ?? p.in) +
    usage.outputTokens * p.out
  ) / 1e6;
}

/** Prefer the upstream model id for pricing (LiteLLM aliases are not in MODEL_PRICES). */
function priceModelId(result, underlyingProvider, tier) {
  if (result.responseModel && MODEL_PRICES[result.responseModel]) {
    return result.responseModel;
  }
  if (result.responseModel) return result.responseModel;
  if (underlyingProvider && MODELS[underlyingProvider] && MODELS[underlyingProvider][tier]) {
    return MODELS[underlyingProvider][tier];
  }
  return result.model;
}

async function callOnce(provider, tier, args, state) {
  const model = MODELS[provider] && MODELS[provider][tier];
  if (!model) throw new Error(`No model configured for ${provider}:${tier} (set the env var)`);
  if (!adapters[provider]) throw new Error(`No adapter registered for provider "${provider}"`);
  const budgetMs = Math.min(state.timeoutMs, remainingMs(state));
  if (budgetMs <= 0) throw deadlineError(state);
  const controller = new AbortController();
  const started = Date.now();
  const out = await withTimeout(
    adapters[provider].generate({
      model, system: args.system, messages: args.messages, maxOutputTokens: args.maxOutputTokens,
      timeoutMs: budgetMs, signal: controller.signal,
    }),
    budgetMs,
    controller
  );
  return { ...out, provider, model, tier, latencyMs: Date.now() - started };
}

async function tryProvider(provider, tier, args, state) {
  try {
    state.attempts++;
    return await callOnce(provider, tier, args, state);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    if (remainingMs(state) < RETRY_BACKOFF_MS + MIN_ATTEMPT_MS) throw deadlineError(state, err);
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    state.attempts++;
    return await callOnce(provider, tier, args, state);
  }
}

/**
 * When LiteLLM is on, primary = litellm with the tier's proxy alias; fallback =
 * the direct adapter for the routed provider (openai/gemini). Flag off: unchanged.
 */
function resolveProviders(args, messages) {
  if (args.aiModel === 'low') {
    if (!DEEPSEEK_ENABLED) {
      const e = new Error('aiModel "low" is not enabled (set DEEPSEEK_ENABLED=true)');
      e.status = 400;
      e.code = 'ai_model_unavailable';
      throw e;
    }
    if (!USE_LITELLM || !(MODELS.litellm && MODELS.litellm.low)) {
      const e = new Error('aiModel "low" requires LiteLLM (LLM_USE_LITELLM and alias general-deepseek)');
      e.status = 400;
      e.code = 'ai_model_unavailable';
      throw e;
    }
    // Low = LiteLLM general-deepseek; 429/5xx/timeout fall back to standard OpenAI.
    return {
      primary: 'litellm',
      fallback: 'openai',
      fallbackTier: 'economy',
      tier: 'low',
      reason: 'mode=general+aiModel=low',
      underlying: 'deepseek',
    };
  }

  const routed = args.provider
    ? { provider: args.provider, tier: args.tier || 'mid', reason: 'explicit' }
    : route({ mode: args.mode || 'auto', messages });
  const tier = args.tier || routed.tier;

  if (!USE_LITELLM) {
    return {
      primary: routed.provider,
      fallback: OTHER[routed.provider] || null,
      tier,
      reason: routed.reason,
      underlying: routed.provider,
    };
  }

  // Explicit provider:'litellm' (compare script) — fallback to openai for economy, gemini for mid.
  if (routed.provider === 'litellm') {
    const underlying = tier === 'mid' || tier === 'premium' ? 'gemini' : 'openai';
    return {
      primary: 'litellm',
      fallback: underlying,
      tier,
      reason: routed.reason,
      underlying,
    };
  }

  // preferDirect: compare script / explicit bypass — hit the raw adapter.
  if (args.preferDirect) {
    return {
      primary: routed.provider,
      fallback: OTHER[routed.provider] || null,
      tier,
      reason: `${routed.reason}+direct`,
      underlying: routed.provider,
    };
  }

  // Router / explicit openai|gemini → LiteLLM first, then the same direct adapter.
  if (routed.provider === 'openai' || routed.provider === 'gemini') {
    return {
      primary: 'litellm',
      fallback: routed.provider,
      tier,
      reason: `${routed.reason}+litellm`,
      underlying: routed.provider,
    };
  }

  return {
    primary: routed.provider,
    fallback: OTHER[routed.provider] || null,
    tier,
    reason: routed.reason,
    underlying: routed.provider,
  };
}

async function generate(args) {
  const { messages, userId, conversationId, purpose = 'coach', allowFallback = true } = args;
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages is required');
  const deadlineMs = args.deadlineMs || DEADLINE_MS;

  const resolved = resolveProviders(args, messages);
  const tier = resolved.tier;
  const state = {
    attempts: 0,
    timeoutMs: args.timeoutMs || TIMEOUT_MS,
    deadlineMs,
    deadlineAt: Date.now() + deadlineMs,
  };
  let result, fellBack = false, firstError = null;

  try {
    result = await tryProvider(resolved.primary, tier, args, state);
  } catch (err) {
    firstError = err;
    const other = resolved.fallback;
    const otherTier = resolved.fallbackTier || tier;
    // Only transient failures (429 / 5xx / timeout) fall back; a 400, auth or
    // config error would fail the same way and must not be hidden.
    if (!allowFallback || !isRetryable(err) || !(other && MODELS[other] && MODELS[other][otherTier])) {
      throw err;
    }
    if (remainingMs(state) < MIN_ATTEMPT_MS) throw deadlineError(state, err);
    result = await tryProvider(other, otherTier, args, state);
    fellBack = true;
  }

  // Price + log the provider/tier that actually answered (e.g. openai:economy after a low fallback).
  const usedTier = result.tier || tier;
  const pricedModel = priceModelId(
    result,
    result.provider === 'litellm' ? resolved.underlying : result.provider,
    usedTier
  );
  const costProvider = result.provider === 'litellm' ? resolved.underlying : result.provider;
  const costUsd = computeCost(costProvider, pricedModel, usedTier, result.usage);
  const rec = {
    userId, conversationId, purpose, provider: result.provider, model: result.model,
    responseModel: result.responseModel ?? null, tier: usedTier,
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    cachedInputTokens: result.usage.cachedInputTokens ?? null, cacheWriteTokens: result.usage.cacheWriteTokens ?? null,
    thinkingTokens: result.usage.thinkingTokens ?? null, totalTokens: result.usage.totalTokens ?? null,
    costUsd, latencyMs: result.latencyMs, attempts: state.attempts, fellBack,
    routeReason: resolved.reason, firstError: firstError ? String(firstError.message).slice(0, 200) : undefined,
  };
  try { usageLogger(rec); } catch (_) { /* logging must never break a request */ }
  return { text: result.text, provider: result.provider, model: result.model, responseModel: result.responseModel ?? null, tier: usedTier,
    usage: result.usage, costUsd, latencyMs: result.latencyMs, attempts: state.attempts, fellBack, routeReason: resolved.reason };
}

module.exports = { generate, setUsageLogger, _setAdapters, computeCost, priceModelId };
