/**
 * ai-provider.gcp.cjs — Gemini via Vertex AI (@google-cloud/vertexai).
 * Only loaded when APP_MODE=cloud.
 *
 * Env:
 *   GOOGLE_CLOUD_PROJECT   (required — already used by auth-provider)
 *   VERTEX_AI_LOCATION     (optional, default us-central1)
 *   VERTEX_AI_MODEL        (optional, default gemini-3.6-flash)
 *
 * Function calling: tool *declarations* live here; tool *execution* is
 * injected via `toolHandlers` from server.cjs (db-provider functions),
 * so this file never requires db-provider directly.
 */

const { VertexAI } = require('@google-cloud/vertexai');

const project =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT;

if (!project) {
  throw new Error(
    '[ai-provider.gcp] Missing environment variable GOOGLE_CLOUD_PROJECT. ' +
    'Set it in your .env (see .env.example) or use APP_MODE=local to run without Vertex AI.'
  );
}

const modelName = process.env.VERTEX_AI_MODEL || 'gemini-3.6-flash';
/**
 * Gemini 3.x publisher models are served on `global` / multi-region `us`|`eu`,
 * not single regions like us-central1 (404 NOT_FOUND if pinned regionally).
 */
function resolveVertexLocation(model, configured) {
  const loc = (configured || 'global').trim().toLowerCase() || 'global';
  const isGemini3 = /^gemini-3(\.|-)/i.test(String(model || ''));
  const isMultiOrGlobal = loc === 'global' || loc === 'us' || loc === 'eu';
  if (isGemini3 && !isMultiOrGlobal) {
    console.warn(
      `[ai-provider.gcp] ${model} is not available in "${loc}"; using "global" ` +
        '(set VERTEX_AI_LOCATION=global|us|eu).'
    );
    return 'global';
  }
  return loc;
}
const location = resolveVertexLocation(
  modelName,
  process.env.VERTEX_AI_LOCATION
);
const MAX_TOOL_ROUNDS = 5;

/**
 * Gemini 3 thinking depth for coach replies.
 * 'low' = faster conversational answers; bump to 'medium'|'high' if quality drops.
 * Allowed: 'low' | 'medium' | 'high'
 */
const COACH_THINKING_LEVEL = 'low';

/**
 * Gemini 3.x rejects temperature / topP / topK / candidateCount when set.
 * Prefer thinkingLevel over the legacy thinkingBudget.
 * includeThoughts:false asks the API not to return thought summaries; we still
 * filter part.thought client-side because Vertex may return them anyway.
 */
const COACH_GENERATION_CONFIG = {
  thinkingConfig: {
    thinkingLevel: COACH_THINKING_LEVEL,
    includeThoughts: false,
  },
};

// Deprecated VertexAI SDK builds `${location}-aiplatform.googleapis.com`.
// For location=global the host is `aiplatform.googleapis.com` (no prefix).
const apiEndpoint =
  location === 'global' ? 'aiplatform.googleapis.com' : undefined;

const vertexAI = new VertexAI({ project, location, apiEndpoint });

/** Vertex AI functionDeclarations for the AI Coach. */
const COACH_FUNCTION_DECLARATIONS = [
  {
    name: 'get_current_metrics',
    description:
      'Get the athlete\'s latest computed vitals/metrics snapshot ' +
      '(heartRate, spo2, respirationRate, temperature, hrvProxyMs, recoveryScore, hasRealData). ' +
      'Use when you need current performance numbers. Never returns raw ECG/waveforms.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_session_history',
    description:
      'List recent closed coaching sessions with startedAt, closedAt, and summary. ' +
      'Use for continuity across past chats.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max sessions to return (default 5).',
        },
      },
    },
  },
  {
    name: 'get_trend',
    description:
      'Get a simple trend for one metric across the last N days from stored metrics snapshots. ' +
      'Returns values[], sampleCount, average (null if no data), and direction. ' +
      'If sampleCount < 2, do not invent a weekly story — say history is insufficient.',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          description: 'One of: heartRate, hrvProxyMs, recoveryScore, spo2.',
          enum: ['heartRate', 'hrvProxyMs', 'recoveryScore', 'spo2'],
        },
        days: {
          type: 'number',
          description: 'Lookback window in days (default 7).',
        },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_recent_alerts',
    description:
      'Get recent clinical events/alerts for this athlete (type, label, severity, timestamp, vitals).',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max alerts to return (default 10).',
        },
      },
    },
  },
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
      'or movement technique (e.g. kettlebell swing proper form, squat technique). ' +
      'Prefer coaching/demo clips — never entertainment, tricks, juggling, freestyle, ' +
      'or viral stunt videos. Use when the athlete needs to see correct movement in motion.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Exact exercise name first in English (e.g. "kettlebell swing" or ' +
            '"kettlebell swing proper form"). Keep it short and specific to the ' +
            'movement — do not use vague queries like only "kettlebell".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_search_link',
    description:
      'Fallback only: get a generic Amazon search-results link for fitness gear when ' +
      'web search (Google Search grounding) did not return useful specific sources. ' +
      'Prefer grounding first for product recommendations. This returns a search results ' +
      'link, not a specific product — never claim it\'s a specific recommended product.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Short product search phrase in English (e.g. "kettlebell 20lb", "foam roller").',
        },
      },
      required: ['query'],
    },
  },
];

