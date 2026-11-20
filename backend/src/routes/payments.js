import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireUser } from '../auth.js';
import {
  activateUserOnPlan,
  attachPaymentTxHash,
  createCryptoPayment,
  findPaymentByTxHash,
  findPaymentForUser,
  findPendingPayment,
  findUserById,
  getAdminSettings,
  getPlan,
  getPublicSettings,
  listPlans,
  logActivity,
  mapUser,
  setPaymentStatus,
} from '../services/accounts.js';
import {
  ChainError,
  normalizeNetwork,
  normalizeTxHash,
  validateTxHash,
  validateWalletAddress,
  verifyUsdtTransaction,
} from '../services/crypto.js';

const router = express.Router();

const startLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Please slow down.' },
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait a minute.' },
});

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function sessionPayload(user) {
  const [settings, plans] = await Promise.all([getPublicSettings(), listPlans({ activeOnly: true })]);
  return { user: mapUser(user), settings, plans };
}

async function currentCryptoConfig() {
  const settings = await getPublicSettings();
  const network = normalizeNetwork(settings.crypto_network);
  const walletAddress = settings.crypto_wallet_address.trim();
  const configured = Boolean(network && validateWalletAddress(network, walletAddress));
  return { network, walletAddress, configured };
}

/* ----------------------------------------------------------- create intent -- */

router.post('/start', startLimiter, requireUser, async (req, res, next) => {
  try {
    const planId = positiveInt(req.body?.plan_id);
    if (!planId) return res.status(400).json({ error: 'plan_id is required' });

    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });
    if (user.account_status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
    }

    const plan = await getPlan(planId);
    if (!plan || !plan.is_active) return res.status(404).json({ error: 'Plan not found' });
    if (plan.plan_type !== 'PAID') {
      return res.status(400).json({ error: 'Only paid plans use crypto payment' });
    }
    if (!(plan.price > 0)) {
      return res.status(409).json({ error: 'This plan has no price configured. Please contact support.' });
    }

    const { network, walletAddress, configured } = await currentCryptoConfig();
    if (!configured) {
      return res.status(409).json({
        error: 'Crypto payments are not configured yet. Please contact support.',
        code: 'CRYPTO_NOT_CONFIGURED',
      });
    }

    const expectedAmount = Math.round(plan.price * 100) / 100;
    const pending = await findPendingPayment({ userId: user.id, planId });
    if (
      pending &&
      pending.network === network &&
      pending.wallet_address === walletAddress &&
      pending.expected_amount_usdt === expectedAmount
    ) {
      return res.json({ payment: pending, plan });
    }

    const payment = await createCryptoPayment({
      userId: user.id,
      planId,
      expectedAmount,
      network,
      walletAddress,
    });

    return res.status(201).json({ payment, plan });
  } catch (err) {
    return next(err);
  }
});

/* -------------------------------------------------------------- read status -- */

router.get('/:id', requireUser, async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid payment id' });

    const payment = await findPaymentForUser(id, req.userId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    res.set('Cache-Control', 'no-store');
    return res.json({ payment });
  } catch (err) {
    return next(err);
  }
});

/* --------------------------------------------------------- verify on-chain -- */

router.post('/verify-crypto', verifyLimiter, requireUser, async (req, res, next) => {
  try {
    const paymentId = positiveInt(req.body?.payment_id ?? req.body?.id);
    if (!paymentId) return res.status(400).json({ error: 'payment_id is required' });

    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found', code: 'ACCOUNT_MISSING' });
    if (user.account_status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
    }

    const payment = await findPaymentForUser(paymentId, user.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if (payment.status === 'VERIFIED') {
      return res.json({ verified: true, payment, ...(await sessionPayload(user)) });
    }

    const network = normalizeNetwork(payment.network);
    if (!network) return res.status(409).json({ error: 'This payment uses an unknown network' });

    const rawHash = String(req.body?.tx_hash ?? '').trim();
    if (!rawHash) return res.status(400).json({ error: 'Enter the transaction hash (TxID)' });
    if (!validateTxHash(network, rawHash)) {
      return res.status(400).json({
        error:
          network === 'BEP20'
            ? 'Enter a valid BEP20 transaction hash: 0x followed by 64 hex characters'
            : 'Enter a valid TRC20 transaction hash: 64 hex characters',
      });
    }
    const txHash = normalizeTxHash(network, rawHash);

    const reused = await findPaymentByTxHash(txHash);
    if (reused && reused.id !== payment.id) {
      return res.status(409).json({
        error: 'This transaction hash was already used for another payment.',
        code: 'TX_HASH_REUSED',
      });
    }

    if (!validateWalletAddress(network, payment.wallet_address)) {
      return res.status(409).json({
        error: 'The receiving wallet for this payment is invalid. Please contact support.',
      });
    }

    if (payment.tx_hash !== txHash) {
      try {
        await attachPaymentTxHash(payment.id, txHash);
      } catch (error) {
        if (
          String(error?.code || '').includes('SQLITE_CONSTRAINT') ||
          String(error?.code || '').includes('ER_DUP_ENTRY') ||
          String(error?.message || '').toLowerCase().includes('unique')
        ) {
          return res.status(409).json({
            error: 'This transaction hash was already used for another payment.',
            code: 'TX_HASH_REUSED',
          });
        }
        throw error;
      }
    }

    const adminSettings = await getAdminSettings();

    let result;
    try {
      result = await verifyUsdtTransaction({
        network,
        txHash,
        walletAddress: payment.wallet_address,
        expectedUsdt: payment.expected_amount_usdt,
        bscscanApiKey: adminSettings.bscscan_api_key,
        trongridApiKey: adminSettings.trongrid_api_key,
      });
    } catch (error) {
      if (error instanceof ChainError) {
        // Keep the payment PENDING: the chain/explorer may simply be unreachable.
        return res.status(error.status || 502).json({
          error: error.message,
          code: 'CHAIN_UNAVAILABLE',
          payment,
        });
      }
      throw error;
    }

    if (!result.ok) {
      // A transaction that is simply not confirmed yet stays PENDING so the
      // app can keep polling; a real mismatch is terminal.
      const stillWaiting = result.status === 409;
      const next = stillWaiting ? payment : await setPaymentStatus(payment.id, 'FAILED');
      return res.status(result.status || 422).json({ error: result.error, payment: next });
    }

    const plan = await getPlan(payment.plan_id);
    if (!plan || !plan.is_active) {
      return res.status(409).json({
        error: 'The plan for this payment is no longer available. Please contact support.',
        payment,
      });
    }

    const verified = await setPaymentStatus(payment.id, 'VERIFIED');
    const updatedUser = await activateUserOnPlan({ userId: user.id, planId: payment.plan_id });

    await logActivity({
      userId: user.id,
      action: 'PAYMENT_VERIFIED',
      details: {
        payment_id: payment.id,
        plan: plan.name,
        plan_id: plan.id,
        network,
        amount_usdt: result.amountUsdt,
        tx_hash: txHash,
      },
    });

    res.set('Cache-Control', 'no-store');
    return res.json({
      verified: true,
      payment: verified,
      ...(await sessionPayload(updatedUser)),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
