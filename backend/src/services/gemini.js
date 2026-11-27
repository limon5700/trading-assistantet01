import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

export const ANALYSIS_MODES = ['BINARY', 'FOREX'];

// Frames of one live capture clip sent to a single model call.
const MAX_LIVE_FRAMES = 6;

const SIGNAL_ENUM = ['BUY', 'SELL', 'WAIT'];
const CANDLE_ENTRY_ENUM = ['RUNNING_CANDLE', 'NEXT_CANDLE'];
// Every failed quality gate the model may report. "NONE" means all seven gates
// passed; anything else downgrades the answer to WAIT in validateAnalysis.
const VETO_ENUM = [
  'NONE',
  'OPPOSING_LEVEL',
  'ROUND_NUMBER',
  'EXHAUSTION_CANDLE',
  'CHOPPY_MARKET',
  'NEWS_RISK',
  'LATE_ENTRY',
  'COUNTER_TREND',
  'EXPIRY_MISMATCH',
  'NO_STRUCTURE',
  'OTC_SPIKE',
];
const GRADE_ENUM = ['A', 'B', 'C', 'REJECT'];
const MARKET_ENUM = ['REAL', 'OTC', 'UNKNOWN'];
const TREND_ENUM = ['UP', 'DOWN', 'SIDEWAYS'];
const ENTRY_TIMING_ENUM = ['AT_LEVEL', 'PULLBACK_DONE', 'CHASING'];
const EXPIRY_FIT_ENUM = ['GOOD', 'TOO_SHORT', 'TOO_LONG'];
const CHART_TIMEFRAME_ENUM = ['5S', '15S', '30S', '1M', '2M', '5M', '15M', '30M', '1H', '4H', 'UNKNOWN'];
const PLAYBOOK_ENUM = [
  'NONE',
  'LIVERMORE_PIVOT',
  'TURTLE_BREAKOUT',
  'RASCHKE_HOLY_GRAIL',
  'DARVAS_BOX',
  'SEYKOTA_TREND',
];

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
      chart_timeframe: {
        type: SchemaType.STRING,
        enum: CHART_TIMEFRAME_ENUM,
        description: 'Candle interval actually printed on the chart, needed to match the expiry to the chart clock.',
      },
      market_type: {
        type: SchemaType.STRING,
        enum: MARKET_ENUM,
        description: 'REAL for a live market, OTC when the chart is marked OTC, UNKNOWN when it cannot be read.',
      },
      trend_bias: {
        type: SchemaType.STRING,
        enum: TREND_ENUM,
        description: 'Direction of the visible main trend: the last 8-20 candles and the swings that contain them.',
      },
      setup_grade: {
        type: SchemaType.STRING,
        enum: GRADE_ENUM,
        description:
          'A = all seven gates passed with confluence, B = all seven passed with one secondary confirmation missing, C = thin single argument, REJECT = unreadable or contradicted.',
      },
      expiry_fit: {
        type: SchemaType.STRING,
        enum: EXPIRY_FIT_ENUM,
        description: 'Whether duration_seconds matches the chart candle interval and the remaining momentum.',
      },
      entry_timing: {
        type: SchemaType.STRING,
        enum: ENTRY_TIMING_ENUM,
        description:
          'AT_LEVEL when price is at the level now, PULLBACK_DONE when the pullback finished and price turned, CHASING when price already ran in the signal direction.',
      },
      vetoes: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING, enum: VETO_ENUM },
        description: 'Every failed gate, as codes. Use ["NONE"] only when all seven gates passed.',
      },
      key_level: {
        type: SchemaType.STRING,
        description: 'The level that decides this trade, e.g. "resistance 3641.50 / round 3640.00".',
      },
      playbook: {
        type: SchemaType.STRING,
        enum: PLAYBOOK_ENUM,
        description:
          'The classic setup that decided this trade: LIVERMORE_PIVOT, TURTLE_BREAKOUT, RASCHKE_HOLY_GRAIL, DARVAS_BOX or SEYKOTA_TREND. NONE when no playbook is satisfied or the signal is WAIT.',
      },
      next_candle_seconds: {
        type: SchemaType.INTEGER,
        description:
          'Seconds from the moment of this answer until the next candle opens, read from the chart candle timer. 0 only when the new candle has just opened.',
      },
      entry_window_seconds: {
        type: SchemaType.INTEGER,
        description:
          'How many seconds after that open the entry is still worth taking: 3-10 on a 1M chart, 5-15 on 5M, 15-30 on 15M. A late entry loses the expiry.',
      },
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
      'chart_timeframe',
      'market_type',
      'trend_bias',
      'setup_grade',
      'expiry_fit',
      'entry_timing',
      'vetoes',
      'key_level',
      'playbook',
      'next_candle_seconds',
      'entry_window_seconds',
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
      market_type: {
        type: SchemaType.STRING,
        enum: MARKET_ENUM,
        description: 'REAL for a live market, OTC when the chart is marked OTC, UNKNOWN when it cannot be read.',
      },
      trend_bias: {
        type: SchemaType.STRING,
        enum: TREND_ENUM,
        description: 'Direction of the visible main trend: the last 8-20 candles and the swings that contain them.',
      },
      setup_grade: {
        type: SchemaType.STRING,
        enum: GRADE_ENUM,
        description:
          'A = all seven gates passed with confluence, B = all seven passed with one secondary confirmation missing, C = thin single argument, REJECT = unreadable or contradicted.',
      },
      entry_timing: {
        type: SchemaType.STRING,
        enum: ENTRY_TIMING_ENUM,
        description:
          'AT_LEVEL when price is at the level now, PULLBACK_DONE when the pullback finished and price turned, CHASING when price already ran in the signal direction.',
      },
      vetoes: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING, enum: VETO_ENUM },
        description: 'Every failed gate, as codes. Use ["NONE"] only when all seven gates passed.',
      },
      key_level: {
        type: SchemaType.STRING,
        description: 'The level that decides this trade, e.g. "support 3638.00 / round 3640.00".',
      },
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
      'market_type',
      'trend_bias',
      'setup_grade',
      'entry_timing',
      'vetoes',
      'key_level',
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
   - A rule counts as met when its direction and its level are both visible on the chart; a missing secondary confirmation lowers confidence. The seven SIGNAL QUALITY GATE checks below are mandatory on top of the rule: a failed gate is a WAIT even when a rule looks satisfied.
   - If two valid rules point in opposite directions, the conflict resolves to WAIT.