function getCoachTools() {
  // Native Google Search grounding alongside function-calling tools.
  const groundingTool = { googleSearch: {} };
  return [
    groundingTool,
    { functionDeclarations: COACH_FUNCTION_DECLARATIONS },
  ];
}

/**
 * Unsplash photo search (hotlink URLs only — never download/rehost).
 * Triggers Unsplash download tracking as fire-and-forget after building the payload.
 *
 * @param {{ query?: string }} args
 * @returns {Promise<{
 *   imageUrl: string|null,
 *   photographerName?: string,
 *   photographerProfileUrl?: string,
 *   downloadTrackingUrl?: string|null,
 * }>}
 */
async function searchReferenceImage({ query } = {}) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    console.warn('[ai-provider.gcp] UNSPLASH_ACCESS_KEY is not set');
    return { imageUrl: null };
  }

  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return { imageUrl: null };

  let photo;
  try {
    const url =
      'https://api.unsplash.com/search/photos' +
      `?query=${encodeURIComponent(q)}&per_page=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
    if (!res.ok) {
      console.warn(
        `[ai-provider.gcp] Unsplash search failed: HTTP ${res.status}`
      );
      return { imageUrl: null };
    }
    const data = await res.json();
    photo = Array.isArray(data?.results) ? data.results[0] : null;
  } catch (err) {
    console.warn(
      '[ai-provider.gcp] Unsplash search error:',
      err?.message || err
    );
    return { imageUrl: null };
  }

  if (!photo?.urls?.regular) {
    return { imageUrl: null };
  }

  const payload = {
    imageUrl: photo.urls.regular,
    photographerName: photo.user?.name || 'Unknown',
    photographerProfileUrl:
      photo.user?.links?.html || 'https://unsplash.com',
    downloadTrackingUrl: photo.links?.download_location || null,
  };

  // Unsplash guideline: ping download_location when a photo is used (non-blocking).
  if (payload.downloadTrackingUrl) {
    fetch(payload.downloadTrackingUrl, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    })
      .then((res) => {
        if (res.ok) {
          console.log('[unsplash] download tracked ok');
        } else {
          console.error('[unsplash] download tracking failed:', res.status);
        }
      })
      .catch((err) => {
        console.error('[unsplash] download tracking failed:', err?.message || err);
      });
  }

  return payload;
}

/**
 * Light cleanup before video search (keep exercise name intact).
 * @param {string} raw
 * @returns {string}
 */
function normalizeVideoSearchQuery(raw) {
  return String(raw || '')
    .trim()
    .replace(/\b(trick|tricks|freestyle|juggling|juggle|stunt|viral|funny|fail)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * YouTube Data API search for exercise tutorials.
 * @param {{ query?: string }} args
 * @returns {Promise<{ videoId: string|null, title?: string, channelTitle?: string }>}
 */
async function searchYouTubeExerciseVideo({ query } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[ai-provider.gcp] YOUTUBE_API_KEY is not set');
    return { videoId: null };
  }

  const base = normalizeVideoSearchQuery(
    typeof query === 'string' ? query : ''
  );
  if (!base) return { videoId: null };

  const q = `${base} exercise tutorial proper form`;
  try {
    const url =
      'https://www.googleapis.com/youtube/v3/search' +
      `?part=snippet&type=video&maxResults=3` +
      `&q=${encodeURIComponent(q)}` +
      `&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[ai-provider.gcp] YouTube search failed: HTTP ${res.status}`
      );
      return { videoId: null };
    }
    const data = await res.json();
    const item = Array.isArray(data?.items) ? data.items[0] : null;
    const videoId =
      item && typeof item.id?.videoId === 'string' ? item.id.videoId : null;
    if (!videoId) return { videoId: null };

    return {
      videoId,
      title:
        typeof item.snippet?.title === 'string'
          ? item.snippet.title
          : 'YouTube video',
      channelTitle:
        typeof item.snippet?.channelTitle === 'string'
          ? item.snippet.channelTitle
          : 'YouTube',
    };
  } catch (err) {
    console.warn(
      '[ai-provider.gcp] YouTube search error:',
      err?.message || err
    );
    return { videoId: null };
  }
}

/**
 * Exercise video lookup via YouTube Data API.
 * @param {{ query?: string }} args
 * @returns {Promise<{ videoId: string|null, title?: string, channelTitle?: string }>}
 */
async function searchReferenceVideo({ query } = {}) {
  return searchYouTubeExerciseVideo({ query });
}

/**
 * Deterministic Amazon search URL — NEVER a product /dp/ASIN link.
 * Bare `?k=` alone is flaky in some regions; include ref + normalized keywords.
 * Optional AMAZON_SEARCH_HOST (allowlisted), e.g. www.amazon.com.mx for Mexico.
 *
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

  // Amazon prefers + for spaces in search keywords (not raw spaces).
  const keywords = encodeURIComponent(searchQuery).replace(/%20/g, '+');
  const url = `https://${host}/s?k=${keywords}&ref=nb_sb_noss`;

  return {
    url,
    retailer: 'Amazon',
    searchQuery,
  };
}

