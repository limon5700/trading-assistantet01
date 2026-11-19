import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Minimal dialect-agnostic database adapter.
 *
 * Exposes three promise based helpers used across the API:
 *   all(sql, params)  -> array of rows
 *   get(sql, params)  -> first row or null
 *   run(sql, params)  -> { insertId, affectedRows }
 *
 * MySQL uses mysql2/promise with a connection pool. SQLite uses the Node
 * built-in `node:sqlite` driver (no native build step required).
 */

let driver = null;

export function timestamp(date = new Date()) {
  const iso = date.toISOString(); // 2026-01-31T14:35:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`; // 2026-01-31 14:35:00 (UTC)
}

async function createDriver() {
  if (config.db.client === 'mysql') {
    const mysql = await import('mysql2/promise');
    const pool = mysql.createPool({
      ...config.db.mysql,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: false,
      charset: 'utf8mb4',
      timezone: 'Z',
    });

    return {
      client: 'mysql',
      async all(sql, params = []) {
        const [rows] = await pool.execute(sql, params);
        return Array.isArray(rows) ? rows : [];
      },
      async get(sql, params = []) {
        const rows = await this.all(sql, params);
        return rows.length ? rows[0] : null;
      },
      async run(sql, params = []) {
        const [result] = await pool.execute(sql, params);
        return {
          insertId: Number(result.insertId) || null,
          affectedRows: Number(result.affectedRows) || 0,
        };
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
    };
  }

  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(config.db.sqlitePath), { recursive: true });
  const db = new DatabaseSync(config.db.sqlitePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    client: 'sqlite',
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      const row = db.prepare(sql).get(...params);
      return row ?? null;
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return {
        insertId: result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid),
        affectedRows: Number(result.changes) || 0,
      };
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

export async function getDb() {
  if (!driver) {
    driver = await createDriver();
  }
  return driver;
}

export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

const KNOWLEDGE_DDL = {
  mysql: `
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      source_type ENUM('TEXT', 'PDF') NOT NULL,
      content LONGTEXT NOT NULL,
      file_name VARCHAR(255) NULL,
      page_count INT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_knowledge_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('TEXT', 'PDF')),
      content TEXT NOT NULL,
      file_name TEXT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
};

/** Creates the schema when it does not exist yet. Safe to run repeatedly. */
export async function initSchema() {
  const db = await getDb();
  await db.exec(KNOWLEDGE_DDL[db.client]);
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_active ON knowledge_base (is_active)',
  ).catch(() => {
    // MySQL does not support CREATE INDEX IF NOT EXISTS; the inline KEY covers it.
  });
  return db.client;
}
