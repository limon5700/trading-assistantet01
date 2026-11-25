/**
 * Default CMS pages (Terms and About) installed once on an empty database so
 * the public pages are never blank. Everything else lives in MySQL and is
 * managed from the admin dashboard.
 */

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
