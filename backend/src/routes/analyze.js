import express from 'express';
import rateLimit from 'express-rate-limit';
import { analyzeChart } from '../services/gemini.js';
import { config } from '../config.js';

const router = express.Router();

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please slow down.' },
});

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

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

router.post('/analyze-chart', analyzeLimiter, async (req, res, next) => {
  try {
    const { imageBase64, currentTime, timezone } = req.body ?? {};
    const image = normalizeImage(imageBase64);
    if (image.error) return res.status(400).json({ error: image.error });

    const { analysis, knowledgeEntriesUsed } = await analyzeChart({
      imageBase64: image.data,
      mimeType: image.mimeType,
      currentTime: typeof currentTime === 'string' ? currentTime.slice(0, 64) : '',
      timezone: typeof timezone === 'string' ? timezone.slice(0, 64) : '',
    });

    res.set('Cache-Control', 'no-store');
    res.set('X-Knowledge-Entries', String(knowledgeEntriesUsed));
    return res.json(analysis);
  } catch (error) {
    if (String(error.message).includes('timed out')) {
      return res.status(504).json({ error: 'Analysis timed out, please try again' });
    }
    return next(error);
  }
});

export default router;