/**
 * Structured usage log for Cloud Run cost visibility (does not block).
 * Token counts come from Vertex usageMetadata — never invented.
 */
function logGeminiUsage({
  kind,
  uid,
  sessionId,
  usageMetadata,
  toolCallRounds,
  toolRoundLimitHit,
  groundingSearchCount,
}) {
  console.log(JSON.stringify({
    event: 'gemini_usage',
    timestamp: new Date().toISOString(),
    kind,
    uid: uid ?? null,
    sessionId: sessionId ?? null,
    promptTokens: usageMetadata?.promptTokenCount ?? null,
    responseTokens: usageMetadata?.candidatesTokenCount ?? null,
    totalTokens: usageMetadata?.totalTokenCount ?? null,
    toolCallRounds: toolCallRounds ?? 0,
    toolRoundLimitHit: Boolean(toolRoundLimitHit),
    groundingSearchCount: groundingSearchCount ?? 0,
  }));
}

/**
 * Gemini 3.x rejects contents that end on a 'model' turn without a following
 * 'user' message. toGeminiContents always appends the new user turn; the
 * tool loop always appends function responses as 'user' before the next call.
 */
function assertContentsEndWithUser(contents, context) {
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new Error(
      `[ai-provider.gcp] Gemini contents empty before generateContent (${context})`
    );
  }
  const last = contents[contents.length - 1];
  if (!last || last.role !== 'user') {
    throw new Error(
      `[ai-provider.gcp] Gemini 3.x rejects history ending in role ` +
        `"${last?.role ?? 'undefined'}" without a following user turn (${context})`
    );
  }
}

/**
 * Map coach history roles onto Gemini content roles.
 * Always ends with the new user message (never leaves a trailing model turn).
 */
function toGeminiContents(history, userMessage) {
  const contents = [];

  for (const msg of history || []) {
    if (!msg || !msg.text) continue;
    const role = msg.role === 'model' ? 'model' : 'user';
    contents.push({
      role,
      parts: [{ text: String(msg.text) }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: String(userMessage || '') }],
  });

  assertContentsEndWithUser(contents, 'toGeminiContents');
  return contents;
}

