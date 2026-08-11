/**
 * ai-provider.gcp.cjs — Gemini via Vertex AI (@google-cloud/vertexai).
 * Only loaded when APP_MODE=cloud.
 *
 * Env:
 *   GOOGLE_CLOUD_PROJECT   (required — already used by auth-provider)
 *   VERTEX_AI_LOCATION     (optional, default us-central1)
 *   VERTEX_AI_MODEL        (optional, default gemini-2.0-flash-001)
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

const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
const modelName = process.env.VERTEX_AI_MODEL || 'gemini-2.0-flash-001';
const MAX_TOOL_ROUNDS = 5;

const vertexAI = new VertexAI({ project, location });

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
      'Get a simple trend for one metric across the last N days from stored metrics snapshots.',
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
];

function getCoachTools() {
  return [{ functionDeclarations: COACH_FUNCTION_DECLARATIONS }];
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
  }));
}

/**
 * Map coach history roles onto Gemini content roles.
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

  return contents;
}

function extractTextAndCalls(parts) {
  let text = '';
  const functionCalls = [];
  for (const part of parts || []) {
    if (part.text) text += part.text;
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
 * the model requests tools.
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
 * @returns {Promise<{ text: string, toolCalls: array }>}
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
    tools: modelTools,
  });

  const contents = toGeminiContents(history, userMessage);
  /** @type {Array<{ name: string, args: object, result?: any }>} */
  const executedToolCalls = [];
  let toolCallRounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await generativeModel.generateContent({ contents });
    const response = result?.response;
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const { text, functionCalls } = extractTextAndCalls(parts);

    logGeminiUsage({
      kind: 'coach_reply',
      uid,
      sessionId,
      usageMetadata: response?.usageMetadata,
      toolCallRounds,
      toolRoundLimitHit: false,
    });

    if (functionCalls.length === 0) {
      return {
        text: text || 'I could not generate a coaching tip right now. Try again in a moment.',
        toolCalls: executedToolCalls,
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
  });

  return {
    text: 'I hit a tool-call limit while gathering data. Please ask again with a shorter question.',
    toolCalls: executedToolCalls,
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
  });

  const result = await generativeModel.generateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: `Conversation:\n${lines}` }],
      },
    ],
  });

  const response = result?.response;
  logGeminiUsage({
    kind: 'session_summary',
    uid,
    sessionId,
    usageMetadata: response?.usageMetadata,
    toolCallRounds: 0,
    toolRoundLimitHit: false,
  });

  const parts = response?.candidates?.[0]?.content?.parts || [];
  let text = '';
  for (const part of parts) {
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
  COACH_FUNCTION_DECLARATIONS,
  MAX_TOOL_ROUNDS,
};
