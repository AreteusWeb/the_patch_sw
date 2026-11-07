'use strict';
/**
 * General aiModel validation + routing (openai | deepseek | gemini + aliases).
 * Run: node llm/test-aimodel.cjs
 */
const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const { normalizeGeneralAiModel, GENERAL_AI_MODELS } = require('./config.cjs');

assert.deepStrictEqual(
  [...GENERAL_AI_MODELS].sort(),
  ['deepseek', 'gemini', 'low', 'openai', 'standard'].sort()
);
assert.strictEqual(normalizeGeneralAiModel(null), 'openai');
assert.strictEqual(normalizeGeneralAiModel(''), 'openai');
assert.strictEqual(normalizeGeneralAiModel('openai'), 'openai');
assert.strictEqual(normalizeGeneralAiModel('standard'), 'openai');
assert.strictEqual(normalizeGeneralAiModel('STANDARD'), 'openai');
assert.strictEqual(normalizeGeneralAiModel('deepseek'), 'deepseek');
assert.strictEqual(normalizeGeneralAiModel('low'), 'deepseek');
assert.strictEqual(normalizeGeneralAiModel('gemini'), 'gemini');
assert.strictEqual(normalizeGeneralAiModel('claude'), null);
assert.strictEqual(normalizeGeneralAiModel('mid'), null);

// DeepSeek flag off → ai_model_unavailable for both 'low' and 'deepseek'
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
      (async () => {
        for (const aiModel of ['low', 'deepseek']) {
          try {
            await llm.generate({
              messages: [{ role: 'user', content: 'hi' }],
              mode: 'general',
              aiModel,
            });
            console.error('expected ai_model_unavailable for', aiModel);
            process.exit(1);
          } catch (e) {
            if (e.status !== 400 || e.code !== 'ai_model_unavailable') {
              console.error(aiModel, e);
              process.exit(1);
            }
          }
        }
        try {
          await llm.generate({
            messages: [{ role: 'user', content: 'hi' }],
            mode: 'general',
            aiModel: 'not-a-model',
          });
          console.error('expected invalid_ai_model');
          process.exit(1);
        } catch (e) {
          if (e.status !== 400 || e.code !== 'invalid_ai_model') {
            console.error(e);
            process.exit(1);
          }
        }
        process.exit(0);
      })();
    `,
  ],
  { encoding: 'utf8' }
);
assert.strictEqual(off.status, 0, off.stderr || off.stdout || 'flag-off child failed');

process.env.LLM_USE_LITELLM = 'true';
process.env.LITELLM_BASE_URL = 'http://127.0.0.1:4000/v1';
process.env.DEEPSEEK_ENABLED = 'true';
process.env.OPENAI_MODEL_ECONOMY = 'fake-openai-eco';
process.env.GEMINI_MODEL_MID = 'fake-gemini-mid';
process.env.LITELLM_MODEL_GENERAL_OPENAI = 'general-openai';
process.env.LITELLM_MODEL_GENERAL_GEMINI = 'general-gemini';
process.env.LITELLM_MODEL_GENERAL_DEEPSEEK = 'general-deepseek';

// Re-require after env (config caches MODELS at first load — use fresh child for routes)
const routeChild = spawnSync(
  process.execPath,
  [
    '-e',
    `
      process.env.LLM_USE_LITELLM = 'true';
      process.env.LITELLM_BASE_URL = 'http://127.0.0.1:4000/v1';
      process.env.DEEPSEEK_ENABLED = 'true';
      process.env.OPENAI_MODEL_ECONOMY = 'fake-openai-eco';
      process.env.GEMINI_MODEL_MID = 'fake-gemini-mid';
      process.env.LITELLM_MODEL_GENERAL_OPENAI = 'general-openai';
      process.env.LITELLM_MODEL_GENERAL_GEMINI = 'general-gemini';
      process.env.LITELLM_MODEL_GENERAL_DEEPSEEK = 'general-deepseek';
      const assert = require('assert');
      const llm = require(${JSON.stringify(path.join(__dirname, 'index.cjs'))});
      const ok = (name, text) => ({
        name,
        generate: async ({ model }) => ({
          text: text + ' via ' + model,
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      });
      (async () => {
        llm._setAdapters({
          litellm: ok('litellm', 'L'),
          openai: ok('openai', 'O'),
          gemini: ok('gemini', 'G'),
        });

        let r = await llm.generate({
          messages: [{ role: 'user', content: 'hi' }],
          mode: 'general',
          aiModel: 'openai',
        });
        assert.strictEqual(r.provider, 'litellm');
        assert.strictEqual(r.model, 'general-openai');
        assert.strictEqual(r.tier, 'economy');
        assert.strictEqual(r.fellBack, false);

        r = await llm.generate({
          messages: [{ role: 'user', content: 'hi' }],
          mode: 'general',
          aiModel: 'standard',
        });
        assert.strictEqual(r.model, 'general-openai');

        r = await llm.generate({
          messages: [{ role: 'user', content: 'hi' }],
          mode: 'general',
          aiModel: 'gemini',
        });
        assert.strictEqual(r.provider, 'litellm');
        assert.strictEqual(r.model, 'general-gemini');
        assert.strictEqual(r.tier, 'mid');

        r = await llm.generate({
          messages: [{ role: 'user', content: 'hi' }],
          mode: 'general',
          aiModel: 'deepseek',
        });
        assert.strictEqual(r.model, 'general-deepseek');
        assert.strictEqual(r.tier, 'low');

        r = await llm.generate({
          messages: [{ role: 'user', content: 'hi' }],
          mode: 'general',
          aiModel: 'low',
        });
        assert.strictEqual(r.model, 'general-deepseek');

        // quota_exceeded must not fall back
        llm._setAdapters({
          litellm: {
            generate: async () => {
              const e = new Error('budget');
              e.status = 422;
              e.code = 'quota_exceeded';
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
            aiModel: 'gemini',
          }),
          (e) => e.code === 'quota_exceeded'
        );

        console.log('ALL AIMODEL MOCK TESTS PASSED');
      })().catch((e) => {
        console.error('FAILED', e);
        process.exit(1);
      });
    `,
  ],
  { encoding: 'utf8' }
);
assert.strictEqual(
  routeChild.status,
  0,
  routeChild.stderr || routeChild.stdout || 'route child failed'
);
console.log(routeChild.stdout.trim());
