'use strict';
/**
 * Helpers for aggregating General-mode LLM spend into users/{uid}/usage/{periodStart}.
 * Period = UTC calendar month (doc id YYYY-MM-01). No message content here.
 */
const { PLAN_BUDGETS } = require('./config.cjs');

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
 * Uses the provider/tier that actually answered (after fallback).
 */
function billableProvider(reply) {
  if (!reply || typeof reply !== 'object') return 'openai';
  const tier = String(reply.tier || '');
  const model = String(reply.model || '');
  const responseModel = String(reply.responseModel || '');
  const provider = String(reply.provider || '');

  if (
    tier === 'low' ||
    /deepseek/i.test(model) ||
    /deepseek/i.test(responseModel)
  ) {
    return 'deepseek';
  }
  if (provider === 'gemini' || tier === 'mid' || /gemini/i.test(model)) {
    return 'gemini';
  }
  if (provider === 'openai' || tier === 'economy') return 'openai';
  if (provider === 'litellm') {
    if (/gemini/i.test(model)) return 'gemini';
    return 'openai';
  }
  return 'openai';
}

function emptyBucket() {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0 };
}

function normalizeUsageDoc(data) {
  const total = {
    costUsd: Number(data?.total?.costUsd) || 0,
    inputTokens: Number(data?.total?.inputTokens) || 0,
    outputTokens: Number(data?.total?.outputTokens) || 0,
  };
  const byProvider = {};
  for (const p of PROVIDERS) {
    byProvider[p] = {
      costUsd: Number(data?.[p]?.costUsd) || 0,
      inputTokens: Number(data?.[p]?.inputTokens) || 0,
      outputTokens: Number(data?.[p]?.outputTokens) || 0,
    };
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
  normalizeUsageDoc,
};
