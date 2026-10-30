'use strict';
/**
 * General aiModel='low' (LiteLLM general-deepseek) + fallback to OpenAI economy.
 * Run: node llm/test-low.cjs
 */
const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const off = spawnSync(
  process.execPath,
  [
    '-e',
    `
      process.env.LLM_USE_LITELLM = 'true';
      process.env.LITELLM_BASE_URL = 'http://127.0.0.1:4000/v1';
      process.env.OPENAI_MODEL_ECONOMY = 'fake-openai-eco';
      delete process.env.DEEPSEEK_ENABLED;
      const llm = require(${JSON.stringify(path.join(__dirname, 'index.cjs'))});
      llm.generate({
        messages: [{ role: 'user', content: 'hi' }],
        mode: 'general',
        aiModel: 'low',
      }).then(() => {
        console.error('expected ai_model_unavailable');
        process.exit(1);
      }).catch((e) => {
        if (e.status !== 400 || e.code !== 'ai_model_unavailable') {
          console.error(e);
          process.exit(1);
        }
        process.exit(0);
      });
    `,
  ],
  { encoding: 'utf8' }
);
assert.strictEqual(off.status, 0, off.stderr || off.stdout || 'flag-off child failed');

process.env.LLM_USE_LITELLM = 'true';
process.env.LITELLM_BASE_URL = 'http://127.0.0.1:4000/v1';
process.env.DEEPSEEK_ENABLED = 'true';
process.env.OPENAI_MODEL_ECONOMY = 'fake-openai-eco';
process.env.LITELLM_MODEL_GENERAL_DEEPSEEK = 'general-deepseek';

const llm = require('./index.cjs');
const logs = [];
llm.setUsageLogger((r) => logs.push(r));

const ok = (name, text) => ({
  name,
  generate: async ({ model }) => ({
    text: `${text} via ${model}`,
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
});

(async () => {
  llm._setAdapters({
    litellm: ok('litellm', 'D'),
    openai: ok('openai', 'O'),
    gemini: ok('gemini', 'G'),
  });
  let r = await llm.generate({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'general',
    aiModel: 'low',
  });
  assert.strictEqual(r.provider, 'litellm');
  assert.strictEqual(r.tier, 'low');
  assert.strictEqual(r.model, 'general-deepseek');
  assert.strictEqual(r.fellBack, false);
  assert.strictEqual(logs.at(-1).provider, 'litellm');

  let calls = 0;
  llm._setAdapters({
    litellm: {
      generate: async () => {
        calls++;
        const e = new Error('busy');
        e.status = 503;
        throw e;
      },
    },
    openai: ok('openai', 'O'),
    gemini: ok('gemini', 'G'),
  });
  r = await llm.generate({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'general',
    aiModel: 'low',
  });
  assert.strictEqual(r.fellBack, true);
  assert.strictEqual(r.provider, 'openai');
  assert.strictEqual(r.tier, 'economy');
  assert.strictEqual(r.model, 'fake-openai-eco');
  assert.strictEqual(calls, 2);
  assert.strictEqual(logs.at(-1).provider, 'openai');
  assert.strictEqual(logs.at(-1).fellBack, true);

  llm._setAdapters({
    litellm: {
      generate: async () => {
        const e = new Error('bad request');
        e.status = 400;
        throw e;
      },
    },
    openai: ok('openai', 'O'),
    gemini: ok('gemini', 'G'),
  });
  await assert.rejects(
    () => llm.generate({
      messages: [{ role: 'user', content: 'hi' }],
      mode: 'general',
      aiModel: 'low',
    }),
    /bad request/
  );

  llm._setAdapters({
    litellm: {
      generate: async () => {
        const e = new Error('slow');
        e.code = 'ETIMEDOUT';
        throw e;
      },
    },
    openai: ok('openai', 'O'),
    gemini: ok('gemini', 'G'),
  });
  r = await llm.generate({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'general',
    aiModel: 'low',
  });
  assert.strictEqual(r.fellBack, true);
  assert.strictEqual(r.provider, 'openai');

  console.log('ALL LOW-COST MOCK TESTS PASSED;', logs.length, 'usage log lines');
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
