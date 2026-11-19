import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export const AUTH_COOKIE = 'admin_token';

export function issueAdminToken(email) {
  return jwt.sign({ sub: email, role: 'admin' }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: 'ai-trading-backend',
  });
}

export function verifyAdminToken(token) {
  const payload = jwt.verify(token, config.jwt.secret, { issuer: 'ai-trading-backend' });
  if (!payload || payload.role !== 'admin' || typeof payload.sub !== 'string') {
    throw new Error('Invalid token payload');
  }
  return payload;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    // Compare anyway so the response time does not leak length information.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function checkCredentials(email, password) {
  if (!email || !password) return false;
  const emailOk = safeEqual(String(email).trim().toLowerCase(), config.admin.email);
  const passwordOk = safeEqual(password, config.admin.password);
  return emailOk && passwordOk;
}

/* ------------------------------------------------------------ app users -- */

export function issueUserToken(user) {
  return jwt.sign({ sub: String(user.id), role: 'user' }, config.jwt.secret, {
    expiresIn: config.jwt.userExpiresIn,
    issuer: 'ai-trading-backend',
  });
}

export function verifyUserToken(token) {
  const payload = jwt.verify(token, config.jwt.secret, { issuer: 'ai-trading-backend' });
  if (!payload || payload.role !== 'user' || typeof payload.sub !== 'string') {
    throw new Error('Invalid token payload');
  }
  const id = Number.parseInt(payload.sub, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid token subject');
  return { id };
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

/**
 * Requires a signed-in app user (Authorization: Bearer <user JWT>) and exposes
 * only the numeric id as `req.userId`. Route handlers load the fresh row so a
 * suspended or deleted account cannot keep using an old token.
 */
export function requireUser(req, res, next) {
  const token = bearerToken(req) || req.get('x-access-token') || '';
  if (!token) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  try {
    const { id } = verifyUserToken(token);
    req.userId = id;
    return next();
  } catch (error) {
    const expired = error?.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Session expired, please sign in again' : 'Invalid session',
      code: expired ? 'SESSION_EXPIRED' : 'INVALID_TOKEN',
    });
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? 'none' : 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
}

/**
 * Accepts either the HTTP-only cookie set by /api/admin/login or an
 * `Authorization: Bearer <token>` header (used by API clients and tests).
 */
export function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const token = bearer || req.cookies?.[AUTH_COOKIE];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.admin = verifyAdminToken(token);
    return next();
  } catch (error) {
    const expired = error?.name === 'TokenExpiredError';
    return res.status(401).json({ error: expired ? 'Session expired' : 'Invalid session' });
  }
}
