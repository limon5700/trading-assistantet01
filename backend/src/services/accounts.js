import crypto from 'node:crypto';
import { getDb, timestamp } from '../db.js';

const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'];
const PLAN_TYPES = ['FREE', 'PAID'];
const ACTIVITY_ACTIONS = [
  'SIGNUP',
  'LOGIN',
  'ACTIVATED',
  'SIGNAL_SCAN',
  'SETTINGS_UPDATED',
  'PAYMENT_VERIFIED',
];
const CRYPTO_NETWORKS = ['BEP20', 'TRC20'];

export { ACCOUNT_STATUSES, PLAN_TYPES, ACTIVITY_ACTIONS, CRYPTO_NETWORKS };

/* ----------------------------------------------------------------- users -- */

export function mapUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    full_name: row.full_name,
    username: row.username,
    email: row.email,
    phone: row.phone ?? null,
    account_status: row.account_status,
    active_plan_id: row.active_plan_id === null || row.active_plan_id === undefined
      ? null
      : Number(row.active_plan_id),
    active_plan_name: row.plan_name ?? null,
    activation_code_used: row.activation_code_used ?? null,
    last_active_at: row.last_active_at ?? null,
    created_at: row.created_at,
  };
}

const USER_SELECT = `
  SELECT u.*, p.name AS plan_name
  FROM users u
  LEFT JOIN plans p ON p.id = u.active_plan_id
`;

export async function findUserById(id) {
  const db = await getDb();
  const row = await db.get(`${USER_SELECT} WHERE u.id = ?`, [Number(id)]);
  return row ?? null;
}

export async function findUserByIdentifier(identifier) {
  const db = await getDb();
  const value = String(identifier).trim().toLowerCase();
  const row = await db.get(
    `${USER_SELECT} WHERE LOWER(u.email) = ? OR LOWER(u.username) = ?`,
    [value, value],
  );
  return row ?? null;
}

export async function findUserByEmail(email) {
  const db = await getDb();
  return (await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [String(email).trim().toLowerCase()])) ?? null;
}

export async function findUserByUsername(username) {
  const db = await getDb();
  return (
    (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [String(username).trim().toLowerCase()])) ??
    null
  );
}

export async function createUser({ fullName, username, email, phone, passwordHash }) {
  const db = await getDb();
  const now = timestamp();
  const result = await db.run(
    `INSERT INTO users
      (full_name, username, email, phone, password_hash, account_status, active_plan_id,
       activation_code_used, last_active_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?)`,
    [fullName, username, email, phone || null, passwordHash, now],
  );
  return findUserById(result.insertId);
}

export async function touchLastActive(id) {
  const db = await getDb();
  await db.run('UPDATE users SET last_active_at = ? WHERE id = ?', [timestamp(), Number(id)]);
}

export async function updateUserStatus(id, { status, planId }) {
  const db = await getDb();
  const fields = [];
  const params = [];

  if (status !== undefined) {
    fields.push('account_status = ?');
    params.push(status);
  }
  if (planId !== undefined) {
    fields.push('active_plan_id = ?');
    params.push(planId === null ? null : Number(planId));
  }
  if (!fields.length) return findUserById(id);

  params.push(Number(id));
  await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  return findUserById(id);
}

export async function deleteUser(id) {
  const db = await getDb();
  const result = await db.run('DELETE FROM users WHERE id = ?', [Number(id)]);
  return result.affectedRows > 0;
}

