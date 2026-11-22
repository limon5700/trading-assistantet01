import { getDb, timestamp } from '../db.js';
import { getPublicSettings, listPlans } from './accounts.js';
import { config } from '../config.js';

export const CMS_SLUGS = ['terms', 'about'];

export function normalizeSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  return CMS_SLUGS.includes(slug) ? slug : null;
}

export function mapCmsPage(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    content: row.content,
    updated_at: row.updated_at,
  };
}

export async function listCmsPages() {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM cms_pages ORDER BY id ASC');
  return rows.map(mapCmsPage);
}

export async function getCmsPage(slug) {
  const db = await getDb();
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const row = await db.get('SELECT * FROM cms_pages WHERE slug = ?', [normalized]);
  return mapCmsPage(row);
}

export async function upsertCmsPage({ slug, title, content }) {
  const db = await getDb();
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    throw Object.assign(new Error('slug must be "terms" or "about"'), { status: 400 });
  }

  const existing = await db.get('SELECT id FROM cms_pages WHERE slug = ?', [normalized]);
  if (existing) {
    await db.run('UPDATE cms_pages SET title = ?, content = ?, updated_at = ? WHERE slug = ?', [
      title,
      content,
      timestamp(),
      normalized,
    ]);
  } else {
    await db.run('INSERT INTO cms_pages (slug, title, content, updated_at) VALUES (?, ?, ?, ?)', [
      normalized,
      title,
      content,
      timestamp(),
    ]);
  }

  return getCmsPage(normalized);
}

/**
 * Clears a page's content while keeping its row. Keeping the row means the
 * startup seeder does not resurrect deleted copy on the next restart, and the
 * app shows its "not published" state.
 */
export async function clearCmsPage(slug) {
  const db = await getDb();
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    throw Object.assign(new Error('slug must be "terms" or "about"'), { status: 400 });
  }
  await db.run('UPDATE cms_pages SET content = ?, updated_at = ? WHERE slug = ?', [
    '',
    timestamp(),
    normalized,
  ]);
  return getCmsPage(normalized);
}

/** Absolute URL for a stored upload path, so the Android app can load it. */
export function absoluteMediaUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = config.publicBaseUrl;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return base ? `${base}${path}` : path;
}

/**
 * Everything the mobile app needs to render itself for a signed-out or
 * signed-in user: brand, legal pages, links and the active plan catalogue.
 */
export async function getPublicConfig() {
  const [settings, plans, terms, about] = await Promise.all([
    getPublicSettings(),
    listPlans({ activeOnly: true }),
    getCmsPage('terms'),
    getCmsPage('about'),
  ]);

  return {
    app_name: settings.app_name || 'AI Trading Assistant',
    app_icon_url: absoluteMediaUrl(settings.app_icon_url),
    terms_and_conditions: terms?.content ?? '',
    terms_title: terms?.title ?? 'Terms & Conditions',
    about_us: about?.content ?? '',
    about_title: about?.title ?? 'About Us',
    affiliate_link: settings.affiliate_link ?? '',
    support_contact_link: settings.support_contact_link ?? '',
    plans,
  };
}
