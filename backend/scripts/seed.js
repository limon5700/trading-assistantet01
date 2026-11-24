import { config } from '../src/config.js';
import { closeDb, initSchema } from '../src/db.js';

/**
 * Explicit, idempotent seed command.
 *
 * initSchema() creates every table and then:
 *   - inserts the default FREE / PAID plans when the plans table is empty,
 *   - inserts every missing app setting (branding, crypto, affiliate links),
 *   - inserts the Terms and About CMS pages,
 *   - inserts every missing BINARY and FOREX strategy entry (topic playbooks
 *     plus the full manual text), matched by category + title.
 *
 * Running it repeatedly is safe: nothing is duplicated and admin edits are
 * never overwritten.
 */
async function main() {
  const client = await initSchema();

  const target =
    client === 'mysql'
      ? `${config.db.mysql.host}:${config.db.mysql.port}/${config.db.mysql.database}`
      : config.db.sqlitePath;

  console.log(`[seed] database ready: ${client} (${target})`);

  const counts = await summary();
  for (const [label, value] of Object.entries(counts)) {
    console.log(`[seed] ${label}: ${value}`);
  }

  if (counts.BINARY === 0 || counts.FOREX === 0) {
    throw new Error('Strategy seeding failed: a category is still empty');
  }

  await closeDb();
}

async function summary() {
  const { getDb } = await import('../src/db.js');
  const db = await getDb();
  const row = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM plans) AS plans,
       (SELECT COUNT(*) FROM app_settings) AS settings,
       (SELECT COUNT(*) FROM cms_pages) AS cms,
       (SELECT COUNT(*) FROM knowledge_base WHERE category = 'BINARY' AND is_active = 1) AS BINARY,
       (SELECT COUNT(*) FROM knowledge_base WHERE category = 'FOREX' AND is_active = 1) AS FOREX`,
  );
  return {
    plans: Number(row?.plans ?? 0),
    settings: Number(row?.settings ?? 0),
    cmsPages: Number(row?.cms ?? 0),
    BINARY: Number(row?.BINARY ?? 0),
    FOREX: Number(row?.FOREX ?? 0),
  };
}

main().catch(async (error) => {
  console.error('[seed] failed:', error);
  await closeDb().catch(() => {});
  process.exit(1);
});
