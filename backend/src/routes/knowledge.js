import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { config } from '../config.js';
import {
  createKnowledge,
  deleteKnowledge,
  getKnowledge,
  listKnowledge,
  normalizeCategory,
  updateKnowledge,
} from '../services/knowledge.js';
import { deleteKnowledgePdf, resolveUploadPath, saveKnowledgePdf } from '../services/uploads.js';
import { extractPdf } from '../services/pdf.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' || String(file.originalname).toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return cb(Object.assign(new Error('Only PDF files are accepted'), { status: 400 }));
    }
    return cb(null, true);
  },
});

function parseActive(value, fallback = true) {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function validateTitle(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'Title is required' };
  }
  const title = value.trim();
  if (title.length > 255) {
    return { error: 'Title must be 255 characters or fewer' };
  }
  return { title };
}

function validateCategory(value) {
  if (value === undefined || value === '') return { category: 'GENERAL' };
  const category = normalizeCategory(value, '');
  if (!category) {
    return { error: 'category must be BINARY, FOREX or GENERAL' };
  }
  return { category };
}

function respond(item) {
  return { ...item, is_active: Number(item.is_active) === 1 };
}

router.get('/', async (req, res, next) => {
  try {
    const rawCategory = typeof req.query.category === 'string' ? req.query.category : '';
    const category = rawCategory ? normalizeCategory(rawCategory, '') : '';
    if (rawCategory && !category) {
      return res.status(400).json({ error: 'category must be BINARY, FOREX or GENERAL' });
    }

    const items = await listKnowledge({ category });
    return res.json({ items: items.map(respond), count: items.length });
  } catch (error) {
    return next(error);
  }
});

router.post('/text', async (req, res, next) => {
  try {
    const { title, error } = validateTitle(req.body?.title);
    if (error) return res.status(400).json({ error });

    const { category, error: categoryError } = validateCategory(req.body?.category);
    if (categoryError) return res.status(400).json({ error: categoryError });

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const item = await createKnowledge({
      title,
      category,
      sourceType: 'TEXT',
      content,
      pageCount: 0,
      isActive: parseActive(req.body?.is_active),
    });
    return res.status(201).json({ item: respond(item) });
  } catch (err) {
    return next(err);
  }
});

router.post('/pdf', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'A PDF file is required (field name: file)' });

    const fallbackTitle = req.file.originalname.replace(/\.pdf$/i, '');
    const { title, error } = validateTitle(req.body?.title || fallbackTitle);
    if (error) return res.status(400).json({ error });

    const { category, error: categoryError } = validateCategory(req.body?.category);
    if (categoryError) return res.status(400).json({ error: categoryError });

    let parsed;
    try {
      parsed = await extractPdf(req.file.buffer);
    } catch (parseError) {
      return res.status(422).json({ error: `Could not read this PDF: ${parseError.message}` });
    }

    if (!parsed.content.trim()) {
      return res.status(422).json({ error: 'No extractable text found in this PDF (is it a scanned image?)' });
    }

    const pdfFilePath = await saveKnowledgePdf({ buffer: req.file.buffer }).catch((saveError) => {
      console.warn(`[knowledge] could not store the PDF copy: ${saveError?.message || saveError}`);
      return null;
    });

    const item = await createKnowledge({
      title,
      category,
      sourceType: 'PDF',
      content: parsed.content,
      fileName: req.file.originalname,
      pdfFilePath,
      pageCount: parsed.pageCount,
      isActive: parseActive(req.body?.is_active),
    });

    return res.status(201).json({ item: respond(item), pageCount: parsed.pageCount });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const item = await getKnowledge(id);
    if (!item) return res.status(404).json({ error: 'Knowledge entry not found' });

    return res.json({ item: respond(item) });
  } catch (err) {
    return next(err);
  }
});

/** Streams the original uploaded PDF so the dashboard can preview it. */
router.get('/:id/file', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const item = await getKnowledge(id);
    if (!item) return res.status(404).json({ error: 'Knowledge entry not found' });
    if (!item.pdf_file_path) {
      return res.status(404).json({ error: 'This entry has no stored PDF file' });
    }

    const absolute = resolveUploadPath(item.pdf_file_path);
    if (!absolute || !fs.existsSync(absolute)) {
      return res.status(404).json({ error: 'The stored PDF is no longer available' });
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(item.file_name || 'strategy.pdf')}"`);
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const { title, category, content, is_active: isActiveRaw } = req.body ?? {};
    if (
      title === undefined &&
      category === undefined &&
      content === undefined &&
      isActiveRaw === undefined
    ) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    let nextTitle;
    if (title !== undefined) {
      const validated = validateTitle(title);
      if (validated.error) return res.status(400).json({ error: validated.error });
      nextTitle = validated.title;
    }

    let nextCategory;
    if (category !== undefined) {
      const validated = validateCategory(category);
      if (validated.error) return res.status(400).json({ error: validated.error });
      nextCategory = validated.category;
    }

    let nextContent;
    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Content cannot be empty' });
      }
      nextContent = content.trim();
    }

    const item = await updateKnowledge(id, {
      title: nextTitle,
      category: nextCategory,
      content: nextContent,
      isActive: isActiveRaw === undefined ? undefined : parseActive(isActiveRaw),
    });
    if (!item) return res.status(404).json({ error: 'Knowledge entry not found' });

    return res.json({ item: respond(item) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const deleted = await deleteKnowledge(id);
    if (!deleted) return res.status(404).json({ error: 'Knowledge entry not found' });
    await deleteKnowledgePdf(deleted.pdf_file_path);
    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

export default router;
