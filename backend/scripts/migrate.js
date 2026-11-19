import { config } from '../src/config.js';
import { closeDb, initSchema } from '../src/db.js';

async function main() {
  const client = await initSchema();
  const target = client === 'mysql' ? `${config.db.mysql.host}/${config.db.mysql.database}` : config.db.sqlitePath;
  console.log(
    `[migrate] knowledge_base, plans, users, activation_codes, app_settings and user_activities are ready on ${client} (${target})`,
  );
  await closeDb();
}

main().catch(async (error) => {
  console.error('[migrate] failed:', error);
  await closeDb().catch(() => {});
  process.exit(1);
});