3. READ THE SETUP IN CONTEXT: market structure, candle sequence and momentum, candle anatomy (long lower wick = buyers defending, long upper wick = sellers defending, small bodies = indecision), the level price is reacting to, and where price sits inside the visible range. Direction comes from that evidence — never from a default.
4. CANDLE ENTRY: RUNNING_CANDLE when the current candle is already moving in the signal direction and the expiry fits inside its remaining time; NEXT_CANDLE when the setup needs the next candle's open or close to confirm.
5. CONFIDENCE must be honest and reflect confluence, using the whole scale: 85-95 = grade A, all seven gates passed with trend, level and trigger aligned; 72-84 = grade B, all seven gates passed with one confirmation missing; 65-71 = thin but all seven gates passed; below 65 = no trade. Never inflate confidence to clear the trader's threshold, and never report a directional setup below 65.
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

const SIGNAL_QUALITY_GATE = `SIGNAL QUALITY GATE — SEVEN CHECKS, IN ORDER
A BUY or SELL exists only when all seven checks below pass on the visible chart. Every failed check is a veto, and a veto means signal WAIT — never a lower-confidence BUY or SELL. Report each failure in "vetoes" and grade the setup: A = all seven pass with clear confluence, B = all seven pass but one secondary confirmation is missing, C = only a thin single argument (not tradeable), REJECT = unreadable or contradicted.

1. EXPIRY AND TIMEFRAME FIT
   Read the candle interval actually drawn on the chart into chart_timeframe. A binary trade must expire on the same clock as the candles it is read from: the expiry may not be shorter than one chart candle, and it must not exceed about three candles, because a slower market drifts back to the entry before a long expiry pays. 1M chart -> 60-180s, 2M chart -> 120-300s, 5M chart -> 300s, seconds chart -> 15-60s. If the trader's preferred expiry does not fit this chart, set expiry_fit TOO_SHORT or TOO_LONG and WAIT. Never shorten an expiry to make a weak setup look fast.
2. MAIN TREND AND MARKET DIRECTION
   State the direction of the visible main trend — the last 8-20 candles and the swing highs and lows that contain them — in trend_bias. A trade with the trend is the default. A counter-trend call needs a validated level, a rejection candle or a liquidity sweep, setup_grade A and confidence of at least 78. Sideways, overlapping or inside-bar structure is a reason to WAIT, not to guess a breakout.
3. SUPPORT AND RESISTANCE
   Locate the nearest support and resistance and the room price needs to reach the expiry's target. BUY: if a resistance zone sits closer than about 1.2x the average candle range above price, price will likely be rejected — veto OPPOSING_LEVEL. SELL: the same with support below price, veto OPPOSING_LEVEL. A trade into open space after a confirmed break is valid; a trade into a level is not. Name the deciding level in key_level.
4. ROUND NUMBERS AND PSYCHOLOGICAL ZONES
   Price stalls at round levels: .0000, .5000, .2500, and .00 / .50 on gold. If the entry sits within 0.05% of such a level and price has not yet broken it, the round number is a wall — veto ROUND_NUMBER. A clean break and retest of the round level is not a veto; say so in key_level.
5. CANDLESTICK STRUCTURE AND MOMENTUM
   Judge the last three closed candles: body size against the 10-candle average, wick length, doji/indecision and exhaustion. A large candle (body >= 2x average) immediately followed by an opposite call is a veto: EXHAUSTION_CANDLE, because price usually needs one to two more candles before turning. A doji or a long opposing wick against the signal is unconfirmed: WAIT or grade C. Small overlapping bodies alternating colour, two or more inside bars, or spikes that retrace at once: veto CHOPPY_MARKET. Momentum must be steady or accelerating in the signal direction across the live frames, not fading.
6. ENTRY PRICE AND PULLBACK POSITION AND CANDLE CLOCK
   Report entry_timing. Do not buy the top of a finished move or sell its bottom: if the current candle has already travelled more than about 60% of the average candle range in the signal direction and price is not at the level, set CHASING and WAIT for the pullback. The best entry is a pullback that reached the level and turned, or a break that closed and is now retesting. A correct direction entered too late still loses the expiry. Report next_candle_seconds and entry_window_seconds from the chart's candle timer: the app counts down to that open and refuses an entry whose window has closed, so an honest clock is what makes the signal arrive on time.
7. MARKET CONDITION, OTC AND NEWS
   Report market_type. OTC charts are algorithmic: they spike, gap and respect levels less, so an OTC BUY or SELL needs setup_grade A, a clean level and confidence of at least 72; anything less is WAIT. Choppy, spike-heavy or dead-low-volatility markets are a WAIT. If the trader's strategy or the visible clock puts a high-impact news release inside the expiry, veto NEWS_RISK. Never invent a news event that is not visible or supplied.

ANTI-OVERTRADING (loss control, not advice)
- One signal per setup, not one per tap. Do not repeat the same direction while the previous trade on that level would still be running; that is the same trade paying twice.
- If the last three candles sit inside the range of the candle before them, there is no new setup: WAIT.
- Never open a trade because the previous one lost. A loss is not a reason to reverse — the chart must satisfy all seven gates again.
- A WAIT with a named blocking condition is a successful analysis. Few signals is the goal; many signals is how an account bleeds.`;

