'use strict';
/**
 * LiteLLM end-user budget / provisioning:
 *   - 422 budget_exceeded → quota_exceeded (429), no fallback
 *   - ensure ok:false + defined budget → quota_unavailable (503), no model call
 *   - ensure ok:false / skip with null budget → continue
 *   - unknown plan → lowest defined PLAN_BUDGETS; all null → no limit
 *   - null budget is not cached in _ensuredCustomers
 * Run: node llm/test-budget.cjs
 */
process.env.LLM_USE_LITELLM = 'true';
process.env.LITELLM_BASE_URL = 'http://127.0.0.1:4000/v1';
process.env.LITELLM_API_KEY = 'sk-test-not-real';
process.env.LITELLM_ADMIN_KEY = 'sk-admin-not-real';
process.env.OPENAI_MODEL_ECONOMY = 'fake-openai-eco';

const assert = require('assert');
const cfg = require('./config.cjs');
const llm = require('./index.cjs');
const litellm = require('./adapters/litellm.cjs');

llm.setUsageLogger(() => {});

const savedBudgets = { ...cfg.PLAN_BUDGETS };
function restoreBudgets() {
  for (const k of Object.keys(cfg.PLAN_BUDGETS)) delete cfg.PLAN_BUDGETS[k];
  Object.assign(cfg.PLAN_BUDGETS, savedBudgets);
}

