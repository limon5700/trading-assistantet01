/**
 * Built-in forex strategy library.
 *
 * Three topic playbooks plus the full trading manual (PDF_TEXT). Inserted into
 * MySQL once per category when missing; fully editable from the dashboard.
 */

export const FOREX_STRATEGIES = [
  {
    title: 'Forex Smart Money Concepts: BOS, CHoCH, Order Blocks & FVG',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
Price moves toward liquidity. Institutions accumulate where retail stops sit, displace price to create imbalance, then return to the imbalance to fill orders before continuing. Read the chart as a sequence of liquidity, displacement and mitigation, not as a set of indicators.

MARKET STRUCTURE
1. Swing high: a candle with lower highs on both sides. Swing low: a candle with higher lows on both sides. Use confirmed swings only (the candles around them must be closed).
2. Uptrend = higher highs and higher lows (HH/HL). Downtrend = lower highs and lower lows (LH/LL).
3. Break of Structure (BOS): a body close beyond the most recent swing high in an uptrend, or below the most recent swing low in a downtrend. BOS confirms continuation.
4. Change of Character (CHoCH): in an uptrend, a body close below the most recent higher low; in a downtrend, a body close above the most recent lower high. CHoCH warns that the trend character changed — it is a warning, not an entry by itself.

ORDER BLOCKS
The last opposing candle before an impulsive displacement is the order block. For a bullish order block: the last down candle before a strong bullish move that breaks structure. Mark its body and wick extremes; the highest-probability entry is the 50% of that candle plus the origin of the displacement. A zone that price has already traded through (mitigated) is invalid — do not reuse it.

FAIR VALUE GAPS / IMBALANCES
A three-candle sequence where candle 1's high does not overlap candle 3's low is a bullish FVG; candle 1's low not overlapping candle 3's high is a bearish FVG. The gap is an inefficiency price tends to revisit. The midpoint (consequent encroachment) is the refined entry. An FVG inside an order block is A+ confluence.

LIQUIDITY SWEEPS
Equal highs, equal lows, session extremes and obvious double tops/bottoms are liquidity pools. A wick through them that closes back inside is a sweep (stop run), not a breakout. The best entries come after a sweep in the opposite direction of the sweep.

THE A+ LONG SEQUENCE
1. Price sweeps sell-side liquidity below a range low or equal lows.
2. Bullish displacement breaks structure (BOS) and leaves a bullish FVG plus a demand order block.
3. Price retraces into the FVG / order block, ideally the 50% of the displacement leg.
4. A bullish confirmation candle closes inside or above the zone.
5. Entry at the confirmation close; stop below the sweep low or below the order block; target the opposing liquidity pool, then the next imbalance.

THE A+ SHORT SEQUENCE
Mirror: sweep above equal highs, bearish displacement with BOS, retrace into supply order block / FVG, bearish confirmation close, stop above the sweep high, target the sell-side liquidity below.

CHoCH TRADING RULES
1. CHoCH alone is not an entry.
2. Wait for the return to the zone that caused the break.
3. Enter on the first lower high (after a bullish CHoCH) or first higher low (after a bearish CHoCH), with the stop behind the zone.
4. If price immediately makes a new extreme in the old direction, the CHoCH failed — stand down.

CONFLUENCE AND FILTERS
- Align with the higher-timeframe bias: long only when H1/H4 structure is bullish.
- Session timing matters: London and New York breaks are more reliable than Asian-session breaks.
- A BOS with a large displacement body outranks a wick-only poke.
- Skip the setup when the retracement never reaches the zone and price runs without a pullback — chasing displacement has poor risk-to-reward.
- If structure and momentum conflict, return WAIT.`,
  },
  {
    title: 'Forex Supply, Demand & Fibonacci Retracement',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
Supply and demand zones are where unfilled institutional orders sit. Fibonacci levels are where traders cluster orders. Neither works alone; together, inside a clear impulse, they define the highest-probability pullback entries.

BUILDING HIGH-PROBABILITY ZONES
1. Origin of an impulse: the base of candles before a strong directional move that broke structure. A tight base (one to three small candles) that produced a large displacement is the strongest zone.
2. Freshness: a zone that has not been revisited since it formed is stronger than one already tested twice.
3. Departure strength: the bigger the displacement leaving the zone, the more orders were left behind.
4. Timeframe weight: H4/H1 zones outrank 15M zones. Trade the direction from the higher timeframe and the trigger from the lower one.

DEMAND ZONE ENTRY (LONG)
1. Price returns to a fresh demand zone with declining bearish momentum.
2. The zone overlaps the 0.5-0.618 Fibonacci retracement of the impulse (golden pocket) or the 0.786 for a deep pullback.
3. A bullish confirmation candle (engulfing, pin bar, or a small double bottom) closes inside or above the zone.
4. Entry at that close; stop below the zone low or below the 0.786, whichever is further; targets: 0.382 extension of the impulse, then the prior high, then 1.272-1.618 extensions.

SUPPLY ZONE ENTRY (SHORT)
Mirror: fresh supply zone plus the 0.5-0.618 pocket of a bearish impulse, bearish confirmation close, stop above the zone high, targets at the prior low and extensions.

FIBONACCI RULES
- Draw only inside a completed impulse from origin to termination.
- 0.382 is a shallow pullback typical of strong trends; 0.5-0.618 is the golden pocket; 0.786 is the last defense.
- A retracement beyond 0.786 usually means the impulse failed — do not force the continuation.
- A shallow 0.236-0.382 pullback that resumes with momentum is a continuation signal, not a reversal.
- Use H1/H4 Fibonacci for bias and 5M/15M for the entry trigger. When timeframes disagree, the higher timeframe wins.

MULTI-TIMEFRAME TOP-DOWN WORKFLOW
1. Daily/H4: mark the major supply and demand zones and the current structure.
2. H1: identify the active zone, the last order block and the nearest liquidity.
3. 15M: wait for BOS or CHoCH in the higher-timeframe direction.
4. 5M/1M: execute on the retest with a candlestick trigger.

RISK-TO-REWARD MATHS
Measure entry to stop (risk) and entry to first target (reward). Take the trade only at 1:2 or better; 1:1.5 is the absolute floor. If the nearest opposing zone is closer than 2x the stop distance, the trade does not qualify — return WAIT.

INVALIDATION AND FILTERS
- Price closing through the zone with a full body invalidates it; wick-only penetration is a sweep, not an invalidation.
- Avoid Fibonacci entries during low-liquidity hours (late Asia, Friday close) when spreads widen and levels are unreliable.
- Skip high-impact news minutes; a news candle can gap through entry, stop and target.
- If price is already mid-range with no fresh zone, there is no trade.`,
  },
  {
    title: 'Forex Trade Execution & Risk Management',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
A signal is only half a trade. Executable entry, structural stop loss, realistic take profit, position size and a hard daily limit turn an idea into a plan. Every BUY or SELL must ship with all of them, in real prices read from the chart axis, and every other situation is WAIT.

EXECUTION CONTRACT FOR EVERY SIGNAL
- signal: BUY, SELL or WAIT.
- candle_entry: RUNNING_CANDLE when the current candle is already moving with momentum and the entry is immediate; NEXT_CANDLE when the entry needs the next candle's open or confirmation close.
- entry_price: a price visible on the axis, at the current market or at the zone being retested.
- stop_loss: beyond the structural invalidation (sweep low, order block, zone edge), plus a spread buffer of 1-3 pips on FX or the instrument's typical spread.
- take_profit: at the nearest opposing liquidity or structure for TP1; never inside the immediate noise.
- Risk-to-reward is computed from those numbers and must be at least 1:2, with 1:1.5 the absolute floor. If not, WAIT.
- Timeframe must be the one printed on the chart (1M, 5M, 15M, 1H, 4H), not an assumption.

STOP LOSS RULES
1. Stops go where the idea is wrong, not at a fixed pip distance.
2. Never widen a stop to avoid a loss. Never trade without one.
3. Place the stop beyond the wick that invalidates the setup, not at the exact wick (stop hunts target the exact level).
4. After price reaches 1R, move the stop to break-even. After TP1, trail behind the last swing.

POSITION SIZING
Risk a fixed 0.5-1% of equity per trade.
Lot size = (equity x risk%) / (stop distance in pips x pip value per lot).
Example: 10,000 USD equity, 1% risk = 100 USD. Stop 25 pips, pip value 10 USD per standard lot: lot size = 100 / (25 x 10) = 0.4 lots.
Never increase size after a loss. Never hold more than two correlated positions (EUR/USD and GBP/USD count as one).

TRADE MANAGEMENT
- Move to break-even at 1R; take 50% at TP1 for intraday setups; trail the remainder behind the last higher low / lower high.
- If price stalls at a level for more than three candles without progress, reduce or exit.
- Do not hold through high-impact news unless the stop is already at break-even.
- Close the trade if the reason for entry disappears (structure breaks against the position).

DAILY AND WEEKLY LIMITS
- Maximum daily loss: 3% of equity. Stop for the day when hit.
- Maximum consecutive losses: two. After two, stop and review.
- Maximum trades per day: five. Quality over quantity.
- Weekly loss limit: 6%. A losing week is information, not a reason to double size.

EXECUTION DISCIPLINE
- Enter at the plan price. If price has already moved past the entry by more than 20% of the stop distance, the trade is gone — do not chase.
- Set stop and target at the same time as the entry order.
- Use limit orders at the zone rather than market orders into a spike.
- Keep a screenshot of every entry.

WHEN TO RETURN WAIT
- No structural stop level is visible.
- The nearest target is closer than 2x the stop.
- Price is mid-range between two zones.
- The higher-timeframe bias contradicts the setup.
- Spread is abnormal (news, rollover, session close).
- The chart is unreadable or the timeframe is ambiguous.

JOURNALING
Log date, pair, session, timeframe, setup, confluence score, entry, stop, target, risk %, outcome in R, and one lesson. Review weekly, remove negative-expectancy setups, and keep the ones that pay.`,
  },
  {
    title: 'Forex Complete Trading Manual (Full Manual Text)',
    sourceType: 'PDF_TEXT',
    content: `FOREX COMPLETE TRADING MANUAL
Section 1 — The framework
Every forex decision in this system follows the same order: higher-timeframe bias, liquidity and structure, zone, trigger, execution, risk. Skipping a step is how traders end up buying into supply or selling into demand. Analysis is top-down; execution is bottom-up. The higher timeframe decides direction, the lower timeframe decides timing, and risk management decides whether the trade exists at all.

Section 2 — Market structure
Uptrend: higher highs and higher lows. Downtrend: lower highs and lower lows. Range: equal highs and equal lows with overlapping candles. A Break of Structure (BOS) is a body close beyond the last swing in the trend direction and confirms continuation. A Change of Character (CHoCH) is a body close through the last counter-trend swing and warns of reversal. Trade the first pullback after a BOS with the trend; treat a CHoCH as a warning and wait for the retest of the zone that caused it before entering.

Section 3 — Smart money concepts
Liquidity pools sit above equal highs, below equal lows, at session extremes and at obvious round numbers. A wick through a pool that closes back inside is a sweep, and the highest-probability entries come after a sweep in the opposite direction. An order block is the last opposing candle before a displacement that breaks structure; mark its body and the 50% level. A fair value gap is a three-candle imbalance where candle 1 and candle 3 do not overlap; price tends to return to its midpoint. The A+ setup is sweep, displacement with BOS, retrace into the order block or FVG, confirmation close, entry with the stop beyond the sweep.

Section 4 — Supply and demand with Fibonacci
Fresh zones that produced a strong displacement outrank tested zones. Combine a fresh H1/H4 zone with the 0.5-0.618 retracement of the impulse (the golden pocket) and the 0.786 as the last defense. A retracement beyond 0.786 usually means the impulse failed. Enter on a confirmation candle inside the zone, stop beyond the zone, first target the nearest opposing liquidity, then the 0.382 and 1.272-1.618 extensions. Require 1:2 risk-to-reward, 1:1.5 as the floor.

Section 5 — Multi-timeframe workflow
Daily: overall direction, major zones, upcoming news. H4: current structure and the active order block. H1: the zone price is approaching and the liquidity it is targeting. 15M: BOS or CHoCH in the HTF direction. 5M/1M: the trigger candle and the exact entry. If the timeframes disagree, the higher timeframe wins and the trade is skipped until they align.

Section 6 — Execution contract
Every signal must include signal (BUY/SELL/WAIT), candle entry (RUNNING_CANDLE or NEXT_CANDLE), timeframe read from the chart, entry price, stop loss beyond the structural invalidation plus spread, and take profit at the next structural target. All prices must be readable on the chart axis. If any of those cannot be produced honestly, the signal is WAIT. Do not invent a stop loss, do not set a target inside the immediate noise, and do not use a risk-to-reward below 1:1.5.

Section 7 — Risk management
Risk 0.5-1% of equity per trade. Size from the stop distance: lot size = (equity x risk%) / (stop pips x pip value). Never widen a stop. Move to break-even at 1R. Two correlated positions count as one. Daily loss limit 3%, weekly 6%, maximum two consecutive losses, maximum five trades per day. No martingale, no averaging into losers, no revenge trades.

Section 8 — Sessions and news
London (07:00-10:00 UTC) and New York (12:00-15:00 UTC) produce the cleanest displacement; the overlap is the best window. Asian session tends to range, so favor level reversals with tighter targets. Avoid opening positions in the five minutes before and after high-impact releases (central bank decisions, CPI, NFP) unless the trade is already at break-even. Rollover and Friday close have wide spreads and unreliable levels.

Section 9 — Trade management
Take 50% at TP1 for intraday setups, move the stop to break-even at 1R, trail the remainder behind the last swing. Exit if structure invalidates the idea even before the stop is hit. Do not move a target further away to avoid taking a smaller win. Do not convert an intraday trade into a swing trade without a new higher-timeframe analysis.

Section 10 — Journal and review
Log every trade: date, pair, session, timeframe, setup name, confluence score, entry, stop, target, risk percent, result in R, screenshot, and one sentence about execution quality. Weekly, group by setup and session; keep positive-expectancy setups, remove the rest. Monthly, review the equity curve and drawdown. The journal is the only reliable feedback loop.

Section 11 — No-trade conditions
Mid-range price with no fresh zone. Structure and momentum in conflict. No structural stop visible. Nearest target closer than 2x the stop. Higher timeframe against the setup. Abnormal spread or news window. Unreadable chart or unknown timeframe. After two consecutive losses or the daily loss limit. In all of these the correct output is WAIT — capital preservation is the edge that keeps a trader in the game long enough for the A+ setups to appear.`,
  },
];
