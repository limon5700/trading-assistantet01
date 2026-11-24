/**
 * Built-in binary-options strategy library.
 *
 * Four topic playbooks plus one full manual (stored as PDF_TEXT, i.e. manual
 * text that is normally shipped as a PDF). Inserted into MySQL once per
 * category when missing; admins can edit, deactivate or delete any entry.
 */

export const BINARY_STRATEGIES = [
  {
    title: 'Binary Candlestick Price Action & Rejection Psychology',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
Every candle is the record of a fight between buyers and sellers. The body is conviction, the wick is rejection. Read the last three to five candles before anything else: colour, close location, body size relative to the recent average, and wick length on each side.

CANDLE ANATOMY NUMBERS
- Body ratio = body / total range. Above 0.7 is a momentum (Marubozu-type) candle: one side dominated from open to close. Below 0.25 is a doji/spinning top: no decision, no trade.
- Lower wick ratio = lower wick / total range. Above 0.5 with a small body in the top third is a hammer/pin bar: sellers pushed price down and were absorbed.
- Upper wick ratio above 0.5 with a small body in the bottom third is a shooting star/pin bar: buyers were trapped.
- A rejection wick only matters AT a level. The same candle in the middle of a range is noise.

THE FIVE HIGH-PROBABILITY PATTERNS
1. Bullish engulfing at support: previous candle bearish, current candle opens at or below the previous close and closes above the previous open, body at least 1.3x the previous body, close in the upper half of its own range. Entry on the close of the engulfing candle, BUY.
2. Bearish engulfing at resistance: mirror image, SELL.
3. Hammer at demand: lower wick at least 2x the body, body in the top third, formed after a sweep of a prior low. BUY on the close, never on the wick.
4. Shooting star at supply: upper wick at least 2x the body, body in the bottom third, after a sweep of a prior high. SELL on the close.
5. Two-candle rejection cluster: two or more consecutive candles leaving wicks at the same price. The side that keeps getting rejected is losing; trade away from the wicks.

MOMENTUM CANDLES
A Marubozu with body ratio above 0.8 and a body larger than the last five candles' average means real displacement. Trade continuation with it while it is not yet at an opposing level; do not fade the first Marubozu into a level. The third or fourth consecutive large candle in the same direction is late — that is where retracements begin.

CHOP AND DOJI FILTER
Return WAIT when any of these is true: the last three candles alternate colour; three or more bodies are smaller than 40% of the 20-candle average body; the last two candles have body ratios under 0.3; price is inside a range narrower than 1.5x the average candle range. Binary expiries punish chop far more than a missed trade.

CONFIRMATION CHECKLIST
- Pattern at a level (support, resistance, round number, session high/low).
- Candle closed before entry; no anticipation of a forming candle.
- The trigger candle's body is larger than the candle it engulfs or rejects.
- Momentum in the trade direction, or a clear exhaustion signature against it.

INVALIDATION
A body close back through the level that produced the signal, or two consecutive closes beyond it, kills the idea. If the next candle gaps against the signal, return WAIT instead of averaging into a losing trade.`,
  },
  {
    title: 'Binary Support, Resistance & Trendline Confluence',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
Support and resistance are zones, not lines. A zone gains strength from touches, the quality of each rejection, and the time between touches. Trade the reaction at a validated zone or the confirmed break of it — never the middle of the range.

MARKING ZONES CORRECTLY
1. Use the visible window (30-60 candles). A zone needs at least two wicks stopping within a few pips of each other.
2. Prefer zones that produced the largest displacement away from them; those hold the most orders.
3. Round psychological levels matter: .000, .500 and .050 on FX pairs, whole numbers on indices and crypto. Brokers cluster stops there, so expect either a sharp rejection or a liquidity sweep first.
4. The session high and session low are always levels, even on a 1-minute chart.

REVERSAL PLAYBOOK
1. Price arrives at the zone with declining momentum: smaller bodies, longer wicks into the zone.
2. A rejection candle closes back inside the prior range.
3. Enter in the bounce direction on that close; expiry 60-180 seconds on a 1M chart.
4. Confidence is highest when the zone aligns with a round number and a moving average.

BREAKOUT PLAYBOOK
1. A breakout requires a candle BODY close beyond the zone, not a wick poke.
2. Skip the first spike. Wait for the retest of the broken zone.
3. A retest that wicks into the zone and closes back out is the best continuation entry, expiry 60-120 seconds.
4. A failed retest — price closes back inside the old range — is a false breakout: flip bias or stand aside.

FALSE BREAKOUTS AND LIQUIDITY SWEEPS
A wick through the level that closes back inside is a sweep, not a break. Sweeps typically happen in the first minutes of a session or right at a round number. After a sweep of a low, the highest-probability binary trade is a BUY on the first bullish close back above the level. After a sweep of a high, SELL on the first bearish close back below it. Do not enter during the sweep itself.

DYNAMIC TRENDLINES
Draw a trendline through two higher lows (uptrend) or two lower highs (downtrend) and require a third touch to validate it. A trendline is a moving support/resistance: the same rejection and body-close rules apply. A body close through the trendline followed by a lower high is a structure shift — stop taking continuation trades.

REVERSAL VS CONTINUATION DECISION
- Reversal only with: zone + rejection candle + momentum divergence or sweep.
- Continuation with: trend + pullback into dynamic support + trigger candle in trend direction.
- When price compresses directly under resistance with no rejection wicks, that is a breakout forming; do not sell it just because resistance is above.
- When price compresses directly above support with no bounce wicks, do not buy it just because support is below.

NO-TRADE CONDITIONS
- Price in the middle third between two zones.
- Zone already broken and re-tested twice (exhausted).
- Two-sided wicks at the same level for four or more candles (balance, no edge).
- News candles with bodies 3x normal size invalidate both zones until a new range forms.`,
  },
  {
    title: 'Binary Indicator Confluence & Expiry Timing (RSI, Bollinger, EMA)',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
Indicators describe momentum and volatility, not direction on their own. Use them as filters that raise or lower confidence, and only trade when they agree with price structure. Never invent an indicator that is not drawn on the screenshot.

RSI(14) RULES
- Above 70 = overbought, below 30 = oversold. Those zones are exhaustion warnings, not automatic reversal signals in a strong trend.
- Bullish divergence: price makes a lower low, RSI makes a higher low, at a support zone, with a bullish trigger candle. BUY.
- Bearish divergence: price makes a higher high, RSI makes a lower high, at resistance, with a bearish trigger candle. SELL.
- RSI between 45 and 55 is neutral: no momentum edge, return WAIT unless a pure level play with strong rejection.
- RSI crossing back through 50 after a pullback confirms continuation in the new direction.

BOLLINGER BANDS (20, 2)
- Squeeze: bands narrow to the smallest width in the visible window. Volatility contracts, then expands. Do not trade inside the squeeze; trade the first candle that closes outside the band with a body, in that direction.
- Band touch alone is not a signal. Band touch + rejection close back inside the band + a level = mean-reversion entry against the band.
- Band walk: four or more consecutive closes outside the same band means trend, not reversal. Fade nothing; trade continuation on the pullback to the middle band.
- Middle band (20 SMA) is the trend filter: price above it, longs preferred; below it, shorts preferred.

EMA ALIGNMENT (20 / 50)
- EMA20 above EMA50 and both sloping up: uptrend, BUY pullbacks.
- EMA20 below EMA50 and both sloping down: downtrend, SELL rallies.
- Flat, crossing EMAs: range, reduce confidence and prefer level-to-level trades.
- Price more than 2.5 average candle ranges from EMA20 is stretched: entry quality drops, wait for a pullback.

EXPIRY TIMING MATRIX
- 5-15 seconds: only on a very fast 1M impulse already in progress, entering RUNNING_CANDLE. Highest variance; skip if the last candle body is small.
- 30-60 seconds: the default for a completed trigger candle on 1M. The trade needs one to two more candles in the same direction.
- 120-180 seconds: slower 1M structure or a 5M setup; requires the level to be strong and momentum to be expanding.
- 300 seconds: only when the 5M trend is clear and the trigger happened at a major zone. Never use a long expiry to "give the trade room" after a weak signal.
- If the remaining time inside the current candle is shorter than the intended expiry, choose NEXT_CANDLE.
- If momentum is strong and the candle just opened, RUNNING_CANDLE with a short expiry is valid.

CONFLUENCE SCORING (take the trade at 4+ of 6)
1. Structure agrees with the signal direction.
2. Price at a validated zone.
3. Candlestick trigger present.
4. RSI not fighting the trade and inside a supportive band.
5. EMA alignment agrees.
6. Expiry matches the timeframe and momentum.

CONFLICT RULE
When two indicators disagree with structure, structure wins. When indicators agree but price is mid-range with no trigger, return WAIT.`,
  },
  {
    title: 'Binary Strict Risk Filter: When to Return WAIT',
    sourceType: 'TEXT',
    content: `CORE PRINCIPLE
A binary account dies from overtrading, not from missing trades. WAIT is a real signal with real value: it protects capital for the setups that actually meet the checklist. This entry is the hard filter applied before every BUY or SELL.

MANDATORY WAIT CONDITIONS (any one is enough)
1. Consolidation trap: price is inside a tight range narrower than 1.5x the average candle range, or the last four candles overlap heavily with small bodies. Binary expiries need movement; chop is a coin flip.
2. Opposing momentum candle immediately before entry: a full-bodied candle against the intended direction that has not been rejected yet. Wait for the rejection close.
3. No confirmation: no trigger candle, no level, no structure. A "feeling" is not a setup.
4. Mid-range location: price is in the middle third between support and resistance.
5. Exhaustion without reversal proof: three or more large candles in one direction, price stretched far from the mean, but no rejection candle yet.
6. Direction conflict: structure says up, the last candles say down (or the reverse), with no CHoCH or sweep to resolve it.
7. Unreadable chart: too zoomed, too blurry, missing price axis, or the candles cannot be distinguished. Never guess.
8. Stale or closed market: flat line, weekend gap, or no new candles visible.
9. Expiry mismatch: the intended expiry does not fit inside the remaining candle time and there is no next-candle confirmation.
10. Low confidence: the honest confidence score is under the trader's minimum threshold. The server enforces this automatically, but the model must also self-report honestly.

CONFIDENCE RUBRIC (report honestly, do not inflate)
- 90-100: strong trend, validated level, clean trigger, indicator agreement, expiry fits.
- 80-89: good setup with one missing confirmation.
- 70-79: acceptable only at a major level with a strong rejection; below the typical 70-80 threshold this becomes WAIT.
- 50-69: weak; WAIT for a better entry.
- Below 50: no edge; WAIT.
Never exceed 90 without at least three independent confluences. A high confidence on a mid-range doji is a modelling error, not a signal.

RISK AND MONEY MANAGEMENT (binary)
- Risk a fixed 1-2% of the account per trade. Never martingale, never double after a loss.
- Cap the day: stop after three consecutive losses or a 5% daily drawdown.
- Trade only during liquid hours for the asset: London and New York overlap for FX, the first two hours of the session for indices.
- One trade at a time. Correlated assets count as one position.
- Journal every signal: mode, asset, setup, expiry, confidence, outcome, and whether the checklist was fully met.

EXECUTION DISCIPLINE
- Enter after the candle closes, never during the wick.
- If the platform fills late, skip the trade rather than chasing.
- If the setup changes between the screenshot and the entry (new candle against the idea), cancel.
- Do not average down, do not "recover" a loss with a bigger stake.

THE ONE-SENTENCE TEST
Before returning BUY or SELL, state the reason in one sentence that names the level, the trigger and the momentum. If that sentence is not convincing, the correct answer is WAIT.`,
  },
  {
    title: 'Binary Options Complete Strategy Manual (Full Manual Text)',
    sourceType: 'PDF_TEXT',
    content: `BINARY OPTIONS COMPLETE STRATEGY MANUAL
Section 1 — How a binary decision is actually made
A binary option is a yes/no bet on whether price finishes above or below the entry at expiry. There is no stop loss and no partial exit, so the only protections are entry quality, expiry selection and stake size. Every analysis therefore answers three questions in order: (a) what is the current impulse, (b) what level is price interacting with, and (c) does the intended expiry give the impulse enough time to finish without giving chop time to reverse it. If any answer is unclear, the trade is WAIT.

Section 2 — Chart preparation
Use a clean candlestick chart with visible price axis and time axis. Mark the last 30-60 candles. Identify swing highs and swing lows, then mark the two nearest support zones below price and the two nearest resistance zones above. Add round numbers (.000, .500) and the session high/low. If RSI, Bollinger Bands or EMAs are visible, note their readings but do not add anything that is not drawn. Confirm the timeframe printed on the chart — a 1M chart and a 5M chart tell different stories and require different expiries.

Section 3 — Trend classification
Uptrend: higher highs and higher lows, EMA20 above EMA50 with both rising, most candles closing in the upper half of their ranges. Downtrend: lower highs and lower lows, EMA20 below EMA50 falling, closes in the lower half. Range: overlapping candles, flat EMAs, repeated rejection of the same two levels. The classification decides whether you trade continuation (trend) or level-to-level reversals (range). Trading a range with trend logic, or a trend with range logic, is the most common source of losses.

Section 4 — The five core setups
1. Trend pullback continuation: in an uptrend, price pulls back to EMA20, a rising trendline or the 0.5 retracement, prints small bearish bodies with lower wicks, then a bullish trigger candle closes back above EMA20. BUY on that close, 60-180 seconds. Mirror for SELL in a downtrend.
2. Level rejection reversal: at a validated zone, a pin bar or engulfing candle closes back inside the range. Enter on the close against the rejected side, 60-180 seconds.
3. Sweep and reclaim: a wick sweeps a prior low/high and the candle closes back inside, followed by a confirmation candle. Enter the reclaim direction, 60-120 seconds.
4. Break and retest: a body close beyond a zone, then a retest that holds. Enter continuation on the retest, 60-120 seconds.
5. Band/squeeze expansion: Bollinger squeeze, then a full-bodied close outside the band. Enter in the expansion direction, 30-60 seconds.

Section 5 — Indicator confluence
RSI(14): use 70/30 as exhaustion zones and divergence as a reversal filter, never as a standalone entry. Bollinger (20,2): squeeze for timing, band rejection for mean reversion, band walk for continuation. EMA20/50: alignment for direction, distance from EMA20 for stretch. When indicators conflict with structure, discard the indicators.

Section 6 — Expiry selection
Speed of the impulse sets the expiry. Fast 1M impulse with a fresh trigger: 30-60 seconds. Normal 1M setup: 60-180 seconds. Clean 5M structure at a major level: 180-300 seconds. Slow, overlapping candles: no trade. Choose RUNNING_CANDLE only when the current candle is already moving in the signal direction and the expiry fits inside its remaining time; otherwise NEXT_CANDLE. Never extend expiry to rescue a weak setup.

Section 7 — Risk management
Fixed stake: 1-2% of equity, identical for every trade. Daily loss limit: 5%. Consecutive-loss limit: 3. Maximum trades per session: 10, and no more than 2 in the same 5-minute window. No martingale. No revenge trading. No trading during high-impact news on the asset.

Section 8 — Session timing
FX pairs: London open (07:00-10:00 UTC) and New York open (12:00-15:00 UTC) give the cleanest impulses; the London-New York overlap is the best window. Asian session favors ranges — use level reversals only, smaller expiries. Indices: first 90 minutes of the cash session. Crypto: avoid the lowest-liquidity hours unless the chart shows a clear trend. Friday late session and Monday open produce false breakouts; demand extra confirmation.

Section 9 — The 12-point pre-trade checklist
1. Timeframe and asset readable. 2. Trend classified. 3. Level validated with two or more touches. 4. Trigger candle closed. 5. Candle body larger than the rejected candle's body. 6. Momentum agrees. 7. No opposing full-bodied candle immediately before entry. 8. Not mid-range. 9. Expiry fits the impulse. 10. Confidence honestly at or above threshold. 11. Stake fixed at 1-2%. 12. Reason expressible in one sentence. Any "no" means WAIT.

Section 10 — Common failure modes
Fading a strong trend because RSI is overbought. Buying support in a downtrend without a reclaim. Selling resistance in an uptrend without a rejection. Entering inside a squeeze. Using a 5-minute expiry on a 15-second impulse. Increasing stake after a loss. Trading a blurry screenshot. Reporting 95% confidence on a doji. All of these are WAIT conditions, and the filter in the previous entry exists to catch them.

Section 11 — Review process
Log every signal with the screenshot time, asset, mode, setup name, level, trigger, indicator readings, expiry, confidence, stake and outcome. Weekly, compute win rate by setup and by session. Remove the setups with negative expectancy. A trader who takes three A+ setups a day beats one who takes thirty coin flips.`,
  },
];
