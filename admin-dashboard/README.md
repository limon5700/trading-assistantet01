# AI Trading Assistant — Admin Dashboard

React 18 + Vite + TypeScript + Tailwind light-mode panel for the global trading
knowledge base. It talks to the backend in `../backend`.

## Run

```bash
cd admin-dashboard
cp .env.example .env
npm install
npm run dev      # http://localhost:5173
```

During development `/api` is proxied to `http://127.0.0.1:4000`, so start the
backend first:

```bash
cd ../backend && npm start
```

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env`.

## Build

```bash
npm run build     # tsc --noEmit + vite build  -> dist/
npm run preview
```

## Hosting

The build is a static SPA. Upload `dist/` to Netlify, Vercel, Cloudflare Pages
or serve it from Nginx. Set `VITE_API_BASE_URL` at build time to the backend
origin if the API is not on the same domain, and make sure the backend allows
that origin through `CORS_ORIGINS`.

When the API and the dashboard are on different sites, the HTTP-only cookie
requires HTTPS on both (`COOKIE_SECURE=true` on the backend). The dashboard also
sends the JWT as a `Bearer` header, so a separated deployment still works.

For SPA routing, rewrite unknown paths to `index.html`
(`/* /index.html 200` on Netlify, `try_files $uri /index.html` on Nginx).

## Features

- Login against `POST /api/admin/login`, session restored on reload via
  `/api/admin/me`.
- Add plain-text rules with title, content and active toggle.
- Drag-and-drop multi-page PDF upload with real progress (XHR) and the extracted
  page count reported back.
- Table with type badge, page count, active switch and per-row Preview / Edit /
  Delete (with confirmation).
- Preview renders each `===== PAGE n =====` section as a separate page card.
- Search, stats and toast notifications.
