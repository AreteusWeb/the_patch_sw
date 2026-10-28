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
 * Only loaded when LLM_USE_LITELLM=true (see llm/index.cjs). Never expose
 * LITELLM_API_KEY or ID tokens (no logging).
 */
const Pkg = require('openai');
const OpenAI = Pkg.default || Pkg;
const { GoogleAuth } = require('google-auth-library');

const DEFAULT_GEMINI_ALIAS = 'general-gemini';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

let _client;
let _googleAuth;
let _idTokenCache = { token: null, expiresAt: 0, audience: null };

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
    const audience = audienceFromBaseUrl(baseURL);
    if (!audience) {
      throw new Error('LITELLM_BASE_URL could not be turned into a Cloud Run audience (strip /v1).');
    }

    // maxRetries 0: index.cjs owns retry + fallback; SDK retries would multiply attempts.
    // apiKey is a placeholder: Cloud Run IAM needs the Google ID token in Authorization.
    // The LiteLLM key goes in x-litellm-api-key (not Authorization).
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
  return _client;
}

function isGeminiProxyAlias(model) {
  const geminiAlias = String(
    process.env.LITELLM_MODEL_GENERAL_GEMINI || DEFAULT_GEMINI_ALIAS
  ).trim();
  return model === geminiAlias || /gemini/i.test(String(model || ''));
}

async function generate({ model, system, messages, maxOutputTokens, signal }) {
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
  const res = await client().chat.completions.create(
    body,
    signal ? { signal } : undefined
  );
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

module.exports = { generate, name: 'litellm' };
