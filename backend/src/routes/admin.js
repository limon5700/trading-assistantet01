import express from 'express';
import {
  ACCOUNT_STATUSES,
  PLAN_TYPES,
  countPlanReferences,
  countUsersByStatus,
  createPlan,
  deleteCode,
  deletePlan,
  deleteUser,
  findUserById,
  generateActivationCode,
  getAdminSettings,
  getPlan,
  listActivities,
  listCodes,
  listPlans,
  listUsers,
  updatePlan,
  updateSettings,
  updateUserStatus,
} from '../services/accounts.js';
import { timestamp } from '../db.js';
import { normalizeNetwork, validateWalletAddress } from '../services/crypto.js';

const router = express.Router();

const ACTION_FILTERS = [
  'SIGNUP',
  'LOGIN',
  'ACTIVATED',
  'SIGNAL_SCAN',
  'SETTINGS_UPDATED',
  'PAYMENT_VERIFIED',
];

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function positiveInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/* ------------------------------------------------------------- settings -- */

router.get('/settings', async (req, res, next) => {
  try {
    return res.json({ settings: await getAdminSettings() });
  } catch (err) {
    return next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const current = await getAdminSettings();
    const patch = {};

    for (const key of ['affiliate_link', 'support_contact_link']) {
      if (body[key] === undefined) continue;
      const value = trimmed(body[key]);
      if (value && !isHttpUrl(value)) {
        return res.status(400).json({ error: `${key} must be a valid http(s) URL or empty` });
      }
      patch[key] = value;
    }

    if (body.app_name !== undefined) {
      const value = trimmed(body.app_name);
      if (!value || value.length > 80) {
        return res.status(400).json({ error: 'app_name must be 1-80 characters' });
      }
      patch.app_name = value;
    }

    const network =
      body.crypto_network === undefined
        ? normalizeNetwork(current.crypto_network) || 'BEP20'
        : normalizeNetwork(body.crypto_network);
    if (body.crypto_network !== undefined && !network) {
      return res.status(400).json({ error: 'crypto_network must be BEP20 or TRC20' });
    }
    if (body.crypto_network !== undefined) patch.crypto_network = network;

    if (body.crypto_wallet_address !== undefined) {
      const wallet = trimmed(body.crypto_wallet_address);
      if (wallet && !validateWalletAddress(network, wallet)) {
        return res.status(400).json({
          error:
            network === 'BEP20'
              ? 'crypto_wallet_address must be a BSC (BEP20) address starting with 0x'
              : 'crypto_wallet_address must be a TRON (TRC20) address starting with T',
        });
      }
      patch.crypto_wallet_address = wallet;
    } else if (body.crypto_network !== undefined && current.crypto_wallet_address) {
      // Refuse to leave an address that does not match the new network.
      if (!validateWalletAddress(network, current.crypto_wallet_address)) {
        return res.status(400).json({
          error: 'Update crypto_wallet_address together with the new network',
        });
      }
    }

    for (const key of ['bscscan_api_key', 'trongrid_api_key']) {
      if (body[key] === undefined) continue;
      const value = trimmed(body[key]);
      if (value.length > 200) {
        return res.status(400).json({ error: `${key} is too long (max 200 characters)` });
      }
      patch[key] = value;
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    return res.json({ settings: await updateSettings(patch) });
  } catch (err) {
    return next(err);
  }
});

/* ---------------------------------------------------------------- plans -- */

router.get('/plans', async (req, res, next) => {
  try {
    return res.json({ items: await listPlans() });
  } catch (err) {
    return next(err);
  }
});

function validatePlanInput(body, { partial = false } = {}) {
  const value = {};

  if (!partial || body.name !== undefined) {
    const name = trimmed(body.name);
    if (!name || name.length > 120) return { error: 'Plan name must be 1-120 characters' };
    value.name = name;
  }

  if (!partial || body.plan_type !== undefined) {
    const type = trimmed(body.plan_type).toUpperCase();
    if (!PLAN_TYPES.includes(type)) return { error: 'plan_type must be FREE or PAID' };
    value.plan_type = type;
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price ?? 0);
    if (!Number.isFinite(price) || price < 0) return { error: 'price must be zero or greater' };
    value.price = Math.round(price * 100) / 100;
  }

  if (!partial || body.duration_days !== undefined) {
    const days = Number(body.duration_days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 36500) {
      return { error: 'duration_days must be an integer between 1 and 36500' };
    }
    value.duration_days = days;
  }

  if (body.description !== undefined) {
    const description = trimmed(body.description);
    if (description.length > 2000) return { error: 'description is too long (max 2000 characters)' };
    value.description = description;
  }

  if (body.features !== undefined) {
    if (!Array.isArray(body.features) || body.features.some((item) => typeof item !== 'string')) {
      return { error: 'features must be a list of strings' };
    }
    value.features = body.features.map((item) => item.trim()).filter(Boolean).slice(0, 20);
  }

  if (body.is_active !== undefined) {
    value.is_active = Boolean(body.is_active);
  }

  return { value };
}

