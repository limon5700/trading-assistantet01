import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../config.js';
import { buildKnowledgePrompt, getActiveKnowledge } from './knowledge.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

export const ANALYSIS_MODES = ['BINARY', 'FOREX'];

const SIGNAL_ENUM = ['BUY', 'SELL', 'WAIT'];
const CANDLE_ENTRY_ENUM = ['RUNNING_CANDLE', 'NEXT_CANDLE'];

const MODE_SCHEMAS = {
  BINARY: {
    type: SchemaType.OBJECT,
    properties: {
      mode: { type: SchemaType.STRING, enum: ['BINARY'], description: 'Always "BINARY".' },
      signal: {
        type: SchemaType.STRING,
        enum: SIGNAL_ENUM,
        description: 'BUY, SELL or WAIT for the selected candle entry.',
      },
      confidence: { type: SchemaType.INTEGER, description: 'Confidence 0-100.' },
      asset: { type: SchemaType.STRING, description: 'Instrument printed on the chart, e.g. "EUR/USD (OTC)".' },
      candle_entry: {
        type: SchemaType.STRING,
        enum: CANDLE_ENTRY_ENUM,
        description:
          'RUNNING_CANDLE when the trade is a continuation of the candle currently forming, NEXT_CANDLE when the entry is at the open of the next candle.',
      },
      duration_seconds: {
        type: SchemaType.INTEGER,
        description: 'Binary expiry in seconds, e.g. 60 or 300.',
      },
      expiry_label: { type: SchemaType.STRING, description: 'Human expiry label such as "1 Minute (60s)".' },
      entry_time: {
        type: SchemaType.STRING,
        description: 'Either "Immediate" (running candle) or "Next Candle Open", or a local HH:MM time.',
      },
      reason: { type: SchemaType.STRING, description: 'One short technical reason, max ~160 characters.' },
      voice_summary: {
        type: SchemaType.STRING,
        description: 'One spoken sentence naming signal, asset, candle target, duration and confidence.',
      },
    },
    required: [
      'mode',
      'signal',
      'confidence',
      'asset',
      'candle_entry',
      'duration_seconds',
      'expiry_label',
      'entry_time',
      'reason',
      'voice_summary',
    ],
  },
  FOREX: {
    type: SchemaType.OBJECT,
    properties: {
      mode: { type: SchemaType.STRING, enum: ['FOREX'], description: 'Always "FOREX".' },
      signal: {
        type: SchemaType.STRING,
        enum: SIGNAL_ENUM,
        description: 'BUY, SELL or WAIT for the selected candle entry.',
      },
      confidence: { type: SchemaType.INTEGER, description: 'Confidence 0-100.' },
      asset: { type: SchemaType.STRING, description: 'Instrument printed on the chart, e.g. "XAU/USD".' },
      timeframe: { type: SchemaType.STRING, description: 'Chart timeframe, e.g. "1M", "5M", "15M", "1H", "4H".' },
      candle_entry: {
        type: SchemaType.STRING,
        enum: CANDLE_ENTRY_ENUM,
        description:
          'RUNNING_CANDLE when the trade is a continuation of the candle currently forming, NEXT_CANDLE when the entry is at the open of the next candle.',
      },
      entry_price: { type: SchemaType.STRING, description: 'Entry price as a decimal string, e.g. "2645.50".' },
      stop_loss: { type: SchemaType.STRING, description: 'Stop-loss price as a decimal string, e.g. "2638.00".' },
      take_profit: { type: SchemaType.STRING, description: 'Take-profit price as a decimal string, e.g. "2660.00".' },
      reason: { type: SchemaType.STRING, description: 'One short technical reason, max ~160 characters.' },
      voice_summary: {
        type: SchemaType.STRING,
        description: 'One spoken sentence naming signal, asset, timeframe, candle target and confidence.',
      },
    },
    required: [
      'mode',
      'signal',
      'confidence',
      'asset',
      'timeframe',
      'candle_entry',
      'entry_price',
      'stop_loss',
      'take_profit',
      'reason',
      'voice_summary',
    ],
  },
};

