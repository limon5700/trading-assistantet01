import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  paymentApi,
  publicApi,
  tradeSettingsApi,
  userApi,
  type AppSettings,
  type AuthUser,
  type Plan,
  type PublicConfig,
  type SignupInput,
  type TradeSettings,
} from './api';

const TOKEN_KEY = 'ai_trading_user_token';
const VOICE_KEY = 'ai_trading_voice_enabled';
const TRADE_KEY = 'ai_trading_trade_settings';

export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  binary_min_confidence: 60,
  binary_duration_seconds: 60,
  binary_strategy: '',
  forex_min_confidence: 60,
  forex_timeframe: '15M',
  forex_strategy: '',
};

function readVoicePreference(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Cached so the settings screen opens instantly, even before the server reply. */
function readCachedTradeSettings(): TradeSettings {
  try {
    const raw = window.localStorage.getItem(TRADE_KEY);
    if (raw) return { ...DEFAULT_TRADE_SETTINGS, ...(JSON.parse(raw) as Partial<TradeSettings>) };
  } catch {
    // Corrupt or blocked storage falls back to the defaults.
  }
  return DEFAULT_TRADE_SETTINGS;
}

function storeTradeSettings(value: TradeSettings): void {
  try {
    window.localStorage.setItem(TRADE_KEY, JSON.stringify(value));
  } catch {
    // Private browsing can block storage; the in-memory value still works.
  }
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can block storage; the in-memory session still works.
  }
}

interface SessionValue {
  booting: boolean;
  token: string | null;
  user: AuthUser | null;
  plans: Plan[];
  settings: AppSettings;
  config: PublicConfig | null;
  tradeSettings: TradeSettings;
  voiceAlerts: boolean;
  setVoiceAlerts: (enabled: boolean) => void;
  saveTradeSettings: (patch: Partial<TradeSettings>) => Promise<TradeSettings>;
  login: (identifier: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  activate: (code: string) => Promise<void>;
  verifyPayment: (paymentId: number, txHash: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
}

const EMPTY_SETTINGS: AppSettings = { affiliate_link: '', support_contact_link: '' };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [tradeSettings, setTradeSettings] = useState<TradeSettings>(() => readCachedTradeSettings());
  const [voiceAlerts, setVoiceAlertsState] = useState<boolean>(() => readVoicePreference());

  const applySession = useCallback((payload: { user: AuthUser; plans: Plan[]; settings: AppSettings }) => {
    setUser(payload.user);
    setPlans(payload.plans ?? []);
    setSettings({ ...EMPTY_SETTINGS, ...(payload.settings ?? {}) });
  }, []);

  const clearSession = useCallback(() => {
    storeToken(null);
    setToken(null);
    setUser(null);
    setPlans([]);
    setSettings(EMPTY_SETTINGS);
    setTradeSettings(DEFAULT_TRADE_SETTINGS);
    try {
      window.localStorage.removeItem(TRADE_KEY);
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, []);

  // Public branding, legal pages and plans are available even before sign-in.
  useEffect(() => {
    let cancelled = false;
    publicApi
      .config()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        // Offline launch keeps the built-in name; the next call retries.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Validate the stored token on launch so an expired session lands on login.
  useEffect(() => {
    let cancelled = false;
    const stored = readStoredToken();

    if (!stored) {
      setBooting(false);
      return () => {
        cancelled = true;
      };
    }

    setToken(stored);
    userApi
      .me(stored)
      .then((payload) => {
        if (cancelled) return;
        applySession(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearSession();
        }
        // Network errors keep the session so the user can retry once online.
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  const establish = useCallback(
    (response: { token: string; user: AuthUser; plans: Plan[]; settings: AppSettings }) => {
      storeToken(response.token);
      setToken(response.token);
      applySession(response);
    },
    [applySession],
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      establish(await userApi.login(identifier.trim(), password));
    },
    [establish],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      establish(await userApi.signup(input));
    },
    [establish],
  );

  const activate = useCallback(
    async (code: string) => {
      if (!token) throw new ApiError('Please sign in again', 401);
      applySession(await userApi.activate(token, code.trim().toUpperCase()));
    },
    [applySession, token],
  );

  const verifyPayment = useCallback(
    async (paymentId: number, txHash: string) => {
      if (!token) throw new ApiError('Please sign in again', 401);
      applySession(await paymentApi.verify(token, paymentId, txHash));
    },
    [applySession, token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      applySession(await userApi.me(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearSession();
      else throw error;
    }
  }, [applySession, clearSession, token]);

  // Trade preferences live on the server so the Android widget can read them
  // through /api/analyze-chart defaults even when the web UI is closed.
  useEffect(() => {
    if (!token) {
      setTradeSettings(DEFAULT_TRADE_SETTINGS);
      return undefined;
    }
    let cancelled = false;
    tradeSettingsApi
      .get(token)
      .then((response) => {
        if (cancelled) return;
        const merged = { ...DEFAULT_TRADE_SETTINGS, ...response.settings };
        setTradeSettings(merged);
        storeTradeSettings(merged);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const setVoiceAlerts = useCallback((enabled: boolean) => {
    setVoiceAlertsState(enabled);
    try {
      window.localStorage.setItem(VOICE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, []);

  const saveTradeSettings = useCallback(
    async (patch: Partial<TradeSettings>) => {
      if (!token) throw new ApiError('Please sign in again', 401);
      const response = await tradeSettingsApi.save(token, patch);
      const merged = { ...DEFAULT_TRADE_SETTINGS, ...response.settings };
      setTradeSettings(merged);
      storeTradeSettings(merged);
      return merged;
    },
    [token],
  );

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const value = useMemo<SessionValue>(
    () => ({
      booting,
      token,
      user,
      plans,
      settings,
      config,
      tradeSettings,
      voiceAlerts,
      setVoiceAlerts,
      saveTradeSettings,
      login,
      signup,
      activate,
      verifyPayment,
      refresh,
      logout,
    }),
    [
      booting,
      token,
      user,
      plans,
      settings,
      config,
      tradeSettings,
      voiceAlerts,
      setVoiceAlerts,
      saveTradeSettings,
      login,
      signup,
      activate,
      verifyPayment,
      refresh,
      logout,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
