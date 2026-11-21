import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { analyzeChart } from '../services/gemini.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';
import { findUserById, logActivity } from '../services/accounts.js';

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

    const { currentTime, timezone } = req.body ?? {};
    const { analysis, knowledgeEntriesUsed, model, modelsAttempted } = await analyzeChart({
      imageBase64: image.data,
      mimeType: image.mimeType,
      currentTime: typeof currentTime === 'string' ? currentTime.slice(0, 64) : '',
      timezone: typeof timezone === 'string' ? timezone.slice(0, 64) : '',
    });

    await logActivity({
      userId: user.id,
      action: 'SIGNAL_SCAN',
      details: {
        signal: analysis.signal,
        confidence: analysis.confidence,
        asset: analysis.asset,
        timeframe: analysis.timeframe,
        model,
        models_attempted: modelsAttempted,
        knowledge_entries: knowledgeEntriesUsed,
      },
    });

    res.set('Cache-Control', 'no-store');
    res.set('X-Knowledge-Entries', String(knowledgeEntriesUsed));
    res.set('X-Gemini-Model', model);
    res.set('X-Gemini-Attempts', String(modelsAttempted.length));
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
