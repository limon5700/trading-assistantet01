import { registerPlugin } from '@capacitor/core';
import type { ChartAnalysis, SignalMode } from './api';

export type { ChartAnalysis, SignalMode };

export interface OverlayPermissionState {
  /** `Settings.canDrawOverlays()` — draw over other apps. */
  overlay: boolean;
  /** Android 13+ runtime notification permission (needed for the foreground service). */
  notifications: boolean;
  /** True while FloatingWidgetService is running. */
  running: boolean;
}

export interface OverlayTradeSettings {
  binaryMinConfidence: number;
  binaryDurationSeconds: number;
  binaryStrategy: string;
  forexMinConfidence: number;
  forexTimeframe: string;
  forexStrategy: string;
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
   * widget foreground service in the requested mode.
   */
  startOverlay(options: {
    serverUrl: string;
    token?: string;
    mode?: SignalMode;
  }): Promise<StartOverlayResult>;
  stopOverlay(): Promise<void>;
  updateServerUrl(options: { serverUrl: string; token?: string }): Promise<void>;
  /** Switches BINARY / FOREX while the widget is running. */
  setMode(options: { mode: SignalMode }): Promise<{ mode: SignalMode }>;
  /** Turns spoken signals on/off without restarting the widget. */
  setVoiceEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  /**
   * Mirrors the saved per-mode trade preferences into the widget so every
   * background scan sends the same min_confidence, duration/timeframe and
   * custom strategy as an in-app scan.
   */
  setTradeSettings(options: OverlayTradeSettings): Promise<OverlayTradeSettings>;
  /** Speaks a short confirmation so the user can verify TTS works. */
  testVoice(options?: { text?: string }): Promise<void>;
  /** Forces an immediate screenshot + analysis cycle. */
  analyzeNow(): Promise<void>;
  addListener(
    eventName: 'analysis',
    listener: (payload: ChartAnalysis) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'overlayState',
    listener: (payload: { running: boolean; mode?: SignalMode }) => void,
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
