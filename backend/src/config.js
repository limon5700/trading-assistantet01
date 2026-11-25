import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(__dirname, '..');

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export const config = {
  port: int('PORT', 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cookieSecure: bool('COOKIE_SECURE', false),
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
    userExpiresIn: process.env.USER_JWT_EXPIRES_IN || '30d',
  },
  admin: {
    email: required('ADMIN_EMAIL').toLowerCase(),
    password: required('ADMIN_PASSWORD'),
  },
  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    // Hard-locked on purpose: one Flash model only, never read from the
    // environment, so no deployment can quietly point a scan at another model.
    model: 'gemini-flash-lite-latest',
    timeoutMs: int('GEMINI_TIMEOUT_MS', 75000),
    // Ceiling for one model call. A chart screenshot plus a full knowledge
    // library measures 10-30 s on gemini-flash-lite-latest, so a 20 s ceiling
    // rejected healthy scans as timeouts; 35 s leaves room for a slow one and
    // still allows two spaced retries of a "503 high demand" spike inside the
    // 75 s scan budget.
    attemptTimeoutMs: int('GEMINI_ATTEMPT_TIMEOUT_MS', 35000),
    maxKnowledgeChars: int('MAX_KNOWLEDGE_CHARS', 120000),
  },
  // MySQL is the only store: accounts, plans, codes, trade settings, CMS pages
  // and every BINARY/FOREX knowledge entry live in the real database.
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ai_trading',
    // The API container may start before MySQL finished its first boot, so the
    // pool keeps retrying instead of crashing the process.
    connectAttempts: int('DB_CONNECT_ATTEMPTS', 30),
    connectRetryMs: int('DB_CONNECT_RETRY_MS', 2000),
  },
  uploads: {
    maxBytes: int('MAX_UPLOAD_MB', 25) * 1024 * 1024,
    maxMb: int('MAX_UPLOAD_MB', 25),
    // Everything uploaded at runtime lives under the backend folder so a
    // deployment only has to persist one directory (or attach a volume).
    dir: path.resolve(backendRoot, process.env.UPLOADS_DIR || './data/uploads'),
    iconMaxBytes: int('MAX_ICON_KB', 2048) * 1024,
    publicPath: '/uploads',
  },
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  crypto: {
    // Optional overrides; the admin panel can also store explorer keys.
    bscRpcUrl: (process.env.BSC_RPC_URL || '').trim(),
    bscscanApiKey: (process.env.BSCSCAN_API_KEY || '').trim(),
    trongridApiKey: (process.env.TRONGRID_API_KEY || '').trim(),
  },
};
