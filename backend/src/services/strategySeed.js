/**
 * Built-in world-class trading strategies.
 *
 * These six binary-focus and four forex-focus playbooks are inserted once per
 * category when that category has no entries, so a fresh deployment already
 * gives Gemini a professional rule set. Admins can edit, deactivate or delete
 * any of them from the dashboard afterwards.
 */

export const BINARY_STRATEGIES = [
  {
    title: 'Price Action & Candlestick Psychology (Engulfing, Pin Bar, Rejection Wicks)',
    content: `CORE PRINCIPLE
Every candle is a record of a fight between buyers and sellers. Read the body as conviction and the wick as rejection. A long lower wick means sellers pushed price down and were absorbed; a long upper wick means buyers were trapped.

SETUPS (1M / 5M binary)
1. Bullish engulfing at support: the previous candle is bearish, the current candle opens at or below its close and closes above its open with a body at least 1.3x the previous body. Take a BUY only when the close is inside the upper half of the engulfing candle and price is sitting on a tested support or demand zone.
2. Bearish engulfing at resistance: mirror of the above, SELL.
3. Bullish pin bar / hammer: lower wick at least 2x the body, small body in the top third, formed at support or after a liquidity sweep. BUY on the close, not on the wick.
4. Shooting star: upper wick 2x the body at resistance. SELL.
5. Rejection wick cluster: two or more consecutive candles rejecting the same price level. The side that keeps getting rejected is the losing side — trade away from the wick.

CONFIRMATION CHECKLIST
- The pattern must form AT a level (support, resistance, round number, session high/low). A pattern in the middle of a range is noise.
- The candle must close before entry. Never anticipate a forming candle.
- Momentum candles in the trend direction should have larger bodies than the counter-trend candles.
- Skip the setup when the last three candles alternate direction with shallow bodies (indecision).

INVALIDATION
A body close back through the level that produced the signal, or two consecutive closes beyond it, invalidates the idea. If the next candle opens with a gap against the signal, return WAIT.`,
  },
  {
    title: 'Support & Resistance Reversal and Breakout Confirmation',
    content: `CORE PRINCIPLE
Support and resistance are zones, not lines. A zone is validated by the number of touches, the strength of the rejection and the time between touches. Trade the reaction at the zone, or the confirmed break of it — never the middle.

REVERSAL PLAYBOOK
1. Mark the zone from the last 30-60 candles: two or more wicks stopping within a few pips of each other.
2. Wait for price to arrive at the zone with declining momentum (smaller bodies, longer wicks into the zone).
3. Enter on a rejection candle that closes back inside the prior range, in the direction of the bounce.
4. Confidence is high when the zone aligns with the session high/low and the moving average.

BREAKOUT PLAYBOOK
1. A breakout needs a candle BODY close beyond the zone, not just a wick.
2. Prefer breakouts during the London or New York open when volume expands.
3. After the break, wait for a retest of the broken zone. A retest that holds (wick into the zone, close back out) is the highest-quality continuation entry.
4. A failed retest — price closes back inside the old range — is a false breakout. Flip the bias or stand aside.

BINARY SPECIFICS
Because binary options are time-boxed, take the reversal entry immediately after the rejection close and keep the expiry at the normal 60s / 5-candle window. For breakouts, enter only after the retest, never on the first spike, and avoid expiries longer than 3 minutes on a retest that is still moving.

RED FLAGS
- Zone already broken and re-broken several times (exhausted).
- Price compressing directly under the zone with no rejection wicks — that is a breakout forming, not a reversal.
- News candles: bodies 3x normal size invalidate the zone.`,
  },
  {
    title: 'RSI + Bollinger Bands Overbought / Oversold Reversal',
    content: `CORE PRINCIPLE
Momentum oscillators describe exhaustion, not direction on their own. RSI and Bollinger Bands are only actionable when price is also at a structural level and the momentum is visibly fading.

SETUP A — BAND REVERSAL
1. RSI(14) above 70 or below 30.
2. Price closes outside the Bollinger Band (20, 2) and the next candle closes back inside the band — the "band rejection".
3. Price is at a support/resistance zone or at the extreme of a completed impulse leg.
4. Enter against the exhausted move. BUY when the lower band rejection happens in an uptrend, SELL when the upper band rejection happens in a downtrend.

SETUP B — BAND WALK CONTINUATION
When RSI stays above 70 (or below 30) for 4+ candles and price keeps closing outside the same band, the market is trending, not reversing. Do NOT fade it. Trade continuation on the pullback to the middle band (20 SMA) instead, in the trend direction.

SETUP C — DIVERGENCE
Price makes a higher high while RSI makes a lower high (bearish divergence) at resistance → SELL. Price makes a lower low while RSI makes a higher low at support → BUY. Divergence without a structural level is not a trade.

CONFIRMATION
- Candlestick trigger: engulfing, pin bar or inside-bar break in the signal direction.
- Volume should contract on the exhaustion leg and expand on the reversal candle if volume is visible.
- If RSI is between 45 and 55 the market is neutral: return WAIT.

BINARY TUNING
Use 60s-180s expiries for band reversals; band walks need a shorter expiry (30s-60s) aligned with the trend. Never fade a band walk.`,
  },
  {
    title: 'Trendline + 1-Minute Momentum Continuation',
    content: `CORE PRINCIPLE
Trend following is the highest-probability binary approach: trade with the dominant 1-minute impulse, enter on the pullback, and let the trend pay for the expiry.

DRAWING THE TREND
1. Connect at least two higher lows (uptrend) or two lower highs (downtrend). A third touch validates the line.
2. Confirm the structure: in an uptrend each swing high is above the previous swing high; in a downtrend each swing low is below the previous one.
3. A trendline break with a body close, followed by a lower high, is a Market Structure Shift — stop trading continuation.

ENTRY SEQUENCE (BUY)
1. Price pulls back to the trendline, the 20 EMA or the 0.5 Fibonacci retracement of the last impulse.
2. The pullback candles are small-bodied with wicks pointing down (sellers failing).
3. A bullish trigger candle closes back above the 20 EMA.
4. Momentum filter: the last impulse leg travelled further than the previous pullback (expansion), and the fast EMA is above the slow EMA.

ENTRY SEQUENCE (SELL)
Mirror: pullback into resistance/trendline, small bullish bodies that fail, bearish trigger close, fast EMA below slow EMA.

MOMENTUM QUALITY CHECK
- Consecutive same-colour candles with growing bodies = strong momentum, continue.
- Long opposing wicks against the trade = weakening momentum, reduce size or wait.
- Three or more candles closing on the same side of the 20 EMA with the EMA sloping = trend intact.

BINARY EXPIRY
Use one impulse-length expiry: 60s in a 1M trend, 180s-300s when the 1M candles are small and the 5M structure is strong. Skip the trade if price is more than 60% of the way to the next resistance/support.`,
  },
];

