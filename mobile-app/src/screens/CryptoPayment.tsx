import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, paymentApi, type CryptoPayment as CryptoPaymentRecord, type Plan } from '../lib/api';
import { useSession } from '../lib/session';

interface CryptoPaymentProps {
  plan: Plan;
  onBack: () => void;
}

const NETWORK_LABELS: Record<'BEP20' | 'TRC20', string> = {
  BEP20: 'BEP20 · BNB Smart Chain',
  TRC20: 'TRC20 · TRON',
};

const POLL_INTERVAL_MS = 10_000;

function formatUsdt(value: number): string {
  return value.toFixed(2);
}

export function CryptoPayment({ plan, onBack }: CryptoPaymentProps) {
  const { token, verifyPayment, refresh } = useSession();
  const [payment, setPayment] = useState<CryptoPaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const startPayment = useCallback(async () => {
    if (!token) {
      setError('Please sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await paymentApi.start(token, plan.id);
      setPayment(response.payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment.');
    } finally {
      setLoading(false);
    }
  }, [plan.id, token]);

  useEffect(() => {
    void startPayment();
  }, [startPayment]);

  // Poll while pending so a payment verified elsewhere (or a retried chain
  // confirmation) unlocks the hub without the user pressing anything.
  useEffect(() => {
    if (!token || !payment || payment.status !== 'PENDING') return undefined;
    let cancelled = false;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          if (payment.tx_hash) {
            // Retry the on-chain check automatically until it confirms or fails.
            await verifyPayment(payment.id, payment.tx_hash);
            if (!cancelled) setNotice('Payment verified. Unlocking your account…');
            return;
          }
          const response = await paymentApi.get(token, payment.id);
          if (cancelled) return;
          setPayment(response.payment);
          if (response.payment.status === 'VERIFIED') await refresh();
        } catch {
          if (cancelled) return;
          const latest = await paymentApi.get(token, payment.id).catch(() => null);
          if (latest) setPayment(latest.payment);
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [payment, refresh, token, verifyPayment]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  async function copyAddress() {
    if (!payment) return;
    try {
      await navigator.clipboard.writeText(payment.wallet_address);
      setCopied(true);
      setNotice('Wallet address copied.');
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        setCopied(false);
        setNotice(null);
      }, 2200);
    } catch {
      setError('Could not access the clipboard. Copy the address manually.');
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment || verifying) return;
    const hash = txHash.trim();
    if (!hash) {
      setError('Paste the transaction hash (TxID) from your wallet.');
      return;
    }

    setError(null);
    setNotice('Checking the transaction on-chain…');
    setVerifying(true);
    try {
      await verifyPayment(payment.id, hash);
      setNotice('Payment verified. Unlocking your account…');
    } catch (err) {
      setNotice(null);
      setError(err instanceof ApiError ? err.message : 'Could not verify this transaction.');
      const latest = await paymentApi.get(token ?? '', payment.id).catch(() => null);
      if (latest) setPayment(latest.payment);
    } finally {
      setVerifying(false);
    }
  }

  function retry() {
    setError(null);
    setNotice(null);
    void startPayment();
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Back to plans"
          disabled={verifying}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="header-text">
          <h1>Pay with USDT</h1>
          <p>{plan.name}</p>
        </div>
      </header>

      {loading ? (
        <section className="card payment-loading">
          <span className="spinner spinner-dark" aria-hidden="true" />
          <p>Preparing your payment address…</p>
        </section>
      ) : !payment ? (
        <section className="card">
          <h2>Payment unavailable</h2>
          <p className="hint">
            {error ?? 'This plan cannot be paid right now. Please contact support.'}
          </p>
          <button type="button" className="btn btn-block" onClick={retry}>
            Try again
          </button>
        </section>
      ) : (
        <>
          <section className="card payment-card">
            <div className="payment-top">
              <span className="payment-network">{NETWORK_LABELS[payment.network]}</span>
              <span className={`pill ${payment.status === 'VERIFIED' ? 'pill-ok' : 'pill-warn'}`}>
                {payment.status}
              </span>
            </div>

            <p className="payment-label">Send exactly</p>
            <p className="payment-amount">
              {formatUsdt(payment.expected_amount_usdt)} <span>USDT</span>
            </p>
            <p className="payment-note">
              Any smaller amount will fail verification. Send only USDT on the {payment.network}{' '}
              network.
            </p>

            <div className="wallet-box">
              <span className="wallet-label">Receiving wallet</span>
              <code className="wallet-address">{payment.wallet_address}</code>
              <button type="button" className="btn btn-small" onClick={() => void copyAddress()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <ol className="payment-steps">
              <li>Open your wallet or exchange and choose USDT on {payment.network}.</li>
              <li>
                Send <strong>{formatUsdt(payment.expected_amount_usdt)} USDT</strong> to the address
                above.
              </li>
              <li>Copy the transaction hash (TxID) and paste it below.</li>
            </ol>
          </section>

          {payment.status === 'VERIFIED' ? (
            <section className="card payment-success">
              <h2>Payment verified</h2>
              <p className="hint">Your account is active. Open the hub to start scanning charts.</p>
            </section>
          ) : (
            <section className="card">
              <h2>Verify payment</h2>
              <p className="hint">Verification happens automatically against the blockchain.</p>
              <form onSubmit={handleVerify}>
                <label className="field-label" htmlFor="tx-hash">
                  Transaction hash (TxID)
                </label>
                <input
                  id="tx-hash"
                  className="input mono"
                  value={txHash}
                  onChange={(event) => setTxHash(event.target.value.trim())}
                  placeholder={
                    payment.network === 'BEP20'
                      ? '0x…'
                      : 'Transaction hash from your wallet'
                  }
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={verifying}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={verifying || payment.status === 'FAILED'}
                >
                  {verifying ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      Verifying on-chain…
                    </>
                  ) : (
                    'Verify Payment'
                  )}
                </button>
                {payment.status === 'FAILED' ? (
                  <button
                    type="button"
                    className="btn btn-block"
                    style={{ marginTop: 8 }}
                    onClick={retry}
                  >
                    Start a new payment
                  </button>
                ) : null}
              </form>
              <p className="micro-hint">
                This screen also checks every few seconds. Once the network confirms your transfer,
                your account unlocks automatically.
              </p>
            </section>
          )}

          {notice ? <div className="alert info">{notice}</div> : null}
          {error ? (
            <div className="alert error" role="alert">
              {error}
            </div>
          ) : null}

          <p className="footer-note">
            Always double-check the network and address. Crypto transfers cannot be reversed.
          </p>
        </>
      )}
    </div>
  );
}