export async function listUsers({ search = '', status = '', page = 1, pageSize = 20 } = {}) {
  const db = await getDb();
  const where = [];
  const params = [];

  if (search) {
    const like = `%${search}%`;
    where.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(like, like, like, like);
  }
  if (status) {
    where.push('u.account_status = ?');
    params.push(status);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.get(`SELECT COUNT(*) AS total FROM users u ${whereSql}`, params);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const rows = await db.all(
    `${USER_SELECT} ${whereSql} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    items: rows.map(mapUser),
    total: Number(total?.total ?? 0),
    page: Math.max(1, Number(page) || 1),
    pageSize: limit,
  };
}

export async function countUsersByStatus() {
  const db = await getDb();
  const rows = await db.all('SELECT account_status, COUNT(*) AS total FROM users GROUP BY account_status');
  const result = { TOTAL: 0, PENDING: 0, ACTIVE: 0, SUSPENDED: 0 };
  for (const row of rows) {
    const count = Number(row.total) || 0;
    result[row.account_status] = count;
    result.TOTAL += count;
  }
  return result;
}

/* ----------------------------------------------------------------- plans -- */

export function mapPlan(row) {
  if (!row) return null;
  let features = [];
  if (row.features_json) {
    try {
      const parsed = JSON.parse(row.features_json);
      if (Array.isArray(parsed)) features = parsed.map((item) => String(item));
    } catch {
      features = String(row.features_json)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    }
  }
  return {
    id: Number(row.id),
    name: row.name,
    plan_type: row.plan_type,
    price: Number(row.price) || 0,
    duration_days: Number(row.duration_days) || 0,
    description: row.description ?? '',
    features,
    is_active: Number(row.is_active) === 1,
    created_at: row.created_at,
  };
}

export async function listPlans({ activeOnly = false } = {}) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT * FROM plans ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY price ASC, id ASC`,
  );
  return rows.map(mapPlan);
}

export async function getPlan(id) {
  const db = await getDb();
  const row = await db.get('SELECT * FROM plans WHERE id = ?', [Number(id)]);
  return row ? mapPlan(row) : null;
}

export async function createPlan(input) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO plans (name, plan_type, price, duration_days, description, features_json, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.plan_type,
      input.price,
      input.duration_days,
      input.description || '',
      JSON.stringify(input.features ?? []),
      input.is_active ? 1 : 0,
      timestamp(),
    ],
  );
  return getPlan(result.insertId);
}

