import { getDb, timestamp } from '../db.js';
import { config } from '../config.js';

const SUMMARY_COLUMNS = `id, title, source_type, file_name, page_count, is_active, created_at, updated_at`;

export async function listKnowledge() {
  const db = await getDb();
  return db.all(
    `SELECT ${SUMMARY_COLUMNS} FROM knowledge_base ORDER BY is_active DESC, updated_at DESC, id DESC`,
  );
}

export async function getKnowledge(id) {
  const db = await getDb();
  return db.get('SELECT * FROM knowledge_base WHERE id = ?', [id]);
}

export async function createKnowledge({ title, sourceType, content, fileName = null, pageCount = 0, isActive = true }) {
  const db = await getDb();
  const now = timestamp();
  const result = await db.run(
    `INSERT INTO knowledge_base
       (title, source_type, content, file_name, page_count, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, sourceType, content, fileName, pageCount, isActive ? 1 : 0, now, now],
  );
  return getKnowledge(result.insertId);
}

export async function updateKnowledge(id, { title, content, isActive }) {
  const db = await getDb();
  const current = await getKnowledge(id);
  if (!current) return null;

  const next = {
    title: title === undefined ? current.title : title,
    content: content === undefined ? current.content : content,
    isActive: isActive === undefined ? Number(current.is_active) === 1 : Boolean(isActive),
  };

  await db.run(
    'UPDATE knowledge_base SET title = ?, content = ?, is_active = ?, updated_at = ? WHERE id = ?',
    [next.title, next.content, next.isActive ? 1 : 0, timestamp(), id],
  );

  return getKnowledge(id);
}

export async function deleteKnowledge(id) {
  const db = await getDb();
  const result = await db.run('DELETE FROM knowledge_base WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

/** Returns all active entries, newest first, both full rows and summary counts. */
export async function getActiveKnowledge() {
  const db = await getDb();
  return db.all(
    'SELECT id, title, source_type, content, page_count FROM knowledge_base WHERE is_active = 1 ORDER BY updated_at DESC, id DESC',
  );
}

/**
 * Builds the knowledge block injected into the Gemini system instruction.
 * Per-entry and total size are capped so a huge library cannot blow the
 * model context window (or the request payload).
 */
export function buildKnowledgePrompt(entries) {
  if (!entries.length) {
    return 'No global knowledge entries are currently active. Analyse the chart using sound price-action and candlestick principles only.';
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
