'use strict';
/**
 * LiteLLM proxy adapter. Same shape as adapters/openai.cjs: OpenAI SDK pointed
 * at LITELLM_BASE_URL. Model IDs are proxy aliases (e.g. general-openai,
 * general-gemini), not raw provider model names.
 *
 * Auth for the private Cloud Run gateway:
 *   Authorization: Bearer <Google ID token>  (audience = LITELLM_BASE_URL without /v1)
 *   x-litellm-api-key: Bearer <LITELLM_API_KEY>
 *
 * End-user budgets (when LLM_USE_LITELLM):
 *   chat/completions includes user: <Firebase uid> (opaque; never email).
 *   /customer/new + /customer/update use LITELLM_ADMIN_KEY (same header shape).
 *   422 budget_exceeded → Error with code 'quota_exceeded' (no retry / fallback).
 *
 * Only loaded when LLM_USE_LITELLM=true (see llm/index.cjs). Never expose
 * LITELLM_API_KEY, LITELLM_ADMIN_KEY, or ID tokens (no logging).
 */
const Pkg = require('openai');
const OpenAI = Pkg.default || Pkg;
const { GoogleAuth } = require('google-auth-library');
const { PLAN_BUDGETS, BUDGET_DURATION } = require('../config.cjs');

const DEFAULT_GEMINI_ALIAS = 'general-gemini';
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * True only when the URL hostname is loopback. Uses new URL() — never
 * substring-match the raw string (localhost.evil.com and ?x=localhost stay remote).
 * Invalid URLs throw; they are not treated as local.
 */
function isLocalHost(baseUrl) {
  let hostname;
  try {
    hostname = new URL(String(baseUrl || '').trim()).hostname;
  } catch {
    throw new Error(
      'LITELLM_BASE_URL is not a valid URL. ' +
        'Example: http://localhost:4000/v1 or https://your-gateway.run.app/v1'
    );
  }
  return LOCAL_HOSTS.has(hostname);
}

let _client;
let _googleAuth;
let _idTokenCache = { token: null, expiresAt: 0, audience: null };
/** uids already ensured (or skipped) this process — avoids repeat /customer/new. */
const _ensuredCustomers = new Set();
/** Optional fetch override for tests. */
let _fetchImpl = null;

function _setFetch(fn) { _fetchImpl = fn; }
function _resetCustomerCache() { _ensuredCustomers.clear(); }

/** Cloud Run IAM audience: same URL as the gateway, without a trailing /v1. */
function audienceFromBaseUrl(baseURL) {
  const raw = String(baseURL || '').trim();
  try {
    const u = new URL(raw);
    let path = u.pathname.replace(/\/+$/, '');
    if (path.toLowerCase() === '/v1') path = '';
    else if (path.toLowerCase().endsWith('/v1')) {
      path = path.slice(0, -3).replace(/\/+$/, '');
    }
    return `${u.origin}${path}`;
  } catch {
    return raw.replace(/\/+$/, '').replace(/\/v1$/i, '');
  }
}

function gatewayRoot() {
  const baseURL = String(process.env.LITELLM_BASE_URL || '').trim();
  if (!baseURL) {
    throw new Error(
      'LITELLM_BASE_URL is not set. Example: http://localhost:4000/v1'
    );
  }
  return audienceFromBaseUrl(baseURL);
}

