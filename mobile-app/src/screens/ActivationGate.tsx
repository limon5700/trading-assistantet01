import { useState, type FormEvent } from 'react';
import { ApiError, type Plan } from '../lib/api';
import { useSession } from '../lib/session';

function openExternal(url: string | undefined) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function durationLabel(plan: Plan): string {
  if (plan.plan_type === 'FREE' || plan.duration_days >= 36500) return 'Lifetime access';
  if (plan.duration_days === 1) return '1 day of access';
  if (plan.duration_days === 30) return '30 days of access';
  return `${plan.duration_days} days of access`;
}

export function ActivationGate() {
  const { user, plans, settings, activate, logout } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const freePlan = plans.find((plan) => plan.plan_type === 'FREE');
  const paidPlan = plans.find((plan) => plan.plan_type === 'PAID');
  const suspended = user?.account_status === 'SUSPENDED';

  async function handleActivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || suspended) return;
    const value = code.trim().toUpperCase();
    if (!value) {
      setError('Enter the activation code you received from support.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await activate(value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not activate this code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">AI</div>
        <div className="header-text">
          <h1>Activate your account</h1>
          <p>
            Signed in as <strong>{user?.username ?? user?.email}</strong>
          </p>
        </div>
        <button type="button" className="btn btn-small" onClick={logout}>
          Sign out
        </button>
      </header>

      <div className={`banner ${suspended ? 'banner-danger' : 'banner-warning'}`} role="status">
        <span className="banner-icon" aria-hidden="true">
          {suspended ? '!' : '🔒'}
        </span>
        <div>
          <strong>{suspended ? 'Your account is suspended' : 'Your account is pending activation'}</strong>
          <p>
            {suspended
              ? 'Contact support to restore access. Chart analysis stays disabled until then.'
              : 'Choose one of the plans below, then enter the activation code support sends you.'}
          </p>
        </div>
      </div>

      <section className="plan-grid" aria-label="Available plans">
        <article className="plan-card">
          <header className="plan-head">
            <span className="plan-tag">Free plan</span>
            <h2>{freePlan?.name ?? 'Free Affiliate Plan'}</h2>
            <p className="plan-price">Free</p>
            <p className="plan-duration">{freePlan ? durationLabel(freePlan) : 'Lifetime access'}</p>
          </header>

          {freePlan?.description ? <p className="plan-copy">{freePlan.description}</p> : null}

          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <div>
                <strong>Open an account with the affiliate link</strong>
                <p>Use our official partner link so your signup is tracked.</p>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => openExternal(settings.affiliate_link)}
                  disabled={!settings.affiliate_link}
                >
                  Open Affiliate Link
                </button>
                {!settings.affiliate_link ? (
                  <p className="micro-hint">The affiliate link is not published yet. Ask support.</p>
                ) : null}
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div>
                <strong>Send the proof to support</strong>
                <p>Share a screenshot of your opened account.</p>
                <button
                  type="button"
                  className="btn btn-block"
                  onClick={() => openExternal(settings.support_contact_link)}
                  disabled={!settings.support_contact_link}
                >
                  Contact Support
                </button>
                {!settings.support_contact_link ? (
                  <p className="micro-hint">Support contact is not published yet.</p>
                ) : null}
              </div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div>
                <strong>Receive your personal activation code</strong>
                <p>Enter the code below to unlock the assistant.</p>
              </div>
            </li>
          </ol>

          {freePlan?.features?.length ? (
            <ul className="feature-list">
              {freePlan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="plan-card plan-card-paid">
          <header className="plan-head">
            <span className="plan-tag tag-paid">Paid plan</span>
            <h2>{paidPlan?.name ?? 'Paid Pro Plan'}</h2>
            <p className="plan-price">
              {paidPlan ? `$${paidPlan.price.toFixed(2)}` : '—'}
              <span className="price-suffix"> / {paidPlan ? durationLabel(paidPlan) : '30 days'}</span>
            </p>
          </header>

          {paidPlan?.description ? <p className="plan-copy">{paidPlan.description}</p> : null}

          {paidPlan?.features?.length ? (
            <ul className="feature-list">
              {paidPlan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => openExternal(settings.support_contact_link)}
            disabled={!settings.support_contact_link}
          >
            Pay &amp; Get Activation Code
          </button>
          <p className="micro-hint">
            Open support, pay the plan price and you will receive your personal code.
          </p>
        </article>
      </section>

      <section className="card">
        <h2>Enter your activation code</h2>
        <p className="hint">
          Codes look like <code>TRD-XXXX-XXXX</code> and are tied to your account.
        </p>
        <form onSubmit={handleActivate}>
          <label className="field-label" htmlFor="activation-code">
            Activation code
          </label>
          <input
            id="activation-code"
            className="input code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="TRD-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy || suspended}
          />
          {error ? (
            <div className="alert error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || suspended}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Activating…
              </>
            ) : (
              'Activate Account'
            )}
          </button>
        </form>
      </section>

      <p className="footer-note">
        Activation codes are single-use. If your code does not work, contact support.
      </p>
    </div>
  );
}