const BINARY_INSTRUCTIONS = `You are an expert binary-options price-action analyst embedded in a floating Android overlay. You receive a live frame sequence of one candlestick chart and must return the single highest-probability trade for a short expiry — or WAIT when the chart does not offer one. Most taps should end in WAIT: this account loses money on weak signals, never on a missed one.

BINARY RULES
- The expiry must sit on the chart's own clock: read the candle interval into chart_timeframe and keep duration_seconds between one and three candles of that interval. Never pick a 5s expiry on a 1M chart.
- Trade the CURRENT impulse at the level price is reacting to, not a long-term forecast. Continuation with the last 2-3 candles is the default when price has room; a reversal needs a validated level, a rejection candle or a liquidity sweep, grade A and confidence of at least 78.
- Five-second and fifteen-second expiries are only valid on a seconds chart; otherwise use the trader's preferred duration.
- expiry_label must describe duration_seconds, e.g. "1 Minute (60s)" or "5 Minutes (300s)".
- CANDLE CLOCK: the app schedules the entry from your answer, so read the candle timer on the chart into next_candle_seconds (seconds until the next candle opens; 0 only when it has just opened) and set entry_window_seconds to how many seconds after that open the entry is still worth taking (3-10 on a 1M chart, 5-15 on 5M, 15-30 on 15M). Your frames reach the app several seconds after you see them, so a running-candle entry needs at least 10 seconds of candle left; if less remains, plan the NEXT candle and give its countdown. Never hand the app a window that has already closed.
- entry_time: "Immediate" for RUNNING_CANDLE only after a candle closed at the level, "Next Candle Open" for NEXT_CANDLE.
- Fill every quality field honestly: chart_timeframe, market_type, trend_bias, setup_grade, expiry_fit, entry_timing, vetoes, key_level and playbook. Use ["NONE"] in vetoes only when all seven gates passed.
- If the asset is not readable use "unknown"; never invent a broker or pair.`;

