import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../config.js';
import { buildKnowledgePrompt, getActiveKnowledge } from './knowledge.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    signal: {
      type: SchemaType.STRING,
      enum: ['BUY', 'SELL', 'NO_TRADE'],
      description: 'Trading signal for the next candle.',
    },
    confidence: {
      type: SchemaType.INTEGER,
      description: 'Confidence in the signal, 0-100.',
    },
    entry_time: {
      type: SchemaType.STRING,
      description:
        'Exactly "Next Candle" for an immediate entry, otherwise a specific local time in 24h HH:MM format such as "14:35".',
    },
    asset: {
      type: SchemaType.STRING,
      description: 'Instrument visible in the screenshot, e.g. "EUR/USD". Use "unknown" if it is not readable.',
    },
    timeframe: {
      type: SchemaType.STRING,
      description: 'Detected chart timeframe, e.g. "1M", "5M", "15M". Use "unknown" if it is not readable.',
    },
    reason: {
      type: SchemaType.STRING,
      description: 'One short, clear technical reason for the decision.',
    },
    voice_summary: {
      type: SchemaType.STRING,
      description:
        'One natural spoken sentence for text-to-speech, e.g. "Buy signal detected with 85 percent confidence."',
    },
  },
  required: [
    'signal',
    'confidence',
    'entry_time',
    'asset',
    'timeframe',
    'reason',
    'voice_summary',
  ],
};

const BASE_SYSTEM_INSTRUCTION = `You are an expert intraday price-action trading assistant embedded in a floating Android overlay.
You receive a screenshot of a live candlestick chart and must decide the next actionable signal.

ABSOLUTE OUTPUT RULES
1. Never ask questions, never request clarification, never apologise.
2. Never reply with prose. Output only the JSON object described by the response schema.
3. signal must be exactly one of BUY, SELL or NO_TRADE.
4. If the chart is unclear, the timeframe is unreadable, or the knowledge base rules are not met, return NO_TRADE with a low confidence.
5. confidence must be a plain integer between 0 and 100.
6. entry_time is exactly "Next Candle" when the entry is immediate, otherwise a specific local time in 24h HH:MM format (for example "14:35").
7. asset is the instrument printed on the chart (for example "EUR/USD"), or "unknown" when it cannot be read.
8. timeframe is the chart interval shown (for example "1M", "5M", "15M"), or "unknown" when it cannot be read.
9. reason is one short technical line (max ~140 characters) naming the setup or the blocking condition.
10. voice_summary is one natural sentence suitable for text-to-speech, naming the signal and the confidence percentage (for example "Buy signal detected with 85 percent confidence.").
11. Emit every field every time, in the exact order defined by the schema. Never omit a field and never add extra fields.

DECISION PROCESS
- Read the visible candles, wicks, trend, support/resistance, volume if shown, and the detected timeframe.
- Apply the global trading knowledge base below first. Where it is silent, use standard price-action and candlestick logic.
- Do not invent indicators that are not visible in the screenshot.
- Treat the supplied local time and timezone as the trader's clock for any timed entry.`;

const SIGNAL_LABELS = { BUY: 'Buy', SELL: 'Sell', NO_TRADE: 'No-trade' };
const CLOCK_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