const CHART_READING_RULES = `HOW TO ANALYSE (knowledge-driven, evidence-first, no guessing)
0. EVIDENCE FIRST: describe to yourself what is actually drawn — the instrument, the timeframe, the direction of the last 5-8 candles, the colour and body/wick ratio of the latest CLOSED candle, the visible swing highs and lows, and the nearest support and resistance. Every claim in your reason must be visible in the screenshot. If the chart cannot be read, return WAIT.
1. DECIDE FROM TWO KNOWLEDGE SOURCES, IN THIS ORDER:
   a. THE ACTIVE KNOWLEDGE LIBRARY below — the BINARY or FOREX entries extracted from this trader's strategy books and manuals. It is the authority for this mode: its entry conditions, confirmation rules, expiry/timeframe rules and invalidation rules decide the trade. Never mix BINARY rules into FOREX or the reverse.
   b. YOUR OWN EXPERT KNOWLEDGE of price action, candlestick behaviour, market structure, support and resistance, trendlines, supply and demand, Smart Money Concepts (HH/HL, BOS, CHoCH, order blocks, fair value gaps, liquidity sweeps) and the standard indicators (RSI, Bollinger Bands, EMA). Use it to read the chart and to fill the gaps the library does not cover — but never to contradict a library rule.
2. DECIDE BY RULE SATISFACTION, NOT BY OPINION:
   - Name the specific library rule (or, when the library is silent, the specific classical principle) the setup satisfies and quote it in the reason.
   - Check that rule's invalidation conditions on this chart. Any invalidation present means the rule is not satisfied.
   - If no rule's entry conditions are fully met, the answer is WAIT. Having a directional opinion is not the same as having a setup.
   - If two valid rules point in opposite directions, the conflict resolves to WAIT.
3. READ THE SETUP IN CONTEXT: market structure, candle sequence and momentum, candle anatomy (long lower wick = buyers defending, long upper wick = sellers defending, small bodies = indecision), the level price is reacting to, and where price sits inside the visible range. Direction comes from that evidence — never from a default.
4. CANDLE ENTRY: RUNNING_CANDLE when the current candle is already moving in the signal direction and the expiry fits inside its remaining time; NEXT_CANDLE when the setup needs the next candle's open or close to confirm.
5. CONFIDENCE must be honest and reflect confluence: 85-95 = a library rule fully satisfied with trend, level and trigger aligned; 70-84 = a valid rule with one confirmation missing; 50-69 = weak or partly conflicting; below 50 = no trade. Never inflate confidence to clear the trader's threshold.
6. FOREX PRICES: entry, stop-loss and take-profit must be actual levels read from the chart's price axis. The stop goes beyond the structure that invalidates the idea, the target goes toward the next level, and risk:reward must be at least 1:1.5 — otherwise WAIT.
7. NO WRONG SIGNAL: never invent a level, indicator or rule that is not visible or not in the library. When the evidence is incomplete or the setup is unconfirmed, return WAIT with a low confidence. A missed trade costs nothing; a wrong BUY or SELL costs money.`;

const OUTPUT_RULES = `ABSOLUTE OUTPUT RULES
1. Never ask questions, never apologise, never write prose. Output only the JSON object required by the response schema.
2. signal must be exactly BUY, SELL or WAIT.
3. confidence must be a plain integer 0-100.
4. candle_entry must be exactly RUNNING_CANDLE or NEXT_CANDLE.
5. reason is one short technical sentence (max ~160 characters) that names the setup or the blocking condition.
6. voice_summary is one natural sentence for text-to-speech that a trader can understand without looking at the screen. Use "Euro U S D" instead of "EUR/USD" and "Gold" instead of "XAU/USD".
7. Emit every required field, in the schema order, with no extra fields.`;

const BINARY_INSTRUCTIONS = `You are an expert binary-options price-action analyst embedded in a floating Android overlay. You receive a screenshot of a live candlestick chart and must return the single highest-probability trade for a short expiry.

BINARY RULES
- Expiry is short (5s to 300s). The trade must be decided by the CURRENT impulse and the level price is reacting to, not by a long-term forecast.
- Prefer continuation with the last 2-3 candle direction when price is not at a strong opposing level.
- Prefer reversal only at a validated support/resistance with a rejection candle or a liquidity sweep.
- duration_seconds should match the momentum: 5-60s for a fast 1M impulse, 180-300s for a slower 5M setup. If the user supplied a preferred duration, use it.
- expiry_label must describe duration_seconds, e.g. "1 Minute (60s)" or "5 Minutes (300s)".
- entry_time: "Immediate" for RUNNING_CANDLE, "Next Candle Open" for NEXT_CANDLE.
- If the asset is not readable use "unknown"; never invent a broker or pair.`;