export const FOREX_STRATEGIES = [
  {
    title: 'Smart Money Concepts (SMC): Order Blocks, Fair Value Gaps and Liquidity Sweeps',
    content: `CORE PRINCIPLE
Institutional order flow leaves footprints: liquidity pools above highs and below lows, order blocks where the last opposing candle preceded an impulsive move, and fair value gaps (imbalances) that price returns to fill.

MARKING THE CHART
1. Order block: the last down candle before an impulsive bullish displacement (or the last up candle before a bearish displacement). Mark its body and wick extremes.
2. Fair Value Gap: a three-candle sequence where candle 1's high and candle 3's low do not overlap (bullish FVG), or candle 1's low and candle 3's high do not overlap (bearish FVG). The gap is the inefficiency.
3. Liquidity: equal highs/equal lows, session highs/lows and obvious stop clusters.

THE A+ SEQUENCE (LONG)
1. Price sweeps a liquidity pool below a range low (stop run), leaving a long lower wick.
2. Displacement higher leaves a bullish FVG and a demand order block.
3. Price retraces into the FVG / order block, ideally into the 50% of the displacement leg.
4. A bullish confirmation candle closes inside or above the zone → enter long.
Stop below the sweep low; first target the opposing liquidity pool, then the next imbalance.

THE A+ SEQUENCE (SHORT)
Mirror: sweep above equal highs, bearish displacement, retrace into supply order block / FVG, bearish confirmation close → short.

RULES
- Never enter before the retracement; chasing displacement has poor risk-to-reward.
- The stronger the displacement leaving the zone, the higher the quality of the zone.
- A zone that has already been mitigated (price traded through it) is invalid.
- Combine with the higher timeframe bias: long only when the H1/H4 structure is bullish.`,
  },
  {
    title: 'Market Structure Shift: BOS and CHoCH',
    content: `CORE PRINCIPLE
Trend is defined by swing structure, not by moving averages. A Break of Structure (BOS) confirms continuation; a Change of Character (CHoCH) warns of reversal. Trade the first pullback after each.

DEFINITIONS
1. Swing high / swing low: a candle with lower highs on both sides (swing high) or higher lows on both sides (swing low). Use the last three confirmed swings.
2. BOS: price closes beyond the most recent swing high in an uptrend (or swing low in a downtrend), confirming the trend continues.
3. CHoCH: in an uptrend, price breaks below the most recent higher low — the character has changed. In a downtrend, a break above the most recent lower high.

TRADING THE BOS (CONTINUATION)
1. Wait for the body close beyond the swing.
2. Mark the origin of the impulse (order block) and the imbalance left behind.
3. Enter on the pullback into that zone with the trend.
4. Stop beyond the swing that produced the BOS. Target the next liquidity pool.

TRADING THE CHoCH (REVERSAL)
1. CHoCH alone is a warning, not an entry.
2. Wait for the return to the supply/demand zone that caused the break.
3. Enter on the first lower high (after a bullish CHoCH, the first higher low) with a tight stop behind the zone.
4. If the market immediately makes a new extreme in the old direction, the CHoCH failed — stand down.

CONFLUENCE
- Higher timeframe bias should agree with the trade direction.
- Session timing: structure breaks during London/NY are more reliable than Asian-session breaks.
- A BOS with a large displacement body is stronger than one with a wick-only poke.`,
  },
  {
    title: 'Fibonacci Retracement + Key Supply and Demand Zones',
    content: `CORE PRINCIPLE
Fibonacci levels are not magic — they are where traders cluster orders. Use them only inside a clearly defined impulse and only when they coincide with a structural zone.

SETUP
1. Identify an impulse leg: a clean directional move with a visible origin and termination.
2. Draw the retracement from the origin to the termination.
3. Mark the 0.382, 0.5, 0.618 and 0.786 levels. The 0.5-0.618 "golden pocket" is the highest-probability reversal area.
4. Overlay supply/demand zones and the 20/50 EMA. Confluence of 2+ factors raises confidence.

ENTRY (LONG)
1. Price retraces into the 0.5-0.618 pocket that also contains a demand zone.
2. Look for a bullish confirmation: engulfing, pin bar, or a small double bottom.
3. Enter on the confirmation close. Stop below the 0.786 or below the demand zone — whichever is further.
4. Targets: 0.382 extension, then the prior high, then 1.272-1.618 extensions.

ENTRY (SHORT)
Mirror using the 0.5-0.618 pocket inside a supply zone.

RULES AND FILTERS
- Retracements deeper than 0.786 usually mean the impulse has failed — do not force a long.
- If the retracement is shallow (0.236-0.382) and momentum resumes, that is a continuation signal, not a reversal — enter with the trend.
- Risk-to-reward must be at least 1:2 measured from entry to the first target.
- Avoid Fibonacci entries during low-liquidity hours when spreads widen and levels are unreliable.

MULTI-TIMEFRAME
Use the H1/H4 Fibonacci for direction and the 5M/15M pocket for the actual entry trigger. When the two disagree, the higher timeframe wins.`,
  },
  {
    title: 'Risk-to-Reward and Multi-Timeframe Confluence',
    content: `CORE PRINCIPLE
A trading system is only as good as its position sizing and its filter for bad trades. This playbook defines when NOT to trade and how to size every trade that passes.

TOP-DOWN WORKFLOW
1. Daily / H4: define the trend using swing structure (higher highs and higher lows = bullish).
2. H1: locate the active supply or demand zone, the last order block and the nearest liquidity pools.
3. 15M: wait for a CHoCH or BOS in the higher-timeframe direction.
4. 5M / 1M: execute on the retest of the zone with a candlestick trigger.

CONFLUENCE SCORING
Give one point for each: HTF trend agreement, price at a fresh zone, momentum alignment (EMA slope), candlestick trigger, session timing (London/NY), and a clean 1:2+ structure. Take the trade only at 4+ points. Below 4, return WAIT.

RISK MANAGEMENT
- Risk a fixed 0.5-1% of account equity per trade. Never widen a stop to avoid a loss.
- Stop loss: beyond the structural invalidation, plus a spread buffer. Entry, stop and target must be readable numbers.
- Take profit 1: the nearest opposing liquidity or structure; take profit 2: the next zone. Move to break-even after TP1.
- Maximum two open positions in correlated pairs (EUR/USD and GBP/USD count as one).
- Stop trading after two consecutive losses or a 3% daily drawdown.

TRADE MANAGEMENT
- If price moves 50% toward target without a retracement, trail the stop behind the last swing.
- Never hold a position through a high-impact news release unless the stop is already at break-even.
- Journal every trade: setup, confluence score, emotion, outcome. Review weekly.

POSITION SIZING FORMULA
Lot size = (equity × risk%) / (stop distance in pips × pip value per lot).`,
  },
];