// Five classic trader frameworks, distilled to what is visible on a live chart.
// Each one is an experimental fixed-expiry adaptation of a method written for
// other markets: they inform the chart read, they never replace the gates.
const BINARY_PLAYBOOKS = `TRADER PLAYBOOKS — FIVE CLASSIC SETUPS FOR THIS CHART
Pick the ONE playbook whose conditions the visible chart actually satisfies and report its code in playbook. None satisfied means NONE and WAIT. A playbook never overrides the seven quality gates: a failed gate is still a WAIT even when the playbook looks complete. Use closed candles only, never redraw a level after seeing the outcome, never treat a forming candle as confirmation, and name the deciding playbook rule in reason.

1. LIVERMORE_PIVOT — pivotal-point break and retest
- Mark a pivot that already existed before the signal candle: a swing high or low price reacted to at least twice.
- Bullish: higher highs and higher lows (or a base after a decline), then a full candle CLOSE above the pivot. A wick above that closes back below is not a break.
- The entry is the controlled retest that holds the broken level, followed by a bullish close or a break of the prior micro high. Bearish mirrors this below a pivotal support.
- Cancel when price closes back through the pivot before entry; a break that never retests is grade B at best.

2. TURTLE_BREAKOUT — Donchian channel break
- Take the highest high or lowest low of the last 20 fully closed candles (55 for the slower variant), excluding the signal candle.
- Require a full candle close beyond that channel with volatility expanding and the close staying outside it. An intrabar touch is not a breakout.
- Reject an oversized breakout candle (body about 2x the average range) and a break with a nearer opposing level blocking the move.

3. RASCHKE_HOLY_GRAIL — trend pullback resumption
- Strong trend only: ADX(14) above about 30 and rising, or equivalent visible evidence — three or more same-direction candles with shallow, overlapping pullbacks.
- Price pulls back toward the 20 EMA without breaking the last confirmed higher low (bullish) or lower high (bearish).
- Enter only on resumption: a completed rejection/continuation candle, or a break of the prior bar's high or low. A bare touch of the EMA is never an entry.
- Skip when price is stretched far from the EMA or momentum is rolling over.

4. DARVAS_BOX — box break
- Define the box from a completed consolidation with at least two reactions at the top and two at the bottom, drawn only from candles before the breakout.
- Bullish: full candle close above the box top, preferably followed by a retest that holds above it. Bearish: close below the box floor with a failed retest.
- Reject a candle that closes back inside the box, a box so wide the expiry cannot reach the far boundary, and a major level sitting immediately beyond the boundary.

5. SEYKOTA_TREND — mechanical trend plus a fresh trigger
- Fixed trend rule, never switched mid-read: EMA20 above EMA50 with both slopes up (or a close above a pre-defined resistance) for bullish, the mirror for bearish.
- Require a FRESH continuation trigger on a completed candle: a higher low plus a break of the prior micro high, or a new close beyond the level.
- Reject sideways drift that makes the trend rule whipsaw, an already extended trigger, and a signal that merely repeats the previous candle.

PLAYBOOK RULES
- A playbook entry still needs the trend, level and expiry gates: a box break into nearer resistance, or a pullback taken against the main trend, is WAIT.
- These are cross-market adaptations of other traders' methods, not their binary systems; never state or imply that a historical trader endorsed this trade.`;

