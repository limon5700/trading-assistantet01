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

## Quick start (SQLite, zero external services)

```bash
cd backend
cp .env.example .env
# edit .env: set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, GEMINI_API_KEY
npm install
npm run migrate
npm start
```

The API listens on `http://localhost:4000` and the SQLite file is created at
`backend/data/ai_trading.db` (configurable with `SQLITE_PATH`).

## MySQL mode

Set in `.env`:

```env
DB_CLIENT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=app
DB_PASS=secret
DB_NAME=ai_trading
```

Then `npm run migrate`, which creates the `knowledge_base` table automatically
(the server also runs the migration on boot).

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
| POST | `/api/analyze-chart` | – (rate limited) | `{ imageBase64, currentTime, timezone }` |

`/api/analyze-chart` responds with exactly:

```json
{
  "signal": "BUY",
  "entry_timing": "Next Candle",
  "confidence": 85,
  "timeframe_detected": "5M",
  "reason": "Bullish engulfing off the 5M demand zone with wick rejection"
}
```

Uploaded PDFs are parsed page by page with `pdf-parse`; page text is stored
with `===== PAGE n =====` separators so the dashboard can render page breaks.

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
