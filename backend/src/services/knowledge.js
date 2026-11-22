import { getDb, timestamp } from '../db.js';
import { config } from '../config.js';

export const KNOWLEDGE_CATEGORIES = ['BINARY', 'FOREX', 'GENERAL'];

const SUMMARY_COLUMNS = `id, title, category, source_type, file_name, pdf_file_path, page_count, is_active, created_at, updated_at`;

export function normalizeCategory(value, fallback = 'GENERAL') {
  const category = String(value ?? '').trim().toUpperCase();
  return KNOWLEDGE_CATEGORIES.includes(category) ? category : fallback;
}

export function mapKnowledge(row) {
  if (!row) return null;
  return { ...row, is_active: Number(row.is_active) === 1 };
}

export async function listKnowledge({ category = '' } = {}) {
  const db = await getDb();
  const where = [];
  const params = [];
  if (category) {
    where.push('category = ?');
    params.push(normalizeCategory(category));
  }
  return db.all(
    `SELECT ${SUMMARY_COLUMNS} FROM knowledge_base
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY is_active DESC, updated_at DESC, id DESC`,
    params,
  );
}

export async function getKnowledge(id) {
  const db = await getDb();
  return db.get('SELECT * FROM knowledge_base WHERE id = ?', [id]);
}

export async function createKnowledge({
  title,
  category = 'GENERAL',
  sourceType,
  content,
  fileName = null,
  pdfFilePath = null,
  pageCount = 0,
  isActive = true,
}) {
  const db = await getDb();
  const now = timestamp();
  const result = await db.run(
    `INSERT INTO knowledge_base
       (title, category, source_type, content, file_name, pdf_file_path, page_count, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      normalizeCategory(category),
      sourceType,
      content,
      fileName,
      pdfFilePath,
      pageCount,
      isActive ? 1 : 0,
      now,
      now,
    ],
  );
  return getKnowledge(result.insertId);
}

export async function updateKnowledge(id, { title, category, content, isActive }) {
  const db = await getDb();
  const current = await getKnowledge(id);
  if (!current) return null;

  const next = {
    title: title === undefined ? current.title : title,
    category: category === undefined ? current.category : normalizeCategory(category, current.category),
    content: content === undefined ? current.content : content,
    isActive: isActive === undefined ? Number(current.is_active) === 1 : Boolean(isActive),
  };

  await db.run(
    `UPDATE knowledge_base
     SET title = ?, category = ?, content = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
    [next.title, next.category, next.content, next.isActive ? 1 : 0, timestamp(), id],
  );

  return getKnowledge(id);
}

export async function deleteKnowledge(id) {
  const db = await getDb();
  const current = await getKnowledge(id);
  const result = await db.run('DELETE FROM knowledge_base WHERE id = ?', [id]);
  return result.affectedRows > 0 ? current : null;
}

/**
 * Active entries for one analysis mode. Binary scans read the BINARY library,
 * forex scans read the FOREX library — the two never bleed into each other.
 */
export async function getActiveKnowledge(category) {
  const db = await getDb();
  const mode = normalizeCategory(category, 'GENERAL');
  return db.all(
    `SELECT id, title, category, source_type, content, page_count
     FROM knowledge_base
     WHERE is_active = 1 AND category = ?
     ORDER BY updated_at DESC, id DESC`,
    [mode],
  );
}

/**
 * Builds the knowledge block injected into the Gemini system instruction.
 * Per-entry and total size are capped so a huge library cannot blow the
 * model context window (or the request payload).
 */
export function buildKnowledgePrompt(entries) {
  if (!entries.length) {
    return 'No strategy entries are active for this mode. Analyse the chart using the built-in price-action, candlestick and smart-money principles only.';
  }

  const maxChars = config.gemini.maxKnowledgeChars;
  const blocks = [];
  let used = 0;
  let omitted = 0;

  for (const entry of entries) {
    const header = `### ${entry.title} (${entry.source_type}${entry.page_count ? `, ${entry.page_count} pages` : ''})\n`;
    const remaining = maxChars - used;
    if (remaining <= header.length + 200) {
      omitted += 1;
      continue;
    }
    const body = String(entry.content || '').slice(0, remaining - header.length);
    const truncated = body.length < String(entry.content || '').length;
    blocks.push(`${header}${body}${truncated ? '\n[entry truncated]' : ''}`);
    used += header.length + body.length;
    if (truncated) break;
  }

  if (omitted > 0) {
    blocks.push(`[${omitted} further active knowledge entr${omitted === 1 ? 'y was' : 'ies were'} omitted for length]`);
  }

  return blocks.join('\n\n');
}