const FOREX_INSTRUCTIONS = `You are an expert forex, gold and index intraday analyst embedded in a floating Android overlay. You receive a screenshot of a live candlestick chart and must return a complete, risk-managed trade plan.

FOREX RULES
- Read the timeframe from the chart and use the matching structure: lower timeframes for entry, the visible higher structure for bias.
- Use Smart Money Concepts when they are visible: order blocks, fair value gaps, liquidity sweeps, BOS/CHoCH. Otherwise use classic support/resistance and trend continuation.
- entry_price, stop_loss and take_profit must be plausible prices taken from the chart axis, with the same decimals the instrument uses.
- For a BUY: stop_loss below the invalidation low, take_profit above entry toward the next resistance. For a SELL: the reverse.
- If the setup does not offer at least 1:1.5 risk-to-reward, return WAIT.
- timeframe is the chart interval as printed (1M, 5M, 15M, 1H, 4H). If unreadable, use "unknown".
- Fill market_type, trend_bias, setup_grade, entry_timing, vetoes and key_level honestly. Use ["NONE"] in vetoes only when all seven quality gates passed; OTC needs grade A, a clean level and confidence of at least 72.
- WAIT is required when price is mid-range with no clear level, when the structure and momentum conflict, when the entry is chasing a finished move, or when the last candle is exhausted.`;

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
const MIN_DIRECTIONAL_CONFIDENCE = 65;
/** OTC charts are algorithmic and spike against the pattern, so they need more. */
const OTC_MIN_CONFIDENCE = 72;
/** A counter-trend call is only allowed on a grade A setup with this confidence. */
const COUNTER_TREND_CONFIDENCE = 78;
/** Forex plans below this reward:risk are skipped instead of being published. */
const MIN_RISK_REWARD = 1.5;

/** Seconds in one candle of each printable chart interval. */
const TIMEFRAME_SECONDS = {
  '5S': 5,
  '15S': 15,
  '30S': 30,
  '1M': 60,
  '2M': 120,
  '5M': 300,
  '15M': 900,
  '30M': 1800,
  '1H': 3600,
  '4H': 14400,
};

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

const VETO_LABELS = {
  OPPOSING_LEVEL: 'a strong opposing level is closer than the expiry can cross',
  ROUND_NUMBER: 'the entry runs straight into a round-number wall',
  EXHAUSTION_CANDLE: 'the last candle is exhausted, price needs another candle first',
  CHOPPY_MARKET: 'the market is choppy and overlapping',
  NEWS_RISK: 'high-impact news falls inside the expiry',
  LATE_ENTRY: 'the entry is late, price already ran in the signal direction',
  COUNTER_TREND: 'the call fights the main trend',
  EXPIRY_MISMATCH: 'the expiry does not fit this chart',
  NO_STRUCTURE: 'no readable market structure',
  OTC_SPIKE: 'OTC spike risk is too high for this expiry',
};