function compact(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeEntryTime(value) {
  const raw = compact(value, 32);
  if (/^next\s*candle$/i.test(raw)) return 'Next Candle';
  const clock = CLOCK_PATTERN.exec(raw);
  if (clock) return `${clock[1].padStart(2, '0')}:${clock[2]}`;
  return 'Next Candle';
}

function validateAnalysis(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Model returned no JSON object');

  const signal = String(raw.signal || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!['BUY', 'SELL', 'NO_TRADE'].includes(signal)) {
    throw new Error(`Model returned an invalid signal: ${raw.signal}`);
  }

  const confidenceRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 0;

  const entryTime = normalizeEntryTime(raw.entry_time ?? raw.entry_timing);
  const asset = compact(raw.asset, 32) || 'unknown';
  const timeframe = compact(raw.timeframe ?? raw.timeframe_detected, 16) || 'unknown';
  const reason = compact(raw.reason, 240) || 'No clear setup detected.';
  const voiceSummary =
    compact(raw.voice_summary, 240) ||
    `${SIGNAL_LABELS[signal]} signal detected with ${confidence} percent confidence.`;

  return {
    signal,
    confidence,
    entry_time: entryTime,
    asset,
    timeframe,
    reason,
    voice_summary: voiceSummary,
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Gemini request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function analysisError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Known-good vision models, used in this order after the configured model and
 * as the offline fallback when the model list cannot be fetched.
 */
const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-pro',
  'gemini-pro-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

const MODEL_LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_CACHE_MS = 10 * 60 * 1000;
const MODEL_LIST_TIMEOUT_MS = 8000;
/** Image generation, speech, embedding and agent-only models cannot return our JSON signal. */
const NON_ANALYSIS_MODEL =
  /(?:^|[-_])(?:image|tts|transcribe|lyria|embedding|nano-banana|robotics|computer-use|deep-research|antigravity|omni)(?:[-_]|$)/i;

let modelCache = { at: 0, models: [] };
/** Models that recently failed, so the next scan does not pay for them again. */
const modelCooldown = new Map();
const COOLDOWN_MISSING_MS = 10 * 60 * 1000;
const COOLDOWN_TRANSIENT_MS = 60 * 1000;
let lastGoodModel = null;

function isCoolingDown(name) {
  const until = modelCooldown.get(name);
  if (!until) return false;
  if (until > Date.now()) return true;
  modelCooldown.delete(name);
  return false;
}

function quarantineModel(name, error, haystack) {
  const missing = Number(error?.status) === 404 || /404|not found|not supported|unsupported|does not exist/.test(haystack);
  modelCooldown.set(name, Date.now() + (missing ? COOLDOWN_MISSING_MS : COOLDOWN_TRANSIENT_MS));
}

function isAnalysisModel(name) {
  return typeof name === 'string' && /^gemini-/i.test(name) && !NON_ANALYSIS_MODEL.test(name);
}

/** Newer, stable, lower-cost models first; Pro models last because they are slower. */
function modelScore(name) {
  const n = name.toLowerCase();
  const version = /gemini-(\d+)(?:\.(\d+))?/.exec(n);
  const versionScore = version ? Number(version[1]) * 10 + Number(version[2] || 0) : 0;
  const experimental = /preview|exp\b|experimental|customtools|thinking/.test(n) ? 0 : 1;
  const tier = /pro/.test(n) ? 3 : /lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2;
  return { experimental, versionScore, tier };
}

function compareModels(a, b) {
  const sa = modelScore(a);
  const sb = modelScore(b);
  if (sa.experimental !== sb.experimental) return sb.experimental - sa.experimental;
  if (sa.versionScore !== sb.versionScore) return sb.versionScore - sa.versionScore;
  if (sa.tier !== sb.tier) return sa.tier - sb.tier;
  return a.localeCompare(b);
}

/**
 * Asks the Gemini API which models this key can actually call and caches the
 * answer. A network or key problem here is not fatal: the caller falls back to
 * the preferred list and the analysis request reports the real error.
 */
async function discoverModels() {
  if (modelCache.models.length && Date.now() - modelCache.at < MODEL_CACHE_MS) {
    return modelCache.models;
  }

  try {
    const response = await fetch(`${MODEL_LIST_URL}?pageSize=1000`, {
      headers: { 'x-goog-api-key': config.gemini.apiKey },
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`model list returned HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload?.models ?? [])
      .filter((model) => (model?.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((model) => String(model.name || '').replace(/^models\//, ''))
      .filter(isAnalysisModel);

    if (!models.length) throw new Error('model list was empty');
    modelCache = { at: Date.now(), models: models.sort(compareModels) };
    console.log(`[gemini] ${models.length} analysis models available`);
    return modelCache.models;
  } catch (error) {
    console.warn(`[gemini] could not list models: ${error?.message || error}`);
    return modelCache.models;
  }
}

/**
 * Builds the failover chain: the configured model first, then every preferred
 * model, then the rest of the models discovered for this key. This is what
 * makes a configured Lite, Flash or Pro model work even when another model is
 * retired, overloaded or out of quota.
 */
async function buildModelChain() {
  const discovered = await discoverModels();
  const chain = [
    config.gemini.model,
    lastGoodModel,
    ...PREFERRED_MODELS,
    ...discovered,
  ]
    .map((name) => String(name || '').trim())
    .filter(Boolean);

  const unique = [...new Set(chain)];
  // Skip models that just failed; if they all failed, retry them rather than
  // returning no model at all.
  const healthy = unique.filter((name) => !isCoolingDown(name));
  return (healthy.length ? healthy : unique).slice(0, config.gemini.maxModelAttempts);
}

/**
 * Turns an SDK error into an actionable API error. Only a key or project
 * permission failure stops the chain; every other failure (retired model,
 * overload, quota, timeout, malformed JSON) moves on to the next model.
 */
function describeGeminiError(error) {
  if (error?.status && error?.code) return { error, retryModel: error.code !== 'GEMINI_KEY_INVALID' };

  const message = String(error?.message || error || 'Unknown Gemini error');
  const details = JSON.stringify(error?.errorDetails ?? error?.response?.data ?? '');
  const haystack = `${message} ${details}`.toLowerCase();

  if (haystack.includes('api key not valid') || haystack.includes('api_key_invalid')) {
    return {
      error: analysisError(
        'The Gemini API key is invalid. Update GEMINI_API_KEY on the server.',
        502,
        'GEMINI_KEY_INVALID',
      ),
      retryModel: false,
    };
  }
  if (
    haystack.includes('permission_denied') ||
    haystack.includes('permission denied') ||
    haystack.includes('api has not been used')
  ) {
    return {
      error: analysisError(
        'Gemini rejected the API key for this project. Check the key and that the Generative Language API is enabled.',
        502,
        'GEMINI_PERMISSION_DENIED',
      ),
      retryModel: false,
    };
  }
  if (
    haystack.includes('429') ||
    haystack.includes('quota') ||
    haystack.includes('resource_exhausted') ||
    haystack.includes('rate limit')
  ) {
    return {
      error: analysisError(
        'Gemini API quota or rate limit reached. Wait a moment or raise the quota, then try again.',
        503,
        'GEMINI_QUOTA_EXCEEDED',
      ),
      retryModel: true,
    };
  }
  if (haystack.includes('safety') || haystack.includes('blocked')) {
    return {
      error: analysisError(
        'Gemini blocked this screenshot (safety filter). Capture the chart again without private content.',
        422,
        'GEMINI_BLOCKED',
      ),
      retryModel: true,
    };
  }

  return { error, retryModel: true };
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Defensive parse: strip fences if the model still wrapped the JSON.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model returned a non-JSON response');
    return JSON.parse(match[0]);
  }
}

/**
 * Runs the vision analysis against the active knowledge base and returns the
 * strictly validated structured signal. Models are tried in order (configured
 * model first, then every other available Gemini model) until one answers, so
 * a retired, overloaded, rate-limited or schema-incompatible model never takes
 * the endpoint down.
 */
export async function analyzeChart({ imageBase64, mimeType, currentTime, timezone }) {
  const activeEntries = await getActiveKnowledge();
  const knowledgeBlock = buildKnowledgePrompt(activeEntries);

  const models = await buildModelChain();
  const deadline = Date.now() + config.gemini.timeoutMs;
  const attempted = [];
  let lastError = null;

  for (const modelName of models) {
    const remaining = deadline - Date.now();
    if (remaining < 4000) {
      lastError = analysisError('Gemini request timed out', 504, 'GEMINI_TIMEOUT');
      break;
    }

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: `${BASE_SYSTEM_INSTRUCTION}\n\nGLOBAL TRADING KNOWLEDGE BASE (authoritative, ${activeEntries.length} active entries):\n${knowledgeBlock}`,
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    attempted.push(modelName);
    try {
      const result = await withTimeout(
        model.generateContent([
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
          {
            text: `Analyse this chart screenshot.
Trader local time: ${currentTime || 'unknown'}
Trader timezone: ${timezone || 'unknown'}

Return the JSON decision now.`,
          },
        ]),
        Math.min(remaining, config.gemini.attemptTimeoutMs),
      );

      const parsed = parseModelJson(result.response.text());
      const analysis = validateAnalysis(parsed);
      lastGoodModel = modelName;
      modelCooldown.delete(modelName);
      return {
        analysis,
        knowledgeEntriesUsed: activeEntries.length,
        model: modelName,
        modelsAttempted: attempted,
      };
    } catch (error) {
      const timedOut = String(error?.message || '').includes('timed out');
      const { error: mapped, retryModel } = timedOut
        ? { error: analysisError('Gemini request timed out', 504, 'GEMINI_TIMEOUT'), retryModel: true }
        : describeGeminiError(error);
      lastError = mapped;
      if (!retryModel) throw mapped;
      quarantineModel(modelName, error, `${error?.message || ''} ${mapped.message}`.toLowerCase());
      console.warn(`[gemini] ${modelName} failed (${mapped.code || mapped.status || 'error'}), trying the next model`);
    }
  }

  if (lastError?.code === 'GEMINI_TIMEOUT') throw lastError;

  if (lastError?.status) throw lastError;

  throw analysisError(
    `No Gemini model answered (tried ${attempted.length}). ${lastError?.message || 'Check GEMINI_MODEL and the API key.'}`,
    502,
    'GEMINI_MODEL_UNAVAILABLE',
  );
}