router.post('/plans', async (req, res, next) => {
  try {
    const { value, error } = validatePlanInput(req.body ?? {});
    if (error) return res.status(400).json({ error });

    const plan = await createPlan({
      ...value,
      features: value.features ?? [],
      is_active: value.is_active ?? true,
    });
    return res.status(201).json({ item: plan });
  } catch (err) {
    return next(err);
  }
});

router.put('/plans/:id', async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid plan id' });

    const existing = await getPlan(id);
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    const { value, error } = validatePlanInput(req.body ?? {}, { partial: true });
    if (error) return res.status(400).json({ error });
    if (!Object.keys(value).length) return res.status(400).json({ error: 'Nothing to update' });

    return res.json({ item: await updatePlan(id, value) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/plans/:id', async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid plan id' });

    const existing = await getPlan(id);
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    const references = await countPlanReferences(id);
    if (references.codes > 0 || references.users > 0) {
      return res.status(409).json({
        error: `This plan is still used by ${references.codes} activation code(s) and ${references.users} user(s). Deactivate it instead.`,
      });
    }

    await deletePlan(id);
    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------ activation codes -- */

router.get('/activation-codes', async (req, res, next) => {
  try {
    const status = trimmed(req.query.status).toLowerCase();
    if (status && !['used', 'unused', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'status must be used, unused or expired' });
    }

    return res.json(
      await listCodes({
        status,
        page: positiveInt(req.query.page, 1),
        pageSize: positiveInt(req.query.page_size, 100),
      }),
    );
  } catch (err) {
    return next(err);
  }
});

router.post('/activation-codes/generate', async (req, res, next) => {
  try {
    const userId = positiveInt(req.body?.user_id);
    const planId = positiveInt(req.body?.plan_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    if (!planId) return res.status(400).json({ error: 'plan_id is required' });

    const user = await findUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plan = await getPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const days = req.body?.expires_in_days === undefined ? null : positiveInt(req.body.expires_in_days);
    if (req.body?.expires_in_days !== undefined && !days) {
      return res.status(400).json({ error: 'expires_in_days must be a positive integer' });
    }
    const expiresAt = days
      ? timestamp(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
      : null;

    const code = await generateActivationCode({
      assignedUserId: userId,
      planId,
      expiresAt,
    });

    return res.status(201).json({ item: code });
  } catch (err) {
    return next(err);
  }
});

router.delete('/activation-codes/:id', async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid activation code id' });

    const deleted = await deleteCode(id);
    if (!deleted) return res.status(404).json({ error: 'Activation code not found' });
    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

/* ---------------------------------------------------------------- users -- */

router.get('/users', async (req, res, next) => {
  try {
    const status = trimmed(req.query.status).toUpperCase();
    if (status && !ACCOUNT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'status must be PENDING, ACTIVE or SUSPENDED' });
    }

    const result = await listUsers({
      search: trimmed(req.query.search),
      status,
      page: positiveInt(req.query.page, 1),
      pageSize: positiveInt(req.query.page_size, 20),
    });

    return res.json({ ...result, stats: await countUsersByStatus() });
  } catch (err) {
    return next(err);
  }
});

router.put('/users/:id/status', async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id' });

    const user = await findUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const body = req.body ?? {};
    const patch = {};

    if (body.account_status !== undefined) {
      const status = trimmed(body.account_status).toUpperCase();
      if (!ACCOUNT_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'account_status must be PENDING, ACTIVE or SUSPENDED' });
      }
      patch.status = status;
    }

    if (body.active_plan_id !== undefined) {
      if (body.active_plan_id === null || body.active_plan_id === '') {
        patch.planId = null;
      } else {
        const planId = positiveInt(body.active_plan_id);
        if (!planId) return res.status(400).json({ error: 'Invalid active_plan_id' });
        if (!(await getPlan(planId))) return res.status(404).json({ error: 'Plan not found' });
        patch.planId = planId;
      }
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    const updated = await updateUserStatus(id, patch);
    return res.json({ item: { ...updated, password_hash: undefined } });
  } catch (err) {
    return next(err);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id' });

    const deleted = await deleteUser(id);
    if (!deleted) return res.status(404).json({ error: 'User not found' });
    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

/* ----------------------------------------------------------- activities -- */

router.get('/activities', async (req, res, next) => {
  try {
    const action = trimmed(req.query.action).toUpperCase();
    if (action && !ACTION_FILTERS.includes(action)) {
      return res.status(400).json({ error: `action must be one of ${ACTION_FILTERS.join(', ')}` });
    }

    return res.json(
      await listActivities({
        action,
        userId: positiveInt(req.query.user_id),
        page: positiveInt(req.query.page, 1),
        pageSize: positiveInt(req.query.page_size, 25),
      }),
    );
  } catch (err) {
    return next(err);
  }
});

export default router;