const ok = (name, text) => ({
  name,
  generate: async ({ model, user }) => ({
    text: `${text}:${user || ''}:${model}`,
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
});

(async () => {
  // ── 1) 422 → quota_exceeded; no OpenAI fallback ──────────────────────────
  let openaiCalls = 0;
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = null;
  llm._setAdapters({
    litellm: {
      name: 'litellm',
      generate: async () => {
        const e = new Error('Budget exceeded!');
        e.status = 422;
        e.error = { type: 'budget_exceeded' };
        if (litellm.isBudgetExceededError(e)) throw litellm.quotaExceededError(e);
        throw e;
      },
    },
    openai: {
      generate: async () => {
        openaiCalls++;
        return { text: 'O', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
    gemini: ok('gemini', 'G'),
  });
  await assert.rejects(
    () => llm.generate({
      messages: [{ role: 'user', content: 'hi' }],
      mode: 'general',
      userId: 'uid-budget-1',
      plan: 'free',
    }),
    (e) => e.code === 'quota_exceeded' && e.status === 429
  );
  assert.strictEqual(openaiCalls, 0, 'must not fall back to openai on budget_exceeded');

  const mapped429 = llm.httpErrorFromLlm({
    code: 'quota_exceeded',
    message: 'AI usage quota for this period has been reached.',
  });
  assert.strictEqual(mapped429.status, 429);
  assert.strictEqual(mapped429.body.error, 'quota_exceeded');

  // ── 2) ok:false + defined budget → 503, model never called ───────────────
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = 5;
  cfg.PLAN_BUDGETS.plus = 20;
  cfg.PLAN_BUDGETS.pro = 50;
  let customerPosts = 0;
  litellm._setFetch(async () => {
    customerPosts++;
    return { ok: false, status: 500, text: async () => 'upstream boom' };
  });
  // ensure fails first → quota_unavailable without calling chat.completions.
  await assert.rejects(
    () => litellm.generate({
      model: 'general-openai',
      messages: [{ role: 'user', content: 'hi' }],
      user: 'uid-fail-ensure',
      plan: 'free',
    }),
    (e) => e.code === 'quota_unavailable' && e.status === 503
  );
  assert.strictEqual(customerPosts, 1);

  const mapped503 = llm.httpErrorFromLlm({ code: 'quota_unavailable' });
  assert.strictEqual(mapped503.status, 503);
  assert.strictEqual(mapped503.body.error, 'quota_unavailable');
  assert.ok(!/gateway|admin|key|LITELLM/i.test(mapped503.body.message));

  // index: quota_unavailable must not fall back
  openaiCalls = 0;
  llm._setAdapters({
    litellm: {
      generate: async () => {
        throw litellm.quotaUnavailableError();
      },
    },
    openai: {
      generate: async () => {
        openaiCalls++;
        return { text: 'O', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
    gemini: ok('gemini', 'G'),
  });
  await assert.rejects(
    () => llm.generate({
      messages: [{ role: 'user', content: 'hi' }],
      mode: 'general',
      userId: 'uid-unavail',
      plan: 'free',
    }),
    (e) => e.code === 'quota_unavailable'
  );
  assert.strictEqual(openaiCalls, 0);

  // ── 3) null budget: ensure skips; ok:false gate still allows completion ──
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = null;
  cfg.PLAN_BUDGETS.plus = null;
  cfg.PLAN_BUDGETS.pro = null;
  customerPosts = 0;
  litellm._setFetch(async () => {
    customerPosts++;
    throw new Error('fetch must not run when budget is null');
  });
  let r = await litellm.ensureEndUser('uid-null-plan', 'free');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.reason, 'null_budget');
  assert.strictEqual(r.maxBudget, null);
  assert.strictEqual(customerPosts, 0);
  assert.strictEqual(litellm.budgetForPlan('free').maxBudget, null);
  // Even a failed ensure must not block when there is no budget limit.
  assert.doesNotThrow(() =>
    litellm.assertCustomerReady({ ok: false, reason: 'no_admin_key' }, null)
  );
  assert.throws(
    () => litellm.assertCustomerReady({ ok: false, reason: 'no_admin_key' }, 5),
    (e) => e.code === 'quota_unavailable' && e.status === 503
  );

  // ── 4) unknown plan → lowest defined; all null → no limit ────────────────
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = 10;
  cfg.PLAN_BUDGETS.plus = 3;
  cfg.PLAN_BUDGETS.pro = 50;
  assert.strictEqual(litellm.lowestDefinedBudget(), 3);
  assert.strictEqual(litellm.budgetForPlan('enterprise').maxBudget, 3);
  assert.strictEqual(litellm.budgetForPlan('enterprise').known, false);

  litellm._resetCustomerCache();
  customerPosts = 0;
  litellm._setFetch(async (_url, init) => {
    customerPosts++;
    const body = JSON.parse(init.body);
    assert.strictEqual(body.max_budget, 3);
    assert.strictEqual(body.user_id, 'uid-unknown');
    return { ok: true, status: 200, text: async () => '{}' };
  });
  r = await litellm.ensureEndUser('uid-unknown', 'enterprise');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.maxBudget, 3);
  assert.strictEqual(customerPosts, 1);

  restoreBudgets();
  cfg.PLAN_BUDGETS.free = null;
  cfg.PLAN_BUDGETS.plus = null;
  cfg.PLAN_BUDGETS.pro = null;
  assert.strictEqual(litellm.lowestDefinedBudget(), null);
  assert.strictEqual(litellm.budgetForPlan('enterprise').maxBudget, null);

  // ── 5) null budget must NOT be cached ────────────────────────────────────
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = null;
  litellm._setFetch(null);
  r = await litellm.ensureEndUser('uid-no-cache', 'free');
  assert.strictEqual(r.skipped, true);
  // Second call is not "cached: true" (would short-circuit before null check).
  r = await litellm.ensureEndUser('uid-no-cache', 'free');
  assert.strictEqual(r.cached, undefined);
  assert.strictEqual(r.skipped, true);

  // ── 6) already exists + defined budget → ok + cached ─────────────────────
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = 5;
  customerPosts = 0;
  litellm._setFetch(async () => {
    customerPosts++;
    return {
      ok: false,
      status: 400,
      text: async () => 'Customer already exists',
    };
  });
  r = await litellm.ensureEndUser('uid-already', 'free');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.alreadyExists, true);
  r = await litellm.ensureEndUser('uid-already', 'free');
  assert.strictEqual(r.cached, true);
  assert.strictEqual(customerPosts, 1);

  // ── 7) opaque user id still passed through index ─────────────────────────
  let seenUser = null;
  llm._setAdapters({
    litellm: {
      generate: async ({ user }) => {
        seenUser = user;
        return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
    openai: ok('openai', 'O'),
    gemini: ok('gemini', 'G'),
  });
  await llm.generate({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'general',
    userId: 'firebaseUidOpaque',
    plan: 'free',
  });
  assert.strictEqual(seenUser, 'firebaseUidOpaque');

  restoreBudgets();
  litellm._setFetch(null);
  litellm._resetCustomerCache();
  console.log('ALL BUDGET MOCK TESTS PASSED');
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
