# AI Trading Assistant — Backend

Express + MySQL (or the built-in SQLite fallback) API that powers the admin
dashboard and the Android floating overlay.

- Admin JWT auth (HTTP-only cookie **and** `Authorization: Bearer`).
- Global trading knowledge base: plain-text rules and multi-page PDFs.
- `POST /api/analyze-chart`: Gemini 2.5 Flash vision analysis with strict JSON
  schema output, injected with every active knowledge entry.

The Gemini key lives only in this service. It is never returned by an endpoint
and never bundled into the dashboard or the Android app.

## Requirements

- Node.js **>= 22.5** (SQLite uses the built-in `node:sqlite` module; Node 24+
  is recommended). MySQL 8 is optional.

## Quick start (Docker + MySQL, persistent)

From the repository root:

```bash
cp .env.docker.example .env
# edit .env: MYSQL_* passwords, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, GEMINI_API_KEY
docker compose up -d --build
```

`docker-compose.yml` runs `mysql:8.0` with the `mysql_data` volume and starts
this API only after MySQL passes its healthcheck. On boot the server creates and
migrates every table and seeds the default plans, settings, CMS pages and both
strategy libraries. MySQL is the default `DB_CLIENT`.

```bash
docker compose exec backend npm run seed   # idempotent re-seed
```

## Quick start (SQLite, zero external services)

```bash
cd backend
cp .env.example .env
# edit .env: set DB_CLIENT=sqlite, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, GEMINI_API_KEY
npm install
npm run migrate && npm run seed
npm start
```

The API listens on `http://localhost:4000` and the SQLite file is created at
`backend/data/ai_trading.db` (configurable with `SQLITE_PATH`).

## MySQL mode (without Docker)

Set in `.env`:

```env
DB_CLIENT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=app
DB_PASS=secret
DB_NAME=ai_trading
```

Then `npm run migrate` (or `npm run seed`), which creates and migrates every
table — `users`, `plans`, `activation_codes`, `crypto_payments`, `app_settings`,
`user_activities`, `cms_pages`, `user_trade_settings` and `knowledge_base` — and
seeds the two strategy libraries. The server also runs the same migration and
seed on boot, so a fresh database is usable immediately.

## Knowledge libraries

`BINARY` and `FOREX` are separate libraries. Each ships four topic playbooks
plus one full manual stored as `PDF_TEXT`:

- **BINARY** — candlestick price action and rejection psychology; support,
  resistance and trendline confluence; indicator confluence and expiry timing;
  the strict WAIT/risk filter; the complete binary manual.
- **FOREX** — smart money concepts (BOS, CHoCH, order blocks, FVG, liquidity);
  supply, demand and Fibonacci; execution and risk management; the complete
  forex manual.

Scans inject only the active entries of the requested mode, plus the trader's
saved settings and custom strategy. Everything is editable from the dashboard,
and PDF uploads are parsed page by page into the same table.

## API

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET  | `/api/health` | – | Liveness probe |
| POST | `/api/admin/login` | – | `{ email, password }` → JWT + HTTP-only cookie |
| POST | `/api/admin/logout` | – | Clears the auth cookie |
| GET  | `/api/admin/me` | admin | Current session |
| GET  | `/api/admin/knowledge` | admin | List entries (no content) |
| POST | `/api/admin/knowledge/text` | admin | `{ title, content, is_active }` |
| POST | `/api/admin/knowledge/pdf` | admin | `multipart/form-data`: `file`, optional `title`, `is_active` |
| GET  | `/api/admin/knowledge/:id` | admin | Full entry with extracted text |
| PUT  | `/api/admin/knowledge/:id` | admin | `{ title?, content?, is_active? }` |
| DELETE | `/api/admin/knowledge/:id` | admin | Delete an entry |
| GET  | `/api/admin/settings` | admin | App + crypto settings (explorer keys included) |
| PUT  | `/api/admin/settings` | admin | Update links, `crypto_network`, `crypto_wallet_address`, explorer keys |
| POST | `/api/payments/start` | user JWT | `{ plan_id }` → creates/reuses a PENDING `crypto_payments` row |
| GET  | `/api/payments/:id` | user JWT | Payment status (owner only) |
| POST | `/api/payments/verify-crypto` | user JWT | `{ payment_id, tx_hash }` → verifies on-chain and activates |
| POST | `/api/analyze-chart` | user JWT + ACTIVE | `{ imageBase64, currentTime, timezone }` or multipart `image` |

