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
      {
        name: 'search_reference_image',
        description:
          'Search for a reference photo to help illustrate a concept, object, ' +
          'or piece of equipment mentioned in the conversation (e.g. a kettlebell, ' +
          'a foam roller, a body part). Use this when a visual would help the ' +
          'athlete understand something you\'re describing.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Short search term in English (e.g. "kettlebell", "foam roller").',
            },
          },
          required: ['query'],
        },
      },
    ],
  }];
}

/**
 * Local mock Unsplash search — fixed placeholder + example photographer.
 * Still fires a non-blocking tracking ping when downloadTrackingUrl is set.
 *
 * @param {{ query?: string }} _args
 */
async function searchReferenceImage({ query: _query } = {}) {
  const payload = {
    imageUrl:
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1080&q=80',
    photographerName: 'Example Photographer',
    photographerProfileUrl: 'https://unsplash.com/@example',
    downloadTrackingUrl: null,
  };

  // Mirror cloud contract: fire-and-forget tracking when a URL is present.
  if (payload.downloadTrackingUrl) {
    fetch(payload.downloadTrackingUrl).catch((err) => {
      console.warn(
        '[ai-provider.local] Unsplash download tracking failed:',
        err?.message || err
      );
    });
  }

  return payload;
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

  // Optionally exercise image search when the user asks for a visual.
  const wantsVisual =
    /\b(show|image|photo|picture|visual|kettlebell|foam\s*roller|equipment)\b/i.test(
      String(userMessage || '')
    );
  if (wantsVisual && typeof toolHandlers?.search_reference_image === 'function') {
    const imageArgs = { query: 'kettlebell' };
    let imageResult = { imageUrl: null };
    try {
      imageResult = await toolHandlers.search_reference_image(imageArgs);
    } catch (err) {
      imageResult = { error: err.message || 'tool_failed' };
    }
    toolCalls.push({
      name: 'search_reference_image',
      args: imageArgs,
      result: imageResult,
    });
  }

  const sessionCount = Array.isArray(historyResult) ? historyResult.length : 0;
  const text =
    `[local coach mock] Got your message (${turns} prior turn(s)): "${preview || '(empty)'}". ` +
    `Looked up session history via tool (${sessionCount} closed session(s)). ` +
    (wantsVisual
      ? 'Attached a reference photo when a visual helps. '
      : '') +
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

module.exports = {
  generateCoachReply,
  generateSessionSummary,
  getCoachTools,
  searchReferenceImage,
};
