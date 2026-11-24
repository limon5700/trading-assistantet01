# Production image for the AI Trading Assistant API.
# Dependencies are installed from the lockfile, the runtime runs as `node`,
# and the schema + seed data are created automatically on startup.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=4000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# curl is used by the container healthcheck below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /app/data/uploads \
    && chown -R node:node /app

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "src/server.js"]
