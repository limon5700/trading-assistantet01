import express from 'express';
import rateLimit from 'express-rate-limit';
import { AUTH_COOKIE, checkCredentials, cookieOptions, issueAdminToken, requireAdmin } from '../auth.js';
import { config } from '../config.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!checkCredentials(email, password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = issueAdminToken(config.admin.email);
  res.cookie(AUTH_COOKIE, token, cookieOptions());
  return res.json({
    token,
    admin: { email: config.admin.email },
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  return res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  return res.json({ admin: { email: req.admin.sub } });
});

export default router;
