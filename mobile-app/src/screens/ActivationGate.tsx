import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Plan } from '../lib/api';
import { useSession } from '../lib/session';
import { CryptoPayment } from './CryptoPayment';

type Step = 'plans' | 'free' | 'paid';

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

function planPrice(plan: Plan): string {
  if (plan.plan_type === 'FREE' || plan.price <= 0) return 'Free';
  return `$${plan.price.toFixed(2)}`;
}

export function ActivationGate() {
  const { user, plans, settings, activate, logout } = useSession();
  const [step, setStep] = useState<Step>('plans');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const suspended = user?.account_status === 'SUSPENDED';

  const orderedPlans = useMemo(
    () => [...plans].sort((a, b) => (a.plan_type === b.plan_type ? a.price - b.price : a.plan_type === 'FREE' ? -1 : 1)),
    [plans],
  );

  const selected = orderedPlans[selectedIndex] ?? orderedPlans[0];

  useEffect(() => {
    if (selectedIndex > orderedPlans.length - 1) setSelectedIndex(0);
  }, [orderedPlans.length, selectedIndex]);

  function selectPlan(index: number) {
    setSelectedIndex(index);
    setError(null);
    const track = trackRef.current;
    const card = track?.children[index] as HTMLElement | undefined;
    if (track && card) {
      track.scrollTo({
        left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  }

  function handleTrackScroll() {
    const track = trackRef.current;
    if (!track || !track.children.length) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    Array.from(track.children).forEach((child, index) => {
      const element = child as HTMLElement;
      const cardCenter = element.offsetLeft + element.offsetWidth / 2;
      const distance = Math.abs(cardCenter - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (bestIndex !== selectedIndex) setSelectedIndex(bestIndex);
  }

  function handleNext() {
    if (!selected || suspended) return;
    setError(null);
    setStep(selected.plan_type === 'FREE' ? 'free' : 'paid');
  }

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

  if (step === 'paid' && selected) {
    return <CryptoPayment plan={selected} onBack={() => setStep('plans')} />;
  }

  if (step === 'free' && selected) {
    return (
      <div className="app">
        <header className="app-header">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setStep('plans')}
            aria-label="Back to plans"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="header-text">
            <h1>Free activation</h1>
            <p>{selected.name}</p>
          </div>
        </header>

        <section className="card">
          <h2>Step 1 · Open an account</h2>
          <p className="hint">
            Use our official partner link so your signup is tracked.
          </p>
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
        </section>

        <section className="card">
          <h2>Step 2 · Send the proof</h2>
          <p className="hint">Share a screenshot of your opened account with support.</p>
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
        </section>

        <section className="card">
          <h2>Step 3 · Enter your activation code</h2>
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

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">AI</div>
        <div className="header-text">
          <h1>Choose your plan</h1>
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
              : 'Swipe the plans, pick one and tap Next to unlock the assistant.'}
          </p>
        </div>
      </div>

      {orderedPlans.length ? (
        <>
          <div className="plan-carousel">
            <div
              className="plan-carousel-track"
              ref={trackRef}
              onScroll={handleTrackScroll}
              aria-label="Available plans"
            >
              {orderedPlans.map((plan, index) => (
                <article
                  key={plan.id}
                  className={`plan-slide${index === selectedIndex ? ' selected' : ''}`}
                  onClick={() => selectPlan(index)}
                  aria-current={index === selectedIndex}
                >
                  <header className="plan-head">
                    <span className={`plan-tag${plan.plan_type === 'PAID' ? ' tag-paid' : ''}`}>
                      {plan.plan_type === 'FREE' ? 'Free plan' : 'Paid plan'}
                    </span>
                    {index === selectedIndex ? <span className="plan-check">✓ Selected</span> : null}
                    <h2>{plan.name}</h2>
                    <p className="plan-price">
                      {planPrice(plan)}
                      {plan.plan_type === 'PAID' ? <span className="price-suffix"> USDT</span> : null}
                    </p>
                    <p className="plan-duration">{durationLabel(plan)}</p>
                  </header>

                  {plan.description ? <p className="plan-copy">{plan.description}</p> : null}

                  {plan.features.length ? (
                    <ul className="feature-list">
                      {plan.features.slice(0, 4).map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="micro-hint">
                    {plan.plan_type === 'FREE'
                      ? 'Activate with your affiliate signup and a personal code.'
                      : 'Pay in USDT — verified on-chain and activated automatically.'}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="carousel-dots" role="tablist" aria-label="Plan pagination">
            {orderedPlans.map((plan, index) => (
              <button
                key={plan.id}
                type="button"
                role="tab"
                aria-selected={index === selectedIndex}
                aria-label={`Show ${plan.name}`}
                className={`carousel-dot${index === selectedIndex ? ' active' : ''}`}
                onClick={() => selectPlan(index)}
              />
            ))}
          </div>

          {error ? (
            <div className="alert error" role="alert">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            className="btn btn-primary btn-block plan-next"
            onClick={handleNext}
            disabled={!selected || suspended}
          >
            Next
          </button>
          <p className="micro-hint center-hint">
            {selected?.plan_type === 'FREE'
              ? 'Next: affiliate link, support and your activation code.'
              : 'Next: USDT payment with automatic on-chain verification.'}
          </p>
        </>
      ) : (
        <section className="card">
          <h2>No plans available</h2>
          <p className="hint">Plans are not published yet. Please contact support.</p>
        </section>
      )}

      <p className="footer-note">
        Signals are technical analysis only and are not financial advice. Trade at your own risk.
      </p>
    </div>
  );
}