const FOREX_INSTRUCTIONS = `You are an expert forex, gold and index intraday analyst embedded in a floating Android overlay. You receive a screenshot of a live candlestick chart and must return a complete, risk-managed trade plan.

FOREX RULES
- Read the timeframe from the chart and use the matching structure: lower timeframes for entry, the visible higher structure for bias.
- Use Smart Money Concepts when they are visible: order blocks, fair value gaps, liquidity sweeps, BOS/CHoCH. Otherwise use classic support/resistance and trend continuation.
- entry_price, stop_loss and take_profit must be plausible prices taken from the chart axis, with the same decimals the instrument uses.
- For a BUY: stop_loss below the invalidation low, take_profit above entry toward the next resistance. For a SELL: the reverse.
- If the setup does not offer at least 1:1.5 risk-to-reward, return WAIT.
- timeframe is the chart interval as printed (1M, 5M, 15M, 1H, 4H). If unreadable, use "unknown".
- WAIT is required when price is mid-range with no clear level, or when the structure and momentum conflict.`;

export function normalizeMode(value) {
  const mode = String(value ?? '').trim().toUpperCase();
  return ANALYSIS_MODES.includes(mode) ? mode : 'BINARY';
}

const SIGNAL_LABELS = { BUY: 'Buy', SELL: 'Sell', WAIT: 'Wait' };
const CLOCK_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const ALLOWED_DURATIONS = [5, 15, 30, 60, 180, 300];
const ALLOWED_TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H'];

