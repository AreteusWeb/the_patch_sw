'use strict';
/**
 * Latency / token / cost comparison: direct adapters vs LiteLLM proxy.
 *
 * For each of openai + gemini: 10 calls direct, 10 via LiteLLM, same short message.
 * Prints a summary table (avg latency, p95, tokens incl. reasoning, costUsd).
 * Never prints API keys or full reply bodies.
 *
 * Usage (from the-patch-server/, CMD):
 *   set LITELLM_BASE_URL=http://localhost:4000/v1
 *   set LITELLM_API_KEY=sk-...
 *   set LLM_USE_LITELLM=true
 *   node scripts/compare-litellm.cjs
 *
 * If you get 404, try LITELLM_BASE_URL=http://localhost:4000 (no /v1) or with /v1.
 *
 * Needs: OpenAI + Vertex env for direct path; LiteLLM proxy running with aliases
 * general-openai and general-gemini (or LITELLM_MODEL_GENERAL_* overrides).
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Force the flag on for this script so MODELS.litellm is registered.
process.env.LLM_USE_LITELLM = 'true';

if (!String(process.env.LITELLM_BASE_URL || '').trim()) {
  console.error(
    'LITELLM_BASE_URL is required.\n' +
      '  set LITELLM_BASE_URL=http://localhost:4000/v1\n' +
      '  (if 404, try http://localhost:4000 without /v1)'
  );
  process.exit(1);
}

const llm = require('../llm/index.cjs');
const { MODELS } = require('../llm/config.cjs');

const N = 10;
const MESSAGE = 'Reply with exactly one short sentence: what is 2+2?';
const RUNS = [
  { label: 'openai-direct', provider: 'openai', tier: 'economy', preferDirect: true },
  { label: 'openai-litellm', provider: 'litellm', tier: 'economy', preferDirect: false },
  { label: 'gemini-direct', provider: 'gemini', tier: 'mid', preferDirect: true },
  { label: 'gemini-litellm', provider: 'litellm', tier: 'mid', preferDirect: false },
];

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function p95(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1);
  return s[idx];
}

function fmtMs(n) {
  return n == null || !Number.isFinite(n) ? '-' : `${n.toFixed(0)} ms`;
}

function fmtCost(n) {
  return n == null || !Number.isFinite(n) ? '-' : n.toFixed(6);
}

function fmtNum(n) {
  return n == null || !Number.isFinite(n) ? '-' : String(Math.round(n));
}

async function oneCall(run) {
  const started = Date.now();
  try {
    const r = await llm.generate({
      messages: [{ role: 'user', content: MESSAGE }],
      provider: run.provider,
      tier: run.tier,
      preferDirect: run.preferDirect,
      allowFallback: false,
      purpose: 'compare_litellm',
      system: 'You are a concise assistant. Answer in one short sentence.',
    });
    return {
      ok: true,
      latencyMs: r.latencyMs ?? Date.now() - started,
      inputTokens: r.usage?.inputTokens ?? 0,
      outputTokens: r.usage?.outputTokens ?? 0,
      thinkingTokens: r.usage?.thinkingTokens ?? 0,
      totalTokens: r.usage?.totalTokens ?? ((r.usage?.inputTokens || 0) + (r.usage?.outputTokens || 0)),
      costUsd: r.costUsd,
      model: r.model,
      responseModel: r.responseModel,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      costUsd: null,
      model: MODELS[run.provider]?.[run.tier] || null,
      responseModel: null,
      error: String(err && err.message ? err.message : err).slice(0, 160),
    };
  }
}

async function runSeries(run) {
  const rows = [];
  for (let i = 0; i < N; i++) {
    process.stdout.write(`  ${run.label} ${i + 1}/${N}…\r`);
    rows.push(await oneCall(run));
  }
  process.stdout.write(' '.repeat(40) + '\r');
  const ok = rows.filter((r) => r.ok);
  const latencies = ok.map((r) => r.latencyMs);
  return {
    label: run.label,
    provider: run.provider,
    tier: run.tier,
    model: ok[0]?.model || rows[0]?.model,
    responseModel: ok[0]?.responseModel || null,
    ok: ok.length,
    fail: rows.length - ok.length,
    avgLatencyMs: avg(latencies),
    p95LatencyMs: p95(latencies),
    avgInput: avg(ok.map((r) => r.inputTokens)),
    avgOutput: avg(ok.map((r) => r.outputTokens)),
    avgThinking: avg(ok.map((r) => r.thinkingTokens)),
    avgTotal: avg(ok.map((r) => r.totalTokens)),
    avgCostUsd: avg(ok.map((r) => r.costUsd).filter((c) => c != null)),
    lastError: rows.find((r) => !r.ok)?.error || null,
  };
}

function printTable(summaries) {
  const cols = [
    ['path', (s) => s.label, 18],
    ['ok', (s) => `${s.ok}/${N}`, 6],
    ['avg lat', (s) => fmtMs(s.avgLatencyMs), 10],
    ['p95 lat', (s) => fmtMs(s.p95LatencyMs), 10],
    ['in tok', (s) => fmtNum(s.avgInput), 8],
    ['out tok', (s) => fmtNum(s.avgOutput), 8],
    ['think tok', (s) => fmtNum(s.avgThinking), 10],
    ['total tok', (s) => fmtNum(s.avgTotal), 10],
    ['costUsd', (s) => fmtCost(s.avgCostUsd), 12],
  ];
  const header = cols.map(([name, , w]) => name.padEnd(w)).join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const s of summaries) {
    console.log(cols.map(([, fn, w]) => String(fn(s)).padEnd(w)).join(' '));
  }
}

async function main() {
  console.log('compare-litellm — direct vs LiteLLM proxy');
  console.log(`message: ${JSON.stringify(MESSAGE)}`);
  console.log(`n=${N} per path`);
  console.log(
    `LITELLM_BASE_URL=${process.env.LITELLM_BASE_URL} ` +
      `(key set: ${String(process.env.LITELLM_API_KEY || '').trim() ? 'yes' : 'no'})`
  );
  console.log(
    `aliases: economy=${MODELS.litellm?.economy} mid=${MODELS.litellm?.mid}`
  );
  console.log('');
  console.log(
    'NOTE (thinking equivalence): Gemini via LiteLLM uses reasoning_effort="none", which in\n' +
      'LiteLLM v1.105.1 maps to thinkingLevel="low" + includeThoughts=false for gemini-3.8-flash\n' +
      '(closest match to The Patch COACH_GENERATION_CONFIG). NOT a guaranteed 1:1 equivalent;\n' +
      'reasoning_effort="low" would set includeThoughts=true and is intentionally NOT used here.'
  );
  console.log('');

  llm.setUsageLogger(() => {});

  const summaries = [];
  for (const run of RUNS) {
    summaries.push(await runSeries(run));
  }

  printTable(summaries);
  console.log('');
  for (const s of summaries) {
    if (s.fail) {
      console.log(`! ${s.label}: ${s.fail} failed. Last error: ${s.lastError}`);
    }
    if (s.responseModel) {
      console.log(`  ${s.label}: model=${s.model} responseModel=${s.responseModel}`);
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
