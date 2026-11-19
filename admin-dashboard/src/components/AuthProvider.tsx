import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, authEvents, getToken, setToken } from '../lib/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(getToken() ? 'loading' : 'anonymous');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!getToken()) {
      setStatus('anonymous');
      return () => {
        cancelled = true;
      };
    }

    api
      .me()
      .then((response) => {
        if (cancelled) return;
        setEmail(response.admin.email);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setEmail(null);
      setStatus('anonymous');
    };
    authEvents.addEventListener('unauthorized', onUnauthorized);
    return () => authEvents.removeEventListener('unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (nextEmail: string, password: string) => {
    const response = await api.login(nextEmail.trim(), password);
    setToken(response.token);
    setEmail(response.admin.email);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setEmail(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, email, login, logout }),
    [status, email, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
