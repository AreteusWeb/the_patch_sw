'use strict';
/**
 * Gemini adapter (Vertex AI, same auth as the existing coach: ADC / service account, no API key).
 * Reuses providers/ai-provider.gcp.cjs so both paths stay in sync:
 *   - getVertexClientForModel: same project, location resolution (Gemini 3.x -> global|us|eu)
 *     and the explicit global endpoint the deprecated SDK needs.
 *   - COACH_GENERATION_CONFIG: thinkingLevel 'low', includeThoughts false, no temperature/topP
 *     (Gemini 3.x rejects them).
 *   - toGeminiContents: same role mapping, drops empty turns, always ends on a user turn.
 * Tools are NOT supported here yet: the health coach keeps using its existing tool loop.
 */
const {
  COACH_GENERATION_CONFIG,
  toGeminiContents,
  getVertexClientForModel,
} = require('../../providers/ai-provider.gcp.cjs');

function splitMessages(messages) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    throw new Error('Gemini requires the conversation to end with a user message');
  }
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    text: m.content == null ? '' : String(m.content),
  }));
  return { history, userMessage: String(last.content || '') };
}

/**
 * The Vertex SDK puts the HTTP status in places index.cjs#isRetryable doesn't look:
 * 4xx -> ClientError whose stackTrace (GoogleApiError) has the numeric `code`;
 * 5xx -> GoogleGenerativeAIError with only "got status: 503 ..." in the message.
 */
function withHttpStatus(err) {
  // requestOptions.timeout fired: same meaning as index.cjs's own timeout. The SDK
  // wraps fetch failures as GoogleGenerativeAIError('exception posting request…', original).
  const aborted = err && (err.name === 'AbortError' || (err.stackTrace && err.stackTrace.name === 'AbortError'));
  if (aborted && !err.code) {
    try { err.code = 'ETIMEDOUT'; } catch (_) { /* read-only */ }
  }
  if (err && typeof err === 'object' && typeof err.status !== 'number') {
    const nested = err.stackTrace && err.stackTrace.code;
    const fromMessage = /got status: (\d{3})/.exec(String(err.message || ''));
    const status = typeof nested === 'number' ? nested : fromMessage ? Number(fromMessage[1]) : null;
    if (status) {
      try { err.status = status; } catch (_) { /* read-only: leave as is */ }
    }
  }
  return err;
}

/**
 * Cancellation: @google-cloud/vertexai has no AbortSignal support, so `signal` can't
 * be wired. Its requestOptions.timeout DOES abort the underlying fetch, so we pass the
 * attempt's budget (same value index.cjs times out on). Limits: it can't be cancelled
 * early on demand, and the SDK never clears that timer (an idle timer of up to timeoutMs
 * stays pending after a fast reply; harmless in the server, delays exit of CLI scripts).
 */
async function generate({ model, system, messages, maxOutputTokens, timeoutMs }) {
  const { history, userMessage } = splitMessages(messages);
  const generativeModel = getVertexClientForModel(model).getGenerativeModel(
    {
      model,
      ...(system ? { systemInstruction: { role: 'system', parts: [{ text: system }] } } : {}),
      generationConfig: {
        ...COACH_GENERATION_CONFIG,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      },
    },
    timeoutMs ? { timeout: timeoutMs } : undefined
  );

  let res;
  try {
    res = await generativeModel.generateContent({ contents: toGeminiContents(history, userMessage) });
  } catch (err) {
    throw withHttpStatus(err);
  }

  const resp = res.response || {};
  const parts = resp.candidates?.[0]?.content?.parts || [];
  let text = '';
  for (const part of parts) {
    // Same filter as the coach: thought summaries must never reach the user.
    if (!part || part.thought === true) continue;
    if (typeof part.text === 'string') text += part.text;
  }

  const u = resp.usageMetadata || {};
  const thinkingTokens = u.thoughtsTokenCount || 0;
  return {
    text: text.trim(),
    usage: {
      // promptTokenCount already includes cachedContentTokenCount (implicit cache hits).
      inputTokens: u.promptTokenCount || 0,
      cachedInputTokens: u.cachedContentTokenCount || 0,
      // Thinking tokens are billed as output but are NOT included in candidatesTokenCount.
      outputTokens: (u.candidatesTokenCount || 0) + thinkingTokens,
      thinkingTokens,
      totalTokens: u.totalTokenCount ?? null,
    },
  };
}

module.exports = { generate, name: 'gemini' };
