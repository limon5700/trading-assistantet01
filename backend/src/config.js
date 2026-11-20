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

const dbClient = (process.env.DB_CLIENT || 'sqlite').trim().toLowerCase();
if (!['mysql', 'sqlite'].includes(dbClient)) {
  throw new Error('DB_CLIENT must be either "mysql" or "sqlite"');
}

const sqlitePath = path.resolve(backendRoot, process.env.SQLITE_PATH || './data/ai_trading.db');

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
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    timeoutMs: int('GEMINI_TIMEOUT_MS', 60000),
    maxKnowledgeChars: int('MAX_KNOWLEDGE_CHARS', 120000),
  },
  db: {
    client: dbClient,
    mysql: {
      host: process.env.DB_HOST || 'localhost',
      port: int('DB_PORT', 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'ai_trading',
    },
    sqlitePath,
  },
  uploads: {
    maxBytes: int('MAX_UPLOAD_MB', 25) * 1024 * 1024,
    maxMb: int('MAX_UPLOAD_MB', 25),
  },
  crypto: {
    // Optional overrides; the admin panel can also store explorer keys.
    bscRpcUrl: (process.env.BSC_RPC_URL || '').trim(),
    bscscanApiKey: (process.env.BSCSCAN_API_KEY || '').trim(),
    trongridApiKey: (process.env.TRONGRID_API_KEY || '').trim(),
  },
};
