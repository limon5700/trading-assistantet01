import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useSession } from '../lib/session';
import {
  TradingOverlay,
  isNativeOverlayAvailable,
  type ChartAnalysis,
  type OverlayPermissionState,
} from '../lib/overlay';
import { API_BASE_URL, isConfiguredServerUrl } from '../lib/settings';

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

function signalLabel(signal: ChartAnalysis['signal']): string {
  return signal === 'NO_TRADE' ? 'WAIT / NO TRADE' : signal;
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
  const { user, token, settings } = useSession();
  const native = isNativeOverlayAvailable();
  const [permissions, setPermissions] = useState<OverlayPermissionState>(EMPTY_PERMISSIONS);
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

  const flashTimer = useRef<number | null>(null);

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
          setLastUpdated(new Date().toLocaleTimeString());
          setError(null);
        });
        const stateListener = await TradingOverlay.addListener('overlayState', (payload) => {
          if (cancelled) return;
          setPermissions((current) => ({ ...current, running: payload.running }));
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

  async function handleToggle() {
    if (busy) return;
    setError(null);
    setBusy(true);

    if (!native) {
      setNotice('Start the widget from the installed Android app — the browser preview cannot draw over other apps.');
      setBusy(false);
      return;
    }

    try {
      if (permissions.running) {
        await TradingOverlay.stopOverlay();
        setPermissions((current) => ({ ...current, running: false }));
        setNotice(null);
        return;
      }

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
        setNotice('Allow “Display over other apps”, then tap start again.');
        await refreshPermissions();
        return;
      }

      setNotice('Approve screen capture in the Android dialog to start analysing charts.');
      const result = await TradingOverlay.startOverlay({ serverUrl: API_BASE_URL, token });
      if (result.started) {
        setPermissions((current) => ({ ...current, running: true }));
        setNotice(null);
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

  const orbitStyle = (angle: number): CSSProperties =>
    ({ '--angle': `${angle}deg` }) as CSSProperties;

  return (
    <div className="app">
      <header className="app-header">
        <div className="avatar">{initials(displayName)}</div>
        <div className="header-text">
          <h1>{displayName}</h1>
          <p className="plan-line">
            <span className="pill pill-ok">{planName}</span>
            <span className={`pill ${permissions.running ? 'pill-live' : ''}`}>
              {permissions.running ? 'Running' : 'Idle'}
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
          className="hub-orbit"
          style={orbitStyle(-90)}
          onClick={() => void handleAnalyzeNow()}
          disabled={!permissions.running}
        >
          <span aria-hidden="true">⚡</span>
          <small>Analyze</small>
        </button>

        <button
          type="button"
          className="hub-orbit"
          style={orbitStyle(0)}
          onClick={() => setShowPermissions((open) => !open)}
          aria-expanded={showPermissions}
        >
          <span aria-hidden="true">🛡</span>
          <small>Access</small>
        </button>

        <button type="button" className="hub-orbit" style={orbitStyle(90)} onClick={openSupport}>
          <span aria-hidden="true">💬</span>
          <small>Support</small>
        </button>

        <button type="button" className="hub-orbit" style={orbitStyle(180)} onClick={onOpenSettings}>
          <span aria-hidden="true">⚙</span>
          <small>Settings</small>
        </button>
      </section>

      <p className="hub-caption">
        {permissions.running
          ? 'Drag the floating widget anywhere over your chart.'
          : 'Start the widget, then approve screen capture to receive signals.'}
      </p>

      <section className="card signal-card">
        <div className="card-head">
          <h2>Latest signal</h2>
          {lastUpdated ? <span className="muted-small">Updated {lastUpdated}</span> : null}
        </div>
        {analysis ? (
          <>
            <div className="signal-top">
              <span className={signalClass(analysis.signal)}>{signalLabel(analysis.signal)}</span>
              <span className="confidence">
                <strong>{analysis.confidence}%</strong>
                confidence
              </span>
            </div>
            <div className="signal-grid">
              <div className="signal-cell wide">
                <span>Asset</span>
                <strong>{analysis.asset}</strong>
              </div>
              <div className="signal-cell">
                <span>Entry time</span>
                <strong>{analysis.entry_time}</strong>
              </div>
              <div className="signal-cell">
                <span>Timeframe</span>
                <strong>{analysis.timeframe}</strong>
              </div>
            </div>
            <p className="signal-reason">{analysis.reason}</p>
            <p className="signal-voice">
              <span>Voice</span>
              {analysis.voice_summary}
            </p>
          </>
        ) : (
          <p className="placeholder">
            No analysis yet. Once the widget is running it screenshots the chart every few seconds.
          </p>
        )}
        {permissions.running ? (
          <button type="button" className="btn btn-block" onClick={() => void handleAnalyzeNow()}>
            Analyze chart now
          </button>
        ) : null}
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

      <p className="footer-note">
        Signals are technical analysis only and are not financial advice. Trade at your own risk.
      </p>
    </div>
  );
}
