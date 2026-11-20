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

/**
 * Runs the vision analysis against the active knowledge base and returns the
 * strictly validated structured signal.
 */
export async function analyzeChart({ imageBase64, mimeType, currentTime, timezone }) {
  const activeEntries = await getActiveKnowledge();
  const knowledgeBlock = buildKnowledgePrompt(activeEntries);

  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    systemInstruction: `${BASE_SYSTEM_INSTRUCTION}\n\nGLOBAL TRADING KNOWLEDGE BASE (authoritative, ${activeEntries.length} active entries):\n${knowledgeBlock}`,
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

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
    config.gemini.timeoutMs,
  );

  const text = result.response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Defensive parse: strip fences if the model still wrapped the JSON.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model returned a non-JSON response');
    parsed = JSON.parse(match[0]);
  }

  return {
    analysis: validateAnalysis(parsed),
    knowledgeEntriesUsed: activeEntries.length,
  };
}