/**
 * Pull citation sources from Google Search groundingMetadata.
 * Dedupes by real site domain (titles like "walmart.com") because grounding
 * redirect URIs are unique even when they point at the same publisher.
 * @returns {{ sources: Array<{ title: string, url: string }>, groundingSearchCount: number }}
 */
function extractGroundingFromCandidate(candidate) {
  const meta = candidate?.groundingMetadata;
  if (!meta || typeof meta !== 'object') {
    return { sources: [], groundingSearchCount: 0 };
  }

  const queries = Array.isArray(meta.webSearchQueries)
    ? meta.webSearchQueries
    : [];
  const groundingSearchCount = queries.length;

  const sources = [];
  const seenKeys = new Set();

  const dedupeKey = (title, url) => {
    const t = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      // Vertex grounding redirects — prefer publisher title/domain for uniqueness.
      if (
        host.includes('vertexaisearch') ||
        host.includes('grounding-api-redirect')
      ) {
        return t || url;
      }
      return host || t || url;
    } catch {
      return t || url;
    }
  };

  for (const chunk of meta.groundingChunks || []) {
    const web = chunk?.web;
    const url = typeof web?.uri === 'string' ? web.uri.trim() : '';
    if (!url) continue;
    const title =
      typeof web?.title === 'string' && web.title.trim()
        ? web.title.trim()
        : url;
    const key = dedupeKey(title, url);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    sources.push({ title, url });
  }

  return { sources, groundingSearchCount };
}

/**
 * Extract user-facing text + function calls.
 * Skip parts marked thought=true (Gemini 3 internal reasoning / summaries) —
 * those must never be shown to the athlete.
 */
function extractTextAndCalls(parts) {
  let text = '';
  const functionCalls = [];
  for (const part of parts || []) {
    if (!part || typeof part !== 'object') continue;
    // Thought summaries / scratchpad — not for the UI.
    if (part.thought === true) continue;
    if (typeof part.text === 'string' && part.text) {
      text += part.text;
    }
    if (part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args || {},
      });
    }
  }
  return { text: text.trim(), functionCalls };
}

async function runToolHandler(name, args, toolHandlers) {
  const handler = toolHandlers && toolHandlers[name];
  if (typeof handler !== 'function') {
    return { error: `unknown_or_unwired_tool:${name}` };
  }
  try {
    return await handler(args || {});
  } catch (err) {
    console.warn(`[ai-provider.gcp] tool ${name} failed:`, err.message);
    return { error: err.message || 'tool_failed' };
  }
}

/**
 * Generate a coach reply with Gemini, running a function-calling loop when
 * the model requests tools. Google Search grounding runs as a native tool
 * alongside function declarations.
 *
 * @param {{
 *   systemPrompt: string,
 *   history: Array<{role:string,text:string}>,
 *   userMessage: string,
 *   tools?: array,
 *   toolHandlers?: Record<string, (args: object) => Promise<any>>,
 *   uid?: string,
 *   sessionId?: string,
 * }} args
 * @returns {Promise<{ text: string, toolCalls: array, sources: Array<{ title: string, url: string }> }>}
 */
