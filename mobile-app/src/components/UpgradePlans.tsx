import { useMemo, useRef, useState } from 'react';
import type { Plan } from '../lib/api';
import { useSession } from '../lib/session';
import { CryptoPayment } from '../screens/CryptoPayment';

interface UpgradePlansProps {
  onBack: () => void;
}

function durationLabel(plan: Plan): string {
  if (plan.plan_type === 'FREE' || plan.duration_days >= 36500) return 'Lifetime access';
  return `${plan.duration_days} day${plan.duration_days === 1 ? '' : 's'} of access`;
}

function planPrice(plan: Plan): string {
  if (plan.plan_type === 'FREE' || plan.price <= 0) return 'Free';
  return `$${plan.price.toFixed(2)}`;
}

function openExternal(url: string | undefined) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Horizontal plan slider used by the Settings screen to upgrade or renew.
 * Free plans route to the affiliate + activation-code instructions; paid plans
 * open the existing on-chain USDT checkout.
 */
export function UpgradePlans({ onBack }: UpgradePlansProps) {
  const { plans, settings, user } = useSession();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);
  const [showFreeSteps, setShowFreeSteps] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const orderedPlans = useMemo(
    () =>
      [...plans].sort((a, b) =>
        a.plan_type === b.plan_type ? a.price - b.price : a.plan_type === 'FREE' ? -1 : 1,
      ),
    [plans],
  );

  const selected = orderedPlans[selectedIndex] ?? orderedPlans[0];

  if (checkoutPlan) {
    return <CryptoPayment plan={checkoutPlan} onBack={() => setCheckoutPlan(null)} />;
  }

  function selectPlan(index: number) {
    setSelectedIndex(index);
    setShowFreeSteps(false);
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

  return (
    <div className="app">
      <header className="app-header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to settings">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="header-text">
          <h1>Upgrade plan</h1>
          <p>Current: {user?.active_plan_name || 'No active plan'}</p>
        </div>
      </header>

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

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              if (!selected) return;
              if (selected.plan_type === 'PAID') setCheckoutPlan(selected);
              else setShowFreeSteps(true);
            }}
            disabled={!selected}
          >
            {selected?.plan_type === 'PAID'
              ? `Pay ${planPrice(selected)} with USDT`
              : 'Continue with the free plan'}
          </button>

          {showFreeSteps ? (
            <section className="card">
              <h2>Free activation</h2>
              <ol className="payment-steps">
                <li>Open a trading account through our official affiliate link.</li>
                <li>Send the signup proof to support and request your code.</li>
                <li>Enter the personal code in the app to activate access.</li>
              </ol>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => openExternal(settings.affiliate_link)}
                disabled={!settings.affiliate_link}
              >
                Open Affiliate Link
              </button>
              <button
                type="button"
                className="btn btn-block"
                style={{ marginTop: 8 }}
                onClick={() => openExternal(settings.support_contact_link)}
                disabled={!settings.support_contact_link}
              >
                Contact Support
              </button>
              {!settings.affiliate_link || !settings.support_contact_link ? (
                <p className="micro-hint">Links are not published yet. Please contact support.</p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <section className="card">
          <h2>No plans available</h2>
          <p className="hint">Plans are not published yet. Please contact support.</p>
        </section>
      )}

      <p className="footer-note">Crypto payments are verified on-chain and cannot be reversed.</p>
    </div>
  );
}
