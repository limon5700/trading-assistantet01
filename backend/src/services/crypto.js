import { config } from '../config.js';

export const USDT_BEP20_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const CRYPTO_NETWORKS = ['BEP20', 'TRC20'];

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const BEP20_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TRC20_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BEP20_TX_RE = /^0x[a-fA-F0-9]{64}$/;
const TRC20_TX_RE = /^[a-fA-F0-9]{64}$/;

const BSC_RPC_FALLBACKS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
];

export function normalizeNetwork(value) {
  const network = String(value ?? '').trim().toUpperCase();
  return CRYPTO_NETWORKS.includes(network) ? network : null;
}

export function validateWalletAddress(network, address) {
  const value = String(address ?? '').trim();
  if (network === 'BEP20') return BEP20_ADDRESS_RE.test(value);
  if (network === 'TRC20') return TRC20_ADDRESS_RE.test(value);
  return false;
}

export function validateTxHash(network, hash) {
  const value = String(hash ?? '').trim();
  if (network === 'BEP20') return BEP20_TX_RE.test(value);
  if (network === 'TRC20') return TRC20_TX_RE.test(value);
  return false;
}

export function normalizeTxHash(network, hash) {
  const value = String(hash ?? '').trim();
  return network === 'BEP20' ? value.toLowerCase() : value;
}

export class ChainError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ChainError';
    this.status = status;
  }
}

function toBaseUnits(amountUsdt, decimals) {
  const cents = BigInt(Math.round(Number(amountUsdt) * 100));
  return decimals >= 2 ? cents * 10n ** BigInt(decimals - 2) : cents / 10n ** BigInt(2 - decimals);
}

