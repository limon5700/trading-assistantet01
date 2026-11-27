import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { analyzeChart, normalizeMode } from '../services/gemini.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';
import { findUserById, logActivity } from '../services/accounts.js';
import { getTradeSettings } from '../services/tradeSettings.js';

const router = express.Router();

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please slow down.' },
});

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/**
 * Screenshots may arrive either as JSON (`{ imageBase64 }`) or as a multipart
 * form with an `image` file part. Both end up as base64 in the same place.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter(req, file, callback) {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      callback(
        Object.assign(new Error(`Unsupported image type: ${mime || 'unknown'}. Use JPEG, PNG or WEBP.`), {
          status: 400,
        }),
      );
      return;
    }
    callback(null, true);
  },
});

function normalizeImage(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { error: 'imageBase64 is required' };
  }

  let mimeType = 'image/jpeg';
  let data = input.trim();

  const dataUrl = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/s.exec(data);
  if (dataUrl) {
    mimeType = dataUrl[1].toLowerCase();
    data = dataUrl[2];
  }

  data = data.replace(/\s+/g, '');
  if (!ALLOWED_MIME.has(mimeType)) {
    return { error: `Unsupported image type: ${mimeType}. Use JPEG, PNG or WEBP.` };
  }
  if (data.length < 256) {
    return { error: 'imageBase64 is too small to be a screenshot' };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { error: 'imageBase64 is not valid base64' };
  }

  const byteLength = Math.floor((data.length * 3) / 4);
  if (byteLength > config.uploads.maxBytes) {
    return { error: `Screenshot is too large (max ${config.uploads.maxMb} MB)` };
  }

  return { data, mimeType };
}

/**
 * Extracts the screenshot from either a multipart upload or a JSON body.
 * Returns `{ data, mimeType }` or `{ error, status }`.
 */
function resolveImage(req) {
  if (req.file) {
    const mimeType = String(req.file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      return { error: `Unsupported image type: ${mimeType}. Use JPEG, PNG or WEBP.`, status: 400 };
    }
    if (!req.file.size) {
      return { error: 'The uploaded screenshot is empty', status: 400 };
    }
    const data = req.file.buffer.toString('base64');
    return normalizeImage(`data:${mimeType};base64,${data}`);
  }

  return normalizeImage(req.body?.imageBase64);
}

/**
 * A live scan sends a short burst of screen frames. The first frame stays in
 * `imageBase64` for older clients, so the extra frames are optional and one
 * damaged frame never costs the whole scan.
 */
const MAX_LIVE_FRAMES = 6;

function resolveLiveFrames(req) {
  const raw = req.body?.frames;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const frames = [];
  for (const item of raw.slice(0, MAX_LIVE_FRAMES)) {
    const normalized = normalizeImage(item);
    if (normalized.error) continue;
    frames.push({ imageBase64: normalized.data, mimeType: normalized.mimeType });
  }
  return frames;
}

function optionalString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function optionalNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The last directional signal per user and mode. The model can be right about
 * direction and still be tapped into eleven trades in fifteen minutes: the same
 * setup delivered repeatedly on every tap. A new trade may not start while the
 * previous one would still be inside its expiry, so that window is closed here
 * as well as in the Android widget.
 */
const recentSignals = new Map();
const COOLDOWN_MIN_MS = 75_000;
const COOLDOWN_BUFFER_MS = 15_000;

function applySignalCooldown(userId, analysis) {
  const key = `${userId}:${analysis.mode}`;
  const now = Date.now();

  if (recentSignals.size > 500) {
    for (const [entryKey, entry] of recentSignals) {
      if (entry.until <= now) recentSignals.delete(entryKey);
    }
  }

  const previous = recentSignals.get(key);
  if (analysis.signal === 'WAIT') return { analysis, cooldownSeconds: 0 };

  if (previous && previous.until > now) {
    const secondsLeft = Math.ceil((previous.until - now) / 1000);
    return {
      analysis: {
        ...analysis,
        signal: 'WAIT',
        confidence: 0,
        reason: `Cooldown: last ${previous.signal} trade is still open for ${secondsLeft}s. No new trade until it expires.`,
        voice_summary: `Cooldown. The last trade still has ${secondsLeft} seconds to run. No new trade yet.`,
      },
      cooldownSeconds: secondsLeft,
    };
  }

  const duration = Math.max(15, Math.min(300, Math.round(Number(analysis.duration_seconds) || 60)));
  const waitMs = Math.max(COOLDOWN_MIN_MS, duration * 1000 + COOLDOWN_BUFFER_MS);
  recentSignals.set(key, {
    signal: analysis.signal,
    until: now + waitMs,
    duration,
  });
  return { analysis, cooldownSeconds: 0 };
}