async function generateCoachReply({
  systemPrompt,
  history,
  userMessage,
  tools,
  toolHandlers,
  uid,
  sessionId,
}) {
  const modelTools =
    Array.isArray(tools) && tools.length > 0 ? tools : getCoachTools();

  const generativeModel = vertexAI.getGenerativeModel({
    model: modelName,
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemPrompt || '' }],
    },
    // Gemini 3.x: thinkingLevel only — no temperature/topP/topK/candidateCount.
    generationConfig: COACH_GENERATION_CONFIG,
    tools: modelTools,
  });

  const contents = toGeminiContents(history, userMessage);
  /** @type {Array<{ name: string, args: object, result?: any }>} */
  const executedToolCalls = [];
  let toolCallRounds = 0;
  /** @type {Array<{ title: string, url: string }>} */
  let latestSources = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    assertContentsEndWithUser(contents, `coach_reply_round_${round}`);
    const result = await generativeModel.generateContent({ contents });
    const response = result?.response;
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const { text, functionCalls } = extractTextAndCalls(parts);
    const { sources, groundingSearchCount } =
      extractGroundingFromCandidate(candidate);
    if (sources.length > 0) {
      latestSources = sources;
    }

    logGeminiUsage({
      kind: 'coach_reply',
      uid,
      sessionId,
      usageMetadata: response?.usageMetadata,
      toolCallRounds,
      toolRoundLimitHit: false,
      groundingSearchCount,
    });

    if (functionCalls.length === 0) {
      return {
        text: text || 'I could not generate a coaching tip right now. Try again in a moment.',
        toolCalls: executedToolCalls,
        sources: latestSources,
      };
    }

    toolCallRounds += 1;

    // Append the model's function-call turn, then our function responses.
    contents.push({ role: 'model', parts });

    const responseParts = [];
    for (const call of functionCalls) {
      const toolResult = await runToolHandler(call.name, call.args, toolHandlers);
      executedToolCalls.push({
        name: call.name,
        args: call.args || {},
        result: toolResult,
      });
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: { content: toolResult },
        },
      });
    }

    // Must end on 'user' before the next generateContent (Gemini 3.x).
    contents.push({ role: 'user', parts: responseParts });
  }

  console.log(JSON.stringify({
    event: 'gemini_tool_round_limit',
    timestamp: new Date().toISOString(),
    kind: 'coach_reply',
    uid: uid ?? null,
    sessionId: sessionId ?? null,
    toolCallRounds,
    maxToolRounds: MAX_TOOL_ROUNDS,
    message: 'Reached MAX_TOOL_ROUNDS without a final text reply — prompt/tools may need tuning',
  }));

  logGeminiUsage({
    kind: 'coach_reply',
    uid,
    sessionId,
    usageMetadata: null,
    toolCallRounds,
    toolRoundLimitHit: true,
    groundingSearchCount: 0,
  });

  return {
    text: 'I hit a tool-call limit while gathering data. Please ask again with a shorter question.',
    toolCalls: executedToolCalls,
    sources: latestSources,
  };
}

const SESSION_SUMMARY_INSTRUCTION =
  'Summarize this coaching conversation in 2-4 sentences, focused on ' +
  'what would help a coach remember context for future sessions ' +
  '(goals mentioned, recurring concerns, relevant metric trends discussed). ' +
  'Do not invent details that are not in the conversation. ' +
  'Performance coaching context only — no medical diagnoses.';

/**
 * Short session summary for future coaching context (no tools).
 * @param {{ messages: Array<{ role?: string, text?: string }>, uid?: string, sessionId?: string }} args
 * @returns {Promise<string>}
 */
async function generateSessionSummary({ messages, uid, sessionId }) {
  const lines = (messages || [])
    .filter(m => m && m.text)
    .map(m => `${m.role === 'model' ? 'Coach' : 'Athlete'}: ${String(m.text).trim()}`)
    .join('\n');

  if (!lines) {
    return 'Short session with little conversation content recorded.';
  }

  const generativeModel = vertexAI.getGenerativeModel({
    model: modelName,
    systemInstruction: {
      role: 'system',
      parts: [{ text: SESSION_SUMMARY_INSTRUCTION }],
    },
    generationConfig: COACH_GENERATION_CONFIG,
  });

  const summaryContents = [
    {
      role: 'user',
      parts: [{ text: `Conversation:\n${lines}` }],
    },
  ];
  assertContentsEndWithUser(summaryContents, 'session_summary');

  const result = await generativeModel.generateContent({
    contents: summaryContents,
  });

  const response = result?.response;
  logGeminiUsage({
    kind: 'session_summary',
    uid,
    sessionId,
    usageMetadata: response?.usageMetadata,
    toolCallRounds: 0,
    toolRoundLimitHit: false,
    groundingSearchCount: 0,
  });

  const parts = response?.candidates?.[0]?.content?.parts || [];
  let text = '';
  for (const part of parts) {
    if (!part || part.thought === true) continue;
    if (part.text) text += part.text;
  }

  text = text.trim();
  return text || 'Coaching session completed; no detailed topics captured.';
}

module.exports = {
  generateCoachReply,
  generateSessionSummary,
  getCoachTools,
  searchReferenceImage,
  searchReferenceVideo,
  searchYouTubeExerciseVideo,
  getProductSearchLink,
  COACH_FUNCTION_DECLARATIONS,
  MAX_TOOL_ROUNDS,
};