function jwtExpMs(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return 0;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function getGoogleIdToken(audience) {
  const now = Date.now();
  if (
    _idTokenCache.token &&
    _idTokenCache.audience === audience &&
    now < _idTokenCache.expiresAt - REFRESH_SKEW_MS
  ) {
    return _idTokenCache.token;
  }
  if (!_googleAuth) _googleAuth = new GoogleAuth();
  const idClient = await _googleAuth.getIdTokenClient(audience);
  const token = await idClient.idTokenProvider.fetchIdToken(audience);
  if (!token) {
    throw new Error('Failed to obtain a Google ID token for the LiteLLM gateway');
  }
  const exp = jwtExpMs(token);
  _idTokenCache = {
    token,
    audience,
    expiresAt: exp > 0 ? exp : now + 50 * 60 * 1000,
  };
  return token;
}

function client() {
  if (!_client) {
    const baseURL = String(process.env.LITELLM_BASE_URL || '').trim();
    if (!baseURL) {
      throw new Error(
        'LITELLM_BASE_URL is not set. Example: http://localhost:4000/v1 ' +
          '(if you get 404, try with or without the /v1 suffix).'
      );
    }
    const apiKey = String(process.env.LITELLM_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('LITELLM_API_KEY is not set (LiteLLM virtual key or master key).');
    }
    const local = isLocalHost(baseURL);

    // maxRetries 0: index.cjs owns retry + fallback; SDK retries would multiply attempts.
    if (local) {
      // Docker / localhost proxy: no Cloud Run IAM. Key in Authorization and x-litellm-api-key.
      _client = new OpenAI({
        apiKey,
        baseURL,
        maxRetries: 0,
        defaultHeaders: {
          'x-litellm-api-key': `Bearer ${apiKey}`,
        },
      });
    } else {
      const audience = audienceFromBaseUrl(baseURL);
      if (!audience) {
        throw new Error('LITELLM_BASE_URL could not be turned into a Cloud Run audience (strip /v1).');
      }
      // Private Cloud Run: IAM ID token in Authorization; LiteLLM key in x-litellm-api-key.
      _client = new OpenAI({
        apiKey: 'unused',
        baseURL,
        maxRetries: 0,
        defaultHeaders: {
          'x-litellm-api-key': `Bearer ${apiKey}`,
        },
        fetch: async (url, init = {}) => {
          const idToken = await getGoogleIdToken(audience);
          const headers = new Headers(init.headers || undefined);
          headers.set('Authorization', `Bearer ${idToken}`);
          return fetch(url, { ...init, headers });
        },
      });
    }
  }
  return _client;
}

function isGeminiProxyAlias(model) {
  const geminiAlias = String(
    process.env.LITELLM_MODEL_GENERAL_GEMINI || DEFAULT_GEMINI_ALIAS
  ).trim();
  return model === geminiAlias || /gemini/i.test(String(model || ''));
}

function planKey(plan) {
  const p = String(plan == null ? 'free' : plan).trim().toLowerCase();
  return p || 'free';
}

/** Lowest numeric max_budget among PLAN_BUDGETS (ignores null). null if none set. */
function lowestDefinedBudget() {
  let min = null;
  for (const v of Object.values(PLAN_BUDGETS)) {
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (min == null || n < min) min = n;
  }
  return min;
}

/**
 * Resolve plan → max_budget. Unknown plan ids use the lowest non-null PLAN_BUDGETS
 * entry; if every entry is null, maxBudget stays null (no limit).
 */
function budgetForPlan(plan) {
  const key = planKey(plan);
  if (Object.prototype.hasOwnProperty.call(PLAN_BUDGETS, key)) {
    return { key, maxBudget: PLAN_BUDGETS[key], known: true };
  }
  const fallback = lowestDefinedBudget();
  return { key, maxBudget: fallback, known: false, fallback: true };
}

/**
 * Detect LiteLLM end-user budget exhaustion. Must not be treated as retryable.
 */
function isBudgetExceededError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || (err.response && err.response.status);
  if (status !== 422) return false;
  const type =
    err.error?.type ||
    err.error?.error?.type ||
    err.code ||
    err.type ||
    null;
  if (type === 'budget_exceeded' || type === 'quota_exceeded') return true;
  const blob = [
    err.message,
    typeof err.error === 'string' ? err.error : JSON.stringify(err.error || ''),
  ].join(' ');
  return /budget_exceeded/i.test(blob);
}

function quotaExceededError(cause) {
  const e = new Error(
    'AI usage quota for this period has been reached. Try again later or upgrade your plan.'
  );
  e.code = 'quota_exceeded';
  e.status = 429;
  if (cause) e.cause = cause;
  return e;
}

