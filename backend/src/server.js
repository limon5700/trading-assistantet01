import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, initSchema } from './db.js';

async function main() {
  const client = await initSchema();
  console.log(`[db] schema ready (${client})`);

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] listening on http://0.0.0.0:${config.port}`);
    console.log(`[server] gemini model: ${config.gemini.model}`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await closeDb().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
