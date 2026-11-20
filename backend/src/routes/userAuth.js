import express from 'express';
import rateLimit from 'express-rate-limit';
import { issueUserToken, requireUser } from '../auth.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import {
  activateWithCode,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByIdentifier,
  findUserByUsername,
  getPublicSettings,
  listPlans,
  logActivity,
  mapUser,
  touchLastActive,
} from '../services/accounts.js';

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const PHONE_RE = /^[+0-9][0-9 ()-]{5,31}$/;

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateSignup(body) {
  const fullName = trimmed(body?.full_name);
  const username = trimmed(body?.username).toLowerCase();
  const email = trimmed(body?.email).toLowerCase();
  const phone = trimmed(body?.phone);
  const password = typeof body?.password === 'string' ? body.password : '';
  const confirmPassword = typeof body?.confirm_password === 'string' ? body.confirm_password : '';

  if (fullName.length < 2 || fullName.length > 120) {
    return { error: 'Full name must be between 2 and 120 characters' };
  }
  if (!USERNAME_RE.test(username)) {
    return { error: 'Username must be 3-30 characters using letters, numbers, dot or underscore' };
  }
  if (!EMAIL_RE.test(email) || email.length > 190) {
    return { error: 'Enter a valid email address' };
  }
  if (phone && !PHONE_RE.test(phone)) {
    return { error: 'Enter a valid phone number' };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: 'Password must be between 8 and 128 characters' };
  }
  if (password !== confirmPassword) {
    return { error: 'Password and confirm password do not match' };
  }

  return { value: { fullName, username, email, phone, password } };
}

async function sessionPayload(user) {
  const [settings, plans] = await Promise.all([
    getPublicSettings(),
    listPlans({ activeOnly: true }),
  ]);
  return {
    user: mapUser(user),
    settings,
    plans,
  };
}

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const { value, error } = validateSignup(req.body ?? {});
    if (error) return res.status(400).json({ error });

    if (await findUserByEmail(value.email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    if (await findUserByUsername(value.username)) {
      return res.status(409).json({ error: 'This username is already taken' });
    }

    const user = await createUser({
      fullName: value.fullName,
      username: value.username,
      email: value.email,
      phone: value.phone,
      passwordHash: hashPassword(value.password),
    });

    await logActivity({
      userId: user.id,
      action: 'SIGNUP',
      details: { username: user.username, email: user.email },
    });

    return res.status(201).json({
      token: issueUserToken(user),
      ...(await sessionPayload(user)),
    });
  } catch (err) {
    if (err?.code === 'SQLITE_CONSTRAINT' || err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This email or username is already registered' });
    }
    return next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const identifier = trimmed(req.body?.identifier || req.body?.email || req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.account_status === 'SUSPENDED') {
      return res.status(403).json({
        error: 'Your account is suspended. Please contact support.',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    await touchLastActive(user.id);
    await logActivity({ userId: user.id, action: 'LOGIN', details: { method: 'password' } });
    const fresh = await findUserById(user.id);

    return res.json({ token: issueUserToken(fresh), ...(await sessionPayload(fresh)) });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', requireUser, async (req, res, next) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });

    res.set('Cache-Control', 'no-store');
    return res.json(await sessionPayload(user));
  } catch (err) {
    return next(err);
  }
});

router.post('/activate', requireUser, async (req, res, next) => {
  try {
    const code = trimmed(req.body?.activation_code).toUpperCase();
    if (!code) return res.status(400).json({ error: 'Activation code is required' });

    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });
    if (user.account_status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
    }

    const result = await activateWithCode({ code, userId: user.id });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    const fresh = await findUserById(user.id);
    return res.json({ ...(await sessionPayload(fresh)), activated_plan: result.plan });
  } catch (err) {
    return next(err);
  }
});

export default router;