function compact(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeSignal(raw) {
  const value = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (value === 'NO_TRADE' || value === 'NOTRADE' || value === 'HOLD' || value === 'NONE') return 'WAIT';
  if (SIGNAL_ENUM.includes(value)) return value;
  if (value === 'LONG') return 'BUY';
  if (value === 'SHORT') return 'SELL';
  return null;
}

function normalizeCandleEntry(raw) {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (value === 'RUNNING_CANDLE' || value === 'CURRENT_CANDLE' || value === 'RUNNING') return 'RUNNING_CANDLE';
  if (value === 'NEXT_CANDLE' || value === 'NEXT' || value === 'NEXT_CANDLE_OPEN') return 'NEXT_CANDLE';
  return null;
}

function normalizeEntryTime(value, candleEntry) {
  const raw = compact(value, 32);
  if (/^immediate$/i.test(raw)) return 'Immediate';
  if (/^next\s*candle/i.test(raw)) return 'Next Candle Open';
  const clock = CLOCK_PATTERN.exec(raw);
  if (clock) return `${clock[1].padStart(2, '0')}:${clock[2]}`;
  return candleEntry === 'RUNNING_CANDLE' ? 'Immediate' : 'Next Candle Open';
}

function normalizeDuration(value, preferred) {
  const requested = Number(preferred);
  if (Number.isFinite(requested) && ALLOWED_DURATIONS.includes(Math.round(requested))) {
    return Math.round(requested);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  const rounded = Math.round(parsed);
  if (ALLOWED_DURATIONS.includes(rounded)) return rounded;
  // Snap an unexpected duration to the nearest allowed value inside 5s-300s.
  const nearest = ALLOWED_DURATIONS.reduce(
    (best, candidate) => (Math.abs(candidate - rounded) < Math.abs(best - rounded) ? candidate : best),
    ALLOWED_DURATIONS[0],
  );
  return Math.min(300, Math.max(5, rounded > 300 ? nearest : nearest));
}

function expiryLabelFor(seconds) {
  const minutes = seconds / 60;
  if (seconds < 60) return `${seconds} Seconds (${seconds}s)`;
  const label = Number.isInteger(minutes) ? `${minutes} Minute` : `${minutes.toFixed(1)} Minute`;
  return `${label}${minutes === 1 ? '' : 's'} (${seconds}s)`;
}

function priceString(value, fallback = '—') {
  const raw = compact(value, 24);
  if (!raw) return fallback;
  const numeric = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return fallback;
  // Keep the precision the model used when it is a clean decimal.
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  return String(numeric);
}

function normalizeTimeframe(value, fallback = '15M') {
  const raw = compact(value, 8).toUpperCase().replace(/\s+/g, '');
  const mapped = raw === '1MIN' ? '1M' : raw === '5MIN' ? '5M' : raw === '15MIN' ? '15M' : raw;
  if (ALLOWED_TIMEFRAMES.includes(mapped)) return mapped;
  if (/^H1$/.test(mapped)) return '1H';
  if (/^H4$/.test(mapped)) return '4H';
  return ALLOWED_TIMEFRAMES.includes(String(fallback).toUpperCase())
    ? String(fallback).toUpperCase()
    : '15M';
}

function spokenAsset(asset) {
  return String(asset)
    .replace(/\(OTC\)/gi, 'OTC')
    .replace(/XAU\/USD/gi, 'Gold')
    .replace(/XAG\/USD/gi, 'Silver')
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenCandle(candleEntry) {
  return candleEntry === 'RUNNING_CANDLE' ? 'Running Candle' : 'Next Candle';
}

function spokenTimeframe(timeframe) {
  const map = { '1M': '1 minute', '5M': '5 minute', '15M': '15 minute', '1H': '1 hour', '4H': '4 hour' };
  return map[timeframe] || timeframe;
}

/**
 * Validates and normalizes the model JSON into the exact public contract for
 * the requested mode. Anything missing is repaired from the chart context, and
 * the response is never returned unvalidated.
 */
/** A directional call below this confidence is never spoken, whatever the user threshold. */
const MIN_DIRECTIONAL_CONFIDENCE = 50;
/** Forex plans below this reward:risk are skipped instead of being published. */
const MIN_RISK_REWARD = 1.5;

function toPrice(value) {
  const numeric = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Deterministic checks on a forex plan: the levels must exist, must sit on the
 * correct side of the entry, and the reward must justify the risk. Returns the
 * list of reasons the signal must not be spoken.
 */
function forexSafetyProblems(signal, prices) {
  const entry = toPrice(prices.entry);
  const stop = toPrice(prices.stop);
  const target = toPrice(prices.target);
  if (entry === null || stop === null || target === null) {
    return ['entry, stop-loss and take-profit must all be readable chart prices'];
  }

  if (signal === 'BUY') {
    if (stop >= entry) return ['stop-loss is not below the entry for a BUY'];
    if (target <= entry) return ['take-profit is not above the entry for a BUY'];
  } else {
    if (stop <= entry) return ['stop-loss is not above the entry for a SELL'];
    if (target >= entry) return ['take-profit is not below the entry for a SELL'];
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!risk || reward / risk < MIN_RISK_REWARD) {
    return [`risk:reward is below 1:${MIN_RISK_REWARD}`];
  }

  return [];
}

export function validateAnalysis(raw, { mode, minConfidence = 0, preferredDuration = null }) {
  if (!raw || typeof raw !== 'object') throw new Error('Model returned no JSON object');

  const resolvedMode = normalizeMode(raw.mode || mode);
  const signal = normalizeSignal(raw.signal);
  if (!signal) throw new Error(`Model returned an invalid signal: ${raw.signal}`);

  const confidenceRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 0;

  const candleEntry =
    normalizeCandleEntry(raw.candle_entry ?? raw.candle_target ?? raw.entry_candle) ||
    (signal === 'BUY' || signal === 'SELL' ? 'NEXT_CANDLE' : 'RUNNING_CANDLE');

  const asset = compact(raw.asset, 48) || 'unknown';
  const reason = compact(raw.reason, 240) || 'No clear setup detected.';
  const threshold = Math.max(0, Math.min(100, Math.round(Number(minConfidence) || 0)));

  // Safety gate: every directional signal must survive these deterministic
  // checks before it reaches the trader. Anything that fails is downgraded to
  // an explicit WAIT with the blocking reason, so the app never speaks a
  // signal the model itself did not justify.
  const blockers = [];
  if (signal !== 'WAIT' && confidence < threshold) {
    blockers.push(`confidence ${confidence}% is below your ${threshold}% threshold`);
  }
  if (signal !== 'WAIT' && confidence < MIN_DIRECTIONAL_CONFIDENCE) {
    blockers.push(`confidence ${confidence}% is below the ${MIN_DIRECTIONAL_CONFIDENCE}% safety floor`);
  }

  const forexPrices =
    resolvedMode === 'FOREX'
      ? {
          entry: priceString(raw.entry_price),
          stop: priceString(raw.stop_loss),
          target: priceString(raw.take_profit),
        }
      : null;

  if (forexPrices && signal !== 'WAIT') {
    blockers.push(...forexSafetyProblems(signal, forexPrices));
  }

  const finalSignal = signal !== 'WAIT' && blockers.length ? 'WAIT' : signal;
  const blocked = finalSignal === 'WAIT' && signal !== 'WAIT';

  const base = {
    mode: resolvedMode,
    signal: finalSignal,
    confidence,
    asset,
    candle_entry: candleEntry,
    reason: blocked ? `${reason} (Blocked: ${blockers[0]})`.slice(0, 260) : reason,
  };

  if (resolvedMode === 'BINARY') {
    const durationSeconds = normalizeDuration(raw.duration_seconds ?? raw.duration, preferredDuration);
    const voiceSummary =
      finalSignal === 'WAIT'
        ? 'No confirmed setup right now, wait for the next signal.'
        : compact(raw.voice_summary, 240) ||
          `Binary ${SIGNAL_LABELS[finalSignal]} signal on ${spokenAsset(asset)}, ${spokenCandle(
            candleEntry,
          )}, ${durationSeconds} seconds, confidence ${confidence} percent.`;

    return {
      ...base,
      duration_seconds: durationSeconds,
      expiry_label: compact(raw.expiry_label, 48) || expiryLabelFor(durationSeconds),
      entry_time: normalizeEntryTime(raw.entry_time, candleEntry),
      voice_summary: voiceSummary,
    };
  }

  const timeframe = normalizeTimeframe(raw.timeframe ?? raw.timeframe_detected, '15M');
  const voiceSummary =
    finalSignal === 'WAIT'
      ? 'No confirmed setup right now, wait for the next signal.'
      : compact(raw.voice_summary, 240) ||
        `Forex ${SIGNAL_LABELS[finalSignal]} signal on ${spokenAsset(asset)}, ${spokenTimeframe(
          timeframe,
        )} timeframe, confidence ${confidence} percent.`;

  return {
    ...base,
    timeframe,
    entry_price: forexPrices?.entry ?? '—',
    stop_loss: forexPrices?.stop ?? '—',
    take_profit: forexPrices?.target ?? '—',
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

/** Models that recently failed, so the next scan does not pay for them again. */
const modelCooldown = new Map();
/** Models this key rejected outright (404): retired for new keys, never retried. */
const retiredModels = new Set();
const COOLDOWN_TRANSIENT_MS = 60 * 1000;
/** A model that used up its free quota stays out of the chain for a while. */
const COOLDOWN_QUOTA_MS = 15 * 60 * 1000;

function isCoolingDown(name) {
  if (retiredModels.has(name)) return true;
  const until = modelCooldown.get(name);
  if (!until) return false;
  if (until > Date.now()) return true;
  modelCooldown.delete(name);
  return false;
}

/** Milliseconds until this model may be tried again (Infinity once retired). */
function cooldownLeft(name) {
  if (retiredModels.has(name)) return Infinity;
  return Math.max(0, (modelCooldown.get(name) || 0) - Date.now());
}

/**
 * Remembers why a model failed so the next analysis does not pay for the same
 * rejection: a retired model leaves the chain for the whole process, a model
 * out of free quota rests for fifteen minutes, a transient failure for a
 * minute. Each reason is logged once, never on every analysis.
 */
function quarantineModel(name, error, haystack, code) {
  const retired =
    Number(error?.status) === 404 ||
    /404|not found|not supported|unsupported|does not exist|no longer available/.test(haystack);
  if (retired) {
    retiredModels.add(name);
    modelCooldown.delete(name);
    console.warn(`[gemini] ${name} is retired for this key, dropping it from the chain`);
    return;
  }
  if (code === 'GEMINI_QUOTA_EXCEEDED' || /429|quota|resource_exhausted|rate limit/.test(haystack)) {
    modelCooldown.set(name, Date.now() + COOLDOWN_QUOTA_MS);
    console.warn(`[gemini] ${name} is out of free quota, resting ${COOLDOWN_QUOTA_MS / 60000} minutes`);
    return;
  }
  modelCooldown.set(name, Date.now() + COOLDOWN_TRANSIENT_MS);
  console.warn(`[gemini] ${name} failed, resting ${COOLDOWN_TRANSIENT_MS / 1000} seconds`);
}

/**
 * The single model every scan calls. This is deliberately not configurable: the
 * assistant uses gemini-flash-lite-latest and nothing else, so a dead or drained
 * model can never turn one scan into a catalogue walk that ends in a timeout.
 * A model that just failed rests, and the caller is told for how long.
 */
function buildModelChain() {
  const model = config.gemini.model;
  if (!retiredModels.has(model) && !isCoolingDown(model)) return [model];

  const waitMs = cooldownLeft(model);
  if (!Number.isFinite(waitMs)) {
    throw analysisError(
      `Gemini rejected "${model}" for this API key (retired or unknown), and it is the only model this assistant uses. Check the key and its project access.`,
      503,
      'GEMINI_MODEL_UNAVAILABLE',
    );
  }
  throw analysisError(
    `Gemini model "${model}" is resting after a failure. Try again in ${Math.max(1, Math.ceil(waitMs / 1000))} seconds.`,
    503,
    'GEMINI_MODELS_COOLING_DOWN',
  );
}

/**
 * Turns an SDK error into an actionable API error. Only a key or project
 * permission failure is final; a retired model, an overloaded or drained one, a
 * timeout or malformed JSON is reported as-is, because there is no second model
 * to fall back to.
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
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model returned a non-JSON response');
    return JSON.parse(match[0]);
  }
}

/**
 * Runs the vision analysis for one mode against that mode's knowledge base and
 * returns the strict structured signal. Models are tried in order until one
 * answers, so a retired, overloaded, rate-limited or schema-incompatible model
 * never takes the endpoint down.
 */
export async function analyzeChart({
  imageBase64,
  mimeType,
  currentTime,
  timezone,
  mode,
  userCustomStrategy,
  minConfidence,
  preferredDuration,
  preferredTimeframe,
}) {
  const resolvedMode = normalizeMode(mode);
  const activeEntries = await getActiveKnowledge(resolvedMode);
  const knowledgeBlock = buildKnowledgePrompt(activeEntries);
  const custom = compact(userCustomStrategy, 4000);
  const threshold = Math.max(0, Math.min(100, Math.round(Number(minConfidence) || 0)));

  const modeInstruction = resolvedMode === 'BINARY' ? BINARY_INSTRUCTIONS : FOREX_INSTRUCTIONS;
  const preferred =
    resolvedMode === 'BINARY'
      ? `Preferred expiry: ${preferredDuration ? `${preferredDuration} seconds` : 'trader default (60s)'}.`
      : `Preferred timeframe: ${normalizeTimeframe(preferredTimeframe, '15M')}.`;

  const systemInstruction = [
    modeInstruction,
    CHART_READING_RULES,
    OUTPUT_RULES,
    `MODE: ${resolvedMode}. ${preferred}`,
    `MINIMUM CONFIDENCE: ${threshold}%. If your confidence is lower than ${threshold}%, return WAIT.`,
    custom
      ? `TRADER'S CUSTOM STRATEGY (apply in addition to the library, never contradict the risk rules):\n${custom}`
      : 'TRADER CUSTOM STRATEGY: none supplied.',
    `MODE-SPECIFIC KNOWLEDGE BASE (authoritative, ${activeEntries.length} active ${resolvedMode} entries, extracted from the trader's books and manuals). Judge the chart against these rules first, combine them with your own market expertise, and never mix BINARY rules into FOREX or the reverse:\n${knowledgeBlock}`,
  ].join('\n\n');

  const models = buildModelChain();
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
      systemInstruction,
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: MODE_SCHEMAS[resolvedMode],
      },
    });

    attempted.push(modelName);
    try {
      const result = await withTimeout(
        model.generateContent([
          { inlineData: { mimeType, data: imageBase64 } },
          {
            text: `Analyse this chart screenshot for a ${resolvedMode} trade.
Trader local time: ${currentTime || 'unknown'}
Trader timezone: ${timezone || 'unknown'}
Minimum confidence: ${threshold}%
${resolvedMode === 'BINARY' ? `Preferred duration: ${preferredDuration || 60} seconds` : `Preferred timeframe: ${normalizeTimeframe(preferredTimeframe, '15M')}`}

Read the chart first, then apply the active knowledge library together with your own market knowledge, name the rule that decided the trade, and only then return the JSON decision. If no rule is satisfied, return WAIT.`,
          },
        ]),
        Math.min(remaining, config.gemini.attemptTimeoutMs),
      );

      const parsed = parseModelJson(result.response.text());
      const analysis = validateAnalysis(parsed, {
        mode: resolvedMode,
        minConfidence: threshold,
        preferredDuration,
      });
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
      quarantineModel(
        modelName,
        error,
        `${error?.message || ''} ${mapped.message}`.toLowerCase(),
        mapped.code,
      );
    }
  }

  if (lastError?.code === 'GEMINI_TIMEOUT') throw lastError;
  if (lastError?.status) throw lastError;

  throw analysisError(
    `Gemini did not answer ${attempted.length === 1 ? '' : `(${attempted.length} attempts) `}from ${config.gemini.model}. ${lastError?.message || 'Check the API key.'}`,
    502,
    'GEMINI_MODEL_UNAVAILABLE',
  );
}
