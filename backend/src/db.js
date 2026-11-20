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
  mysql: `CREATE TABLE IF NOT EXISTS knowledge_base (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  sqlite: `CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('TEXT', 'PDF')),
      content TEXT NOT NULL,
      file_name TEXT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
};

const ACCOUNTS_DDL = {
  mysql: [
    `CREATE TABLE IF NOT EXISTS plans (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      plan_type ENUM('FREE', 'PAID') NOT NULL DEFAULT 'FREE',
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      duration_days INT UNSIGNED NOT NULL DEFAULT 30,
      description TEXT NULL,
      features_json TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_plan_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(120) NOT NULL,
      username VARCHAR(40) NOT NULL,
      email VARCHAR(190) NOT NULL,
      phone VARCHAR(32) NULL,
      password_hash VARCHAR(255) NOT NULL,
      account_status ENUM('PENDING', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'PENDING',
      active_plan_id INT UNSIGNED NULL,
      activation_code_used VARCHAR(40) NULL,
      last_active_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username),
      UNIQUE KEY uq_users_email (email),
      KEY idx_users_status (account_status),
      CONSTRAINT fk_users_plan FOREIGN KEY (active_plan_id) REFERENCES plans (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS activation_codes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      assigned_user_id INT UNSIGNED NULL,
      plan_id INT UNSIGNED NOT NULL,
      is_used TINYINT(1) NOT NULL DEFAULT 0,
      used_by_user_id INT UNSIGNED NULL,
      used_at DATETIME NULL,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_activation_code (code),
      KEY idx_code_assigned (assigned_user_id),
      KEY idx_code_plan (plan_id),
      CONSTRAINT fk_code_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_code_used_user FOREIGN KEY (used_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_code_plan FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(64) NOT NULL,
      setting_value TEXT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_activities (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      action VARCHAR(32) NOT NULL,
      details TEXT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_activity_user (user_id, created_at),
      KEY idx_activity_action (action),
      CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS crypto_payments (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      plan_id INT UNSIGNED NOT NULL,
      expected_amount_usdt DECIMAL(18, 6) NOT NULL,
      network VARCHAR(16) NOT NULL,
      wallet_address VARCHAR(128) NOT NULL,
      tx_hash VARCHAR(128) NULL,
      status ENUM('PENDING', 'VERIFIED', 'FAILED') NOT NULL DEFAULT 'PENDING',
      verified_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_crypto_tx_hash (tx_hash),
      KEY idx_crypto_user (user_id, created_at),
      KEY idx_crypto_status (status),
      KEY idx_crypto_plan (plan_id),
      CONSTRAINT fk_crypto_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_crypto_plan FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
  sqlite: [
    `CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plan_type TEXT NOT NULL DEFAULT 'FREE' CHECK (plan_type IN ('FREE', 'PAID')),
      price REAL NOT NULL DEFAULT 0,
      duration_days INTEGER NOT NULL DEFAULT 30,
      description TEXT NULL,
      features_json TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NULL,
      password_hash TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (account_status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
      active_plan_id INTEGER NULL REFERENCES plans (id) ON DELETE SET NULL,
      activation_code_used TEXT NULL,
      last_active_at TEXT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activation_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      assigned_user_id INTEGER NULL REFERENCES users (id) ON DELETE SET NULL,
      plan_id INTEGER NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
      is_used INTEGER NOT NULL DEFAULT 0,
      used_by_user_id INTEGER NULL REFERENCES users (id) ON DELETE SET NULL,
      used_at TEXT NULL,
      expires_at TEXT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      details TEXT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS crypto_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
      expected_amount_usdt REAL NOT NULL,
      network TEXT NOT NULL CHECK (network IN ('BEP20', 'TRC20')),
      wallet_address TEXT NOT NULL,
      tx_hash TEXT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED')),
      verified_at TEXT NULL,
      created_at TEXT NOT NULL
    )`,
  ],
};

const DEFAULT_PLANS = [
  {
    name: 'Free Affiliate Plan',
    planType: 'FREE',
    price: 0,
    durationDays: 36500,
    description:
      'Open a trading account through our official affiliate link, send the proof to support and receive a personal activation code.',
    features: [
      'Activation through the official affiliate link',
      'Personal one-time activation code',
      'Live chart signals while the account is active',
      'Community support',
    ],
  },
  {
    name: 'Paid Pro Plan',
    planType: 'PAID',
    price: 29,
    durationDays: 30,
    description:
      'Pay the subscription fee to support and receive a personal activation code for 30 days of full access.',
    features: [
      'Everything in the Free Affiliate Plan',
      '30 days of full access from activation',
      'Priority support on Telegram / WhatsApp',
      'Unlimited chart scans',
    ],
  },
];

const DEFAULT_SETTINGS = [
  ['affiliate_link', ''],
  ['support_contact_link', ''],
  ['app_name', 'AI Trading Assistant'],
  ['default_plan_type', 'FREE'],
  ['crypto_network', 'BEP20'],
  ['crypto_wallet_address', ''],
  ['bscscan_api_key', ''],
  ['trongrid_api_key', ''],
];

/** Creates the schema when it does not exist yet. Safe to run repeatedly. */
export async function initSchema() {
  const db = await getDb();

  await db.exec(KNOWLEDGE_DDL[db.client]);
  await db
    .exec('CREATE INDEX IF NOT EXISTS idx_knowledge_active ON knowledge_base (is_active)')
    .catch(() => {
      // MySQL does not support CREATE INDEX IF NOT EXISTS; the inline KEY covers it.
    });

  for (const statement of ACCOUNTS_DDL[db.client]) {
    await db.exec(statement);
  }

  if (db.client === 'sqlite') {
    await db.exec('CREATE INDEX IF NOT EXISTS idx_activities_user ON user_activities (user_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_codes_assigned ON activation_codes (assigned_user_id)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_crypto_user ON crypto_payments (user_id, created_at)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_crypto_status ON crypto_payments (status)');
  }

  await seedDefaults(db);
  return db.client;
}

async function seedDefaults(db) {
  const planRow = await db.get('SELECT COUNT(*) AS total FROM plans');
  if (Number(planRow?.total ?? 0) === 0) {
    for (const plan of DEFAULT_PLANS) {
      await db.run(
        `INSERT INTO plans (name, plan_type, price, duration_days, description, features_json, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plan.name,
          plan.planType,
          plan.price,
          plan.durationDays,
          plan.description,
          JSON.stringify(plan.features),
          1,
          timestamp(),
        ],
      );
    }
  }

  const insertSetting =
    db.client === 'mysql'
      ? 'INSERT IGNORE INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)'
      : 'INSERT OR IGNORE INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)';

  for (const [key, value] of DEFAULT_SETTINGS) {
    await db.run(insertSetting, [key, value, timestamp()]);
  }
}
