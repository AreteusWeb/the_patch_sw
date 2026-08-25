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
      {
        name: 'search_reference_video',
        description:
          'Search YouTube for an INSTRUCTIONAL exercise tutorial showing proper form ' +
          'or movement technique. Prefer coaching/demo clips — never entertainment or stunts.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Exact exercise name first in English (e.g. "kettlebell swing").',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_product_search_link',
        description:
          'Get a link to search for fitness equipment or gear on Amazon when the athlete ' +
          'wants to know where to buy something. This returns a search results link, not a ' +
          'specific product — never claim it\'s a specific recommended product, just a place to look.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Short product search phrase in English (e.g. "kettlebell 20lb").',
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
 * Local mock YouTube search — fixed example videoId.
 * @param {{ query?: string }} _args
 */
async function searchYouTubeExerciseVideo({ query: _query } = {}) {
  return {
    videoId: 'IODxDxX7oi4',
    title: 'Example: How To Do A Proper Push-Up (local mock)',
    channelTitle: 'Local Mock Channel',
  };
}

/**
 * Local reference video — same YouTube mock as cloud live path.
 * @param {{ query?: string }} args
 */
async function searchReferenceVideo(args = {}) {
  return searchYouTubeExerciseVideo(args);
}

/**
 * Deterministic Amazon search URL — NEVER a product /dp/ASIN link.
 * @param {{ query?: string }} args
 * @returns {{ url: string|null, retailer: string, searchQuery: string }}
 */
function getProductSearchLink({ query } = {}) {
  const searchQuery = String(typeof query === 'string' ? query : '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!searchQuery) {
    return { url: null, retailer: 'Amazon', searchQuery: '' };
  }

  const allowedHosts = new Set([
    'www.amazon.com',
    'www.amazon.com.mx',
    'www.amazon.ca',
    'www.amazon.co.uk',
  ]);
  const rawHost = String(process.env.AMAZON_SEARCH_HOST || 'www.amazon.com.mx')
    .trim()
    .toLowerCase();
  const host = allowedHosts.has(rawHost) ? rawHost : 'www.amazon.com.mx';

  const keywords = encodeURIComponent(searchQuery).replace(/%20/g, '+');
  const url = `https://${host}/s?k=${keywords}&ref=nb_sb_noss`;

  return {
    url,
    retailer: 'Amazon',
    searchQuery,
  };
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

  // Optionally exercise video search when the user asks for form/demo movement.
  const wantsVideo =
    /\b(video|form|technique|demo|demonstrate|swing|squat|movement)\b/i.test(
      String(userMessage || '')
    );
  if (wantsVideo && typeof toolHandlers?.search_reference_video === 'function') {
    const videoArgs = { query: 'kettlebell swing proper form' };
    let videoResult = { videoId: null };
    try {
      videoResult = await toolHandlers.search_reference_video(videoArgs);
    } catch (err) {
      videoResult = { error: err.message || 'tool_failed' };
    }
    toolCalls.push({
      name: 'search_reference_video',
      args: videoArgs,
      result: videoResult,
    });
  }

  const wantsBuy =
    /\b(buy|purchase|amazon|shop|where\s+to\s+(get|buy)|equip(ment)?|gear)\b/i.test(
      String(userMessage || '')
    );
  if (wantsBuy && typeof toolHandlers?.get_product_search_link === 'function') {
    const shopArgs = { query: 'kettlebell 20lb' };
    let shopResult = { url: null };
    try {
      shopResult = await toolHandlers.get_product_search_link(shopArgs);
    } catch (err) {
      shopResult = { error: err.message || 'tool_failed' };
    }
    toolCalls.push({
      name: 'get_product_search_link',
      args: shopArgs,
      result: shopResult,
    });
  }

  const sessionCount = Array.isArray(historyResult) ? historyResult.length : 0;
  const text =
    `[local coach mock] Got your message (${turns} prior turn(s)): "${preview || '(empty)'}". ` +
    `Looked up session history via tool (${sessionCount} closed session(s)). ` +
    (wantsVisual
      ? 'Attached a reference photo when a visual helps. '
      : '') +
    (wantsVideo
      ? 'Attached a reference video when form/movement helps. '
      : '') +
    (wantsBuy
      ? 'Attached an Amazon search link for gear. '
      : '') +
    `Keep training smart — hydrate, watch recovery score trends, and ease off if HR stays elevated at rest. ` +
    `This is performance coaching only, not medical advice.`;

  return { text, toolCalls, sources: [] };
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
  searchReferenceVideo,
  searchYouTubeExerciseVideo,
  getProductSearchLink,
};
