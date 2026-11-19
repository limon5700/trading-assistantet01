# AI Trading Assistant — Mobile App

React + Vite + TypeScript UI wrapped by Capacitor, with a native Kotlin bridge
that draws a floating widget over other apps and captures the screen with
`MediaProjection` to analyse candlestick charts.

## Web development preview

```bash
cd mobile-app
npm install
npm run dev        # http://localhost:5174
```

Outside the Android shell the plugin calls are disabled and the screen shows the
UI only. The backend URL defaults to the value in `.env` / `src/lib/settings.ts`
and is editable in the app.

## Android build

```bash
npm install
npm run build
npx cap sync android
npx cap open android      # or: cd android && ./gradlew assembleDebug
```

Requires Android Studio (JDK 17 + Android SDK). The generated project targets
the SDK versions Capacitor 7 defaults to.

Outputs:

- debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- release APK/AAB: `android/app/build/outputs/apk/release/`,
  `android/app/build/outputs/bundle/release/`

GitHub Actions (`.github/workflows/android.yml`) builds both `.apk` and `.aab`
on every push and uploads them as artifacts. Optional signing secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`.

## Native bridge

`android/app/src/main/java/com/aitrading/assistant/`

- `OverlayPlugin.kt` — Capacitor plugin `TradingOverlay`: permission checks,
  the draw-over-apps settings intent, `POST_NOTIFICATIONS`, the MediaProjection
  consent flow, start/stop of the service, `analyzeNow`, and the `analysis`,
  `overlayState` and `overlayError` events.
- `MainActivity.java` — registers the plugin with the bridge.
- `FloatingWidgetService.kt` — foreground service (`mediaProjection` type) that
  inflates the draggable widget, mirrors the screen with `ImageReader`, scales
  the screenshot to ≤1080 px wide, JPEG-compresses it, and posts
  `{ imageBase64, currentTime, timezone }` to `/api/analyze-chart`. The parsed
  signal updates the widget and is forwarded to the app UI.
- `res/layout/overlay_widget.xml` — compact card: status line, colour-coded
  signal badge (BUY green / SELL red / WAIT gray), confidence, target time and
  timeframe.

The widget colour is also applied to the card border so the signal is readable
at a glance. Tapping "Analyze" inside the widget forces an immediate capture;
the handle area at the top is draggable.

## Notes

- `POST_NOTIFICATIONS` is requested on Android 13+; the foreground service runs
  regardless of the answer.
- The MediaProjection token is registered with a `MediaProjection.Callback`
  before `createVirtualDisplay`, as Android 14+ requires.
- Only the backend URL is stored on the device. No API keys are shipped.