export async function updatePlan(id, patch) {
  const db = await getDb();
  const fields = [];
  const params = [];

  const columnFor = {
    name: 'name',
    plan_type: 'plan_type',
    price: 'price',
    duration_days: 'duration_days',
    description: 'description',
    is_active: 'is_active',
  };

  for (const [key, column] of Object.entries(columnFor)) {
    if (patch[key] === undefined) continue;
    fields.push(`${column} = ?`);
    params.push(key === 'is_active' ? (patch[key] ? 1 : 0) : patch[key]);
  }
  if (patch.features !== undefined) {
    fields.push('features_json = ?');
    params.push(JSON.stringify(patch.features));
  }
  if (!fields.length) return getPlan(id);

  params.push(Number(id));
  await db.run(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`, params);
  return getPlan(id);
}

export async function deletePlan(id) {
  const db = await getDb();
  const result = await db.run('DELETE FROM plans WHERE id = ?', [Number(id)]);
  return result.affectedRows > 0;
}

export async function countPlanReferences(id) {
  const db = await getDb();
  const codes = await db.get('SELECT COUNT(*) AS total FROM activation_codes WHERE plan_id = ?', [Number(id)]);
  const users = await db.get('SELECT COUNT(*) AS total FROM users WHERE active_plan_id = ?', [Number(id)]);
  return {
    codes: Number(codes?.total ?? 0),
    users: Number(users?.total ?? 0),
  };
}

/* --------------------------------------------------- activation codes ----- */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomBlock(length = 4) {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

export function buildActivationCode() {
  return `TRD-${randomBlock()}-${randomBlock()}`;
}

export function mapCode(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    assigned_user_id: row.assigned_user_id === null || row.assigned_user_id === undefined
      ? null
      : Number(row.assigned_user_id),
    assigned_user_name: row.assigned_user_name ?? null,
    assigned_username: row.assigned_username ?? null,
    plan_id: Number(row.plan_id),
    plan_name: row.plan_name ?? null,
    is_used: Number(row.is_used) === 1,
    used_by_user_id: row.used_by_user_id === null || row.used_by_user_id === undefined
      ? null
      : Number(row.used_by_user_id),
    used_by_user_name: row.used_by_user_name ?? null,
    used_at: row.used_at ?? null,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at,
  };
}

const CODE_SELECT = `
  SELECT c.*,
         ua.full_name AS assigned_user_name, ua.username AS assigned_username,
         ub.full_name AS used_by_user_name,
         p.name AS plan_name
  FROM activation_codes c
  LEFT JOIN users ua ON ua.id = c.assigned_user_id
  LEFT JOIN users ub ON ub.id = c.used_by_user_id
  LEFT JOIN plans p ON p.id = c.plan_id
`;

export async function generateActivationCode({ assignedUserId, planId, expiresAt }) {
  const db = await getDb();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = buildActivationCode();
    const existing = await db.get('SELECT id FROM activation_codes WHERE code = ?', [code]);
    if (existing) continue;

    try {
      await db.run(
        `INSERT INTO activation_codes
          (code, assigned_user_id, plan_id, is_used, used_by_user_id, used_at, expires_at, created_at)
         VALUES (?, ?, ?, 0, NULL, NULL, ?, ?)`,
        [code, assignedUserId ?? null, planId, expiresAt ?? null, timestamp()],
      );
    } catch (error) {
      // Unique collision on a concurrent insert: retry with a new code.
      if (String(error?.message || '').toLowerCase().includes('unique')) continue;
      throw error;
    }

    const row = await db.get(`${CODE_SELECT} WHERE c.code = ?`, [code]);
    return row ? mapCode(row) : null;
  }
  throw Object.assign(new Error('Could not allocate a unique activation code, please retry'), { status: 503 });
}

export async function findCode(code) {
  const db = await getDb();
  const row = await db.get(`${CODE_SELECT} WHERE c.code = ?`, [String(code).trim().toUpperCase()]);
  return row ? { raw: row, code: mapCode(row) } : null;
}

export async function listCodes({ status = '', page = 1, pageSize = 100 } = {}) {
  const db = await getDb();
  const where = [];
  if (status === 'used') where.push('c.is_used = 1');
  if (status === 'unused') where.push('c.is_used = 0');
  if (status === 'expired') where.push('c.expires_at IS NOT NULL AND c.expires_at < ?');
  const params = status === 'expired' ? [timestamp()] : [];

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, Number(pageSize) || 100));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const total = await db.get(`SELECT COUNT(*) AS total FROM activation_codes c ${whereSql}`, params);
  const rows = await db.all(`${CODE_SELECT} ${whereSql} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);

  return {
    items: rows.map(mapCode),
    total: Number(total?.total ?? 0),
    page: Math.max(1, Number(page) || 1),
    pageSize: limit,
  };
}

export async function markCodeUsed({ codeId, userId, planId }) {
  const db = await getDb();
  const now = timestamp();
  await db.run(
    'UPDATE activation_codes SET is_used = 1, used_by_user_id = ?, used_at = ? WHERE id = ?',
    [Number(userId), now, Number(codeId)],
  );
  await db.run(
    `UPDATE users
     SET account_status = 'ACTIVE', active_plan_id = ?, activation_code_used = (
       SELECT code FROM activation_codes WHERE id = ?
     )
     WHERE id = ?`,
    [Number(planId), Number(codeId), Number(userId)],
  );
}

/**
 * Validates a user's activation code and, when every rule passes, activates the
 * account on the code's plan. Returns `{ plan }` on success or `{ status, error }`.
 */
