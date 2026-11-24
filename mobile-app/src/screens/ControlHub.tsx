import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSession } from '../lib/session';
import {
  TradingOverlay,
  isNativeOverlayAvailable,
  type ChartAnalysis,
  type OverlayPermissionState,
  type SignalMode,
} from '../lib/overlay';
import { API_BASE_URL, isConfiguredServerUrl, mediaUrl } from '../lib/settings';
import { LegalModal } from '../components/LegalModal';

const EMPTY_PERMISSIONS: OverlayPermissionState = {
  overlay: false,
  notifications: false,
  running: false,
};

function signalClass(signal: ChartAnalysis['signal']): string {
  if (signal === 'BUY') return 'signal-badge buy';
  if (signal === 'SELL') return 'signal-badge sell';
  return 'signal-badge no-trade';
}

function candleLabel(entry: ChartAnalysis['candle_entry']): string {
  return entry === 'RUNNING_CANDLE' ? 'Running Candle' : 'Next Candle';
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'AI'
  );
}

interface ControlHubProps {
  onOpenSettings: () => void;
}

export function ControlHub({ onOpenSettings }: ControlHubProps) {
  const { user, token, settings, config, voiceAlerts, setVoiceAlerts, tradeSettings } = useSession();
  const native = isNativeOverlayAvailable();
  const [permissions, setPermissions] = useState<OverlayPermissionState>(EMPTY_PERMISSIONS);
  const [mode, setMode] = useState<SignalMode>('BINARY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    native
      ? null
      : 'The floating widget and screen capture run inside the Android app. This preview shows the app UI only.',
  );
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [legal, setLegal] = useState<'terms' | 'about' | null>(null);

  const flashTimer = useRef<number | null>(null);
  const appName = config?.app_name || settings.app_name || 'AI Trading Assistant';
  const appIcon = mediaUrl(config?.app_icon_url || settings.app_icon_url);

  const refreshPermissions = useCallback(async () => {
    if (!native) return;
    try {
      setPermissions(await TradingOverlay.checkPermissions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read Android permissions.');
    }
  }, [native]);

  useEffect(() => {
    void refreshPermissions();
    if (!native) return undefined;

    const listeners: Array<{ remove: () => Promise<void> }> = [];
    let cancelled = false;

    void (async () => {
      try {
        const analysisListener = await TradingOverlay.addListener('analysis', (payload) => {
          if (cancelled) return;
          setAnalysis(payload);
          setMode(payload.mode);
          setLastUpdated(new Date().toLocaleTimeString());
          setError(null);
        });
        const stateListener = await TradingOverlay.addListener('overlayState', (payload) => {
          if (cancelled) return;
          setPermissions((current) => ({ ...current, running: payload.running }));
          if (payload.mode) setMode(payload.mode);
        });
        const errorListener = await TradingOverlay.addListener('overlayError', (payload) => {
          if (cancelled) setError(payload.message);
        });
        if (cancelled) {
          void analysisListener.remove();
          void stateListener.remove();
          void errorListener.remove();
          return;
        }
        listeners.push(analysisListener, stateListener, errorListener);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not attach overlay listeners.');
        }
      }
    })();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshPermissions();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      listeners.forEach((listener) => void listener.remove());
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, [native, refreshPermissions]);

  // Keep a running overlay pointed at the configured backend and current token.
  useEffect(() => {
    if (!native || !permissions.running || !token) return;
    TradingOverlay.updateServerUrl({ serverUrl: API_BASE_URL, token }).catch(() => undefined);
  }, [native, permissions.running, token]);

  // Mirror the trader's saved preferences into native storage so background
  // scans use the same threshold, duration/timeframe and custom strategy.
  useEffect(() => {
    if (!native) return;
    TradingOverlay.setTradeSettings({
      binaryMinConfidence: tradeSettings.binary_min_confidence,
      binaryDurationSeconds: tradeSettings.binary_duration_seconds,
      binaryStrategy: tradeSettings.binary_strategy,
      forexMinConfidence: tradeSettings.forex_min_confidence,
      forexTimeframe: tradeSettings.forex_timeframe,
      forexStrategy: tradeSettings.forex_strategy,
    }).catch(() => undefined);
  }, [native, tradeSettings]);

  async function stopWidget() {
    await TradingOverlay.stopOverlay();
    setPermissions((current) => ({ ...current, running: false }));
    setNotice(null);
  }

  /** Starts the widget in the requested mode (or switches mode if running). */
  async function handleMode(nextMode: SignalMode) {
    if (busy) return;
    setError(null);
    setMode(nextMode);

    if (!native) {
      setNotice('Start the widget from the installed Android app — the browser preview cannot draw over other apps.');
      return;
    }

    if (permissions.running) {
      try {
        await TradingOverlay.setMode({ mode: nextMode });
        setNotice(`${nextMode === 'BINARY' ? 'Binary' : 'Forex'} mode — background analysis is running. Tap the bubble to hear the signal.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not switch mode.');
      }
      return;
    }

    await startWidget(nextMode);
  }

  async function startWidget(nextMode: SignalMode) {
    setBusy(true);
    try {
      if (!token) {
        setError('Sign in again before starting the widget.');
        return;
      }
      if (!isConfiguredServerUrl()) {
        setError('This build is missing its backend URL. Reinstall the official app.');
        return;
      }

      if (!permissions.notifications) {
        try {
          await TradingOverlay.requestNotificationPermission();
        } catch {
          // Below Android 13 there is no notification permission.
        }
      }

      if (!permissions.overlay) {
        await TradingOverlay.requestOverlayPermission();
        setNotice('Allow “Display over other apps”, then tap the mode button again.');
        await refreshPermissions();
        return;
      }

      setNotice('Approve screen capture in the Android dialog to start the background analysis.');
      const result = await TradingOverlay.startOverlay({
        serverUrl: API_BASE_URL,
        token,
        mode: nextMode,
      });
      if (result.started) {
        setPermissions((current) => ({ ...current, running: true }));
        setNotice(null);
        await TradingOverlay.setVoiceEnabled({ enabled: voiceAlerts }).catch(() => undefined);
      } else {
        setNotice(null);
        setError('Screen capture was not approved, so the widget did not start.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the widget.');
      await refreshPermissions();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    if (busy) return;
    setError(null);
    if (!native) {
      setNotice('Start the widget from the installed Android app — the browser preview cannot draw over other apps.');
      return;
    }
    if (permissions.running) {
      setBusy(true);
      try {
        await stopWidget();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not stop the widget.');
      } finally {
        setBusy(false);
      }
      return;
    }
    await startWidget(mode);
  }

  async function toggleVoice() {
    const next = !voiceAlerts;
    setVoiceAlerts(next);
    if (native && permissions.running) {
      try {
        await TradingOverlay.setVoiceEnabled({ enabled: next });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not change voice alerts.');
      }
    }
  }

  async function handleAnalyzeNow() {
    if (!native || !permissions.running) return;
    setError(null);
    try {
      await TradingOverlay.analyzeNow();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis request failed.');
    }
  }

  const displayName = user?.full_name || user?.username || 'Trader';
  const planName = user?.active_plan_name || 'Active plan';

  function openSupport() {
    if (!settings.support_contact_link) {
      setError('Support contact is not published yet.');
      return;
    }
    window.open(settings.support_contact_link, '_blank', 'noopener,noreferrer');
  }

  const orbitStyle = (angle: number): CSSProperties => ({ '--angle': `${angle}deg` }) as CSSProperties;

  return (
    <div className="app">
      <header className="app-header">
        {appIcon ? (
          <img className="avatar avatar-image" src={appIcon} alt={`${appName} icon`} />
        ) : (
          <div className="avatar">{initials(appName)}</div>
        )}
        <div className="header-text">
          <h1>{appName}</h1>
          <p className="plan-line">
            <span className="pill pill-ok">{planName}</span>
            <span className={`pill ${permissions.running ? 'pill-live' : ''}`}>
              {permissions.running ? `${mode === 'BINARY' ? 'BIN' : 'FX'} live` : 'Idle'}
            </span>
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.11a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1Z" />
          </svg>
        </button>
      </header>

      <p className="hub-user">
        Signed in as <strong>{displayName}</strong>
      </p>
      <nav className="legal-links" aria-label="Legal pages">
        <button type="button" className="link-btn" onClick={() => setLegal('terms')}>
          Terms &amp; Conditions
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link-btn" onClick={() => setLegal('about')}>
          About Us
        </button>
      </nav>

      {notice ? <div className="alert info">{notice}</div> : null}
      {error ? (
        <div className="alert error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="hub" aria-label="Control hub">
        <div className={`hub-ring${permissions.running ? ' live' : ''}`} aria-hidden="true" />

        <button
          type="button"
          className={`hub-center${permissions.running ? ' on' : ''}`}
          onClick={() => void handleToggle()}
          disabled={busy}
          aria-pressed={permissions.running}
          aria-label={permissions.running ? 'Stop the trading widget' : 'Start the trading widget'}
        >
          <span className="hub-center-icon" aria-hidden="true">
            {permissions.running ? (
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
              </svg>
            )}
          </span>
          <strong>{busy ? 'Please wait…' : permissions.running ? 'Stop' : 'Start'}</strong>
          <small>{permissions.running ? 'Widget is live' : 'Trading widget'}</small>
        </button>

        <button
          type="button"
          className={`hub-orbit${mode === 'BINARY' ? ' active' : ''}`}
          style={orbitStyle(-90)}
          onClick={() => void handleMode('BINARY')}
          aria-label="Binary signal mode"
        >
          <span aria-hidden="true">BIN</span>
          <small>Binary Signal</small>
        </button>

        <button
          type="button"
          className={`hub-orbit${mode === 'FOREX' ? ' active' : ''}`}
          style={orbitStyle(0)}
          onClick={() => void handleMode('FOREX')}
          aria-label="Forex signal mode"
        >
          <span aria-hidden="true">FX</span>
          <small>Forex Signal</small>
        </button>

        <button
          type="button"
          className="hub-orbit"
          style={orbitStyle(90)}
          onClick={onOpenSettings}
        >
          <span aria-hidden="true">⚙</span>
          <small>Settings</small>
        </button>

        <button
          type="button"
          className={`hub-orbit${voiceAlerts ? ' active' : ''}`}
          style={orbitStyle(180)}
          onClick={() => void toggleVoice()}
          aria-pressed={voiceAlerts}
        >
          <span aria-hidden="true">{voiceAlerts ? '🔊' : '🔇'}</span>
          <small>Audio {voiceAlerts ? 'ON' : 'OFF'}</small>
        </button>
      </section>

      <p className="hub-caption">
        {permissions.running
          ? 'Tap the compact bubble over your chart to hear the latest signal. Show more reveals the full card and JSON.'
          : 'Choose Binary or Forex, approve screen capture, then tap the bubble for a signal.'}
      </p>

      <section className="card signal-card">
        <div className="card-head">
          <h2>Latest signal</h2>
          <div className="signal-card-actions">
            {analysis ? (
              <button type="button" className="link-btn" onClick={() => setShowJson((value) => !value)}>
                {showJson ? 'Hide JSON' : 'JSON view'}
              </button>
            ) : null}
            {lastUpdated ? <span className="muted-small">{lastUpdated}</span> : null}
          </div>
        </div>

        {analysis ? (
          <>
            <div className="signal-top">
              <span className={signalClass(analysis.signal)}>{analysis.signal}</span>
              <span className="confidence">
                <strong>{analysis.confidence}%</strong>
                confidence
              </span>
            </div>
            <div className="signal-grid">
              <div className="signal-cell wide">
                <span>Mode / Asset</span>
                <strong>
                  {analysis.mode === 'BINARY' ? 'Binary' : 'Forex'} · {analysis.asset}
                </strong>
              </div>
              <div className="signal-cell">
                <span>Candle target</span>
                <strong>{candleLabel(analysis.candle_entry)}</strong>
              </div>
              {analysis.mode === 'BINARY' ? (
                <div className="signal-cell">
                  <span>Duration</span>
                  <strong>{analysis.expiry_label || `${analysis.duration_seconds}s`}</strong>
                </div>
              ) : (
                <div className="signal-cell">
                  <span>Timeframe</span>
                  <strong>{analysis.timeframe}</strong>
                </div>
              )}
              {analysis.mode === 'BINARY' ? (
                <div className="signal-cell wide">
                  <span>Entry</span>
                  <strong>{analysis.entry_time}</strong>
                </div>
              ) : (
                <>
                  <div className="signal-cell">
                    <span>Entry</span>
                    <strong>{analysis.entry_price}</strong>
                  </div>
                  <div className="signal-cell">
                    <span>Stop loss</span>
                    <strong>{analysis.stop_loss}</strong>
                  </div>
                  <div className="signal-cell">
                    <span>Take profit</span>
                    <strong>{analysis.take_profit}</strong>
                  </div>
                  <div className="signal-cell wide">
                    <span>Entry timing</span>
                    <strong>{candleLabel(analysis.candle_entry)}</strong>
                  </div>
                </>
              )}
            </div>
            <p className="signal-reason">{analysis.reason}</p>
            <p className="signal-voice">
              <span>Voice</span>
              {analysis.voice_summary}
            </p>
            {showJson ? <pre className="json-view">{JSON.stringify(analysis, null, 2)}</pre> : null}
          </>
        ) : (
          <p className="placeholder">
            No analysis yet. Once the widget is running it captures the chart every few seconds in the
            background — tap the bubble for an instant signal.
          </p>
        )}

        {permissions.running ? (
          <div className="signal-footer">
            <button type="button" className="btn btn-block" onClick={() => void handleAnalyzeNow()}>
              Analyze chart now
            </button>
            <button type="button" className="btn btn-block" onClick={() => void handleMode(mode)}>
              Rescan in {mode === 'BINARY' ? 'Binary' : 'Forex'} mode
            </button>
            <button type="button" className="btn btn-block" onClick={openSupport}>
              Contact support
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-block" onClick={openSupport}>
            Contact support
          </button>
        )}
      </section>

      {showPermissions ? (
        <section className="card">
          <h2>Permissions</h2>
          <p className="hint">Android needs both grants before the widget can appear and read the chart.</p>
          <div className="permissions">
            <div className="permission">
              <span className={`dot${permissions.overlay ? ' ok' : ''}`} />
              <span>Display over other apps</span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() =>
                  void TradingOverlay.requestOverlayPermission()
                    .catch(() =>
                      setError('Open Settings → Apps → AI Trading Assistant → Display over other apps.'),
                    )
                    .finally(() => void refreshPermissions())
                }
                disabled={!native}
              >
                {permissions.overlay ? 'Granted' : 'Open'}
              </button>
            </div>
            <div className="permission">
              <span className={`dot${permissions.notifications ? ' ok' : ''}`} />
              <span>Notifications</span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() =>
                  void TradingOverlay.requestNotificationPermission()
                    .catch(() => undefined)
                    .finally(() => void refreshPermissions())
                }
                disabled={!native}
              >
                {permissions.notifications ? 'Granted' : 'Allow'}
              </button>
            </div>
            <div className="permission">
              <span className={`dot${permissions.running ? ' ok' : ''}`} />
              <span>Screen capture</span>
              <span className="permission-state">
                {permissions.running ? 'Active' : 'Asked on start'}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="link-btn center-hint"
        onClick={() => setShowPermissions((open) => !open)}
        aria-expanded={showPermissions}
      >
        {showPermissions ? 'Hide permissions' : 'Manage permissions'}
      </button>

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
