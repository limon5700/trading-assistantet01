import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TradingOverlay,
  isNativeOverlayAvailable,
  type ChartAnalysis,
  type OverlayPermissionState,
} from './lib/overlay';
import {
  DEFAULT_SERVER_URL,
  isValidServerUrl,
  loadServerUrl,
  normalizeServerUrl,
  saveServerUrl,
} from './lib/settings';

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

export default function App() {
  const native = isNativeOverlayAvailable();
  const [serverUrl, setServerUrl] = useState<string>(() => loadServerUrl());
  const [urlDraft, setUrlDraft] = useState<string>(() => loadServerUrl());
  const [savedFlash, setSavedFlash] = useState(false);
  const [permissions, setPermissions] = useState<OverlayPermissionState>(EMPTY_PERMISSIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    native
      ? null
      : 'The floating overlay and screen capture run inside the Android app. This preview shows the app UI only.',
  );
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const refreshPermissions = useCallback(async () => {
    if (!native) return;
    try {
      const state = await TradingOverlay.checkPermissions();
      setPermissions(state);
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
          if (cancelled) return;
          setError(payload.message);
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
    };
  }, [native, refreshPermissions]);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  async function handleSaveUrl() {
    const next = normalizeServerUrl(urlDraft);
    if (!isValidServerUrl(next)) {
      setError('Enter a valid http(s) URL, for example https://your-api.onrender.com');
      return;
    }
    setError(null);
    setServerUrl(next);
    saveServerUrl(next);
    setSavedFlash(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2200);
    if (native && permissions.running) {
      try {
        await TradingOverlay.updateServerUrl({ serverUrl: next });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update the running overlay.');
      }
    }
  }

  async function handleToggle() {
    if (busy) return;
    setError(null);
    setBusy(true);

    if (!native) {
      setNotice('Start the overlay from the installed Android app — the browser preview cannot draw over other apps.');
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

      if (!isValidServerUrl(serverUrl)) {
        setError('Set a valid backend server URL before starting the overlay.');
        return;
      }

      if (!permissions.notifications) {
        try {
          await TradingOverlay.requestNotificationPermission();
        } catch {
          // Below Android 13 the permission does not exist; the service still runs.
        }
      }

      if (!permissions.overlay) {
        await TradingOverlay.requestOverlayPermission();
        setNotice('Allow “Display over other apps”, then tap the toggle again.');
        await refreshPermissions();
        return;
      }

      setNotice('Approve screen capture in the Android dialog to start analysing charts.');
      const result = await TradingOverlay.startOverlay({ serverUrl });
      if (result.started) {
        setPermissions((current) => ({ ...current, running: true }));
        setNotice(null);
      } else {
        setNotice(null);
        setError('Screen capture was not approved, so the overlay did not start.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start the overlay.';
      setError(message);
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

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">AI</div>
        <div>
          <h1>AI Trading Assistant</h1>
          <p>Candlestick analysis over any trading app</p>
        </div>
      </header>

      <button
        type="button"
        className={`hero-toggle${permissions.running ? ' on' : ''}`}
        onClick={() => void handleToggle()}
        disabled={busy}
        aria-pressed={permissions.running}
      >
        <span className="toggle-icon" aria-hidden="true">
          {permissions.running ? (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
            </svg>
          )}
        </span>
        <span>
          <strong>{permissions.running ? 'Stop Trading Overlay Widget' : 'Start Trading Overlay Widget'}</strong>
          <small>
            {busy
              ? 'Waiting for Android…'
              : permissions.running
                ? 'Running — drag the widget anywhere on screen'
                : 'Floats above Quotex, Exness, TradingView, MetaTrader'}
          </small>
        </span>
        <span className={`switch${permissions.running ? ' on' : ''}`} aria-hidden="true" />
      </button>

      {notice ? <div className="alert info">{notice}</div> : null}
      {error ? (
        <div className="alert error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <h2>Backend server</h2>
        <p className="hint">
          The overlay posts each screenshot to <code>/api/analyze-chart</code>. The Gemini API key
          stays on the server and is never shipped in this app.
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
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveUrl()}
            disabled={normalizeServerUrl(urlDraft) === serverUrl}
          >
            Save
          </button>
        </div>
        {savedFlash ? <p className="saved-flash">Saved — the overlay is using this server.</p> : null}
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Active: <code>{serverUrl}</code>
        </p>
      </section>

      <section className="card">
        <h2>Latest signal</h2>
        {analysis ? (
          <>
            <div className="signal-top" style={{ marginTop: 10 }}>
              <span className={signalClass(analysis.signal)}>{signalLabel(analysis.signal)}</span>
              <span className="confidence">
                <strong>{analysis.confidence}%</strong>
                confidence
              </span>
            </div>
            <div className="signal-grid">
              <div className="signal-cell">
                <span>Entry timing</span>
                <strong>{analysis.entry_timing}</strong>
              </div>
              <div className="signal-cell">
                <span>Timeframe</span>
                <strong>{analysis.timeframe_detected}</strong>
              </div>
            </div>
            <p className="signal-reason">{analysis.reason}</p>
            {lastUpdated ? (
              <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                Updated {lastUpdated}
              </p>
            ) : null}
          </>
        ) : (
          <p className="placeholder">
            No analysis yet. Once the overlay is running, the widget checks the chart every few
            seconds and shows the signal above your trading app.
          </p>
        )}
        {permissions.running ? (
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12, width: '100%' }}
            onClick={() => void handleAnalyzeNow()}
          >
            Analyze chart now
          </button>
        ) : null}
      </section>

      <section className="card">
        <h2>Permissions</h2>
        <p className="hint">Android needs both grants before the widget can appear and read the chart.</p>
        <div className="permissions">
          <div className="permission">
            <span className={`dot${permissions.overlay ? ' ok' : ''}`} />
            <span>Display over other apps</span>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void TradingOverlay.requestOverlayPermission()
                  .catch(() =>
                    setError('Open Settings → Apps → AI Trading Assistant → Display over other apps.'),
                  )
                  .finally(() => void refreshPermissions())
              }
              disabled={!native}
            >
              {permissions.overlay ? 'Granted' : 'Open settings'}
            </button>
          </div>
          <div className="permission">
            <span className={`dot${permissions.notifications ? ' ok' : ''}`} />
            <span>Notifications (foreground service)</span>
            <button
              type="button"
              className="btn"
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
            <button type="button" className="btn" disabled>
              {permissions.running ? 'Active' : 'Asked on start'}
            </button>
          </div>
        </div>
      </section>

      <p className="footer-note">
        Signals are technical analysis only and are not financial advice. Trade at your own risk.
      </p>
    </div>
  );
}
