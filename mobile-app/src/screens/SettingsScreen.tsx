import { useState } from 'react';
import { useSession } from '../lib/session';
import { isNativeOverlayAvailable } from '../lib/overlay';
import { APP_VERSION } from '../lib/settings';

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
  const [error, setError] = useState<string | null>(null);

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
          <p>Account and support</p>
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

      <p className="footer-note">AI Trading Assistant · v{APP_VERSION}</p>
    </div>
  );
}
