'use strict';
// Real call to both providers: node llm/smoke.cjs   (needs env: GOOGLE_CLOUD_PROJECT creds, OPENAI_API_KEY, OPENAI_MODEL_*)
require('dotenv').config?.();
const llm = require('./index.cjs');
const q = process.argv.slice(2).join(' ') || 'In one sentence, what is HRV?';
(async () => {
  for (const provider of ['gemini', 'openai']) {
    try {
      const r = await llm.generate({ provider, tier: 'economy', allowFallback: false, messages: [{ role: 'user', content: q }] });
      console.log(`\n[${provider}] ${r.model} | ${r.latencyMs} ms | in ${r.usage.inputTokens} out ${r.usage.outputTokens} | cost ${r.costUsd}\n${r.text}`);
    } catch (e) { console.log(`\n[${provider}] FAILED:`, e.message); }
  }
})();