`/api/analyze-chart` responds with exactly this strictly validated object —
Gemini Vision is called with a JSON response schema, so every field is always
present and no prose or extra keys can leak through:

```json
{
  "signal": "BUY",
  "confidence": 85,
  "entry_time": "Next Candle",
  "asset": "EUR/USD",
  "timeframe": "5M",
  "reason": "Bullish engulfing off the 5M demand zone with wick rejection",
  "voice_summary": "Buy signal detected with 85 percent confidence."
}
```

- `signal` is `BUY`, `SELL` or `NO_TRADE`.
- `confidence` is clamped to an integer 0–100.
- `entry_time` is `Next Candle` for an immediate entry, otherwise local 24h
  `HH:MM`; anything malformed falls back to `Next Candle`.
- `asset` and `timeframe` fall back to `unknown` when unreadable.
- `voice_summary` is a single spoken sentence and falls back to
  `<Signal> signal detected with <n> percent confidence.`

Uploaded PDFs are parsed page by page with `pdf-parse`; page text is stored
with `===== PAGE n =====` separators so the dashboard can render page breaks.

## Crypto (USDT) payments

The admin sets `crypto_network` (`BEP20` or `TRC20`), `crypto_wallet_address`
and optional `BSCSCAN_API_KEY` / `TRONGRID_API_KEY` on the dashboard Settings
page (the env vars with the same names are fallbacks). `/api/payments/start`
snapshots the price, network and wallet into `crypto_payments` with status
`PENDING`.

`/api/payments/verify-crypto` then checks:

1. the transaction succeeded on-chain (BSC receipt status `0x1`, TRON
   `contractRet: SUCCESS`);
2. the hash has not been used by another payment (`tx_hash` is unique);
3. a USDT `Transfer` to the configured wallet exists in the receipt/logs
   (BEP20 contract `0x55d3…7955`, TRC20 `TR7N…Lj6t`);
4. the transferred amount is at least `expected_amount_usdt`.

BEP20 is read over public BSC JSON-RPC (with BscScan as a key-backed fallback);
TRC20 uses TronGrid and falls back to TronScan. On success the row becomes
`VERIFIED`, the user is set to `ACTIVE` on the plan, a `PAYMENT_VERIFIED`
activity is logged, and the app returns the fresh session so the hub unlocks.
Unconfirmed transactions stay `PENDING` for the app's polling; mismatches are
marked `FAILED`.

## Deployment

### Render / Railway (recommended)

1. Push this repository and create a **Web Service** with root directory
   `backend`.
2. Build command: `npm install` — Start command: `npm start`.
3. Add every variable from `.env.example` in the dashboard. Use
   `COOKIE_SECURE=true` and set `CORS_ORIGINS` to your dashboard URL.
4. Add a managed MySQL (Railway MySQL / Render external DB) and set
   `DB_CLIENT=mysql` plus the connection variables. SQLite on ephemeral
   filesystems loses data on redeploy — use MySQL or a persistent disk.
5. Health check path: `/api/health`.

### VPS (systemd + Nginx)

```bash
git clone <repo> /opt/ai-trading && cd /opt/ai-trading/backend
cp .env.example .env && npm install --omit=dev && npm run migrate
```

`/etc/systemd/system/ai-trading.service`:

```ini
[Unit]
Description=AI Trading Backend
After=network.target

[Service]
WorkingDirectory=/opt/ai-trading/backend
EnvironmentFile=/opt/ai-trading/backend/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
User=www-data
```

```bash
sudo systemctl enable --now ai-trading
```

Nginx reverse proxy (TLS via certbot), keeping the upload limit above
`MAX_UPLOAD_MB`:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 30m;
}
```

## Notes

- Rate limits are in-memory (login 20/15 min, analysis 30/min per IP). For
  multi-instance deployments put a shared store (Redis) behind
  `express-rate-limit`.
- Screenshots are analysed in memory and never written to disk.
- `NO_TRADE` is a first-class answer; the model is instructed to prefer it when
  the chart or the knowledge base rules do not justify a trade.
