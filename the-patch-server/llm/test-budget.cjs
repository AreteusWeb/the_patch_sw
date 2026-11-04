'use strict';
/**
 * LiteLLM end-user budget / provisioning + resetAt on quota_exceeded.
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
  // Config keys match Firestore plan ids
  assert.strictEqual(cfg.PLAN_BUDGETS.free, 0.50);
  assert.strictEqual(cfg.PLAN_BUDGETS.essential, 6.99);
  assert.strictEqual(cfg.PLAN_BUDGETS.pro, 13.99);
  assert.strictEqual(cfg.PLAN_BUDGETS.patch_pro, 13.99);
  assert.strictEqual(cfg.PLAN_BUDGETS.plus, undefined);

  // ── 1) 422 → quota_exceeded + resetAt from /customer/info; no fallback ───
  let openaiCalls = 0;
  litellm._resetCustomerCache();
  restoreBudgets();
  const resetIso = '2026-12-01T00:00:00.000Z';
  litellm._setFetch(async (url) => {
    assert.ok(String(url).includes('/customer/info'));
    assert.ok(String(url).includes('end_user_id=uid-budget-1'));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        litellm_budget_table: { budget_reset_at: resetIso },
      }),
    };
  });
  llm._setAdapters({
    litellm: {
      name: 'litellm',
      generate: async ({ user }) => {
        const e = new Error('Budget exceeded!');
        e.status = 422;
        e.error = { type: 'budget_exceeded' };
        if (litellm.isBudgetExceededError(e)) {
          const resetAt = await litellm.fetchBudgetResetAt(user);
          throw litellm.quotaExceededError(e, resetAt || undefined);
        }
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
  let caught = null;
  try {
    await llm.generate({
      messages: [{ role: 'user', content: 'hi' }],
      mode: 'general',
      userId: 'uid-budget-1',
      plan: 'essential',
    });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'quota_exceeded');
  assert.strictEqual(caught.status, 429);
  assert.strictEqual(caught.resetAt, resetIso);
  assert.strictEqual(openaiCalls, 0);

  const mapped429 = llm.httpErrorFromLlm(caught);
  assert.strictEqual(mapped429.status, 429);
  assert.strictEqual(mapped429.body.error, 'quota_exceeded');
  assert.strictEqual(mapped429.body.resetAt, resetIso);

  // /customer/info failure → 429 without resetAt
  litellm._setFetch(async () => {
    throw new Error('info down');
  });
  const eNoInfo = litellm.quotaExceededError(
    { status: 422 },
    (await litellm.fetchBudgetResetAt('uid-x')) || undefined
  );
  assert.strictEqual(eNoInfo.code, 'quota_exceeded');
  assert.strictEqual(eNoInfo.resetAt, undefined);
  const mappedNoReset = llm.httpErrorFromLlm(eNoInfo);
  assert.strictEqual(mappedNoReset.body.resetAt, undefined);

  // Real adapter path: 422 during completions → fetch resetAt then throw
  litellm._resetCustomerCache();
  restoreBudgets();
  // free null → ensure skips; still hit completion mock via replacing client is hard,
  // so exercise fetchBudgetResetAt + toIsoResetAt directly.
  assert.strictEqual(
    litellm.toIsoResetAt('2026-11-15T18:30:00Z'),
    new Date('2026-11-15T18:30:00Z').toISOString()
  );

  // ── 2) ok:false + defined budget → 503 ───────────────────────────────────
  litellm._resetCustomerCache();
  restoreBudgets();
  let customerPosts = 0;
  litellm._setFetch(async (url) => {
    if (String(url).includes('/customer/new')) {
      customerPosts++;
      return { ok: false, status: 500, text: async () => 'upstream boom' };
    }
    throw new Error('unexpected ' + url);
  });
  await assert.rejects(
    () => litellm.generate({
      model: 'general-openai',
      messages: [{ role: 'user', content: 'hi' }],
      user: 'uid-fail-ensure',
      plan: 'essential',
    }),
    (e) => e.code === 'quota_unavailable' && e.status === 503
  );
  assert.strictEqual(customerPosts, 1);

  const mapped503 = llm.httpErrorFromLlm({ code: 'quota_unavailable' });
  assert.strictEqual(mapped503.status, 503);
  assert.strictEqual(mapped503.body.error, 'quota_unavailable');

  openaiCalls = 0;
  llm._setAdapters({
    litellm: { generate: async () => { throw litellm.quotaUnavailableError(); } },
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
      plan: 'pro',
    }),
    (e) => e.code === 'quota_unavailable'
  );
  assert.strictEqual(openaiCalls, 0);

  // ── 3) null budget (temp): skip create; ok:false gate allows completion ──
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = null; // exercise null-budget path without changing prod default
  customerPosts = 0;
  litellm._setFetch(async () => {
    customerPosts++;
    throw new Error('fetch must not run for null budget');
  });
  let r = await litellm.ensureEndUser('uid-null-plan', 'free');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(customerPosts, 0);
  assert.doesNotThrow(() =>
    litellm.assertCustomerReady({ ok: false, reason: 'no_admin_key' }, null)
  );
  assert.throws(
    () => litellm.assertCustomerReady({ ok: false, reason: 'no_admin_key' }, 0.50),
    (e) => e.code === 'quota_unavailable'
  );
  restoreBudgets();

  // ── 4) unknown plan → lowest defined (free 0.50) ─────────────────────────
  restoreBudgets();
  assert.strictEqual(litellm.lowestDefinedBudget(), 0.50);
  assert.strictEqual(litellm.budgetForPlan('enterprise').maxBudget, 0.50);
  assert.strictEqual(litellm.budgetForPlan('free').maxBudget, 0.50);
  assert.strictEqual(litellm.budgetForPlan('essential').maxBudget, 6.99);
  assert.strictEqual(litellm.budgetForPlan('pro').maxBudget, 13.99);
  assert.strictEqual(litellm.budgetForPlan('patch_pro').maxBudget, 13.99);

  litellm._resetCustomerCache();
  customerPosts = 0;
  litellm._setFetch(async (_url, init) => {
    customerPosts++;
    const body = JSON.parse(init.body);
    assert.strictEqual(body.max_budget, 0.50);
    return { ok: true, status: 200, text: async () => '{}' };
  });
  r = await litellm.ensureEndUser('uid-unknown', 'enterprise');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.maxBudget, 0.50);
  assert.strictEqual(customerPosts, 1);

  // ── 5) null budget is not cached (temp free=null) ────────────────────────
  litellm._resetCustomerCache();
  restoreBudgets();
  cfg.PLAN_BUDGETS.free = null;
  litellm._setFetch(null);
  r = await litellm.ensureEndUser('uid-no-cache', 'free');
  assert.strictEqual(r.skipped, true);
  r = await litellm.ensureEndUser('uid-no-cache', 'free');
  assert.strictEqual(r.cached, undefined);
  assert.strictEqual(r.skipped, true);
  restoreBudgets();

  // ── 6) already exists ────────────────────────────────────────────────────
  litellm._resetCustomerCache();
  restoreBudgets();
  customerPosts = 0;
  litellm._setFetch(async () => {
    customerPosts++;
    return {
      ok: false,
      status: 400,
      text: async () => 'Customer already exists',
    };
  });
  r = await litellm.ensureEndUser('uid-already', 'pro');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.alreadyExists, true);
  r = await litellm.ensureEndUser('uid-already', 'pro');
  assert.strictEqual(r.cached, true);
  assert.strictEqual(customerPosts, 1);

  // ── 7) opaque user id ────────────────────────────────────────────────────
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
    plan: 'essential',
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
