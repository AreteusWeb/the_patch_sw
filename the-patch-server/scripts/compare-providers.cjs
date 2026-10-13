'use strict';
/**
 * Run the same questions through Gemini and OpenAI (llm/ layer) and write a CSV.
 *
 * Usage (from the-patch-server/):
 *   node scripts/compare-providers.cjs <questions.json> [out.csv] [--tier economy|mid|premium] [--system general|none]
 *
 * questions.json: an array of strings, or of objects { "id": "q1", "question": "..." }.
 * Defaults: out = compare-results-<timestamp>.csv, tier = economy, system = general
 * (the same prompt mode='general' uses in POST /api/coach/message).
 *
 * Needs the same env as the server (.env next to this folder): Vertex ADC +
 * GOOGLE_CLOUD_PROJECT for Gemini, OPENAI_API_KEY + OPENAI_MODEL_* for OpenAI.
 * Calls run one at a time with allowFallback:false so each row is the provider it says.
 * Token columns are measured from each API response; cost_usd is an estimate from
 * llm/config.cjs (MODEL_PRICES / PRICES) and stays empty for models without a verified price.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const llm = require('../llm/index.cjs');
const { GENERAL_ASSISTANT_SYSTEM_PROMPT } = require('../prompts/general-assistant.cjs');

const PROVIDERS = ['gemini', 'openai'];
const TIERS = ['economy', 'mid', 'premium'];
const COLUMNS = [
  'question_id', 'question', 'provider', 'model', 'response_model', 'tier', 'latency_ms',
  'input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'thinking_tokens', 'total_tokens',
  'cost_usd', 'error', 'answer',
];

function parseArgs(argv) {
  const positional = [];
  const opts = { tier: 'economy', system: 'general' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tier' || a === '--system') {
      opts[a.slice(2)] = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { input: positional[0], output: positional[1], ...opts };
}

function loadQuestions(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('questions file must be a JSON array');
  return raw
    .map((q, i) => (typeof q === 'string'
      ? { id: `q${i + 1}`, question: q }
      : { id: q && q.id ? String(q.id) : `q${i + 1}`, question: q && q.question }))
    .filter(q => typeof q.question === 'string' && q.question.trim());
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/compare-providers.cjs <questions.json> [out.csv] [--tier economy|mid|premium] [--system general|none]');
    process.exit(1);
  }
  if (!TIERS.includes(args.tier)) throw new Error(`--tier must be one of ${TIERS.join(', ')}`);
  if (!['general', 'none'].includes(args.system)) throw new Error('--system must be general or none');

  const questions = loadQuestions(args.input);
  const outFile = args.output || `compare-results-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  const system = args.system === 'general' ? GENERAL_ASSISTANT_SYSTEM_PROMPT : undefined;

  // Rows already carry the usage numbers; keep the console readable.
  llm.setUsageLogger(() => {});

  const rows = [];
  for (const q of questions) {
    for (const provider of PROVIDERS) {
      const row = { question_id: q.id, question: q.question, provider, tier: args.tier };
      const started = Date.now();
      try {
        const r = await llm.generate({
          provider,
          tier: args.tier,
          allowFallback: false,
          system,
          messages: [{ role: 'user', content: q.question }],
          purpose: 'compare_providers',
        });
        Object.assign(row, {
          model: r.model,
          response_model: r.responseModel ?? '',
          latency_ms: r.latencyMs,
          input_tokens: r.usage.inputTokens,
          cached_input_tokens: r.usage.cachedInputTokens ?? '',
          cache_write_tokens: r.usage.cacheWriteTokens ?? '',
          output_tokens: r.usage.outputTokens,
          thinking_tokens: r.usage.thinkingTokens ?? '',
          total_tokens: r.usage.totalTokens ?? '',
          cost_usd: r.costUsd == null ? '' : r.costUsd.toFixed(6),
          answer: r.text,
        });
        console.log(`[${q.id}] ${provider} ${r.model} ${r.latencyMs} ms in=${r.usage.inputTokens} out=${r.usage.outputTokens}`);
      } catch (err) {
        row.latency_ms = Date.now() - started;
        row.error = String(err && err.message ? err.message : err).slice(0, 300);
        console.log(`[${q.id}] ${provider} FAILED: ${row.error}`);
      }
      rows.push(row);
    }
  }

  const csv = [
    COLUMNS.join(','),
    ...rows.map(r => COLUMNS.map(c => csvCell(r[c])).join(',')),
  ].join('\r\n');
  // BOM so Excel opens accents (Spanish questions/answers) correctly.
  fs.writeFileSync(outFile, '\uFEFF' + csv + '\r\n', 'utf8');
  console.log(`\nWrote ${rows.length} rows to ${outFile}`);
}

main()
  // Explicit exit: the Vertex SDK leaves its request-timeout timer pending after each call.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('compare-providers failed:', err && err.message ? err.message : err);
    process.exit(1);
  });
