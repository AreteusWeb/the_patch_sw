'use strict';
/**
 * LiteLLM alias → real MODEL_PRICES (costUsd not null) + one-shot missing-price warn.
 * Run: node llm/test-litellm-prices.cjs
 */
process.env.LLM_USE_LITELLM = 'true';
process.env.LITELLM_BASE_URL = 'http://127.0.0.1:4000/v1';
process.env.LITELLM_API_KEY = 'sk-test-not-real';
process.env.OPENAI_MODEL_ECONOMY = 'gpt-6-luna';
process.env.DEEPSEEK_ENABLED = 'true';

const assert = require('assert');
const cfg = require('./config.cjs');
const llm = require('./index.cjs');
const usage = require('./usage.cjs');

llm.setUsageLogger(() => {});

assert.strictEqual(cfg.resolveLitellmUpstream('general-openai'), 'gpt-6-luna');
assert.strictEqual(cfg.resolveLitellmUpstream('general-gemini'), 'gemini-3.8-flash');
assert.strictEqual(cfg.resolveLitellmUpstream('general-deepseek'), 'deepseek-v4-flash');
assert.strictEqual(cfg.billableProviderForModel('general-deepseek'), 'deepseek');
assert.strictEqual(cfg.billableProviderForModel('general-openai'), 'openai');
assert.strictEqual(cfg.billableProviderForModel('general-gemini'), 'gemini');

(async () => {
  // 1) priceModelId maps aliases to priced upstream ids
  assert.strictEqual(
    llm.priceModelId(
      { model: 'general-openai', responseModel: null, provider: 'litellm' },
      'openai',
      'economy'
    ),
    'gpt-6-luna'
  );
  assert.strictEqual(
    llm.priceModelId(
      { model: 'general-gemini', responseModel: 'general-gemini', provider: 'litellm' },
      'gemini',
      'mid'
    ),
    'gemini-3.8-flash'
  );
  assert.strictEqual(
    llm.priceModelId(
      { model: 'general-deepseek', responseModel: null, provider: 'litellm' },
      'deepseek',
      'low'
    ),
    'deepseek-v4-flash'
  );

  // 2) computeCost via generate() with litellm adapter returning alias as model
  const usageTok = { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0, cacheWriteTokens: 0 };
  llm._setAdapters({
    litellm: {
      generate: async ({ model }) => ({
        text: 'ok',
        model,
        responseModel: model, // gateway echoes alias
        usage: usageTok,
      }),
    },
    openai: { generate: async () => ({ text: 'O', usage: usageTok }) },
    gemini: { generate: async () => ({ text: 'G', usage: usageTok }) },
  });

  let r = await llm.generate({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'general',
    userId: 'u1',
    plan: 'free',
  });
  assert.strictEqual(r.provider, 'litellm');
  assert.strictEqual(r.model, 'general-openai');
  // gpt-6-luna: (1000 * 0.10 + 500 * 0.50) / 1e6 = 0.00035
  assert.ok(Math.abs(r.costUsd - 0.00035) < 1e-12, `openai cost ${r.costUsd}`);
  assert.strictEqual(usage.billableProvider(r), 'openai');

  r = await llm.generate({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'general',
    aiModel: 'low',
    userId: 'u1',
    plan: 'free',
  });
  assert.strictEqual(r.model, 'general-deepseek');
  // deepseek-v4-flash PICO: (1000 * 0.30 + 500 * 1.20) / 1e6 = 0.0009
  assert.ok(Math.abs(r.costUsd - 0.0009) < 1e-12, `deepseek cost ${r.costUsd}`);
  assert.strictEqual(usage.billableProvider(r), 'deepseek');

  llm._setAdapters({
    litellm: {
      generate: async () => ({
        text: 'ok',
        model: 'general-gemini',
        responseModel: 'general-gemini',
        usage: usageTok,
      }),
    },
    openai: { generate: async () => ({ text: 'O', usage: usageTok }) },
    gemini: { generate: async () => ({ text: 'G', usage: usageTok }) },
  });
  r = await llm.generate({
    messages: [{ role: 'user', content: 'sleep and heart rate' }],
    mode: 'coach',
    userId: 'u1',
    plan: 'free',
    // force litellm mid path: mode coach → gemini mid → litellm when flag on
  });
  assert.strictEqual(r.provider, 'litellm');
  // gemini-3.8-flash: (1000 * 0.75 + 500 * 3.75) / 1e6 = 0.002625
  assert.ok(Math.abs(r.costUsd - 0.002625) < 1e-12, `gemini cost ${r.costUsd}`);
  assert.strictEqual(usage.billableProvider(r), 'gemini');

  // 3) unknown model → null cost + warn once
  llm._resetMissingPriceWarnings();
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const cost1 = llm.computeCost('openai', 'totally-unknown-model', 'economy', usageTok);
    const cost2 = llm.computeCost('openai', 'totally-unknown-model', 'economy', usageTok);
    assert.strictEqual(cost1, null);
    assert.strictEqual(cost2, null);
    assert.strictEqual(warns.length, 1);
    assert.ok(/totally-unknown-model/.test(warns[0]));
  } finally {
    console.warn = origWarn;
  }

  console.log('ALL LITELLM PRICE MOCK TESTS PASSED');
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
