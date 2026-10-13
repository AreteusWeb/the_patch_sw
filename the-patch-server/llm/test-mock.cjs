'use strict';
// Runs without any API keys: node llm/test-mock.cjs
process.env.OPENAI_MODEL_ECONOMY = 'fake-openai-eco';
process.env.OPENAI_MODEL_MID = 'fake-openai-mid';
const assert = require('assert');
const cfg = require('./config.cjs');
cfg.PRICES['openai:economy'] = { in: 0.2, out: 1.2 };
const llm = require('./index.cjs');
const logs = [];
llm.setUsageLogger((r) => logs.push(r));

const ok = (name, text) => ({ name, generate: async ({ model }) => ({ text: `${text} via ${model}`, usage: { inputTokens: 1000, outputTokens: 500 } }) });
(async () => {
  // 1) routing + cost
  llm._setAdapters({ gemini: ok('gemini', 'G'), openai: ok('openai', 'O') });
  let r = await llm.generate({ messages: [{ role: 'user', content: 'Tell me a joke' }], mode: 'auto' });
  assert.strictEqual(r.provider, 'openai'); assert.strictEqual(r.tier, 'economy');
  assert.ok(Math.abs(r.costUsd - (1000 * 0.2 + 500 * 1.2) / 1e6) < 1e-12);
  r = await llm.generate({ messages: [{ role: 'user', content: 'Should I train hard after bad sleep?' }], mode: 'auto' });
  assert.strictEqual(r.provider, 'gemini'); assert.strictEqual(r.costUsd, null);
  // 2) fallback on 5xx
  let calls = 0;
  llm._setAdapters({
    gemini: { generate: async () => { calls++; const e = new Error('boom'); e.status = 503; throw e; } },
    openai: ok('openai', 'O'),
  });
  process.env.OPENAI_MODEL_MID = 'fake-openai-mid';
  cfg.MODELS.openai.mid = 'fake-openai-mid';
  r = await llm.generate({ messages: [{ role: 'user', content: 'my heart rate is high' }], mode: 'coach' });
  assert.strictEqual(r.fellBack, true); assert.strictEqual(r.provider, 'openai'); assert.strictEqual(calls, 2); // 1 try + 1 retry
  // 3) non-retryable error is not retried, and no fallback hides a 400
  llm._setAdapters({ gemini: { generate: async () => { const e = new Error('bad request'); e.status = 400; throw e; } }, openai: ok('openai', 'O') });
  await assert.rejects(() => llm.generate({ messages: [{ role: 'user', content: 'sleep' }], mode: 'coach', allowFallback: false }), /bad request/);
  // 3b) ...and even with fallback allowed, a 400 is thrown instead of switching provider
  await assert.rejects(() => llm.generate({ messages: [{ role: 'user', content: 'sleep' }], mode: 'coach' }), /bad request/);
  // 3c) a timeout still falls back
  llm._setAdapters({ gemini: { generate: async () => { const e = new Error('slow'); e.code = 'ETIMEDOUT'; throw e; } }, openai: ok('openai', 'O') });
  r = await llm.generate({ messages: [{ role: 'user', content: 'sleep' }], mode: 'coach' });
  assert.strictEqual(r.fellBack, true); assert.strictEqual(r.provider, 'openai');
  // 3d) verified per-model price wins over tier price; cached reads / cache writes priced separately
  cfg.MODELS.openai.economy = 'gpt-6-luna';
  llm._setAdapters({ gemini: ok('gemini', 'G'), openai: { generate: async () => ({ text: 'x', usage: { inputTokens: 3000, cachedInputTokens: 1024, cacheWriteTokens: 1000, outputTokens: 400 } }) } });
  r = await llm.generate({ messages: [{ role: 'user', content: 'hi' }], mode: 'general' });
  assert.ok(Math.abs(r.costUsd - (976 * 0.10 + 1024 * 0.01 + 1000 * 0.125 + 400 * 0.50) / 1e6) < 1e-12);
  // 3e) > 272K input tokens uses long-context rates for the whole request
  llm._setAdapters({ gemini: ok('gemini', 'G'), openai: { generate: async () => ({ text: 'x', usage: { inputTokens: 300000, outputTokens: 1000 } }) } });
  r = await llm.generate({ messages: [{ role: 'user', content: 'hi' }], mode: 'general' });
  assert.ok(Math.abs(r.costUsd - (300000 * 0.20 + 1000 * 0.75) / 1e6) < 1e-12);
  // 3f) placeholder price entry (null rates) reports null cost instead of a guess
  cfg.MODELS.gemini.mid = 'gemini-3.8-flash';
  cfg.PRICES['gemini:mid'] = { in: 1, out: 1 };
  llm._setAdapters({ gemini: ok('gemini', 'G'), openai: ok('openai', 'O') });
  r = await llm.generate({ messages: [{ role: 'user', content: 'sleep' }], mode: 'coach' });
  assert.strictEqual(r.provider, 'gemini'); assert.strictEqual(r.costUsd, null);
  cfg.PRICES['gemini:mid'] = null;
  // 3g) overall deadline: the hung attempt is aborted and no retry/fallback starts without time left
  let seenSignal = null, openaiCalled = false;
  llm._setAdapters({
    gemini: { generate: ({ signal }) => { seenSignal = signal; return new Promise(() => {}); } },
    openai: { generate: async () => { openaiCalled = true; return { text: 'O', usage: { inputTokens: 1, outputTokens: 1 } }; } },
  });
  let t0 = Date.now();
  await assert.rejects(() => llm.generate({ messages: [{ role: 'user', content: 'sleep' }], mode: 'coach', deadlineMs: 1200 }), (e) => e.code === 'EDEADLINE');
  assert.ok(seenSignal && seenSignal.aborted, 'timed-out attempt must be aborted');
  assert.strictEqual(openaiCalled, false);
  assert.ok(Date.now() - t0 < 1700, 'must stop near the deadline');
  // 3h) per-attempt timeout shorter than the deadline: hung primary times out twice, fallback still fits
  let geminiCalls = 0;
  llm._setAdapters({
    gemini: { generate: () => { geminiCalls++; return new Promise(() => {}); } },
    openai: ok('openai', 'O'),
  });
  t0 = Date.now();
  r = await llm.generate({ messages: [{ role: 'user', content: 'sleep' }], mode: 'coach', timeoutMs: 300, deadlineMs: 3000 });
  assert.strictEqual(r.fellBack, true); assert.strictEqual(r.provider, 'openai'); assert.strictEqual(geminiCalls, 2);
  assert.ok(Date.now() - t0 < 3000);
  // 4) missing model config gives a clear error
  cfg.MODELS.openai.economy = null;
  llm._setAdapters({ gemini: ok('gemini', 'G'), openai: ok('openai', 'O') });
  await assert.rejects(() => llm.generate({ messages: [{ role: 'user', content: 'hi' }], mode: 'general', allowFallback: false }), /No model configured/);
  console.log('ALL MOCK TESTS PASSED;', logs.length, 'usage log lines');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
