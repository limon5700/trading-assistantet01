import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/ToastProvider';
import { ApiError, api } from '../lib/api';
import type { AppSettings } from '../lib/types';

type CryptoNetwork = 'BEP20' | 'TRC20';

type FormState = Pick<
  AppSettings,
  | 'affiliate_link'
  | 'support_contact_link'
  | 'app_name'
  | 'crypto_network'
  | 'crypto_wallet_address'
  | 'bscscan_api_key'
  | 'trongrid_api_key'
>;

const EMPTY: FormState = {
  affiliate_link: '',
  support_contact_link: '',
  app_name: '',
  crypto_network: 'BEP20',
  crypto_wallet_address: '',
  bscscan_api_key: '',
  trongrid_api_key: '',
};

const BEP20_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TRC20_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function walletMatches(network: CryptoNetwork, wallet: string): boolean {
  return network === 'BEP20' ? BEP20_ADDRESS.test(wallet) : TRC20_ADDRESS.test(wallet);
}

export default function SettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { settings } = await api.getSettings();
      setForm({
        affiliate_link: settings.affiliate_link ?? '',
        support_contact_link: settings.support_contact_link ?? '',
        app_name: settings.app_name ?? '',
        crypto_network: settings.crypto_network === 'TRC20' ? 'TRC20' : 'BEP20',
        crypto_wallet_address: settings.crypto_wallet_address ?? '',
        bscscan_api_key: settings.bscscan_api_key ?? '',
        trongrid_api_key: settings.trongrid_api_key ?? '',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const affiliate = form.affiliate_link.trim();
    const support = form.support_contact_link.trim();
    const appName = form.app_name.trim();
    const wallet = form.crypto_wallet_address.trim();
    const bscscanKey = form.bscscan_api_key.trim();
    const trongridKey = form.trongrid_api_key.trim();

    if (affiliate && !isHttpUrl(affiliate)) {
      setError('The affiliate link must start with http:// or https://.');
      return;
    }
    if (support && !isHttpUrl(support)) {
      setError('The support contact link must start with http:// or https://.');
      return;
    }
    if (!appName) {
      setError('App name is required.');
      return;
    }
    if (wallet && !walletMatches(form.crypto_network, wallet)) {
      setError(
        form.crypto_network === 'BEP20'
          ? 'Enter a BSC (BEP20) wallet address starting with 0x.'
          : 'Enter a TRON (TRC20) wallet address starting with T.',
      );
      return;
    }
    if (bscscanKey.length > 200 || trongridKey.length > 200) {
      setError('Explorer API keys must be 200 characters or fewer.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { settings } = await api.updateSettings({
        affiliate_link: affiliate,
        support_contact_link: support,
        app_name: appName,
        crypto_network: form.crypto_network,
        crypto_wallet_address: wallet,
        bscscan_api_key: bscscanKey,
        trongrid_api_key: trongridKey,
      });
      setForm({
        affiliate_link: settings.affiliate_link,
        support_contact_link: settings.support_contact_link,
        app_name: settings.app_name,
        crypto_network: settings.crypto_network === 'TRC20' ? 'TRC20' : 'BEP20',
        crypto_wallet_address: settings.crypto_wallet_address,
        bscscan_api_key: settings.bscscan_api_key,
        trongrid_api_key: settings.trongrid_api_key,
      });
      toast.success('Settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-3xl space-y-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">App settings</h1>
          <p className="text-xs text-slate-500">
            These values are shown to users inside the Android app on the activation screen.
          </p>
        </div>

        {loading ? (
          <div className="card flex items-center justify-center py-14">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card space-y-5 p-5" noValidate>
            <div>
              <label className="label" htmlFor="app-name">
                App name
              </label>
              <input
                id="app-name"
                className="input"
                value={form.app_name}
                onChange={(event) => setForm({ ...form, app_name: event.target.value })}
                placeholder="AI Trading Assistant"
              />
            </div>

            <div>
              <label className="label" htmlFor="affiliate-link">
                Affiliate link
              </label>
              <input
                id="affiliate-link"
                className="input"
                inputMode="url"
                value={form.affiliate_link}
                onChange={(event) => setForm({ ...form, affiliate_link: event.target.value })}
                placeholder="https://broker.example.com/ref/your-id"
              />
              <p className="mt-1 text-xs text-slate-500">
                Users tap “Open Affiliate Link” on the Free plan before requesting a code.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="support-link">
                Support contact link
              </label>
              <input
                id="support-link"
                className="input"
                inputMode="url"
                value={form.support_contact_link}
                onChange={(event) => setForm({ ...form, support_contact_link: event.target.value })}
                placeholder="https://t.me/your_support"
              />
              <p className="mt-1 text-xs text-slate-500">
                Telegram, WhatsApp or any support URL. Used by the Free affiliate step.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Crypto payments (USDT)</h2>
                  <p className="text-xs text-slate-500">
                    Paid plans are verified on-chain against this wallet.
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    form.crypto_wallet_address
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {form.crypto_wallet_address ? 'Payments enabled' : 'Wallet not set'}
                </span>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="label" htmlFor="crypto-network">
                    Network
                  </label>
                  <select
                    id="crypto-network"
                    className="input"
                    value={form.crypto_network}
                    onChange={(event) =>
                      setForm({ ...form, crypto_network: event.target.value as CryptoNetwork })
                    }
                  >
                    <option value="BEP20">BEP20 — BNB Smart Chain (BSC)</option>
                    <option value="TRC20">TRC20 — TRON</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    {form.crypto_network === 'BEP20'
                      ? 'USDT contract 0x55d398326f99059fF775485246999027B3197955 (BSC, 18 decimals).'
                      : 'USDT contract TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (TRON, 6 decimals).'}
                  </p>
                </div>

                <div>
                  <label className="label" htmlFor="crypto-wallet">
                    Receiving wallet address
                  </label>
                  <input
                    id="crypto-wallet"
                    className="input font-mono text-xs"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={form.crypto_wallet_address}
                    onChange={(event) =>
                      setForm({ ...form, crypto_wallet_address: event.target.value })
                    }
                    placeholder={
                      form.crypto_network === 'BEP20'
                        ? '0x… (BSC address)'
                        : 'T… (TRON address)'
                    }
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Leave empty to disable crypto checkout. Users must pay the exact plan amount in
                    USDT to this address.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="bscscan-key">
                      BscScan API key (optional)
                    </label>
                    <input
                      id="bscscan-key"
                      className="input font-mono text-xs"
                      type="password"
                      autoComplete="off"
                      value={form.bscscan_api_key}
                      onChange={(event) =>
                        setForm({ ...form, bscscan_api_key: event.target.value })
                      }
                      placeholder="Used when BSC RPC is unavailable"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="trongrid-key">
                      TronGrid API key (optional)
                    </label>
                    <input
                      id="trongrid-key"
                      className="input font-mono text-xs"
                      type="password"
                      autoComplete="off"
                      value={form.trongrid_api_key}
                      onChange={(event) =>
                        setForm({ ...form, trongrid_api_key: event.target.value })
                      }
                      placeholder="Raises TRON API limits"
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Explorer keys are stored server-side and are never sent to the mobile app.
                </p>
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void load()} disabled={saving}>
                Reset
              </button>
            </div>
          </form>
        )}

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Activation flow</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>User signs up in the app and stays PENDING.</li>
            <li>
              <strong>Free plan:</strong> they open your affiliate link, contact support, and you
              generate an activation code from the Codes page.
            </li>
            <li>
              <strong>Paid plan:</strong> they send the exact USDT amount shown in the app and submit
              the TxID. The backend verifies the transfer on-chain and activates the account
              automatically — no code needed.
            </li>
            <li>They enter the code (free flow) or finish the payment (paid flow) to unlock the hub.</li>
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
