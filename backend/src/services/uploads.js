import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const ICON_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export const BRANDING_DIR = path.join(config.uploads.dir, 'branding');
export const KNOWLEDGE_DIR = path.join(config.uploads.dir, 'knowledge');

export async function ensureUploadDirs() {
  await fs.mkdir(BRANDING_DIR, { recursive: true });
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
}

export function iconExtensionFor(mimeType, originalName = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (ICON_EXTENSIONS[mime]) return ICON_EXTENSIONS[mime];
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return null;
}

function randomName(extension) {
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${extension}`;
}

/**
 * Stores an uploaded app icon under uploads/branding and returns the public
 * relative path (`/uploads/branding/<file>`). Any previous icon for the app is
 * removed so the folder cannot grow without bound.
 */
export async function saveBrandingIcon({ buffer, mimeType, originalName, previousUrl }) {
  await ensureUploadDirs();

  const extension = iconExtensionFor(mimeType, originalName);
  if (!extension) {
    throw Object.assign(new Error('App icon must be a PNG, JPEG, WEBP, SVG or ICO image'), {
      status: 400,
    });
  }
  if (!buffer?.length) {
    throw Object.assign(new Error('The uploaded icon is empty'), { status: 400 });
  }
  if (buffer.length > config.uploads.iconMaxBytes) {
    throw Object.assign(
      new Error(`App icon is too large (max ${Math.round(config.uploads.iconMaxBytes / 1024)} KB)`),
      { status: 413 },
    );
  }

  const fileName = randomName(extension);
  await fs.writeFile(path.join(BRANDING_DIR, fileName), buffer);

  if (previousUrl) {
    const previousName = path.basename(String(previousUrl).split('?')[0]);
    if (previousName && previousName !== fileName && /^[\w.-]+$/.test(previousName)) {
      await fs.unlink(path.join(BRANDING_DIR, previousName)).catch(() => {});
    }
  }

  return `${config.uploads.publicPath}/branding/${fileName}`;
}

/** Deletes a previously stored branding icon, ignoring missing files. */
export async function deleteBrandingIcon(publicPath) {
  if (!publicPath) return;
  const name = path.basename(String(publicPath).split('?')[0]);
  if (!name || !/^[\w.-]+$/.test(name)) return;
  await fs.unlink(path.join(BRANDING_DIR, name)).catch(() => {});
}

/** Stores the original PDF so the dashboard can preview the real document. */
export async function saveKnowledgePdf({ buffer }) {
  await ensureUploadDirs();
  const fileName = randomName('.pdf');
  await fs.writeFile(path.join(KNOWLEDGE_DIR, fileName), buffer);
  return `${config.uploads.publicPath}/knowledge/${fileName}`;
}

export async function deleteKnowledgePdf(pdfFilePath) {
  if (!pdfFilePath) return;
  const name = path.basename(String(pdfFilePath).split('?')[0]);
  if (!name || !/^[\w.-]+\.pdf$/i.test(name)) return;
  await fs.unlink(path.join(KNOWLEDGE_DIR, name)).catch(() => {});
}

/**
 * Resolves a stored `/uploads/...` path to an absolute path, refusing anything
 * that escapes the uploads directory.
 */
export function resolveUploadPath(publicPath) {
  const relative = String(publicPath || '').replace(/^\/?uploads\//, '');
  if (!relative) return null;
  const absolute = path.resolve(config.uploads.dir, relative);
  const root = path.resolve(config.uploads.dir);
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}