function formatUnits(value, decimals) {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return Number(fraction ? `${whole}.${fraction}` : whole.toString());
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw new ChainError(
      error?.name === 'AbortError'
        ? 'The blockchain node did not answer in time. Please retry.'
        : `Could not reach the blockchain API: ${error?.message || 'network error'}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ChainError(
      `Blockchain API returned HTTP ${response.status}${payload?.message ? `: ${payload.message}` : ''}`,
    );
  }
  return payload;
}

/* ---------------------------------------------------------------- BEP20 -- */

async function bscRpc(method, params) {
  const endpoints = [config.crypto.bscRpcUrl, ...BSC_RPC_FALLBACKS].filter(Boolean);
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const payload = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (payload?.error) {
        lastError = new ChainError(`BSC node error: ${payload.error.message || 'unknown error'}`);
        continue;
      }
      return payload?.result ?? null;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new ChainError('No BSC RPC endpoint answered');
}

async function verifyBep20WithRpc({ txHash, walletAddress, expectedUsdt }) {
  const receipt = await bscRpc('eth_getTransactionReceipt', [txHash]);
  if (!receipt) {
    return {
      ok: false,
      status: 409,
      error: 'This transaction is not confirmed on BSC yet. Wait for a confirmation and try again.',
    };
  }
  if (receipt.status !== '0x1') {
    return {
      ok: false,
      status: 422,
      error: 'The transaction failed on-chain (receipt status 0). No USDT was transferred.',
    };
  }

  const wallet = walletAddress.toLowerCase();
  const contract = USDT_BEP20_CONTRACT.toLowerCase();
  const expectedBase = toBaseUnits(expectedUsdt, 18);

  let receivedBase = 0n;
  for (const log of Array.isArray(receipt.logs) ? receipt.logs : []) {
    if (String(log.address || '').toLowerCase() !== contract) continue;
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (topics.length < 3) continue;
    if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    const to = `0x${String(topics[2]).slice(-40)}`.toLowerCase();
    if (to !== wallet) continue;
    try {
      receivedBase += BigInt(log.data);
    } catch {
      // Ignore malformed log data.
    }
  }

  if (receivedBase <= 0n) {
    return {
      ok: false,
      status: 422,
      error: `This transaction did not transfer USDT to the configured wallet (${walletAddress}).`,
    };
  }
  if (receivedBase < expectedBase) {
    return {
      ok: false,
      status: 422,
      error: `Received ${formatUnits(receivedBase, 18)} USDT but ${expectedUsdt} USDT is required.`,
    };
  }

  return {
    ok: true,
    amountUsdt: formatUnits(receivedBase, 18),
    blockNumber: Number.parseInt(receipt.blockNumber, 16) || null,
  };
}

async function verifyBep20WithBscScan({ txHash, walletAddress, expectedUsdt, apiKey }) {
  const key = String(apiKey || '').trim() || config.crypto.bscscanApiKey;
  if (!key) return null;

  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: USDT_BEP20_CONTRACT,
    address: walletAddress,
    page: '1',
    offset: '100',
    sort: 'desc',
    apikey: key,
  });
  const payload = await fetchJson(`https://api.bscscan.com/api?${params.toString()}`);
  if (payload?.status !== '1' || !Array.isArray(payload.result)) {
    const message = payload?.result && typeof payload.result === 'string' ? payload.result : '';
    if (/No transactions found/i.test(message)) {
      return {
        ok: false,
        status: 409,
        error: 'This transaction is not visible to the explorer yet. Please retry shortly.',
      };
    }
    throw new ChainError(
      `BscScan could not verify the transaction${message ? `: ${message}` : ''}`,
    );
  }

  const transfer = payload.result.find(
    (item) => String(item.hash || '').toLowerCase() === txHash.toLowerCase(),
  );
  if (!transfer) {
    return {
      ok: false,
      status: 422,
      error: 'No USDT transfer with this transaction hash was found for the configured wallet.',
    };
  }
  if (String(transfer.to || '').toLowerCase() !== walletAddress.toLowerCase()) {
    return { ok: false, status: 422, error: 'The USDT transfer was sent to a different wallet.' };
  }
  if (String(transfer.txreceipt_status ?? '1') !== '1') {
    return { ok: false, status: 422, error: 'The transaction failed on-chain.' };
  }

  const decimals = Number(transfer.tokenDecimal) || 18;
  const expectedBase = toBaseUnits(expectedUsdt, decimals);
  const receivedBase = BigInt(transfer.value || '0');
  if (receivedBase < expectedBase) {
    return {
      ok: false,
      status: 422,
      error: `Received ${formatUnits(receivedBase, decimals)} USDT but ${expectedUsdt} USDT is required.`,
    };
  }

  return { ok: true, amountUsdt: formatUnits(receivedBase, decimals), blockNumber: null };
}

async function verifyBep20({ txHash, walletAddress, expectedUsdt, bscscanApiKey }) {
  try {
    return await verifyBep20WithRpc({ txHash, walletAddress, expectedUsdt });
  } catch (error) {
    if (String(bscscanApiKey || '').trim() || config.crypto.bscscanApiKey) {
      const fallback = await verifyBep20WithBscScan({
        txHash,
        walletAddress,
        expectedUsdt,
        apiKey: bscscanApiKey,
      });
      if (fallback) return fallback;
    }
    throw error;
  }
}

/* ---------------------------------------------------------------- TRC20 -- */

async function verifyTrc20WithTronGrid({ txHash, walletAddress, expectedUsdt, apiKey }) {
  const params = new URLSearchParams({
    limit: '200',
    only_confirmed: 'true',
    contract_address: USDT_TRC20_CONTRACT,
  });
  const key = String(apiKey || '').trim() || config.crypto.trongridApiKey;
  const headers = key ? { 'TRON-PRO-API-KEY': key } : {};

  const payload = await fetchJson(
    `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions/trc20?${params.toString()}`,
    { headers },
  );

  const transfers = Array.isArray(payload?.data) ? payload.data : [];
  const transfer = transfers.find((item) => String(item.transaction_id) === txHash);
  if (!transfer) return null;

  if (String(transfer.to) !== walletAddress) {
    return { ok: false, status: 422, error: 'The USDT transfer was sent to a different wallet.' };
  }
  if (String(transfer.type || 'Transfer') !== 'Transfer') {
    return { ok: false, status: 422, error: 'This transaction is not a USDT transfer.' };
  }
  if (
    transfer.token_info?.address &&
    String(transfer.token_info.address) !== USDT_TRC20_CONTRACT
  ) {
    return { ok: false, status: 422, error: 'The transaction transferred a different token.' };
  }

  const decimals = Number(transfer.token_info?.decimals ?? 6);
  const receivedBase = BigInt(transfer.value ?? '0');
  const expectedBase = toBaseUnits(expectedUsdt, decimals);
  if (receivedBase < expectedBase) {
    return {
      ok: false,
      status: 422,
      error: `Received ${formatUnits(receivedBase, decimals)} USDT but ${expectedUsdt} USDT is required.`,
    };
  }

  return { ok: true, amountUsdt: formatUnits(receivedBase, decimals), blockNumber: null };
}

async function verifyTrc20WithTronScan({ txHash, walletAddress, expectedUsdt }) {
  const payload = await fetchJson(
    `https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(txHash)}`,
  );

  if (!payload || payload.contractRet === undefined) {
    return {
      ok: false,
      status: 409,
      error: 'This transaction is not confirmed on TRON yet. Wait for a confirmation and try again.',
    };
  }
  if (payload.contractRet !== 'SUCCESS' || payload.confirmed === false) {
    return {
      ok: false,
      status: 422,
      error: 'The transaction failed or is not confirmed on TRON.',
    };
  }

  const transfers = Array.isArray(payload.trc20TransferInfo)
    ? payload.trc20TransferInfo
    : payload.trc20TransferInfo
      ? [payload.trc20TransferInfo]
      : [];

  const transfer = transfers.find(
    (item) =>
      String(item.contract_address) === USDT_TRC20_CONTRACT &&
      String(item.to_address) === walletAddress,
  );

  if (!transfer) {
    const sentElsewhere = transfers.some(
      (item) => String(item.contract_address) === USDT_TRC20_CONTRACT,
    );
    return {
      ok: false,
      status: 422,
      error: sentElsewhere
        ? 'The USDT transfer was sent to a different wallet.'
        : 'This transaction did not transfer USDT.',
    };
  }

  const decimals = Number(transfer.decimals ?? 6);
  const receivedBase = BigInt(transfer.amount_str ?? '0');
  const expectedBase = toBaseUnits(expectedUsdt, decimals);
  if (receivedBase < expectedBase) {
    return {
      ok: false,
      status: 422,
      error: `Received ${formatUnits(receivedBase, decimals)} USDT but ${expectedUsdt} USDT is required.`,
    };
  }

  return { ok: true, amountUsdt: formatUnits(receivedBase, decimals), blockNumber: null };
}

async function verifyTrc20({ txHash, walletAddress, expectedUsdt, trongridApiKey }) {
  let tronGridError = null;
  try {
    const result = await verifyTrc20WithTronGrid({
      txHash,
      walletAddress,
      expectedUsdt,
      apiKey: trongridApiKey,
    });
    if (result) return result;
  } catch (error) {
    tronGridError = error;
  }

  try {
    return await verifyTrc20WithTronScan({ txHash, walletAddress, expectedUsdt });
  } catch (error) {
    throw tronGridError || error;
  }
}

/* ---------------------------------------------------------------- public -- */

/**
 * Confirms that `txHash` is a successful USDT transfer on the configured
 * network, sent to `walletAddress`, for at least `expectedUsdt`.
 *
 * Returns `{ ok, amountUsdt, blockNumber }` on success, or
 * `{ ok: false, status, error }` when the chain definitively rejects it.
 * Throws `ChainError` for transport/explorer failures.
 */
export async function verifyUsdtTransaction({
  network,
  txHash,
  walletAddress,
  expectedUsdt,
  bscscanApiKey = '',
  trongridApiKey = '',
}) {
  if (network === 'BEP20') {
    return verifyBep20({ txHash, walletAddress, expectedUsdt, bscscanApiKey });
  }
  if (network === 'TRC20') {
    return verifyTrc20({ txHash, walletAddress, expectedUsdt, trongridApiKey });
  }
  throw new ChainError('Unsupported crypto network', 400);
}
