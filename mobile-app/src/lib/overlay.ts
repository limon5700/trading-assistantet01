import { registerPlugin } from '@capacitor/core';

/** Mirrors the response contract of `POST /api/analyze-chart`. */
export interface ChartAnalysis {
  signal: 'BUY' | 'SELL' | 'NO_TRADE';
  confidence: number;
  /** `Next Candle` for an immediate entry, otherwise a local `HH:MM` time. */
  entry_time: string;
  /** Instrument shown on the chart, e.g. `EUR/USD` (`unknown` if unreadable). */
  asset: string;
  /** Chart interval, e.g. `1M`, `5M` (`unknown` if unreadable). */
  timeframe: string;
  reason: string;
  /** Spoken one-sentence summary of the decision. */
  voice_summary: string;
}

export interface OverlayPermissionState {
  /** `Settings.canDrawOverlays()` — draw over other apps. */
  overlay: boolean;
  /** Android 13+ runtime notification permission (needed for the foreground service). */
  notifications: boolean;
  /** True while FloatingWidgetService is running. */
  running: boolean;
}

export interface StartOverlayResult {
  /** Whether the MediaProjection consent dialog returned a usable grant. */
  started: boolean;
}

/**
 * Native Kotlin bridge implemented by
 * `android/app/src/main/java/com/aitrading/assistant/OverlayPlugin.kt`.
 */
export interface TradingOverlayPlugin {
  checkPermissions(): Promise<OverlayPermissionState>;
  /** Opens the system "Display over other apps" screen for this app. */
  requestOverlayPermission(): Promise<{ overlay: boolean }>;
  /** Asks for POST_NOTIFICATIONS on Android 13+ (no-op below that). */
  requestNotificationPermission(): Promise<{ notifications: boolean }>;
  /**
   * Shows the Android screen-capture consent dialog, then starts the floating
   * widget foreground service. Rejects when the draw-over-apps permission is
   * missing or the user declines capture.
   */
  startOverlay(options: { serverUrl: string; token?: string }): Promise<StartOverlayResult>;
  stopOverlay(): Promise<void>;
  updateServerUrl(options: { serverUrl: string; token?: string }): Promise<void>;
  /** Forces an immediate screenshot + analysis cycle. */
  analyzeNow(): Promise<void>;
  addListener(
    eventName: 'analysis',
    listener: (payload: ChartAnalysis) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'overlayState',
    listener: (payload: { running: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'overlayError',
    listener: (payload: { message: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  removeAllListeners(): Promise<void>;
}

export const TradingOverlay = registerPlugin<TradingOverlayPlugin>('TradingOverlay');

/** The native plugin only exists inside the Android shell. */
export function isNativeOverlayAvailable(): boolean {
  return typeof window !== 'undefined' && 'Capacitor' in window;
}
