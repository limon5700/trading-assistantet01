import express from 'express';
import { requireUser } from '../auth.js';
import { findUserById, logActivity } from '../services/accounts.js';
import { getTradeSettings, saveTradeSettings } from '../services/tradeSettings.js';

const router = express.Router();

router.use(requireUser);

router.get('/trade-settings', async (req, res, next) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });

    res.set('Cache-Control', 'no-store');
    return res.json({ settings: await getTradeSettings(user.id) });
  } catch (error) {
    return next(error);
  }
});

router.put('/trade-settings', async (req, res, next) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });

    const body = req.body ?? {};
    const allowed = [
      'binary_min_confidence',
      'binary_duration_seconds',
      'binary_strategy',
      'forex_min_confidence',
      'forex_timeframe',
      'forex_strategy',
    ];
    if (!allowed.some((key) => body[key] !== undefined)) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const settings = await saveTradeSettings(user.id, body);
    await logActivity({
      userId: user.id,
      action: 'SETTINGS_UPDATED',
      details: { scope: 'trade_settings' },
    });

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

export default router;
