const STORAGE_KEY = 'ai_trading_server_url';

/**
 * Cloud backend that ships with the app. Override at build time with
 * `VITE_DEFAULT_SERVER_URL` (see `.env.example`), e.g. when you host the API on
 * your own domain.
 */
export const DEFAULT_SERVER_URL =
  (import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://ai-trading-api.onrender.com';

export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function isValidServerUrl(value: string): boolean {
  try {
    const url = new URL(normalizeServerUrl(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function loadServerUrl(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeServerUrl(stored) : DEFAULT_SERVER_URL;
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

export function saveServerUrl(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, normalizeServerUrl(value));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory value still works.
  }
}
