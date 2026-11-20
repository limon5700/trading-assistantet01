/**
 * The backend base URL is baked into the build from `VITE_API_BASE_URL`
 * (see `.env` / `.env.example`). It is intentionally not editable in the app,
 * so users can never point the widget at another server.
 *
 * An empty value means "same origin", which is useful for web previews that
 * proxy `/api` to the backend. The Android overlay requires an absolute URL.
 */
export const API_BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
)
  .trim()
  .replace(/\/+$/, '');

export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.0.1';

export function isConfiguredServerUrl(): boolean {
  if (!API_BASE_URL) return false;
  try {
    const url = new URL(API_BASE_URL);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