export async function activateWithCode({ code, userId }) {
  const found = await findCode(code);
  if (!found) return { status: 404, error: 'Activation code not found' };

  const row = found.raw;
  if (Number(row.is_used) === 1) {
    return { status: 409, error: 'This activation code has already been used' };
  }
  if (row.assigned_user_id !== null && row.assigned_user_id !== undefined) {
    if (Number(row.assigned_user_id) !== Number(userId)) {
      return { status: 403, error: 'This activation code was issued to another account' };
    }
  }
  if (row.expires_at && String(row.expires_at) < timestamp()) {
    return { status: 410, error: 'This activation code has expired' };
  }

  const plan = await getPlan(row.plan_id);
  if (!plan) return { status: 409, error: 'The plan for this activation code no longer exists' };
  if (!plan.is_active) {
    return { status: 409, error: 'The plan for this activation code is no longer available' };
  }

  await markCodeUsed({ codeId: row.id, userId, planId: row.plan_id });
  await logActivity({
    userId,
    action: 'ACTIVATED',
    details: { code: row.code, plan: plan.name, plan_id: plan.id },
  });

  return { plan };
}

export async function deleteCode(id) {
  const db = await getDb();
  const result = await db.run('DELETE FROM activation_codes WHERE id = ?', [Number(id)]);
  return result.affectedRows > 0;
}

/* -------------------------------------------------------------- settings -- */

async function readSettings() {
  const db = await getDb();
  const rows = await db.all('SELECT setting_key, setting_value FROM app_settings');
  const settings = {};
  for (const row of rows) settings[row.setting_key] = row.setting_value ?? '';
  return settings;
}

/**
 * Settings that are safe to send to the mobile app. Explorer/RPC API keys are
 * deliberately excluded; they never leave the server.
 */
export async function getPublicSettings() {
  const settings = await readSettings();
  return {
    affiliate_link: settings.affiliate_link ?? '',
    support_contact_link: settings.support_contact_link ?? '',
    app_name: settings.app_name ?? 'AI Trading Assistant',
    app_icon_url: settings.app_icon_url ?? '',
    default_plan_type: settings.default_plan_type ?? 'FREE',
    crypto_network: settings.crypto_network === 'TRC20' ? 'TRC20' : 'BEP20',
    crypto_wallet_address: settings.crypto_wallet_address ?? '',
  };
}

/** Full settings for the admin panel, including the private explorer keys. */
export async function getAdminSettings() {
  const settings = await readSettings();
  return {
    ...(await getPublicSettings()),
    default_plan_type: settings.default_plan_type ?? 'FREE',
    bscscan_api_key: settings.bscscan_api_key ?? '',
    trongrid_api_key: settings.trongrid_api_key ?? '',
  };
}

/** Backwards-compatible alias: callers that render the app use public data. */
export function getSettings() {
  return getPublicSettings();
}

export async function updateSettings(patch) {
  const db = await getDb();
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key, value] of entries) {
    const existing = await db.get('SELECT setting_key FROM app_settings WHERE setting_key = ?', [key]);
    if (existing) {
      await db.run('UPDATE app_settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?', [
        value === null ? '' : String(value),
        timestamp(),
        key,
      ]);
    } else {
      await db.run('INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)', [
        key,
        value === null ? '' : String(value),
        timestamp(),
      ]);
    }
  }
  return getAdminSettings();
}

/* -------------------------------------------------------- crypto payments -- */

export function mapPayment(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    plan_id: Number(row.plan_id),
    plan_name: row.plan_name ?? null,
    expected_amount_usdt: Number(row.expected_amount_usdt) || 0,
    network: row.network,
    wallet_address: row.wallet_address,
    tx_hash: row.tx_hash ?? null,
    status: row.status,
    verified_at: row.verified_at ?? null,
    created_at: row.created_at,
  };
}

const PAYMENT_SELECT = `
  SELECT c.*, p.name AS plan_name
  FROM crypto_payments c
  LEFT JOIN plans p ON p.id = c.plan_id
`;

export async function findPaymentById(id) {
  const db = await getDb();
  const row = await db.get(`${PAYMENT_SELECT} WHERE c.id = ?`, [Number(id)]);
  return row ? mapPayment(row) : null;
}

