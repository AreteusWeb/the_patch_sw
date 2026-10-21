'use strict';
/**
 * LiteLLM proxy adapter. Same shape as adapters/openai.cjs: OpenAI SDK pointed
 * at LITELLM_BASE_URL with LITELLM_API_KEY. Model IDs are proxy aliases
 * (e.g. general-openai, general-gemini), not raw provider model names.
 *
 * Only loaded when LLM_USE_LITELLM=true (see llm/index.cjs). Never expose
 * LITELLM_API_KEY to the frontend.
 */
const Pkg = require('openai');
const OpenAI = Pkg.default || Pkg;

const DEFAULT_GEMINI_ALIAS = 'general-gemini';

let _client;
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
    // maxRetries 0: index.cjs owns retry + fallback; SDK retries would multiply attempts.
    _client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
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
