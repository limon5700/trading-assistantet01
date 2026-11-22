import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { getAdminSettings, updateSettings } from '../services/accounts.js';
import {
  CMS_SLUGS,
  absoluteMediaUrl,
  clearCmsPage,
  getPublicConfig,
  listCmsPages,
  normalizeSlug,
  upsertCmsPage,
} from '../services/cms.js';
import { deleteBrandingIcon, saveBrandingIcon } from '../services/uploads.js';

const router = express.Router();

const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.iconMaxBytes + 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const allowed = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/svg+xml',
      'image/x-icon',
      'image/vnd.microsoft.icon',
    ];
    if (!allowed.includes(mime)) {
      return cb(Object.assign(new Error('App icon must be a PNG, JPEG, WEBP, SVG or ICO image'), { status: 400 }));
    }
    return cb(null, true);
  },
});

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* -------------------------------------------------------------- CMS pages -- */

router.get('/cms', async (req, res, next) => {
  try {
    return res.json({ items: await listCmsPages(), slugs: CMS_SLUGS });
  } catch (error) {
    return next(error);
  }
});

router.put('/cms/:slug', async (req, res, next) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'slug must be "terms" or "about"' });

    const title = trimmed(req.body?.title);
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (title && title.length > 255) {
      return res.status(400).json({ error: 'title must be 255 characters or fewer' });
    }
    if (content.length > 200000) {
      return res.status(400).json({ error: 'content is too long (max 200000 characters)' });
    }

    const existing = (await listCmsPages()).find((page) => page.slug === slug);
    const item = await upsertCmsPage({
      slug,
      title: title || existing?.title || (slug === 'terms' ? 'Terms & Conditions' : 'About Us'),
      content,
    });

    return res.json({ item });
  } catch (error) {
    return next(error);
  }
});

router.delete('/cms/:slug', async (req, res, next) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'slug must be "terms" or "about"' });

    const item = await clearCmsPage(slug);
    return res.json({ ok: true, item });
  } catch (error) {
    return next(error);
  }
});

/* -------------------------------------------------------------- branding -- */

router.get('/branding', async (req, res, next) => {
  try {
    const settings = await getAdminSettings();
    return res.json({
      branding: {
        app_name: settings.app_name,
        app_icon_url: settings.app_icon_url,
        app_icon_full_url: absoluteMediaUrl(settings.app_icon_url),
      },
      public_config: await getPublicConfig(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/branding/icon', iconUpload.single('icon'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'An image file is required (field name: icon)' });

    const current = await getAdminSettings();
    const appIconUrl = await saveBrandingIcon({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      previousUrl: current.app_icon_url,
    });
    const settings = await updateSettings({ app_icon_url: appIconUrl });

    return res.status(201).json({
      app_icon_url: settings.app_icon_url,
      app_icon_full_url: absoluteMediaUrl(settings.app_icon_url),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/branding/icon', async (req, res, next) => {
  try {
    const current = await getAdminSettings();
    if (current.app_icon_url) {
      await deleteBrandingIcon(current.app_icon_url);
    }
    const settings = await updateSettings({ app_icon_url: '' });
    return res.json({ app_icon_url: settings.app_icon_url, app_icon_full_url: '' });
  } catch (error) {
    return next(error);
  }
});

export default router;