export async function findPaymentForUser(id, userId) {
  const db = await getDb();
  const row = await db.get(`${PAYMENT_SELECT} WHERE c.id = ? AND c.user_id = ?`, [
    Number(id),
    Number(userId),
  ]);
  return row ? mapPayment(row) : null;
}

export async function findPaymentByTxHash(txHash) {
  const db = await getDb();
  const row = await db.get(`${PAYMENT_SELECT} WHERE LOWER(c.tx_hash) = ?`, [
    String(txHash).trim().toLowerCase(),
  ]);
  return row ? mapPayment(row) : null;
}

export async function findPendingPayment({ userId, planId }) {
  const db = await getDb();
  const row = await db.get(
    `${PAYMENT_SELECT} WHERE c.user_id = ? AND c.plan_id = ? AND c.status = 'PENDING'
     ORDER BY c.id DESC LIMIT 1`,
    [Number(userId), Number(planId)],
  );
  return row ? mapPayment(row) : null;
}

export async function createCryptoPayment({
  userId,
  planId,
  expectedAmount,
  network,
  walletAddress,
}) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO crypto_payments
      (user_id, plan_id, expected_amount_usdt, network, wallet_address, tx_hash, status, verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'PENDING', NULL, ?)`,
    [Number(userId), Number(planId), expectedAmount, network, walletAddress, timestamp()],
  );
  return findPaymentById(result.insertId);
}

export async function attachPaymentTxHash(id, txHash) {
  const db = await getDb();
  await db.run('UPDATE crypto_payments SET tx_hash = ? WHERE id = ?', [
    String(txHash).trim(),
    Number(id),
  ]);
  return findPaymentById(id);
}

export async function setPaymentStatus(id, status) {
  const db = await getDb();
  const verifiedAt = status === 'VERIFIED' ? timestamp() : null;
  await db.run('UPDATE crypto_payments SET status = ?, verified_at = ? WHERE id = ?', [
    status,
    verifiedAt,
    Number(id),
  ]);
  return findPaymentById(id);
}

/** Activates an account on a paid plan without consuming an activation code. */
export async function activateUserOnPlan({ userId, planId }) {
  const db = await getDb();
  await db.run(
    `UPDATE users SET account_status = 'ACTIVE', active_plan_id = ? WHERE id = ?`,
    [Number(planId), Number(userId)],
  );
  return findUserById(userId);
}

/* ------------------------------------------------------------ activities -- */

export async function logActivity({ userId, action, details }) {
  if (!ACTIVITY_ACTIONS.includes(action)) {
    throw new Error(`Unknown activity action: ${action}`);
  }
  const db = await getDb();
  const value =
    details === undefined || details === null
      ? null
      : typeof details === 'string'
        ? details.slice(0, 2000)
        : JSON.stringify(details).slice(0, 2000);

  await db.run('INSERT INTO user_activities (user_id, action, details, created_at) VALUES (?, ?, ?, ?)', [
    Number(userId),
    action,
    value,
    timestamp(),
  ]);
}

export async function listActivities({ page = 1, pageSize = 25, action = '', userId = null } = {}) {
  const db = await getDb();
  const where = [];
  const params = [];

  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  if (userId) {
    where.push('a.user_id = ?');
    params.push(Number(userId));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(100, Number(pageSize) || 25));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const total = await db.get(`SELECT COUNT(*) AS total FROM user_activities a ${whereSql}`, params);
  const rows = await db.all(
    `SELECT a.*, u.full_name, u.username, u.email
     FROM user_activities a
     LEFT JOIN users u ON u.id = a.user_id
     ${whereSql}
     ORDER BY a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      full_name: row.full_name ?? 'Deleted user',
      username: row.username ?? '',
      email: row.email ?? '',
      action: row.action,
      details: row.details ?? null,
      created_at: row.created_at,
    })),
    total: Number(total?.total ?? 0),
    page: Math.max(1, Number(page) || 1),
    pageSize: limit,
  };
}