router.post('/analyze-chart', analyzeLimiter, requireUser, upload.single('image'), async (req, res, next) => {
  try {
    // Re-read the account on every scan so suspensions and activations apply immediately.
    const user = await findUserById(req.userId);
    if (!user) {
      return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });
    }
    if (user.account_status !== 'ACTIVE') {
      return res.status(403).json({
        error:
          user.account_status === 'SUSPENDED'
            ? 'Your account is suspended. Please contact support.'
            : 'Your account is pending activation. Enter your activation code in the app.',
        code: 'ACCOUNT_NOT_ACTIVE',
        account_status: user.account_status,
      });
    }

    const image = resolveImage(req);
    if (image.error) return res.status(image.status || 400).json({ error: image.error });

    const liveFrames = resolveLiveFrames(req);

    const body = req.body ?? {};
    const mode = normalizeMode(body.mode);
    const savedSettings = await getTradeSettings(user.id);

    // Request values win over saved settings, so a single scan can override the
    // user's default without permanently changing it.
    const minConfidence = optionalNumber(
      body.min_confidence,
      mode === 'BINARY' ? savedSettings.binary_min_confidence : savedSettings.forex_min_confidence,
    );
    const preferredDuration = optionalNumber(
      body.preferred_duration_seconds ?? body.duration_seconds,
      savedSettings.binary_duration_seconds,
    );
    const preferredTimeframe =
      optionalString(body.preferred_timeframe ?? body.timeframe, 8).toUpperCase() ||
      savedSettings.forex_timeframe;
    const userCustomStrategy =
      optionalString(body.user_custom_strategy, 4000) ||
      (mode === 'BINARY' ? savedSettings.binary_strategy : savedSettings.forex_strategy);

    const {
      analysis: freshAnalysis,
      strategySource,
      model,
      modelsAttempted,
    } = await analyzeChart({
      imageBase64: image.data,
      mimeType: image.mimeType,
      frames: liveFrames,
      frameIntervalMs: optionalNumber(body.frameIntervalMs, 0),
      currentTime: optionalString(body.currentTime ?? body.current_time, 64),
      timezone: optionalString(body.timezone, 64),
      mode,
      userCustomStrategy,
      minConfidence,
      preferredDuration,
      preferredTimeframe,
    });

    const { analysis, cooldownSeconds } = applySignalCooldown(user.id, freshAnalysis);

    await logActivity({
      userId: user.id,
      action: 'SIGNAL_SCAN',
      details: {
        mode: analysis.mode,
        signal: analysis.signal,
        confidence: analysis.confidence,
        asset: analysis.asset,
        candle_entry: analysis.candle_entry,
        duration_seconds: analysis.duration_seconds,
        timeframe: analysis.timeframe,
        chart_timeframe: analysis.chart_timeframe,
        setup_grade: analysis.setup_grade,
        trend_bias: analysis.trend_bias,
        market_type: analysis.market_type,
        vetoes: analysis.vetoes,
        key_level: analysis.key_level,
        next_candle_seconds: analysis.next_candle_seconds,
        entry_window_seconds: analysis.entry_window_seconds,
        cooldown_seconds: cooldownSeconds || undefined,
        min_confidence: Math.round(minConfidence),
        model,
        models_attempted: modelsAttempted,
        strategy_source: strategySource,
      },
    });

    res.set('Cache-Control', 'no-store');
    res.set('X-Strategy-Source', strategySource);
    res.set('X-Gemini-Model', model);
    res.set('X-Gemini-Attempts', String(modelsAttempted.length));
    res.set('X-Signal-Mode', analysis.mode);
    if (analysis.setup_grade) res.set('X-Setup-Grade', String(analysis.setup_grade));
    if (cooldownSeconds) res.set('X-Signal-Cooldown', String(cooldownSeconds));
    return res.json(analysis);
  } catch (error) {
    if (String(error.message).includes('timed out')) {
      return res.status(504).json({ error: 'Analysis timed out, please try again' });
    }
    if (error?.status) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return next(error);
  }
});

export default router;
