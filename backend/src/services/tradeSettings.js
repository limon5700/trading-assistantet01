import { getDb, timestamp } from '../db.js';

export const BINARY_DURATIONS = [5, 15, 30, 60, 180, 300];
export const FOREX_TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H'];

export const DEFAULT_TRADE_SETTINGS = {
  binary_min_confidence: 70,
  binary_duration_seconds: 60,
  binary_strategy: '',
  forex_min_confidence: 70,
  forex_timeframe: '15M',
  forex_strategy: '',
};

function clampConfidence(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(50, Math.min(95, Math.round(parsed)));
}

function pick(value, allowed, fallback) {
  const parsed = Number(value);
  if (allowed.includes(parsed)) return parsed;
  return fallback;
}

function cleanStrategy(value, fallback = '') {
  if (value === undefined) return fallback;
  return String(value ?? '').slice(0, 4000);
}

export function mapTradeSettings(row) {
  if (!row) return { ...DEFAULT_TRADE_SETTINGS };
  const duration = pick(row.binary_duration_seconds, BINARY_DURATIONS, DEFAULT_TRADE_SETTINGS.binary_duration_seconds);
  const timeframe = FOREX_TIMEFRAMES.includes(String(row.forex_timeframe || '').toUpperCase())
    ? String(row.forex_timeframe).toUpperCase()
    : DEFAULT_TRADE_SETTINGS.forex_timeframe;

  return {
    binary_min_confidence: clampConfidence(row.binary_min_confidence, DEFAULT_TRADE_SETTINGS.binary_min_confidence),
    binary_duration_seconds: duration,
    binary_strategy: row.binary_strategy ?? '',
    forex_min_confidence: clampConfidence(row.forex_min_confidence, DEFAULT_TRADE_SETTINGS.forex_min_confidence),
    forex_timeframe: timeframe,
    forex_strategy: row.forex_strategy ?? '',
  };
}

export async function getTradeSettings(userId) {
  const db = await getDb();
  const row = await db.get('SELECT * FROM user_trade_settings WHERE user_id = ?', [Number(userId)]);
  return mapTradeSettings(row);
}

/**
 * Upserts the user's trade preferences. Values are validated here rather than in
 * the route so the overlay's direct calls and the settings screen always agree.
 */
export async function saveTradeSettings(userId, input = {}) {
  const db = await getDb();
  const current = await getTradeSettings(userId);

  const next = {
    binary_min_confidence: clampConfidence(input.binary_min_confidence, current.binary_min_confidence),
    binary_duration_seconds: pick(
      input.binary_duration_seconds,
      BINARY_DURATIONS,
      current.binary_duration_seconds,
    ),
    binary_strategy: cleanStrategy(input.binary_strategy, current.binary_strategy),
    forex_min_confidence: clampConfidence(input.forex_min_confidence, current.forex_min_confidence),
    forex_timeframe: FOREX_TIMEFRAMES.includes(String(input.forex_timeframe || '').toUpperCase())
      ? String(input.forex_timeframe).toUpperCase()
      : current.forex_timeframe,
    forex_strategy: cleanStrategy(input.forex_strategy, current.forex_strategy),
  };

  const existing = await db.get('SELECT user_id FROM user_trade_settings WHERE user_id = ?', [
    Number(userId),
  ]);

  if (existing) {
    await db.run(
      `UPDATE user_trade_settings
       SET binary_min_confidence = ?, binary_duration_seconds = ?, binary_strategy = ?,
           forex_min_confidence = ?, forex_timeframe = ?, forex_strategy = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        next.binary_min_confidence,
        next.binary_duration_seconds,
        next.binary_strategy,
        next.forex_min_confidence,
        next.forex_timeframe,
        next.forex_strategy,
        timestamp(),
        Number(userId),
      ],
    );
  } else {
    await db.run(
      `INSERT INTO user_trade_settings
         (user_id, binary_min_confidence, binary_duration_seconds, binary_strategy,
          forex_min_confidence, forex_timeframe, forex_strategy, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(userId),
        next.binary_min_confidence,
        next.binary_duration_seconds,
        next.binary_strategy,
        next.forex_min_confidence,
        next.forex_timeframe,
        next.forex_strategy,
        timestamp(),
      ],
    );
  }

  return getTradeSettings(userId);
}
