import { config } from '../src/config.js';
import { closeDb, initSchema } from '../src/db.js';

async function main() {
  const client = await initSchema();
  const target = `${config.db.host}:${config.db.port}/${config.db.database}`;
  console.log(
    `[migrate] knowledge_base (BINARY/FOREX/GENERAL), cms_pages, user_trade_settings, plans, users, activation_codes, app_settings and user_activities are ready on ${client} (${target})`,
  );
  await closeDb();
}

main().catch(async (error) => {
  console.error('[migrate] failed:', error);
  await closeDb().catch(() => {});
  process.exit(1);
});
