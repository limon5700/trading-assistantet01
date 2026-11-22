import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../lib/session';
import { TradingOverlay, isNativeOverlayAvailable } from '../lib/overlay';
import { APP_VERSION } from '../lib/settings';
import { LegalModal } from '../components/LegalModal';
import { UpgradePlans } from '../components/UpgradePlans';

interface SettingsScreenProps {
  onBack: () => void;
}

const DURATIONS = [5, 15, 30, 60, 180, 300];
const TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H'];
const VOICE_TEST_TEXT = 'Voice alerts are working. Binary buy signal, next candle, sixty seconds, confidence eighty five percent.';

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${seconds / 60}m`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function addDays(value: string | null, days: number): string | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (days >= 36500) return null;
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const {
    user,
    plans,
    settings,
    config,
    tradeSettings,
    saveTradeSettings,
    voiceAlerts,
    setVoiceAlerts,
    logout,
  } = useSession();

  const [binaryConfidence, setBinaryConfidence] = useState(tradeSettings.binary_min_confidence);
  const [binaryDuration, setBinaryDuration] = useState(tradeSettings.binary_duration_seconds);
  const [binaryStrategy, setBinaryStrategy] = useState(tradeSettings.binary_strategy);
  const [forexConfidence, setForexConfidence] = useState(tradeSettings.forex_min_confidence);
  const [forexTimeframe, setForexTimeframe] = useState(tradeSettings.forex_timeframe);
  const [forexStrategy, setForexStrategy] = useState(tradeSettings.forex_strategy);
  const [savingTrade, setSavingTrade] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<'terms' | 'about' | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    setBinaryConfidence(tradeSettings.binary_min_confidence);
    setBinaryDuration(tradeSettings.binary_duration_seconds);
    setBinaryStrategy(tradeSettings.binary_strategy);
    setForexConfidence(tradeSettings.forex_min_confidence);
    setForexTimeframe(tradeSettings.forex_timeframe);
    setForexStrategy(tradeSettings.forex_strategy);
  }, [tradeSettings]);

  useEffect(() => {
    if (!savedFlash) return undefined;
    const timer = window.setTimeout(() => setSavedFlash(null), 2400);
    return () => window.clearTimeout(timer);
  }, [savedFlash]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === user?.active_plan_id) ?? null,
    [plans, user?.active_plan_id],
  );
  const expiry = activePlan ? addDays(user?.created_at ?? null, activePlan.duration_days) : null;

  const tradeDirty =
    binaryConfidence !== tradeSettings.binary_min_confidence ||
    binaryDuration !== tradeSettings.binary_duration_seconds ||
    binaryStrategy !== tradeSettings.binary_strategy ||
    forexConfidence !== tradeSettings.forex_min_confidence ||
    forexTimeframe !== tradeSettings.forex_timeframe ||
    forexStrategy !== tradeSettings.forex_strategy;

  function openSupport() {
    if (!settings.support_contact_link) {
      setError('Support contact is not published yet.');
      return;
    }
    window.open(settings.support_contact_link, '_blank', 'noopener,noreferrer');
  }

  async function saveTrade() {
    if (savingTrade) return;
    setSavingTrade(true);
    setError(null);
    try {
      await saveTradeSettings({
        binary_min_confidence: binaryConfidence,
        binary_duration_seconds: binaryDuration,
        binary_strategy: binaryStrategy,
        forex_min_confidence: forexConfidence,
        forex_timeframe: forexTimeframe,
        forex_strategy: forexStrategy,
      });
      setSavedFlash('Trade settings saved. The AI now uses them on every scan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your trade settings.');
    } finally {
      setSavingTrade(false);
    }
  }

  async function testVoice() {
    if (voiceBusy) return;
    setVoiceBusy(true);
    setError(null);
    try {
      if (isNativeOverlayAvailable()) {
        await TradingOverlay.testVoice({ text: VOICE_TEST_TEXT });
        setSavedFlash('Test sentence sent to Android text-to-speech.');
      } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(VOICE_TEST_TEXT);
        utterance.lang = 'en-US';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setSavedFlash('Test sentence sent to the browser voice engine.');
      } else {
        setError('This device has no text-to-speech engine available.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not test the voice output.');
    } finally {
      setVoiceBusy(false);
    }
  }

  if (upgrading) {
    return <UpgradePlans onBack={() => setUpgrading(false)} />;
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
          <p>Profile, trade rules and voice</p>
        </div>
      </header>

      {savedFlash ? <div className="alert info">{savedFlash}</div> : null}
      {error ? (
        <div className="alert error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2>Profile &amp; current plan</h2>
          <span className={`pill ${user?.account_status === 'ACTIVE' ? 'pill-ok' : 'pill-warn'}`}>
            {user?.account_status ?? '—'}
          </span>
        </div>
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
            <dt>Plan</dt>
            <dd>
              <span className="pill pill-ok">{user?.active_plan_name || 'No plan yet'}</span>
            </dd>
          </div>
          <div>
            <dt>Expiry</dt>
            <dd>{expiry ? `Active until ${expiry}` : activePlan?.duration_days === 36500 ? 'Lifetime' : '—'}</dd>
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
        <button type="button" className="btn btn-primary btn-block" onClick={() => setUpgrading(true)}>
          Upgrade Plan
        </button>
      </section>

      <section className="card">
        <h2>Binary trade settings</h2>
        <p className="hint">Used for every BINARY scan from the widget.</p>

        <div className="range-field">
          <div className="range-head">
            <label htmlFor="binary-confidence">Minimum confidence</label>
            <strong>{binaryConfidence}%</strong>
          </div>
          <input
            id="binary-confidence"
            className="range"
            type="range"
            min={50}
            max={95}
            step={1}
            value={binaryConfidence}
            onChange={(event) => setBinaryConfidence(Number(event.target.value))}
          />
          <p className="micro-hint">Below this confidence the AI returns WAIT instead of BUY/SELL.</p>
        </div>

        <div className="range-field">
          <span className="range-head">
            <span>Preferred duration</span>
            <strong>{durationLabel(binaryDuration)}</strong>
          </span>
          <div className="chip-row">
            {DURATIONS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className={`chip${binaryDuration === seconds ? ' active' : ''}`}
                onClick={() => setBinaryDuration(seconds)}
              >
                {durationLabel(seconds)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="binary-strategy">
            My binary strategy
          </label>
          <textarea
            id="binary-strategy"
            className="input textarea"
            rows={4}
            maxLength={4000}
            placeholder="e.g. Only trade the London/NY overlap. Skip signals against the 5M trend. Prefer bullish engulfing at support."
            value={binaryStrategy}
            onChange={(event) => setBinaryStrategy(event.target.value)}
          />
          <p className="micro-hint">Your notes are sent to the AI with every binary scan.</p>
        </div>
      </section>

      <section className="card">
        <h2>Forex trade settings</h2>
        <p className="hint">Used for every FOREX scan from the widget.</p>

        <div className="range-field">
          <div className="range-head">
            <label htmlFor="forex-confidence">Minimum confidence</label>
            <strong>{forexConfidence}%</strong>
          </div>
          <input
            id="forex-confidence"
            className="range"
            type="range"
            min={50}
            max={95}
            step={1}
            value={forexConfidence}
            onChange={(event) => setForexConfidence(Number(event.target.value))}
          />
          <p className="micro-hint">Below this confidence the AI returns WAIT instead of BUY/SELL.</p>
        </div>

        <div className="range-field">
          <span className="range-head">
            <span>Preferred timeframe</span>
            <strong>{forexTimeframe}</strong>
          </span>
          <div className="chip-row">
            {TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe}
                type="button"
                className={`chip${forexTimeframe === timeframe ? ' active' : ''}`}
                onClick={() => setForexTimeframe(timeframe)}
              >
                {timeframe}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="forex-strategy">
            My forex strategy
          </label>
          <textarea
            id="forex-strategy"
            className="input textarea"
            rows={4}
            maxLength={4000}
            placeholder="e.g. Only take SMC continuation after a liquidity sweep. Minimum 1:2 risk-to-reward. Avoid news candles."
            value={forexStrategy}
            onChange={(event) => setForexStrategy(event.target.value)}
          />
          <p className="micro-hint">Your notes are sent to the AI with every forex scan.</p>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void saveTrade()}
          disabled={savingTrade || !tradeDirty}
        >
          {savingTrade ? 'Saving…' : tradeDirty ? 'Save trade settings' : 'Saved'}
        </button>
      </section>

      <section className="card">
        <h2>Voice &amp; app info</h2>
        <div className="setting-row">
          <div>
            <p className="setting-title">Voice alerts</p>
            <p className="micro-hint">Speak every delivered signal with Android text-to-speech.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={voiceAlerts}
            className={`switch${voiceAlerts ? ' on' : ''}`}
            onClick={() => {
              setVoiceAlerts(!voiceAlerts);
              if (isNativeOverlayAvailable()) {
                void TradingOverlay.setVoiceEnabled({ enabled: !voiceAlerts }).catch(() => undefined);
              }
            }}
            aria-label="Toggle voice alerts"
          >
            <span />
          </button>
        </div>

        <button type="button" className="btn btn-block" onClick={() => void testVoice()} disabled={voiceBusy}>
          {voiceBusy ? 'Speaking…' : 'Test Voice'}
        </button>

        <div className="info-links">
          <button type="button" className="link-btn" onClick={() => setLegal('terms')}>
            Terms &amp; Conditions
          </button>
          <button type="button" className="link-btn" onClick={() => setLegal('about')}>
            About Us
          </button>
          <button type="button" className="link-btn" onClick={openSupport}>
            Contact Support
          </button>
        </div>

        <p className="micro-hint">
          {config?.app_name || settings.app_name || 'AI Trading Assistant'} · v{APP_VERSION}
        </p>
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

      <p className="footer-note">
        Signals are technical analysis only and are not financial advice. Trade at your own risk.
      </p>

      <LegalModal
        open={legal !== null}
        title={
          legal === 'terms'
            ? config?.terms_title || 'Terms & Conditions'
            : config?.about_title || 'About Us'
        }
        content={legal === 'terms' ? config?.terms_and_conditions || '' : config?.about_us || ''}
        onClose={() => setLegal(null)}
      />
    </div>
  );
}
