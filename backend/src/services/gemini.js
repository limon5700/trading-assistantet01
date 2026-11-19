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
    entry_timing: {
      type: SchemaType.STRING,
      description: 'Either "Next Candle" or a specific local time such as "14:35".',
    },
    confidence: {
      type: SchemaType.INTEGER,
      description: 'Confidence in the signal, 0-100.',
    },
    timeframe_detected: {
      type: SchemaType.STRING,
      description: 'Detected chart timeframe, e.g. "1M", "5M", "15M".',
    },
    reason: {
      type: SchemaType.STRING,
      description: 'One short, clear technical reason for the decision.',
    },
  },
  required: ['signal', 'entry_timing', 'confidence', 'timeframe_detected', 'reason'],
};

const BASE_SYSTEM_INSTRUCTION = `You are an expert intraday price-action trading assistant embedded in a floating Android overlay.
You receive a screenshot of a live candlestick chart and must decide the next actionable signal.

ABSOLUTE OUTPUT RULES
1. Never ask questions, never request clarification, never apologise.
2. Never reply with prose. Output only the JSON object described by the response schema.
3. signal must be exactly one of BUY, SELL or NO_TRADE.
4. If the chart is unclear, the timeframe is unreadable, or the knowledge base rules are not met, return NO_TRADE with a low confidence.
5. entry_timing is "Next Candle" when the entry is immediate, otherwise a specific local time in 24h HH:MM format.
6. confidence is an integer between 0 and 100.
7. reason is one short technical line (max ~140 characters) naming the setup or the blocking condition.

DECISION PROCESS
- Read the visible candles, wicks, trend, support/resistance, volume if shown, and the detected timeframe.
- Apply the global trading knowledge base below first. Where it is silent, use standard price-action and candlestick logic.
- Do not invent indicators that are not visible in the screenshot.
- Treat the supplied local time and timezone as the trader's clock for any timed entry.`;

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

  const entryTiming = String(raw.entry_timing || '').trim();
  const timeframe = String(raw.timeframe_detected || '').trim();
  const reason = String(raw.reason || '').trim();

  return {
    signal,
    entry_timing: entryTiming || 'Next Candle',
    confidence,
    timeframe_detected: timeframe || 'unknown',
    reason: reason ? reason.slice(0, 240) : 'No clear setup detected.',
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
