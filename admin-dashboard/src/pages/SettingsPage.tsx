import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/ToastProvider';
import { ApiError, api } from '../lib/api';
import type { AppSettings } from '../lib/types';

type FormState = Pick<AppSettings, 'affiliate_link' | 'support_contact_link' | 'app_name'>;

const EMPTY: FormState = { affiliate_link: '', support_contact_link: '', app_name: '' };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
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

    setSaving(true);
    setError(null);
    try {
      const { settings } = await api.updateSettings({
        affiliate_link: affiliate,
        support_contact_link: support,
        app_name: appName,
      });
      setForm({
        affiliate_link: settings.affiliate_link,
        support_contact_link: settings.support_contact_link,
        app_name: settings.app_name,
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
                Telegram, WhatsApp or any support URL. Used by both the Free and Paid plan buttons.
              </p>
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
            <li>They open your affiliate link and send proof to support, or pay for the paid plan.</li>
            <li>Generate an activation code for that user from the Codes page.</li>
            <li>They enter the code in the app, which activates the account on that plan.</li>
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
