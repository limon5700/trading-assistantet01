import express from 'express';
import { getPublicConfig } from '../services/cms.js';

const router = express.Router();

/**
 * Public, unauthenticated configuration used by the mobile app's header, legal
 * pages and upgrade flow. No explorer keys, wallets tokens or user data.
 */
router.get('/config', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(await getPublicConfig());
  } catch (error) {
    return next(error);
  }
});

export default router;