/** Customer provisioning failed while a budget limit is required — do not call the model. */
function quotaUnavailableError(cause) {
  const e = new Error(
    'AI usage limits are temporarily unavailable. Please try again later.'
  );
  e.code = 'quota_unavailable';
  e.status = 503;
  if (cause) e.cause = cause;
  return e;
}

/**
 * Fail closed only when a numeric budget is required and ensure did not succeed.
 * maxBudget == null → no limit → always allow the completion.
 */
function assertCustomerReady(ensured, maxBudget) {
  if (maxBudget != null && (!ensured || ensured.ok !== true)) {
    throw quotaUnavailableError();
  }
}

/** Build auth headers for /customer/* (admin key; never log the value). */
async function adminHeaders() {
  const adminKey = String(process.env.LITELLM_ADMIN_KEY || '').trim();
  if (!adminKey) return null;

  const baseURL = String(process.env.LITELLM_BASE_URL || '').trim();
  const headers = {
    'Content-Type': 'application/json',
    'x-litellm-api-key': `Bearer ${adminKey}`,
  };

  if (isLocalHost(baseURL)) {
    headers.Authorization = `Bearer ${adminKey}`;
  } else {
    const audience = audienceFromBaseUrl(baseURL);
    const idToken = await getGoogleIdToken(audience);
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

function customerAlreadyExists(status, bodyText) {
  if (status === 409) return true;
  if (status !== 400 && status !== 422) return false;
  return /already\s*exist|exists|duplicate/i.test(String(bodyText || ''));
}

async function customerPost(path, body) {
  const headers = await adminHeaders();
  if (!headers) {
    console.warn(
      '[litellm] LITELLM_ADMIN_KEY is not set — skipping end-user customer API call'
    );
    return { skipped: true, reason: 'no_admin_key' };
  }
  const url = `${gatewayRoot()}${path}`;
  const doFetch = _fetchImpl || fetch;
  const res = await doFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  return { skipped: false, status: res.status, ok: res.ok, text };
}

/**
 * Ensure LiteLLM has an end-user row for this Firebase uid (opaque id only).
 * Reads plan → PLAN_BUDGETS (unknown plan → lowest defined budget).
 * null budget → no /customer/new (not cached). Idempotent when a limit is created.
 */
async function ensureEndUser(uid, plan = 'free') {
  const userId = String(uid || '').trim();
  if (!userId) return { ok: false, reason: 'missing_uid', maxBudget: null };
  if (_ensuredCustomers.has(userId)) {
    return { ok: true, cached: true, maxBudget: budgetForPlan(plan).maxBudget };
  }

  const { key, maxBudget, known } = budgetForPlan(plan);
  if (!known) {
    console.warn(
      `[litellm] unknown plan "${key}" for uid=${userId} — using lowest defined budget` +
        (maxBudget == null ? ' (none; no limit)' : ` (${maxBudget})`)
    );
  }
  if (maxBudget == null) {
    console.warn(
      `[litellm] no budget limit for plan="${key}" uid=${userId} — skipping /customer/new`
    );
    // Do not cache null-budget skips (plan table may be filled later).
    return { ok: true, skipped: true, reason: 'null_budget', maxBudget: null };
  }

  if (!String(process.env.LITELLM_ADMIN_KEY || '').trim()) {
    console.warn(
      `[litellm] LITELLM_ADMIN_KEY is not set — cannot create customer for uid=${userId}`
    );
    // Do not cache: admin key may appear later in the same process.
    return { ok: false, reason: 'no_admin_key', maxBudget };
  }

  const result = await customerPost('/customer/new', {
    user_id: userId,
    max_budget: maxBudget,
    budget_duration: BUDGET_DURATION,
  });

  if (result.skipped) {
    return { ok: false, reason: result.reason, maxBudget };
  }

  if (result.ok || customerAlreadyExists(result.status, result.text)) {
    _ensuredCustomers.add(userId);
    return {
      ok: true,
      created: result.ok,
      alreadyExists: !result.ok,
      maxBudget,
    };
  }

  console.warn(
    `[litellm] /customer/new failed for uid=${userId} status=${result.status}`
  );
  return { ok: false, reason: 'customer_new_failed', status: result.status, maxBudget };
}

/**
 * Update LiteLLM max_budget for an existing end user. Not wired to routes yet.
 */
async function updateUserPlan(uid, plan) {
  const userId = String(uid || '').trim();
  if (!userId) return { ok: false, reason: 'missing_uid' };

  const { key, maxBudget } = budgetForPlan(plan);
  if (maxBudget == null) {
    console.warn(
      `[litellm] updateUserPlan: PLAN_BUDGETS["${key}"] is null — not calling /customer/update for uid=${userId}`
    );
    return { ok: false, reason: 'null_budget' };
  }

  if (!String(process.env.LITELLM_ADMIN_KEY || '').trim()) {
    console.warn(
      `[litellm] LITELLM_ADMIN_KEY is not set — cannot update customer for uid=${userId}`
    );
    return { ok: false, reason: 'no_admin_key' };
  }

  const result = await customerPost('/customer/update', {
    user_id: userId,
    max_budget: maxBudget,
  });

  if (result.skipped) return { ok: false, reason: result.reason };
  if (!result.ok) {
    console.warn(
      `[litellm] /customer/update failed for uid=${userId} status=${result.status}`
    );
    return { ok: false, reason: 'customer_update_failed', status: result.status };
  }
  return { ok: true };
}

async function generate({
  model,
  system,
  messages,
  maxOutputTokens,
  signal,
  user,
  plan,
}) {
  const uid = user != null ? String(user).trim() : '';
  if (uid) {
    const planId = plan || 'free';
    const { maxBudget } = budgetForPlan(planId);
    let ensured;
    try {
      ensured = await ensureEndUser(uid, planId);
    } catch (err) {
      console.warn(
        `[litellm] ensureEndUser threw for uid=${uid}: ${String(err && err.message || err).slice(0, 200)}`
      );
      // Required budget + provisioning error → fail closed (do not call the model).
      if (maxBudget != null) throw quotaUnavailableError(err);
      ensured = { ok: false, reason: 'ensure_threw', maxBudget: null };
    }
    assertCustomerReady(ensured, maxBudget);
  }

  const msgs = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    })),
  ];

  const body = {
    model,
    messages: msgs,
    ...(maxOutputTokens ? { max_completion_tokens: maxOutputTokens } : {}),
    // Opaque Firebase uid for LiteLLM end-user budgets (never email).
    ...(uid ? { user: uid } : {}),
  };

  // Gemini 3.x via LiteLLM v1.105.1: reasoning_effort "none" maps to
  // thinkingConfig { thinkingLevel: "low", includeThoughts: false } for
  // gemini-3.8-flash (models that reject "minimal"). That is the closest match
  // to The Patch's COACH_GENERATION_CONFIG. NOT guaranteed 1:1 equivalence.
  // reasoning_effort "low" would set thinkingLevel "low" but includeThoughts true.
  if (isGeminiProxyAlias(model)) {
    body.reasoning_effort = 'none';
  }

  // index.cjs aborts `signal` when the attempt's time budget runs out.
  let res;
  try {
    res = await client().chat.completions.create(
      body,
      signal ? { signal } : undefined
    );
  } catch (err) {
    if (isBudgetExceededError(err)) throw quotaExceededError(err);
    throw err;
  }
  const text = (res.choices?.[0]?.message?.content || '').trim();
  const u = res.usage || {};
  return {
    text,
    responseModel: res.model || null,
    usage: {
      inputTokens: u.prompt_tokens || 0,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: u.prompt_tokens_details?.cache_write_tokens || 0,
      outputTokens: u.completion_tokens || 0,
      thinkingTokens: u.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: u.total_tokens ?? null,
    },
  };
}

module.exports = {
  generate,
  name: 'litellm',
  isLocalHost,
  ensureEndUser,
  updateUserPlan,
  budgetForPlan,
  lowestDefinedBudget,
  isBudgetExceededError,
  quotaExceededError,
  quotaUnavailableError,
  assertCustomerReady,
  _setFetch,
  _resetCustomerCache,
};