export const DEFAULT_CMS_PAGES = [
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    content: `# Terms & Conditions

Last updated: 2026

## 1. Acceptance of these terms
By creating an account, activating a plan or using the AI Trading Assistant application, floating widget or website (together, "the Service"), you agree to these Terms & Conditions. If you do not agree, do not use the Service.

## 2. What the Service is
The Service provides automated technical analysis of chart screenshots using artificial intelligence. Signals, confidence scores, entry suggestions, stop-loss and take-profit levels are informational analysis of chart patterns. They are **not** investment advice, a recommendation, an offer or a solicitation to buy or sell any financial instrument.

## 3. No financial advice and no guarantee
The Service does not know your financial situation, risk tolerance, capital or objectives. Past performance and historical chart patterns never guarantee future results. You are solely responsible for every order you place and for the outcome of every trade.

## 4. Trading risk
Trading foreign exchange, binary options, commodities, indices and cryptocurrencies involves substantial risk of loss and is not suitable for every person. You may lose part or all of your capital. Never trade with money you cannot afford to lose. Some jurisdictions restrict or prohibit binary options; it is your responsibility to comply with the laws that apply to you.

## 5. Accounts and activation
You must provide accurate registration details and keep your password confidential. Accounts start in a pending state and become active after an activation code is redeemed or a paid plan is verified. Accounts may be suspended for abuse, sharing of access, automated scraping, payment fraud or violation of these terms.

## 6. Subscriptions and payments
Paid plans are billed in advance for the stated duration. Crypto payments are verified on-chain against the wallet shown in the app; blockchain transfers are irreversible and must be for the exact amount on the correct network. Activation codes are personal, single-use and non-transferable. Unless required by law, fees are non-refundable.

## 7. Acceptable use
You agree not to resell, sublicense or redistribute access; not to reverse engineer, copy or attempt to extract the underlying models, prompts or knowledge base; not to use the Service to break any law, market rule or exchange policy; and not to overload or interfere with the Service.

## 8. Screen capture and privacy
The floating widget captures the chart area of your screen only while you have started it and granted Android screen-capture consent. Screenshots are sent to our server, analysed and discarded; they are not used to train public models. Account activity (login, activation, scan metadata) is stored to operate the Service. See the About page for contact details.

## 9. Third-party services
The Service relies on third-party AI and blockchain providers. Outages, model changes, rate limits or delays can interrupt analysis. We are not liable for third-party failures, but we will use reasonable efforts to keep the Service available.

## 10. Limitation of liability
To the maximum extent permitted by law, we are not liable for indirect, incidental, special or consequential damages, or for any trading losses, lost profits or lost data arising from your use of the Service. Our total liability is limited to the amount you paid us in the twelve months before the claim.

## 11. Changes to the Service and these terms
We may change, suspend or discontinue features at any time. We may update these terms; the current version is always published in the app. Continued use after an update means you accept the revised terms.

## 12. Governing law
These terms are governed by the laws of the jurisdiction in which the Service operator is established, without regard to conflict-of-law rules.

## 13. Contact
For questions about these terms, billing, activation or account closure, use the support contact published on the About page.`,
  },
  {
    slug: 'about',
    title: 'About Us',
    content: `# About AI Trading Assistant

## Our mission
AI Trading Assistant was built for traders who already watch price action all day and want a disciplined second pair of eyes. Instead of another indicator overlay, we read the chart the way a discretionary trader does — structure, momentum, candlestick psychology, support and resistance — and return a single, structured decision with an honest confidence score.

## How it works
1. You start the floating widget over any trading platform on your phone and grant screen-capture consent.
2. The widget captures the chart on a short cycle and sends the frame to our server.
3. Gemini Vision analyses price action, candle sequence, support and resistance, structure and the active strategy library for your selected mode.
4. The result comes back as strict JSON: BUY, SELL or WAIT, the candle target (running or next), duration or timeframe, confidence, and a plain-language reason.
5. Tap the widget and the current signal is delivered on screen and spoken aloud.

## Binary and Forex modes
Binary mode is tuned for short expiries: candle-entry timing, duration in seconds and price-action triggers. Forex mode is tuned for structured risk: timeframe, entry price, stop loss and take profit. Each mode has its own strategy library, which our analysts and admins maintain, and you can add your own rules in Settings.

## What we believe
- Discipline beats prediction. A confident WAIT is a valid signal.
- A signal without a reason is useless, so every result explains itself.
- Your strategy is yours. Custom rules you write are sent only with your own scans.
- Risk management comes first: stop loss, position size and a hard daily limit.

## Technology
Node.js and Express on the API, Gemini Vision for chart reading, SQLite or MySQL for storage, and a React + Capacitor Android app with a native floating overlay and on-device text-to-speech.

## Contact and support
For activation, billing, partnership or data requests, use the support contact link published inside the app. We answer support requests in the order they arrive and aim to respond within one business day.

## Risk statement
AI Trading Assistant provides technical analysis, not financial advice. Trading carries a substantial risk of loss. Always trade with capital you can afford to lose and follow the laws of your jurisdiction.`,
  },
];
