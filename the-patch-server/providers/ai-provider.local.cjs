/**
 * ai-provider.local.cjs — Mock coach replies (no Vertex AI / no API quota).
 *
 * Used when APP_MODE=local so UI and /api/coach/message can be developed
 * without GCP credentials — same idea as storage-provider.local for GCS.
 *
 * Simulates one function-calling round (get_session_history) so the full
 * coach → tool → reply path can be exercised locally.
 */

function getCoachTools() {
  return [{
    functionDeclarations: [
      { name: 'get_current_metrics', description: 'mock', parameters: { type: 'object', properties: {} } },
      { name: 'get_session_history', description: 'mock', parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
      { name: 'get_trend', description: 'mock', parameters: { type: 'object', properties: { metric: { type: 'string' }, days: { type: 'number' } }, required: ['metric'] } },
      { name: 'get_recent_alerts', description: 'mock', parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
    ],
  }];
}

/**
 * @param {{
 *   systemPrompt: string,
 *   history: Array<{role:string,text:string}>,
 *   userMessage: string,
 *   tools?: array,
 *   toolHandlers?: Record<string, (args: object) => Promise<any>>,
 * }} args
 * @returns {Promise<{ text: string, toolCalls: array }>}
 */
async function generateCoachReply({
  systemPrompt: _systemPrompt,
  history,
  userMessage,
  tools: _tools,
  toolHandlers,
}) {
  const turns = Array.isArray(history) ? history.length : 0;
  const preview = String(userMessage || '').trim().slice(0, 120);
  const toolCalls = [];

  // Simulate one tool round so local mode exercises the same contract as gcp.
  const historyArgs = { limit: 5 };
  let historyResult = [];
  if (typeof toolHandlers?.get_session_history === 'function') {
    try {
      historyResult = await toolHandlers.get_session_history(historyArgs);
    } catch (err) {
      historyResult = { error: err.message || 'tool_failed' };
    }
  }
  toolCalls.push({
    name: 'get_session_history',
    args: historyArgs,
    result: historyResult,
  });

  const sessionCount = Array.isArray(historyResult) ? historyResult.length : 0;
  const text =
    `[local coach mock] Got your message (${turns} prior turn(s)): "${preview || '(empty)'}". ` +
    `Looked up session history via tool (${sessionCount} closed session(s)). ` +
    `Keep training smart — hydrate, watch recovery score trends, and ease off if HR stays elevated at rest. ` +
    `This is performance coaching only, not medical advice.`;

  return { text, toolCalls };
}

/**
 * Mock session summary for local mode (no Vertex quota).
 * @param {{ messages: Array<{ role?: string, text?: string }>, uid?: string, sessionId?: string }} _args
 * @returns {Promise<string>}
 */
async function generateSessionSummary({ messages: _messages }) {
  return '[local mock summary] Discussed recovery and training topics.';
}

module.exports = { generateCoachReply, generateSessionSummary, getCoachTools };
