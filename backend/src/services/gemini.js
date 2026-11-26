import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../config.js';

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
   a. THE TRADER'S STRATEGY inside this instruction. It is the authority for this mode: its entry conditions, confirmation rules, expiry/timeframe rules and invalidation rules decide the trade. Never mix BINARY rules into FOREX or the reverse. When the trader's strategy is silent on a point, fall back to (b).
   b. YOUR OWN EXPERT KNOWLEDGE of price action, candlestick behaviour, market structure, support and resistance, trendlines, supply and demand, Smart Money Concepts (HH/HL, BOS, CHoCH, order blocks, fair value gaps, liquidity sweeps) and the standard indicators (RSI, Bollinger Bands, EMA). Use it to read the chart and to fill the gaps the trader's strategy does not cover — but never to contradict it.
2. DECIDE BY RULE SATISFACTION, NOT BY OPINION:
   - Name the specific strategy rule (or, when the strategy is silent, the specific classical principle) the setup satisfies and quote it in the reason.
   - Check that rule's invalidation conditions on this chart. Any invalidation present means the rule is not satisfied.
   - A rule counts as met when its direction and its level are both visible on the chart; a missing secondary confirmation lowers confidence (52-79) but does not cancel a readable setup. Only return WAIT when no rule's direction and level are both visible.
   - If two valid rules point in opposite directions, the conflict resolves to WAIT.
3. READ THE SETUP IN CONTEXT: market structure, candle sequence and momentum, candle anatomy (long lower wick = buyers defending, long upper wick = sellers defending, small bodies = indecision), the level price is reacting to, and where price sits inside the visible range. Direction comes from that evidence — never from a default.
4. CANDLE ENTRY: RUNNING_CANDLE when the current candle is already moving in the signal direction and the expiry fits inside its remaining time; NEXT_CANDLE when the setup needs the next candle's open or close to confirm.
5. CONFIDENCE must be honest and reflect confluence, using the whole scale: 80-95 = a library rule fully satisfied with trend, level and trigger aligned; 65-79 = a valid rule with one confirmation missing; 52-64 = one clear rule with the level respected but thin confluence, still tradeable on a short expiry; below 52 = no trade. Never inflate confidence to clear the trader's threshold, and never report a directional setup below 52.
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
/** A model that used up its free quota stays out of the chain for a while. */
const COOLDOWN_QUOTA_MS = 15 * 60 * 1000;
/**
 * Gap before each extra attempt of the same model. Google's "503 high demand"
 * spikes last seconds, so a single immediate retry lands inside the same spike;
 * two spaced retries ride most of them out within the scan budget. The delay is
 * jittered so simultaneous scans do not retry in lockstep and add to the load
 * that caused the spike.
 */
const RETRY_DELAYS_MS = [2000, 5000];
const MAX_ATTEMPTS_PER_MODEL = RETRY_DELAYS_MS.length + 1;

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
 * True only for a rejection that says this key cannot use this model at all:
 * an HTTP 404 or an explicit unknown-model message. A generic "not supported"
 * is deliberately not enough, because Google uses it for recoverable 400s
 * (an unsupported generation option) and retiring the only model would take
 * analysis down until the process restarts.
 */
function looksLikeUnknownModel(error, haystack) {
  return (
    Number(error?.status) === 404 ||
    /\b404\b/.test(haystack) ||
    /is not found for api version/.test(haystack) ||
    /models\/[\w.-]+ is not found/.test(haystack) ||
    haystack.includes('no longer available') ||
    haystack.includes('is not supported for generatecontent')
  );
}

/**
 * Records why a model failed. Only a rejection the whole key shares (404) or a
 * drained free quota is worth taking the model out of the chain, because those
 * cannot succeed on the next scan either. A timeout, a 5xx, an unparseable
 * answer or a blocked screenshot is this scan's problem, so the model stays
 * available: benching the only model would turn one hiccup into a minute of
 * "model is resting" 503s for every trader.
 */
