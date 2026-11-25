import { config } from './config.js';
import { DEFAULT_CMS_PAGES } from './services/defaults.js';

/**
 * MySQL data access for the API.
 *
 * Exposes three promise based helpers used across the routes:
 *   all(sql, params)  -> array of rows
 *   get(sql, params)  -> first row or null
 *   run(sql, params)  -> { insertId, affectedRows }
 *
 * The connection pool waits for MySQL on boot (Docker starts both containers
 * at once) and every table is created with MySQL DDL only: there is no second
 * dialect and no local database file.
 */

let driver = null;

export function timestamp(date = new Date()) {
  const iso = date.toISOString(); // 2026-01-31T14:35:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`; // 2026-01-31 14:35:00 (UTC)
}

async function createDriver() {
  const mysql = await import('mysql2/promise');
  const { connectAttempts, connectRetryMs, ...mysqlOptions } = config.db;
  const pool = mysql.createPool({
    ...mysqlOptions,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false,
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  // In Docker the backend can win the race against MySQL's first init, so wait
  // for the server instead of failing the container on boot.
  let lastError = null;
  for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
    try {
      const connection = await pool.getConnection();
      try {
        await connection.ping();
      } finally {
        connection.release();
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt === connectAttempts) break;
      console.warn(
        `[db] MySQL not ready (attempt ${attempt}/${connectAttempts}): ${error?.message || error}`,
      );
      await new Promise((resolve) => setTimeout(resolve, connectRetryMs));
    }
  }
  if (lastError) {
    await pool.end().catch(() => {});
    throw lastError;
  }

  return {
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

const KNOWLEDGE_DDL = `CREATE TABLE IF NOT EXISTS knowledge_base (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    category ENUM('BINARY', 'FOREX', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
    source_type ENUM('TEXT', 'PDF', 'PDF_TEXT') NOT NULL DEFAULT 'TEXT',
    content LONGTEXT NOT NULL,
    file_name VARCHAR(255) NULL,
    pdf_file_path VARCHAR(255) NULL,
    page_count INT UNSIGNED NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_knowledge_active (is_active),
    KEY idx_knowledge_category (category, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const KNOWLEDGE_COLUMNS = [
  "ADD COLUMN category ENUM('BINARY', 'FOREX', 'GENERAL') NOT NULL DEFAULT 'GENERAL'",
  'ADD COLUMN pdf_file_path VARCHAR(255) NULL',
];

/** CMS pages (Terms, About) and per-user trade settings. */
const CONTENT_DDL = [
  `CREATE TABLE IF NOT EXISTS cms_pages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cms_slug (slug)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_trade_settings (
    user_id INT UNSIGNED NOT NULL,
    binary_min_confidence INT UNSIGNED NOT NULL DEFAULT 70,
    binary_duration_seconds INT UNSIGNED NOT NULL DEFAULT 60,
    binary_strategy TEXT NULL,
    forex_min_confidence INT UNSIGNED NOT NULL DEFAULT 70,
    forex_timeframe VARCHAR(8) NOT NULL DEFAULT '15M',
    forex_strategy TEXT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_trade_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const ACCOUNTS_DDL = [
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
];

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
  ['app_icon_url', ''],
  ['default_plan_type', 'FREE'],
  ['crypto_network', 'BEP20'],
  ['crypto_wallet_address', ''],
  ['bscscan_api_key', ''],
  ['trongrid_api_key', ''],
];

/** Creates the schema when it does not exist yet. Safe to run repeatedly. */
export async function initSchema() {
  const db = await getDb();

  await db.exec(KNOWLEDGE_DDL);

  for (const statement of ACCOUNTS_DDL) {
    await db.exec(statement);
  }

  await migrateKnowledgeColumns(db);
  await migrateSourceType(db);

  for (const statement of CONTENT_DDL) {
    await db.exec(statement);
  }

  await ensureDefaults(db);
  return 'mysql';
}

async function migrateKnowledgeColumns(db) {
  const existing = new Set(
    (
      await db.all(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_base'`,
      )
    ).map((row) => String(row.name).toLowerCase()),
  );

  const wanted = ['category', 'pdf_file_path'];

  for (let index = 0; index < wanted.length; index += 1) {
    if (existing.has(wanted[index])) continue;
    try {
      await db.exec(`ALTER TABLE knowledge_base ${KNOWLEDGE_COLUMNS[index]}`);
    } catch (error) {
      // A concurrent deploy may have added it first.
      console.warn(`[db] could not add knowledge_base.${wanted[index]}: ${error?.message || error}`);
    }
  }
}

/**
 * Older installs only allowed TEXT and PDF. Manual text is stored as PDF_TEXT,
 * so widen the column once on upgrade.
 */
async function migrateSourceType(db) {
  try {
    await db.exec(
      "ALTER TABLE knowledge_base MODIFY COLUMN source_type ENUM('TEXT', 'PDF', 'PDF_TEXT') NOT NULL DEFAULT 'TEXT'",
    );
  } catch (error) {
    console.warn(`[db] could not widen knowledge_base.source_type: ${error?.message || error}`);
  }
}

/**
 * Bootstrap rows the API cannot work without on an empty database: the two
 * subscription plans, the settings keys and the Terms/About pages. Trading
 * knowledge is never inserted here — the BINARY and FOREX libraries contain
 * only what the admin uploads. Existing rows are never overwritten.
 */
async function ensureDefaults(db) {
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

  for (const [key, value] of DEFAULT_SETTINGS) {
    await db.run(
      'INSERT IGNORE INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)',
      [key, value, timestamp()],
    );
  }

  for (const page of DEFAULT_CMS_PAGES) {
    await db.run('INSERT IGNORE INTO cms_pages (slug, title, content, updated_at) VALUES (?, ?, ?, ?)', [
      page.slug,
      page.title,
      page.content,
      timestamp(),
    ]);
  }
}
