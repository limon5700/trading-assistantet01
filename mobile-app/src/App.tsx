import { useEffect, useState } from 'react';
import { useSession } from './lib/session';
import { AuthScreen } from './screens/AuthScreen';
import { ActivationGate } from './screens/ActivationGate';
import { ControlHub } from './screens/ControlHub';
import { SettingsScreen } from './screens/SettingsScreen';

type Screen = 'hub' | 'settings';

export default function App() {
  const { booting, user } = useSession();
  const [screen, setScreen] = useState<Screen>('hub');

  useEffect(() => {
    if (!user) setScreen('hub');
  }, [user]);

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