function noteModelFailure(name, error, haystack, code) {
  const reason = compact(error?.message || error, 240) || 'unknown error';
  if (looksLikeUnknownModel(error, haystack)) {
    retiredModels.add(name);
    modelCooldown.delete(name);
    console.warn(`[gemini] ${name} is retired for this key, dropping it from the chain (${reason})`);
    return;
  }
  if (code === 'GEMINI_QUOTA_EXCEEDED' || /429|quota|resource_exhausted|rate limit/.test(haystack)) {
    modelCooldown.set(name, Date.now() + COOLDOWN_QUOTA_MS);
    console.warn(
      `[gemini] ${name} is out of free quota, resting ${COOLDOWN_QUOTA_MS / 60000} minutes (${reason})`,
    );
    return;
  }
  console.warn(`[gemini] ${name} failed this scan but stays available: ${reason}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The single model every scan calls. This is deliberately not configurable: the
 * assistant uses gemini-flash-lite-latest and nothing else, so a dead or drained
 * model can never turn one scan into a catalogue walk that ends in a timeout.
 * Only a retired model or a drained quota takes it out of the chain, and the
 * caller is told how long to wait.
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
 * Turns an SDK error into an actionable API error plus a kind that decides what
 * happens next: "fatal" is thrown back at once, "quota" benches the model and
 * is thrown, and "transient" (a timeout, a 5xx, an unparseable answer) earns one
 * retry of the same model without benching it.
 */
function describeGeminiError(error) {
  if (error?.status && error?.code) {
    const kind =
      error.code === 'GEMINI_QUOTA_EXCEEDED'
        ? 'quota'
        : error.code === 'GEMINI_KEY_INVALID' || error.code === 'GEMINI_PERMISSION_DENIED'
          ? 'fatal'
          : 'transient';
    return { error, kind };
  }

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
      kind: 'fatal',
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
      kind: 'fatal',
    };
  }
  if (looksLikeUnknownModel(error, haystack)) {
    return {
      error: analysisError(
        `Gemini rejected "${config.gemini.model}" for this API key (unknown or unsupported model). Check the key and its project access.`,
        503,
        'GEMINI_MODEL_UNAVAILABLE',
      ),
      kind: 'fatal',
    };
  }
  if (
    haystack.includes('503') ||
    haystack.includes('high demand') ||
    haystack.includes('overloaded') ||
    haystack.includes('service unavailable') ||
    haystack.includes('temporarily unavailable')
  ) {
    return {
      error: analysisError(
        `Gemini's ${config.gemini.model} is at capacity right now (Google-side high demand). Try again in a few seconds.`,
        503,
        'GEMINI_OVERLOADED',
      ),
      kind: 'transient',
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
      kind: 'quota',
    };
  }
  if (haystack.includes('safety') || haystack.includes('blocked')) {
    return {
      error: analysisError(
        'Gemini blocked this screenshot (safety filter). Capture the chart again without private content.',
        422,
        'GEMINI_BLOCKED',
      ),
      kind: 'fatal',
    };
  }

  return { error, kind: 'transient' };
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
  // The trader's strategy travels with the request and lives in the system
  // instruction below; the analysis never reads it from the database.
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
      ? `TRADER'S STRATEGY (authoritative for this ${resolvedMode} scan; apply it literally and never contradict the risk rules):\n${custom}`
      : 'TRADER STRATEGY: none supplied for this scan, use the built-in price-action rules.',
  ].join('\n\n');

  const models = buildModelChain();
  const deadline = Date.now() + config.gemini.timeoutMs;
  const attempted = [];
  let lastError = null;

  for (const modelName of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
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

Read the chart first, then apply the trader's strategy together with your own market knowledge, name the rule that decided the trade, and only then return the JSON decision. If no rule is satisfied, return WAIT.`,
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
          strategySource: custom ? 'request' : 'builtin',
          model: modelName,
          modelsAttempted: attempted,
        };
      } catch (error) {
        const timedOut = String(error?.message || '').includes('timed out');
        const { error: mapped, kind } = timedOut
          ? { error: analysisError('Gemini request timed out', 504, 'GEMINI_TIMEOUT'), kind: 'transient' }
          : describeGeminiError(error);
        lastError = mapped;
        noteModelFailure(
          modelName,
          error,
          `${error?.message || ''} ${mapped.message}`.toLowerCase(),
          mapped.code,
        );
        // A bad key, a revoked permission, a blocked screenshot or a drained
        // quota will not improve by asking again: report it now.
        if (kind === 'fatal' || kind === 'quota') throw mapped;
        // A scan that already spent its whole attempt budget will most likely
        // time out again on the next try, so only fast failures get retried.
        const retryDelay = RETRY_DELAYS_MS[attempt - 1];
        if (timedOut || retryDelay === undefined || deadline - Date.now() < 6000) throw mapped;
        const waitMs = retryDelay + Math.floor(Math.random() * 600);
        console.warn(
          `[gemini] ${modelName} busy, retry ${attempt + 1}/${MAX_ATTEMPTS_PER_MODEL} in ${(waitMs / 1000).toFixed(1)}s: ${mapped.message}`,
        );
        await sleep(waitMs);
      }
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
