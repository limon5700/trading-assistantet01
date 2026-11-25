# AI Trading Assistant & Floating Overlay System

A production-ready monorepo with three deployable parts:

| Folder | Stack | Purpose |
| --- | --- | --- |
| [`backend`](backend) | Node.js + Express + MySQL 8 (SQLite fallback) + Gemini Vision | Admin auth, per-mode BINARY/FOREX knowledge base, `/api/analyze-chart` vision endpoint |
| [`admin-dashboard`](admin-dashboard) | React 18 + Vite + TypeScript + Tailwind | Light-mode panel to manage text rules and multi-page PDFs |
| [`mobile-app`](mobile-app) | React + Vite + TypeScript + Capacitor + Kotlin | Android app with a draggable floating overlay and MediaProjection screen analysis |

The Gemini API key exists only on the backend. Neither the dashboard bundle nor
the Android APK ever receives it.

## How it fits together

```
Admin dashboard ──CRUD──▶ Backend (knowledge_base table)
                              ▲
Android overlay ──screenshot + time + timezone──┘
                              │
                              ▼
                   Gemini 2.5 Flash (strict JSON)
                              │
   {signal, confidence, entry_time, asset, timeframe, reason, voice_summary}
                              │
                              ▼
               Floating widget: BUY / SELL / WAIT
```

## Quick start

### 0. Docker + MySQL (recommended: persistent data)

MySQL is the primary store, so accounts, plans, activation codes, per-user
trade settings and every BINARY/FOREX knowledge item survive restarts and
redeploys in the named `mysql_data` volume.

```bash
cp .env.docker.example .env  # set MySQL passwords, JWT_SECRET, admin, GEMINI_API_KEY
docker compose up -d --build
docker compose logs -f backend
```

The API listens on `http://localhost:4000`. On boot it creates/migrates every
table in MySQL and ensures the two subscription plans, the settings keys and the
Terms/About pages exist. No trading knowledge is inserted: the BINARY and FOREX
libraries hold only what you upload from the admin dashboard. Re-running the
migration is idempotent:

```bash
docker compose exec backend npm run migrate
```

Data survives `docker compose down` and `docker compose up`. Only
`docker compose down -v` deletes the volume.

### 1. Backend without Docker (MySQL)

```bash
cd backend
cp .env.example .env         # set DB_HOST/DB_USER/DB_PASS/DB_NAME, JWT_SECRET, admin, GEMINI_API_KEY
npm install
npm run migrate
npm start                    # http://localhost:4000
```

### 2. Admin dashboard

```bash
cd admin-dashboard
cp .env.example .env
npm install
npm run dev                  # http://localhost:5173 (proxies /api to :4000)
```

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env`.

### 3. Mobile app

```bash
cd mobile-app
cp .env.example .env         # VITE_API_BASE_URL = your deployed API (baked in at build time)
npm install
npm run dev                  # browser preview of the UI
npm run build && npx cap sync android
npx cap open android         # build/run with Android Studio (JDK 21)
```

The backend URL comes only from `VITE_API_BASE_URL`; there is no server field in
the app. In the Android app: grant **Display over other apps** and
notifications, then tap **Start Trading Overlay Widget** and approve screen
capture. The widget floats above Quotex, Exness, TradingView, MetaTrader, etc.

Pending accounts pick a plan from a swipeable carousel: the Free plan leads to
the affiliate link, support and activation-code step, while the Paid plan opens
a USDT checkout (BEP20 or TRC20) that the backend verifies on-chain and activates
automatically. Version **1.0.1** (`versionCode 2`).

## Deployment

- **Backend** — Render/Railway/VPS instructions, MySQL mode and Nginx config are
  in [`backend/README.md`](backend/README.md).
- **Dashboard** — static `dist/` hosting notes are in
  [`admin-dashboard/README.md`](admin-dashboard/README.md).
- **Android** — GitHub Actions
  [`.github/workflows/android.yml`](.github/workflows/android.yml) builds both
  `.apk` and `.aab` on every push to `main`. Add the optional signing secrets
  (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`) to produce signed release artifacts. Details in
  [`mobile-app/README.md`](mobile-app/README.md).

## Security notes

- Admin endpoints accept an HTTP-only cookie **or** `Authorization: Bearer`.
- Login is rate limited (20 per 15 min) and analysis is limited to 30 requests
  per minute per IP.
- Crypto payments are verified against the transaction receipt and USDT Transfer
  logs, require the admin-configured wallet and exact-or-higher amount, and a
  transaction hash can only be redeemed once. Explorer keys stay server-side.
- Passwords are compared in constant time; JWTs expire after 12 hours.
- Screenshots are processed in memory and never written to disk.
- PDFs are limited by `MAX_UPLOAD_MB` and parsed page by page.

Signals are generated technical analysis, not financial advice.
