import { useEffect, useState } from 'react';
import { useSession } from './lib/session';
import { isNativeOverlayAvailable, TradingOverlay } from './lib/overlay';
import { API_BASE_URL } from './lib/settings';
import { AuthScreen } from './screens/AuthScreen';
import { ActivationGate } from './screens/ActivationGate';
import { ControlHub } from './screens/ControlHub';
import { SettingsScreen } from './screens/SettingsScreen';

type Screen = 'hub' | 'settings';

export default function App() {
  const { booting, user, token } = useSession();
  const [screen, setScreen] = useState<Screen>('hub');

  useEffect(() => {
    if (!user) setScreen('hub');
  }, [user]);

  // Push the build-time backend URL and the fresh token into the native overlay
  // as soon as a session exists, so the user never configures a server.
  useEffect(() => {
    if (!token || !API_BASE_URL || !isNativeOverlayAvailable()) return;
    TradingOverlay.updateServerUrl({ serverUrl: API_BASE_URL, token }).catch(() => undefined);
  }, [token, user?.account_status]);

  if (booting) {
    return (
      <div className="splash">
        <span className="auth-logo">AI</span>
        <p>Restoring your session…</p>
        <span className="spinner spinner-dark" aria-hidden="true" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;
  if (user.account_status !== 'ACTIVE') return <ActivationGate />;

  return screen === 'settings' ? (
    <SettingsScreen onBack={() => setScreen('hub')} />
  ) : (
    <ControlHub onOpenSettings={() => setScreen('settings')} />
  );
}
