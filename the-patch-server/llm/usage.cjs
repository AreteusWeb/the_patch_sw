'use strict';
/**
 * Helpers for aggregating General-mode LLM spend into users/{uid}/usage/{periodStart}.
 * Period = UTC calendar month (doc id YYYY-MM-01). No message content here.
 */
const { PLAN_BUDGETS, billableProviderForModel } = require('./config.cjs');

const PROVIDERS = ['openai', 'gemini', 'deepseek'];

function periodStartDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Doc id: YYYY-MM-DD of the period start (UTC month). */
function periodStartKey(now = new Date()) {
  return periodStartDate(now).toISOString().slice(0, 10);
}

/** ISO timestamp for the next UTC month start (local usage-panel "resets"). */
function periodResetsAt(now = new Date()) {
  const start = periodStartDate(now);
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
  ).toISOString();
}

function planLimitUsd(plan) {
  const key = String(plan == null ? 'free' : plan).trim().toLowerCase() || 'free';
  if (!Object.prototype.hasOwnProperty.call(PLAN_BUDGETS, key)) {
    return null;
  }
  const v = PLAN_BUDGETS[key];
  return v == null ? null : Number(v);
}

/**
 * Map llm.generate() result → openai | gemini | deepseek for the usage doc.
 * Prefer the real upstream model (alias map); never bucket as 'litellm'.
 */
function billableProvider(reply) {
  if (!reply || typeof reply !== 'object') return 'openai';

  for (const id of [reply.responseModel, reply.model]) {
    const fromModel = billableProviderForModel(id);
    if (fromModel) return fromModel;
  }

  const tier = String(reply.tier || '');
  const provider = String(reply.provider || '');

  if (tier === 'low') return 'deepseek';
  if (provider === 'gemini' || tier === 'mid') return 'gemini';
  if (provider === 'openai' || tier === 'economy') return 'openai';
  if (provider === 'litellm') {
    // Alias unresolved — tier is the best signal left.
    if (tier === 'mid') return 'gemini';
    if (tier === 'low') return 'deepseek';
    return 'openai';
  }
  return 'openai';
}

function emptyBucket() {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0 };
}

/**
 * Read one numeric field from a usage doc.
 * Prefer nested maps (total.costUsd → data.total.costUsd); fall back to flat
 * dotted keys as Firestore set({'total.costUsd': n}) used to store them.
 */
function readUsageField(data, prefix, field) {
  if (!data || typeof data !== 'object') return 0;
  const nested = data[prefix];
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && nested[field] != null) {
    const n = Number(nested[field]);
    return Number.isFinite(n) ? n : 0;
  }
  const flat = data[`${prefix}.${field}`];
  if (flat != null) {
    const n = Number(flat);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function readUsageBucket(data, prefix) {
  return {
    costUsd: readUsageField(data, prefix, 'costUsd'),
    inputTokens: readUsageField(data, prefix, 'inputTokens'),
    outputTokens: readUsageField(data, prefix, 'outputTokens'),
  };
}

function normalizeUsageDoc(data) {
  const total = readUsageBucket(data, 'total');
  const byProvider = {};
  for (const p of PROVIDERS) {
    byProvider[p] = readUsageBucket(data, p);
  }
  return { total, byProvider };
}

module.exports = {
  PROVIDERS,
  periodStartKey,
  periodResetsAt,
  planLimitUsd,
  billableProvider,
  emptyBucket,
  readUsageField,
  readUsageBucket,
  normalizeUsageDoc,
};
