'use strict';
/**
 * Usage helpers + local db increment (no message content).
 * Run: node llm/test-usage.cjs
 */
process.env.APP_MODE = 'local';

const assert = require('assert');
const usage = require('./usage.cjs');
const db = require('../providers/db-provider.local.cjs');

(async () => {
  assert.strictEqual(usage.billableProvider({ provider: 'openai', tier: 'economy' }), 'openai');
  assert.strictEqual(usage.billableProvider({ provider: 'gemini', tier: 'mid' }), 'gemini');
  assert.strictEqual(usage.billableProvider({ provider: 'litellm', tier: 'low', model: 'general-deepseek' }), 'deepseek');
  assert.strictEqual(usage.billableProvider({ provider: 'litellm', tier: 'economy', model: 'general-openai' }), 'openai');
  assert.strictEqual(usage.billableProvider({ provider: 'litellm', tier: 'mid', model: 'general-gemini' }), 'gemini');
  assert.strictEqual(usage.billableProvider({
    provider: 'litellm',
    model: 'general-openai',
    responseModel: 'gpt-6-luna',
  }), 'openai');
  assert.strictEqual(usage.billableProvider({ provider: 'openai', tier: 'economy', fellBack: true }), 'openai');
  // Never bucket as 'litellm'
  assert.notStrictEqual(
    usage.billableProvider({ provider: 'litellm', model: 'general-openai' }),
    'litellm'
  );

  const key = usage.periodStartKey(new Date('2026-11-15T12:00:00Z'));
  assert.strictEqual(key, '2026-11-01');
  assert.strictEqual(usage.periodResetsAt(new Date('2026-11-15T12:00:00Z')), '2026-12-01T00:00:00.000Z');
  assert.strictEqual(usage.planLimitUsd('essential'), 6.99);
  assert.strictEqual(usage.planLimitUsd('free'), 0.50);

  const uid = 'usage-test-uid';
  await db.incrementLlmUsage(uid, key, {
    provider: 'openai',
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 50,
  });
  await db.incrementLlmUsage(uid, key, {
    provider: 'deepseek',
    costUsd: null, // must still count tokens
    inputTokens: 20,
    outputTokens: 10,
  });
  const raw = await db.getLlmUsage(uid, key);
  const norm = usage.normalizeUsageDoc(raw);
  assert.ok(Math.abs(norm.total.costUsd - 0.01) < 1e-12);
  assert.strictEqual(norm.total.inputTokens, 120);
  assert.strictEqual(norm.total.outputTokens, 60);
  assert.strictEqual(norm.byProvider.openai.inputTokens, 100);
  assert.strictEqual(norm.byProvider.deepseek.inputTokens, 20);
  assert.strictEqual(norm.byProvider.deepseek.costUsd, 0);

  // Ensure normalized shape never embeds message fields
  assert.strictEqual(raw.message, undefined);
  assert.strictEqual(raw.text, undefined);

  console.log('ALL USAGE MOCK TESTS PASSED');
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
