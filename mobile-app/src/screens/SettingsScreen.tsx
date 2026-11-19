import { useRef, useState } from 'react';
import { useSession } from '../lib/session';
import {
  DEFAULT_SERVER_URL,
  isValidServerUrl,
  loadServerUrl,
  normalizeServerUrl,
  saveServerUrl,
} from '../lib/settings';
import { isNativeOverlayAvailable } from '../lib/overlay';

interface SettingsScreenProps {
  onBack: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const { user, settings, logout } = useSession();
  const [draft, setDraft] = useState(() => loadServerUrl());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const flashTimer = useRef<number | null>(null);

  function handleSave() {
    const next = normalizeServerUrl(draft);
    if (!isValidServerUrl(next)) {
      setError('Enter a valid http(s) server URL, for example https://your-api.onrender.com');
      return;
    }
    setError(null);
    saveServerUrl(next);
    setDraft(next);
    setSaved(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSaved(false), 2200);
  }

  function openSupport() {
    if (!settings.support_contact_link) {
      setError('Support contact is not published yet.');
      return;
    }
    window.open(settings.support_contact_link, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="app">
      <header className="app-header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="header-text">
          <h1>Settings</h1>
          <p>Account, server and support</p>
        </div>
      </header>

      <section className="card">
        <h2>Account</h2>
        <dl className="detail-list">
          <div>
            <dt>Full name</dt>
            <dd>{user?.full_name ?? '—'}</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>@{user?.username ?? '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{user?.phone || '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`pill ${user?.account_status === 'ACTIVE' ? 'pill-ok' : 'pill-warn'}`}>
                {user?.account_status ?? '—'}
              </span>
            </dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{user?.active_plan_name || 'No plan yet'}</dd>
          </div>
          <div>
            <dt>Activation code</dt>
            <dd className="mono">{user?.activation_code_used || '—'}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(user?.created_at ?? null)}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2>Backend server</h2>
        <p className="hint">
          The widget posts screenshots to <code>/api/analyze-chart</code>. The Gemini key stays on the
          server and is never shipped in this app.
        </p>
        <label className="field-label" htmlFor="server-url">
          Server URL
        </label>
        <div className="row">
          <input
            id="server-url"
            className="input"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={DEFAULT_SERVER_URL}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="button" className="btn" onClick={handleSave}>
            Save
          </button>
        </div>
        {saved ? <p className="saved-flash">Saved — restart the widget to use this server.</p> : null}
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Active: <code>{loadServerUrl()}</code>
        </p>
      </section>

      {error ? (
        <div className="alert error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <h2>Support</h2>
        <p className="hint">
          Need help with activation, payments or the widget? Reach our team directly.
        </p>
        <button
          type="button"
          className="btn btn-block"
          onClick={openSupport}
          disabled={!settings.support_contact_link}
        >
          Contact Support
        </button>
        {!settings.support_contact_link ? (
          <p className="micro-hint">Support contact is not published yet.</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Session</h2>
        <p className="hint">
          {isNativeOverlayAvailable()
            ? 'Signing out stops the widget on this device.'
            : 'You are viewing the browser preview of the app.'}
        </p>
        <button type="button" className="btn btn-danger-outline btn-block" onClick={logout}>
          Sign out
        </button>
      </section>

      <p className="footer-note">AI Trading Assistant · v1.0.0</p>
    </div>
  );
}
