'use strict';
/**
 * OpenAI adapter. Needs: npm i openai, and OPENAI_API_KEY as a server-side secret
 * (Cloud Run secret in prod, .env locally). Never expose the key to the frontend.
 * Text-only for now (no tools).
 */
const Pkg = require('openai');
const OpenAI = Pkg.default || Pkg;

let _client;
function client() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    // maxRetries 0: index.cjs owns retry + fallback; SDK retries would multiply attempts.
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  }
  return _client;
}

async function generate({ model, system, messages, maxOutputTokens, signal }) {
  const msgs = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];
  // index.cjs aborts `signal` when the attempt's time budget runs out, which
  // cancels the HTTP request. No SDK `timeout`: its error isn't marked retryable.
  const res = await client().chat.completions.create(
    { model, messages: msgs, ...(maxOutputTokens ? { max_completion_tokens: maxOutputTokens } : {}) },
    signal ? { signal } : undefined
  );
  const text = (res.choices?.[0]?.message?.content || '').trim();
  const u = res.usage || {};
  return {
    text,
    responseModel: res.model || null,
    usage: {
      // prompt_tokens includes cached reads and cache writes (priced separately in index.cjs).
      inputTokens: u.prompt_tokens || 0,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: u.prompt_tokens_details?.cache_write_tokens || 0,
      // completion_tokens already includes reasoning tokens (billed as output).
      outputTokens: u.completion_tokens || 0,
      thinkingTokens: u.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: u.total_tokens ?? null,
    },
  };
}

module.exports = { generate, name: 'openai' };