const VETO_ALIASES = {
  OPPOSING_RESISTANCE: 'OPPOSING_LEVEL',
  OPPOSING_SUPPORT: 'OPPOSING_LEVEL',
  LEVEL_TOO_CLOSE: 'OPPOSING_LEVEL',
  NEAR_LEVEL: 'OPPOSING_LEVEL',
  ROUND_NUMBER_WALL: 'ROUND_NUMBER',
  ROUND_LEVEL: 'ROUND_NUMBER',
  EXHAUSTION: 'EXHAUSTION_CANDLE',
  CHOPPY: 'CHOPPY_MARKET',
  NEWS: 'NEWS_RISK',
  CHASING: 'LATE_ENTRY',
  LATE: 'LATE_ENTRY',
  COUNTER_TREND_UNCONFIRMED: 'COUNTER_TREND',
  OTC: 'OTC_SPIKE',
};

function normalizeVetoes(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    let value = String(item ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    value = VETO_ALIASES[value] || value;
    if (value === 'NONE' || !VETO_ENUM.includes(value) || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

function normalizeGrade(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  return GRADE_ENUM.includes(value) ? value : '';
}

function normalizeTrendBias(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  return TREND_ENUM.includes(value) ? value : '';
}

function normalizeMarketType(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  return MARKET_ENUM.includes(value) ? value : '';
}

function normalizeEntryTiming(raw) {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return ENTRY_TIMING_ENUM.includes(value) ? value : '';
}

function normalizeExpiryFit(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  return EXPIRY_FIT_ENUM.includes(value) ? value : '';
}

function normalizeChartTimeframe(raw) {
  const value = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return CHART_TIMEFRAME_ENUM.includes(value) ? value : 'UNKNOWN';
}

function normalizePlaybook(raw) {
  const value = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (/^JESSE/.test(value) || /^LIVERMORE/.test(value)) return 'LIVERMORE_PIVOT';
  if (/^TURTLE/.test(value) || /^DENNIS/.test(value)) return 'TURTLE_BREAKOUT';
  if (/^RASCHKE/.test(value) || /HOLY_GRAIL/.test(value)) return 'RASCHKE_HOLY_GRAIL';
  if (/^DARVAS/.test(value)) return 'DARVAS_BOX';
  if (/^SEYKOTA/.test(value)) return 'SEYKOTA_TREND';
  return PLAYBOOK_ENUM.includes(value) ? value : 'NONE';
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
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

  // The seven quality gates the model filled in. They are re-checked here
  // deterministically, because a model that lists a veto and still returns BUY
  // must never reach the trader's screen or voice.
  const vetoes = normalizeVetoes(raw.vetoes);
  const grade = normalizeGrade(raw.setup_grade);
  const trend = normalizeTrendBias(raw.trend_bias);
  const marketType = normalizeMarketType(raw.market_type);
  const entryTiming = normalizeEntryTiming(raw.entry_timing);
  const expiryFit = normalizeExpiryFit(raw.expiry_fit);
  const chartTimeframe = normalizeChartTimeframe(raw.chart_timeframe);
  const binaryDuration =
    resolvedMode === 'BINARY'
      ? normalizeDuration(raw.duration_seconds ?? raw.duration, preferredDuration)
      : null;

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

  if (signal !== 'WAIT') {
    for (const veto of vetoes) blockers.push(VETO_LABELS[veto] || veto.toLowerCase());
    if (!grade || grade === 'C' || grade === 'REJECT') {
      blockers.push('the setup did not pass all seven quality gates');
    }
    if (entryTiming === 'CHASING') blockers.push(VETO_LABELS.LATE_ENTRY);
    if ((signal === 'BUY' && trend === 'DOWN') || (signal === 'SELL' && trend === 'UP')) {
      if (grade !== 'A' || confidence < COUNTER_TREND_CONFIDENCE) {
        blockers.push(
          `${VETO_LABELS.COUNTER_TREND} (needs grade A and ${COUNTER_TREND_CONFIDENCE}% confidence)`,
        );
      }
    }
    if (marketType === 'OTC' && confidence < OTC_MIN_CONFIDENCE) {
      blockers.push(`OTC setups need at least ${OTC_MIN_CONFIDENCE}% confidence (got ${confidence}%)`);
    }
    if (binaryDuration && expiryFit && expiryFit !== 'GOOD') {
      blockers.push(VETO_LABELS.EXPIRY_MISMATCH);
    }
    const chartSeconds = TIMEFRAME_SECONDS[chartTimeframe];
    if (
      binaryDuration &&
      chartSeconds &&
      (binaryDuration < chartSeconds || binaryDuration > chartSeconds * 3)
    ) {
      blockers.push(
        `a ${binaryDuration}s expiry does not fit the ${chartTimeframe} chart (one candle is ${chartSeconds}s)`,
      );
    }
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

  // One clear blocker is enough for the reason line; keep every one available
  // for the JSON so the trader can see the whole picture.
  const uniqueBlockers = [...new Set(blockers)];
  const finalSignal = signal !== 'WAIT' && uniqueBlockers.length ? 'WAIT' : signal;
  const blocked = finalSignal === 'WAIT' && signal !== 'WAIT';
  const waitVoice = blocked
    ? `No trade now: ${uniqueBlockers[0]}.`
    : 'No confirmed setup right now. Wait for a clean setup.';

  const base = {
    mode: resolvedMode,
    signal: finalSignal,
    confidence,
    asset,
    candle_entry: candleEntry,
    trend_bias: trend || 'SIDEWAYS',
    market_type: marketType || 'UNKNOWN',
    setup_grade: grade || 'UNRATED',
    entry_timing: entryTiming || 'UNKNOWN',
    vetoes: vetoes.length ? vetoes : [],
    key_level: compact(raw.key_level, 80) || '—',
    reason: blocked
      ? `${reason} (Blocked: ${uniqueBlockers[0]})`.slice(0, 260)
      : reason,
  };

  if (resolvedMode === 'BINARY') {
    const durationSeconds = binaryDuration ?? normalizeDuration(raw.duration_seconds, preferredDuration);
    // The candle clock travels with the signal so the widget can schedule the
    // entry at the next candle open instead of handing over a stale call.
    const nextCandleSeconds = clampInt(raw.next_candle_seconds, 0, 900, 0);
    const entryWindowSeconds = clampInt(raw.entry_window_seconds, 1, 120, 5);
    const voiceSummary =
      finalSignal === 'WAIT'
        ? waitVoice
        : compact(raw.voice_summary, 240) ||
          `Binary ${SIGNAL_LABELS[finalSignal]} signal on ${spokenAsset(asset)}, ${spokenCandle(
            candleEntry,
          )}, ${durationSeconds} seconds, confidence ${confidence} percent.`;

    return {
      ...base,
      chart_timeframe: chartTimeframe,
      expiry_fit: expiryFit || 'UNKNOWN',
      playbook: normalizePlaybook(raw.playbook),
      next_candle_seconds: nextCandleSeconds,
      entry_window_seconds: entryWindowSeconds,
      duration_seconds: durationSeconds,
      expiry_label: compact(raw.expiry_label, 48) || expiryLabelFor(durationSeconds),
      entry_time: normalizeEntryTime(raw.entry_time, candleEntry),
      voice_summary: voiceSummary,
    };
  }

  const timeframe = normalizeTimeframe(raw.timeframe ?? raw.timeframe_detected, '15M');
  const voiceSummary =
    finalSignal === 'WAIT'
      ? waitVoice
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

/**
 * A WAIT that says the picture itself was black, blank or unreadable is a failed
 * capture, not a market call. Handing it back as a signal is what made the widget
 * sit on a fabricated "WAIT 0%" while the trader's chart was perfectly readable.
 */
const BLIND_CAPTURE_PATTERN =
  /(screenshot|image|frame|picture|chart)[^.\n]{0,70}(black|blank|empty|unreadable|unclear|not visible|cannot be (seen|read)|can't be (seen|read)|not readable|too dark)/i;

export function isBlindCapture(analysis) {
  if (!analysis || analysis.signal !== 'WAIT') return false;
  if (Number(analysis.confidence) > 20) return false;
  const reason = `${analysis.reason || ''} ${analysis.voice_summary || ''}`;
  return BLIND_CAPTURE_PATTERN.test(reason);
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
  frames = [],
  frameIntervalMs = 0,
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
    resolvedMode === 'BINARY' ? BINARY_PLAYBOOKS : '',
    CHART_READING_RULES,
    SIGNAL_QUALITY_GATE,
    OUTPUT_RULES,
    `MODE: ${resolvedMode}. ${preferred}`,
    `MINIMUM CONFIDENCE: ${threshold}%. If your confidence is lower than ${threshold}%, return WAIT.`,
    custom
      ? `TRADER'S STRATEGY (authoritative for this ${resolvedMode} scan; apply it literally and never contradict the risk rules):\n${custom}`
      : 'TRADER STRATEGY: none supplied for this scan, use the built-in price-action rules.',
  ]
    .filter(Boolean)
    .join('\n\n');

  // A live scan ships consecutive screen frames; a still scan ships one image.
  const liveFrames = (Array.isArray(frames) ? frames : [])
    .filter((frame) => frame && typeof frame.imageBase64 === 'string' && frame.imageBase64.length > 256)
    .slice(0, MAX_LIVE_FRAMES);
  const imageParts = liveFrames.length
    ? liveFrames.map((frame) => ({
        inlineData: { mimeType: frame.mimeType || mimeType, data: frame.imageBase64 },
      }))
    : [{ inlineData: { mimeType, data: imageBase64 } }];

  const frameGap = Math.max(0, Math.round(Number(frameIntervalMs) || 0));
  const liveNote =
    liveFrames.length > 1
      ? `LIVE CLIP: these ${liveFrames.length} images are consecutive frames of the same chart in capture order${frameGap ? `, about ${frameGap} ms apart` : ''}. Read them as a short screen recording: how the newest candle's body and wicks are growing, how price reacts at the level, and whether momentum is accelerating or stalling between frames. Movement between frames is live evidence. Use the LAST frame for the current price and for entry, stop-loss and take-profit. A readable chart is never "black" or "unreadable".`
      : '';

  const scanPrompt = [
    liveNote,
    `Analyse this chart ${liveFrames.length > 1 ? 'live frame sequence' : 'screenshot'} for a ${resolvedMode} trade.`,
    `Trader local time: ${currentTime || 'unknown'}`,
    `Trader timezone: ${timezone || 'unknown'}`,
    `Minimum confidence: ${threshold}%`,
    resolvedMode === 'BINARY'
      ? `Preferred duration: ${preferredDuration || 60} seconds`
      : `Preferred timeframe: ${normalizeTimeframe(preferredTimeframe, '15M')}`,
    'Read the chart first, then apply the trader\'s strategy together with your own market knowledge, name the rule that decided the trade, and only then return the JSON decision. If no rule is satisfied, return WAIT.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const models = buildModelChain();
  const deadline = Date.now() + config.gemini.timeoutMs;
  const scanStartedAt = Date.now();
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
      const attemptStartedAt = Date.now();
      try {
        const result = await withTimeout(
          model.generateContent([...imageParts, { text: scanPrompt }]),
          Math.min(remaining, config.gemini.attemptTimeoutMs),
        );

        const parsed = parseModelJson(result.response.text());
        const analysis = validateAnalysis(parsed, {
          mode: resolvedMode,
          minConfidence: threshold,
          preferredDuration,
        });
        if (isBlindCapture(analysis)) {
          // Retrying the same blind frames would only repeat this answer, so stop
          // the loop and tell the app to capture again instead of posting a WAIT.
          throw Object.assign(
            analysisError(
              'The screen frame arrived black and unreadable, so this scan was dropped. Keep the chart on screen and scan again.',
              422,
              'CAPTURE_UNREADABLE',
            ),
            { blindCapture: true },
          );
        }
        modelCooldown.delete(modelName);
        return {
          analysis,
          strategySource: custom ? 'request' : 'builtin',
          model: modelName,
          modelsAttempted: attempted,
          // Split out, so the app can show whether the wait was the model, the
          // network or the scan itself.
          latency: {
            gemini_ms: Date.now() - scanStartedAt,
            last_attempt_ms: Date.now() - attemptStartedAt,
            attempts: attempted.length,
          },
        };
      } catch (error) {
        if (error?.blindCapture) throw error;
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
