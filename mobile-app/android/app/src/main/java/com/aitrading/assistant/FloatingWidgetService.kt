package com.aitrading.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Foreground service that shows the draggable trading widget.
 *
 * While the widget is open a silent loop keeps reading the chart every few
 * seconds and stores the newest answer, so a tap can deliver a signal at once.
 * The loop alone never shows anything: only a tap on Get signal (or the bubble)
 * renders that one answer and speaks it. Until then the card stays empty, so a
 * placeholder can never be mistaken for a BUY, SELL or WAIT decision.
 */
class FloatingWidgetService : Service() {

    companion object {
        private const val TAG = "FloatingWidget"

        const val ACTION_START = "com.aitrading.assistant.action.START"
        const val ACTION_STOP = "com.aitrading.assistant.action.STOP"
        const val ACTION_ANALYZE = "com.aitrading.assistant.action.ANALYZE"
        const val ACTION_DELIVER = "com.aitrading.assistant.action.DELIVER"
        const val ACTION_SET_MODE = "com.aitrading.assistant.action.SET_MODE"
        const val ACTION_SET_VOICE = "com.aitrading.assistant.action.SET_VOICE"
        const val ACTION_SET_TRADE_SETTINGS = "com.aitrading.assistant.action.SET_TRADE_SETTINGS"
        const val ACTION_UPDATE_SERVER = "com.aitrading.assistant.action.UPDATE_SERVER"

        const val ACTION_ANALYSIS = "com.aitrading.assistant.event.ANALYSIS"
        const val ACTION_STATE = "com.aitrading.assistant.event.STATE"
        const val ACTION_ERROR = "com.aitrading.assistant.event.ERROR"

        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_USER_TOKEN = "user_token"
        const val EXTRA_MODE = "signal_mode"
        const val EXTRA_VOICE_ENABLED = "voice_enabled"
        const val EXTRA_ANALYSIS = "analysis"
        const val EXTRA_RUNNING = "running"
        const val EXTRA_MESSAGE = "message"

        const val PREFS_NAME = "trading_overlay"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_USER_TOKEN = "user_token"
        const val KEY_MODE = "signal_mode"
        const val KEY_VOICE = "voice_enabled"

        // The trader's saved per-mode preferences. They are mirrored into the
        // analysis request so a background scan applies the same threshold,
        // duration/timeframe and custom strategy as the React UI.
        const val KEY_BINARY_MIN_CONFIDENCE = "binary_min_confidence"
        const val KEY_BINARY_DURATION = "binary_duration_seconds"
        const val KEY_BINARY_STRATEGY = "binary_strategy"
        const val KEY_FOREX_MIN_CONFIDENCE = "forex_min_confidence"
        const val KEY_FOREX_TIMEFRAME = "forex_timeframe"
        const val KEY_FOREX_STRATEGY = "forex_strategy"

        const val MODE_BINARY = "BINARY"
        const val MODE_FOREX = "FOREX"

        const val UTTERANCE_ID = "SIGNAL_UTTERANCE"

        /** Real model decisions. Anything else means no decision was received. */
        private val DECISIONS = setOf("BUY", "SELL", "WAIT")
        // Colour.rgb keeps these inside the Int range; a plain 0xFF... literal
        // above Int.MAX does not compile.
        private val BUBBLE_ACCENT = Color.rgb(0x25, 0x63, 0xEB)
        private val BUBBLE_MUTED = Color.rgb(0x64, 0x74, 0x8B)
        private const val SCAN_SWEEP_MS = 1100L
        private const val SCAN_STATE_BUSY = "SCANNING"
        private const val SCAN_STATE_FAILED = "ERROR"

        private const val CHANNEL_ID = "trading_overlay_channel"
        private const val NOTIFICATION_ID = 4310

        /**
         * The chart is read in the background so a tap can answer instantly, but
         * only a tap ever shows a signal; background results just fill the cache.
         */
        private const val ANALYSIS_INTERVAL_MS = 5_000L
        /** An answer this fresh is delivered on tap without another scan. */
        private const val CACHE_FRESH_MS = 20_000L
        /**
         * A directional call lives until its entry window closes, not until the
         * cache looks old: a next-candle signal made 40 s before the open is
         * still the call for that open, and rescanning it would only add latency.
         */
        private const val CACHED_SIGNAL_MAX_AGE_MS = 45_000L

        /**
         * One signal per trade, not one per tap. After a BUY or SELL is delivered
         * the widget refuses the next trade until that expiry (plus a small
         * buffer) has finished, because a tap 20 s later only re-enters the same
         * setup that is already running.
         */
        private const val SIGNAL_COOLDOWN_BUFFER_MS = 15_000L
        private const val SIGNAL_COOLDOWN_MIN_MS = 75_000L
        private const val CAPTURE_DELAY_MS = 200L
        // A live clip, not a still: the model has to see the candle move. Three
        // frames already show momentum and cut the upload that used to push the
        // signal past the candle open.
        private const val LIVE_FRAME_COUNT = 3
        private const val LIVE_FRAME_GAP_MS = 300L
        private const val LIVE_ROUNDS = 3
        private const val LIVE_ROUND_GAP_MS = 450L
        private const val MAX_CAPTURE_WIDTH = 800
        private const val JPEG_QUALITY = 72
        private const val MAX_FRAME_ATTEMPTS = 8
        private const val FRAME_RETRY_MS = 150L
        // A frame this dark is the mirror surface, never the chart.
        private const val MIN_FRAME_MEAN_LUMA = 10.0
        private const val MIN_FRAME_BRIGHT_RATIO = 0.05

        @Volatile
        var isRunning: Boolean = false
            private set

        fun normalizeMode(value: String?): String =
            if (value?.trim()?.uppercase(Locale.US) == MODE_FOREX) MODE_FOREX else MODE_BINARY
    }

    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private var bubbleView: View? = null
    private var expandedView: View? = null
    private var dragHandle: View? = null
    private var bubbleMode: TextView? = null
    private var bubbleSignal: TextView? = null
    private var bubbleHint: TextView? = null
    private var signalBadge: TextView? = null
    private var modeBadge: TextView? = null
    private var confidenceText: TextView? = null
    private var assetText: TextView? = null
    private var candleText: TextView? = null
    private var timingText: TextView? = null
    private var levelsText: TextView? = null
    private var reasonText: TextView? = null
    private var voiceText: TextView? = null
    private var statusText: TextView? = null
    private var jsonText: TextView? = null
    private var deliverButton: TextView? = null
    private var analyzeButton: TextView? = null
    private var expandButton: TextView? = null
    private var showLessButton: TextView? = null
    private var scanLine: View? = null
    private var hideOverlayForCapture = false
    private var scanAnimator: ValueAnimator? = null
    private var expanded = false

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val liveFrames = mutableListOf<String>()
    private var liveMisses = 0
    private var liveRound = 0
    private var projectionCallback: MediaProjection.Callback? = null

    private val handler = Handler(Looper.getMainLooper())
    private val networkExecutor = Executors.newSingleThreadExecutor()
    private var analyzing = false
    /** A tap asked for this scan: render it and speak when it lands. */
    @Volatile
    private var deliverWhenReady = false
    /** A manual Rescan/analyze asked for this scan: render it, quietly. */
    @Volatile
    private var showWhenReady = false
    private var serverUrl: String = ""
    private var userToken: String = ""

    private var mode: String = MODE_BINARY
    private var voiceEnabled = true
    /** Latest background answer, shown only when the trader taps for it. */
    private var cachedAnalysis: JSONObject? = null
    private var cachedAt = 0L
    /** A delivered BUY/SELL keeps the widget in cooldown until this moment. */
    private var signalCooldownUntil = 0L
    private var lastDeliveredSignal = ""
    /** Ticks the entry countdown over the card until the candle open. */
    private var entryCountdown: Runnable? = null

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null

    /** Silent background analysis loop that keeps the cache warm. */
    private val analysisLoop = object : Runnable {
        override fun run() {
            if (!isRunning) return
            captureAndAnalyze()
            handler.postDelayed(this, ANALYSIS_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        serverUrl = loadServerUrl()
        userToken = loadUserToken()
        mode = normalizeMode(
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_MODE, MODE_BINARY),
        )
        voiceEnabled = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_VOICE, true)
        createNotificationChannel()
        initTts()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart(intent)

            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }

            ACTION_ANALYZE -> {
                // A manual scan from the app: one chart read, one result.
                if (isRunning) {
                    showWhenReady = true
                    clearSignalCard()
                    if (!analyzing) captureAndAnalyze()
                }
            }

            ACTION_DELIVER -> if (isRunning) deliverSignal()

            ACTION_SET_MODE -> {
                val next = normalizeMode(intent.getStringExtra(EXTRA_MODE))
                if (next != mode) {
                    mode = next
                    forgetCachedSignal()
                    persistMode(mode)
                    applyModeBadge()
                    clearSignalCard()
                    updateStatus("${modeLabel()} mode · tap Get signal for one live signal")
                    broadcastState(isRunning)
                    startBackgroundAnalysis(0L)
                }
            }

            ACTION_SET_VOICE -> {
                voiceEnabled = intent.getBooleanExtra(EXTRA_VOICE_ENABLED, voiceEnabled)
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_VOICE, voiceEnabled)
                    .apply()
                updateStatus(if (voiceEnabled) "Voice alerts on" else "Voice alerts off")
            }

            ACTION_SET_TRADE_SETTINGS -> {
                // Settings are mirrored on every app open: never wipe a signal
                // the trader is still reading, but re-read the chart with them.
                forgetCachedSignal()
                updateStatus("${modeLabel()} mode · trade settings updated")
                startBackgroundAnalysis(0L)
            }

            ACTION_UPDATE_SERVER -> {
                intent.getStringExtra(EXTRA_SERVER_URL)?.let {
                    serverUrl = it
                    updateStatus("Server updated")
                }
                intent.getStringExtra(EXTRA_USER_TOKEN)?.let { userToken = it }
            }

            else -> {
                if (!isRunning) stopSelf()
            }
        }
        return START_STICKY
    }

    private fun handleStart(intent: Intent) {
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        intent.getStringExtra(EXTRA_SERVER_URL)?.takeIf { it.isNotBlank() }?.let { serverUrl = it }
        intent.getStringExtra(EXTRA_USER_TOKEN)?.takeIf { it.isNotBlank() }?.let { userToken = it }
        intent.getStringExtra(EXTRA_MODE)?.let {
            mode = normalizeMode(it)
            persistMode(mode)
        }
        if (intent.hasExtra(EXTRA_VOICE_ENABLED)) {
            voiceEnabled = intent.getBooleanExtra(EXTRA_VOICE_ENABLED, voiceEnabled)
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_VOICE, voiceEnabled)
                .apply()
        }

        if (resultData == null || resultCode == 0) {
            broadcastError("Screen capture permission was not granted")
            stopSelf()
            return
        }

        if (isRunning) {
            // Already showing the widget: just refresh the capture session.
            return
        }

        startForegroundNotification()

        try {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val projection = manager.getMediaProjection(resultCode, resultData)
            if (projection == null) {
                broadcastError("Android refused the screen capture session")
                stopEverything()
                return
            }
            mediaProjection = projection
            registerProjectionCallback(projection)
            createVirtualDisplay(projection)
            showOverlay()
            isRunning = true
            broadcastState(true)
            applyModeBadge()
            updateStatus("${modeLabel()} mode · tap the bubble for one live signal")
            // Warm the cache immediately so the first tap is already instant.
            startBackgroundAnalysis(900L)
        } catch (error: Exception) {
            Log.e(TAG, "Could not start screen capture", error)
            broadcastError("Could not start screen capture: ${error.message}")
            stopEverything()
        }
    }

    private fun registerProjectionCallback(projection: MediaProjection) {
        val callback = object : MediaProjection.Callback() {
            override fun onStop() {
                handler.post {
                    if (isRunning) broadcastError("Screen capture stopped")
                    stopEverything()
                }
            }
        }
        projectionCallback = callback
        projection.registerCallback(callback, handler)
    }

    private fun createVirtualDisplay(projection: MediaProjection) {
        val metrics = resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        virtualDisplay = projection.createVirtualDisplay(
            "ai-trading-capture",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler,
        )
    }

    // ---------------------------------------------------------------- overlay

    private fun showOverlay() {
        if (overlayView != null) return

        val view = LayoutInflater.from(this).inflate(R.layout.overlay_widget, null)
        overlayView = view
        bubbleView = view.findViewById(R.id.bubble_view)
        expandedView = view.findViewById(R.id.expanded_view)
        dragHandle = view.findViewById(R.id.drag_handle)
        bubbleMode = view.findViewById(R.id.bubble_mode)
        bubbleSignal = view.findViewById(R.id.bubble_signal)
        bubbleHint = view.findViewById(R.id.bubble_hint)
        signalBadge = view.findViewById(R.id.signal_badge)
        modeBadge = view.findViewById(R.id.mode_badge)
        confidenceText = view.findViewById(R.id.confidence_text)
        assetText = view.findViewById(R.id.asset_text)
        candleText = view.findViewById(R.id.candle_text)
        timingText = view.findViewById(R.id.timing_text)
        levelsText = view.findViewById(R.id.levels_text)
        reasonText = view.findViewById(R.id.reason_text)
        voiceText = view.findViewById(R.id.voice_text)
        statusText = view.findViewById(R.id.status_text)
        jsonText = view.findViewById(R.id.json_text)
        deliverButton = view.findViewById(R.id.deliver_button)
        analyzeButton = view.findViewById(R.id.analyze_button)
        expandButton = view.findViewById(R.id.expand_button)
        showLessButton = view.findViewById(R.id.show_less_button)
        scanLine = view.findViewById(R.id.scan_line)
        expanded = false

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 24
            y = 220
        }

        attachDragHandler(dragHandle, params, null)
        attachDragHandler(bubbleView, params) { deliverSignal() }
        attachActions(view)
        applyModeBadge()
        clearSignalCard()
        updateStatus("Tap Get signal for one live signal.")

        try {
            windowManager.addView(view, params)
        } catch (error: Exception) {
            Log.e(TAG, "Could not add the overlay view", error)
            broadcastError("Could not draw the overlay. Check the draw-over-apps permission.")
            stopEverything()
        }
    }

    /**
     * Drags a view, and optionally reports a tap (press + release without real
     * movement) so the compact bubble can deliver a signal on a single tap.
     */
    private fun attachDragHandler(
        target: View?,
        params: WindowManager.LayoutParams,
        onTap: (() -> Unit)?,
    ) {
        val handle = target ?: return
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false

        handle.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x
                    startY = params.y
                    touchX = event.rawX
                    touchY = event.rawY
                    moved = false
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - touchX
                    val dy = event.rawY - touchY
                    if (abs(dx) > 8f || abs(dy) > 8f) moved = true
                    if (moved) {
                        params.x = startX + dx.roundToInt()
                        params.y = startY + dy.roundToInt()
                        overlayView?.let { view ->
                            try {
                                windowManager.updateViewLayout(view, params)
                            } catch (ignored: IllegalArgumentException) {
                                // View was removed while dragging.
                            }
                        }
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!moved) onTap?.invoke()
                    true
                }

                else -> false
            }
        }
    }

    private fun attachActions(view: View) {
        deliverButton?.setOnClickListener { deliverSignal() }
        analyzeButton?.setOnClickListener {
            // Rescan is manual too: one chart read, one result. It still cannot
            // hand out a second trade while the last one is open.
            if (showCooldownIfActive()) return@setOnClickListener
            showWhenReady = true
            clearSignalCard()
            if (!analyzing) captureAndAnalyze()
        }
        expandButton?.setOnClickListener { setExpanded(true) }
        showLessButton?.setOnClickListener { setExpanded(false) }
        view.findViewById<TextView>(R.id.stop_button)?.setOnClickListener { stopEverything() }
    }

    /** Switches between the compact circle and the full signal card. */
    private fun setExpanded(expand: Boolean) {
        if (expanded == expand) return
        expanded = expand

        val show = if (expand) expandedView else bubbleView
        val hide = if (expand) bubbleView else expandedView
        if (show == null || hide == null) return

        show.visibility = View.VISIBLE
        show.alpha = 0f
        show.scaleX = 0.94f
        show.scaleY = 0.94f
        show.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(160).start()

        hide.animate().alpha(0f).scaleX(0.94f).scaleY(0.94f).setDuration(110).withEndAction {
            hide.visibility = View.GONE
            hide.alpha = 1f
            hide.scaleX = 1f
            hide.scaleY = 1f
        }.start()
    }

    private fun setActionsEnabled(enabled: Boolean) {
        handler.post {
            deliverButton?.isEnabled = enabled
            analyzeButton?.isEnabled = enabled
        }
    }

    private fun applySignalBadge(badge: TextView?, signal: String) {
        if (badge == null) return
        when (signal) {
            "BUY" -> {
                badge.text = "BUY"
                badge.setBackgroundResource(R.drawable.signal_buy)
            }

            "SELL" -> {
                badge.text = "SELL"
                badge.setBackgroundResource(R.drawable.signal_sell)
            }

            "WAIT" -> {
                badge.text = "WAIT"
                badge.setBackgroundResource(R.drawable.signal_wait)
            }

            SCAN_STATE_BUSY -> {
                badge.text = "…"
                badge.setBackgroundResource(R.drawable.signal_scan)
            }

            SCAN_STATE_FAILED -> {
                badge.text = "!"
                badge.setBackgroundResource(R.drawable.signal_scan)
            }

            else -> {
                // No decision has been received yet: show nothing at all.
                badge.text = ""
                badge.setBackgroundResource(R.drawable.signal_scan)
            }
        }
    }

    /**
     * Clears every value so the card shows no BUY, SELL or WAIT until a real
     * answer has arrived from the server.
     */
    private fun clearSignalCard() {
        handler.post {
            applySignalBadge(bubbleSignal, "")
            applySignalBadge(signalBadge, "")
            confidenceText?.text = ""
            assetText?.text = ""
            candleText?.text = ""
            timingText?.text = ""
            levelsText?.text = ""
            reasonText?.text = ""
            voiceText?.text = ""
            jsonText?.text = ""
            bubbleHint?.text = "TAP\nFOR SIGNAL"
            applySignalTheme("")
        }
    }

    /**
     * Tints the floating widget by the decision: green for BUY, red for SELL,
     * neutral white otherwise, so the state is readable without opening the card.
     */
    private fun applySignalTheme(signal: String) {
        handler.post {
            when (signal) {
                "BUY" -> {
                    bubbleView?.setBackgroundResource(R.drawable.overlay_bubble_buy)
                    expandedView?.setBackgroundResource(R.drawable.overlay_card_buy)
                    toneBubbleText(Color.WHITE)
                }

                "SELL" -> {
                    bubbleView?.setBackgroundResource(R.drawable.overlay_bubble_sell)
                    expandedView?.setBackgroundResource(R.drawable.overlay_card_sell)
                    toneBubbleText(Color.WHITE)
                }

                else -> {
                    bubbleView?.setBackgroundResource(R.drawable.overlay_bubble)
                    expandedView?.setBackgroundResource(R.drawable.overlay_card)
                    toneBubbleText(BUBBLE_ACCENT)
                }
            }
        }
    }

    private fun toneBubbleText(accent: Int) {
        val muted = if (accent == Color.WHITE) Color.WHITE else BUBBLE_MUTED
        bubbleMode?.setTextColor(accent)
        bubbleHint?.setTextColor(accent)
        expandButton?.setTextColor(muted)
    }

    /** Cyber-style sweep: a neon line runs down the widget while one scan runs. */
    private fun startScanEffect() {
        handler.post {
            val line = scanLine ?: return@post
            val root = overlayView ?: return@post
            line.visibility = View.VISIBLE
            line.alpha = 1f
            line.translationY = 0f
            root.post {
                val travel = (root.height - line.height).coerceAtLeast(1).toFloat()
                scanAnimator?.cancel()
                scanAnimator = ValueAnimator.ofFloat(0f, travel).apply {
                    duration = SCAN_SWEEP_MS
                    repeatCount = ValueAnimator.INFINITE
                    repeatMode = ValueAnimator.RESTART
                    interpolator = LinearInterpolator()
                    addUpdateListener { line.translationY = it.animatedValue as Float }
                    start()
                }
            }
        }
    }

    private fun stopScanEffect() {
        handler.post {
            scanAnimator?.cancel()
            scanAnimator = null
            scanLine?.let { line ->
                line.visibility = View.GONE
                line.translationY = 0f
            }
        }
    }

    /** Marks that one scan is in flight, without inventing any signal value. */
    private fun showScanningState() {
        handler.post {
            applySignalBadge(bubbleSignal, SCAN_STATE_BUSY)
            applySignalBadge(signalBadge, SCAN_STATE_BUSY)
            confidenceText?.text = ""
            reasonText?.text = ""
            voiceText?.text = ""
            statusText?.text = "Scanning…"
            applySignalTheme(SCAN_STATE_BUSY)
            startScanEffect()
        }
    }

    /**
     * A scan that could not be completed must not look like the model's WAIT
     * decision, so it replaces the badge and states the reason on the card.
     */
    private fun showScanFailure(message: String) {
        handler.post {
            stopScanEffect()
            applySignalTheme("")
            applySignalBadge(bubbleSignal, SCAN_STATE_FAILED)
            applySignalBadge(signalBadge, SCAN_STATE_FAILED)
            confidenceText?.text = ""
            reasonText?.text = message
            voiceText?.text = ""
            statusText?.text = message
            bubbleHint?.text = "TAP\nTO RETRY"
        }
    }

    private fun applyModeBadge() {
        handler.post {
            val label = modeLabel()
            modeBadge?.text = label
            bubbleMode?.text = label
        }
    }

    private fun modeLabel(): String = if (mode == MODE_FOREX) "FX" else "BIN"

    private fun updateStatus(message: String) {
        handler.post { statusText?.text = message }
    }

    /** Renders the full structured card. Speaks only when `speak` is true. */
    private fun renderAnalysis(analysis: JSONObject, speak: Boolean) {
        handler.post {
            val signal = analysis.optString("signal").uppercase(Locale.US)
            val hasDecision = signal in DECISIONS
            val resolvedMode = if (analysis.optString("mode", mode).uppercase(Locale.US) == MODE_FOREX) {
                MODE_FOREX
            } else {
                MODE_BINARY
            }

            stopScanEffect()
            stopEntryCountdown()
            applySignalTheme(signal)
            applySignalBadge(bubbleSignal, signal)
            applySignalBadge(signalBadge, signal)
            bubbleHint?.text = "TAP\nFOR SIGNAL"

            confidenceText?.text = if (hasDecision) "${analysis.optInt("confidence", 0)}%" else ""
            assetText?.text = "${if (resolvedMode == MODE_FOREX) "Forex" else "Binary"} · ${analysis.optString("asset", "—")}"
            candleText?.text = "Candle: " + when (analysis.optString("candle_entry")) {
                "RUNNING_CANDLE" -> "Running Candle"
                "NEXT_CANDLE" -> "Next Candle"
                else -> "—"
            }

            if (resolvedMode == MODE_FOREX) {
                val grade = analysis.optString("setup_grade", "—").ifBlank { "—" }
                val market = analysis.optString("market_type", "—").ifBlank { "—" }
                timingText?.text =
                    "Timeframe: ${analysis.optString("timeframe", "—")} · Grade $grade · $market"
                levelsText?.text = buildString {
                    append("Entry ").append(analysis.optString("entry_price", "—"))
                    append("  ·  SL ").append(analysis.optString("stop_loss", "—"))
                    append("  ·  TP ").append(analysis.optString("take_profit", "—"))
                }
            } else {
                val seconds = analysis.optInt("duration_seconds", 60)
                val expiry = analysis.optString("expiry_label").ifBlank { "${seconds}s" }
                val grade = analysis.optString("setup_grade", "—").ifBlank { "—" }
                val trend = analysis.optString("trend_bias", "—").ifBlank { "—" }
                val market = analysis.optString("market_type", "—").ifBlank { "—" }
                timingText?.text = "Duration: $expiry  ·  ${analysis.optString("entry_time", "—")}"
                levelsText?.text = "Expiry ${seconds}s · Grade $grade · Trend $trend · $market"
            }

            startEntryCountdown(analysis)

            reasonText?.text = analysis.optString("reason", "")
            voiceText?.text = analysis.optString("voice_summary", "")
            jsonText?.text = analysis.toString(2)
            updateStatus(
                "Delivered ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())} · ${analysis.optString("mode", mode)}",
            )

            if (speak) {
                speak(analysis.optString("voice_summary", ""))
            }
        }
    }

    /** Keeps the newest answer for the next tap; the card stays untouched. */
    private fun rememberAnalysis(analysis: JSONObject) {
        cachedAnalysis = analysis
        cachedAt = System.currentTimeMillis()
    }

    private fun forgetCachedSignal() {
        cachedAnalysis = null
        cachedAt = 0L
    }

    /** Starts (or restarts) the silent loop that keeps the cache warm. */
    private fun startBackgroundAnalysis(delayMs: Long = ANALYSIS_INTERVAL_MS) {
        handler.removeCallbacks(analysisLoop)
        if (!isRunning) return
        handler.postDelayed(analysisLoop, delayMs)
    }

    /**
     * A failed background read stays silent; a failure of the tap the trader
     * made is reported on the card so it can never pass for a WAIT decision.
     */
    private fun reportFailure(message: String) {
        if (deliverWhenReady || showWhenReady) {
            broadcastError(message)
            showScanFailure(message)
        } else {
            Log.w(TAG, "Background scan skipped: $message")
        }
    }

    // ----------------------------------------------------------------- voice

    /**
     * Initializes Android text-to-speech on the main thread with an explicit
     * US-English locale, falling back to the device locale. Audio attributes use
     * the accessibility usage so the utterance plays even while the overlay is
     * on top of a trading app.
     */
    private fun initTts() {
        if (tts != null) return
        tts = TextToSpeech(applicationContext) { status ->
            handler.post {
                if (status != TextToSpeech.SUCCESS) {
                    ttsReady = false
                    Log.w(TAG, "TextToSpeech init failed with status $status")
                    return@post
                }
                val engine = tts ?: return@post
                val language = try {
                    engine.setLanguage(Locale.US)
                } catch (error: Exception) {
                    TextToSpeech.LANG_NOT_SUPPORTED
                }
                if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                    engine.setLanguage(Locale.getDefault())
                }
                engine.setSpeechRate(1.0f)
                engine.setPitch(1.0f)
                try {
                    engine.setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                } catch (ignored: Exception) {
                    // Older engines may not expose audio attributes.
                }
                ttsReady = true
                pendingSpeech?.let { text ->
                    pendingSpeech = null
                    speak(text)
                }
            }
        }
    }

    private fun speak(text: String) {
        if (!voiceEnabled) return
        val message = text.trim()
        if (message.isEmpty()) return
        if (tts == null) initTts()

        val engine = tts
        if (engine == null || !ttsReady) {
            pendingSpeech = message
            return
        }
        try {
            engine.speak(message, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
        } catch (error: Exception) {
            Log.w(TAG, "TextToSpeech speak failed", error)
            ttsReady = false
            pendingSpeech = message
        }
    }

    // ------------------------------------------------------------- analysis

    /**
     * One tap, one signal. The background loop has already read the chart, so
     * the tap normally delivers that answer at once; only a stale cache makes it
     * capture a fresh screenshot first. Nothing shows a signal on its own.
     */
    private fun deliverSignal() {
        if (!isRunning) return

        if (showCooldownIfActive()) return

        val cached = cachedAnalysis
        val cachedAge = System.currentTimeMillis() - cachedAt
        val cachedSignal = cached?.optString("signal")?.uppercase(Locale.US)
        val cachedDirectional = cachedSignal == "BUY" || cachedSignal == "SELL"
        val cachedFresh = cached != null &&
            (cachedAge < CACHE_FRESH_MS || (cachedDirectional && cachedAge < CACHED_SIGNAL_MAX_AGE_MS))
        if (cached != null && cachedFresh && !entryIsLate(cached)) {
            renderAnalysis(cached, speak = true)
            broadcastAnalysis(cached)
            noteDeliveredSignal(cached)
            updateStatus("Signal delivered · ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())}")
            return
        }
        // A cached call whose own entry window has closed is no longer a signal:
        // showing it now is exactly the late entry that loses the expiry.
        if (cached != null && cachedFresh) forgetCachedSignal()

        deliverWhenReady = true
        clearSignalCard()
        updateStatus("Scanning…")
        // A background scan may be in flight: its answer is this tap's signal.
        if (!analyzing) captureAndAnalyze()
    }

    /**
     * A new trade may not start while the previous one is still running. Tapping
     * Get signal inside that window shows the cooldown card instead of entering
     * the same setup again, which is what turned one bad read into eleven trades.
     */
    private fun showCooldownIfActive(): Boolean {
        val remaining = signalCooldownUntil - System.currentTimeMillis()
        if (remaining <= 0L) return false

        val secondsLeft = ((remaining + 999) / 1000).toInt()
        val signal = lastDeliveredSignal.ifBlank { "last" }
        val analysis = JSONObject()
            .put("mode", mode)
            .put("signal", "WAIT")
            .put("confidence", 0)
            .put("asset", "Cooldown")
            .put("candle_entry", "NEXT_CANDLE")
            .put("setup_grade", "—")
            .put("trend_bias", "—")
            .put("market_type", "—")
            .put(
                "reason",
                "Cooldown: the last $signal trade is still open for ${secondsLeft}s. " +
                    "No new trade until it expires — wait for the candle to close.",
            )
            .put(
                "voice_summary",
                "Cooldown. Wait ${secondsLeft} seconds for the last trade to close before the next one.",
            )

        if (mode == MODE_FOREX) {
            analysis
                .put("timeframe", "—")
                .put("entry_price", "—")
                .put("stop_loss", "—")
                .put("take_profit", "—")
        } else {
            analysis
                .put("duration_seconds", 0)
                .put("expiry_label", "Cooldown")
                .put("entry_time", "After the trade closes")
        }

        renderAnalysis(analysis, speak = true)
        broadcastAnalysis(analysis)
        return true
    }

    /** Starts the no-new-trade window once a directional signal is delivered. */
    private fun noteDeliveredSignal(analysis: JSONObject) {
        val signal = analysis.optString("signal").uppercase(Locale.US)
        if (signal != "BUY" && signal != "SELL") return

        val seconds = analysis.optInt("duration_seconds", 60).coerceIn(15, 300)
        val now = System.currentTimeMillis()
        // The trade runs from its entry, not from the tap: a next-candle call
        // delivered a minute early still owns the minute after that open.
        val entryAt = analysis.optLong("_entry_at", 0L).coerceAtLeast(now)
        signalCooldownUntil = maxOf(
            now + SIGNAL_COOLDOWN_MIN_MS,
            entryAt + seconds * 1000L + SIGNAL_COOLDOWN_BUFFER_MS,
        )
        lastDeliveredSignal = signal
        // The cached answer was just traded: a new tap must read the chart again.
        forgetCachedSignal()
    }

    /**
     * The model reports the candle clock with the signal. Stamping absolute entry
     * times here means a countdown still works after the answer was cached, and
     * a call whose open already passed can be told apart from a live one.
     */
    private fun stampEntryWindow(analysis: JSONObject) {
        val signal = analysis.optString("signal").uppercase(Locale.US)
        if (signal != "BUY" && signal != "SELL") return

        val nextCandle = analysis.optInt("next_candle_seconds", 0).coerceIn(0, 900)
        val window = analysis.optInt("entry_window_seconds", 5).coerceIn(1, 120)
        val entryAt = System.currentTimeMillis() + nextCandle * 1000L
        analysis.put("_entry_at", entryAt)
        analysis.put("_entry_until", entryAt + window * 1000L)
    }

    /** True when this signal's entry window is already over. */
    private fun entryIsLate(analysis: JSONObject): Boolean {
        val until = analysis.optLong("_entry_until", 0L)
        return until > 0L && System.currentTimeMillis() > until
    }

    /** A BUY/SELL that missed its candle open is reported as a WAIT, never shown live. */
    private fun markLateEntry(analysis: JSONObject): JSONObject {
        val late = JSONObject(analysis.toString())
        val signal = analysis.optString("signal").uppercase(Locale.US)
        late.put("signal", "WAIT")
        late.put("confidence", 0)
        late.put("setup_grade", "—")
        late.put(
            "reason",
            "Late entry: the $signal signal missed its candle open and its entry window has closed. " +
                "No trade — tap Get signal for the fresh candle.",
        )
        late.put(
            "voice_summary",
            "That signal arrived too late for its candle. No trade. Scan again for the fresh candle.",
        )
        late.put("_entry_at", 0L)
        late.put("_entry_until", 0L)
        return late
    }

    /**
     * Counts down to the candle open the model reported, so the trader sees
     * "Entry in 7s" instead of a BUY that is already a few seconds old.
     */
    private fun startEntryCountdown(analysis: JSONObject) {
        stopEntryCountdown()
        if (mode == MODE_FOREX) return
        val signal = analysis.optString("signal").uppercase(Locale.US)
        if (signal != "BUY" && signal != "SELL") return
        val entryAt = analysis.optLong("_entry_at", 0L)
        if (entryAt <= 0L) return

        val seconds = analysis.optInt("duration_seconds", 60)
        val expiry = analysis.optString("expiry_label").ifBlank { "${seconds}s" }
        val runnable = object : Runnable {
            override fun run() {
                val left = entryAt - System.currentTimeMillis()
                when {
                    left > 1_500L -> {
                        timingText?.text = "Entry in ${((left + 999) / 1000).toInt()}s · $expiry"
                        handler.postDelayed(this, 500L)
                    }

                    left > -1_500L -> {
                        timingText?.text = "ENTRY NOW · $expiry"
                        speak("Enter now.")
                    }

                    else -> timingText?.text = "Entry window passed · $expiry"
                }
            }
        }
        entryCountdown = runnable
        handler.post(runnable)
    }

    private fun stopEntryCountdown() {
        entryCountdown?.let { handler.removeCallbacks(it) }
        entryCountdown = null
    }

    private fun captureAndAnalyze() {
        if (analyzing || !isRunning) return
        analyzing = true
        setActionsEnabled(false)
        // Only a tap puts the card into a scanning state; the background loop
        // must never wipe the signal the trader is reading.
        if (deliverWhenReady || showWhenReady) showScanningState()

        if (imageReader == null) {
            reportFailure("Screen capture is not ready. Stop and start the widget again.")
            finishAnalysis()
            return
        }

        // The widget itself is part of the screen, and an expanded card covers most
        // of the candles, so a tapped scan hides it for the frame; otherwise the
        // model reads a white panel instead of the chart and answers WAIT. A
        // background scan keeps the collapsed bubble visible so nothing blinks.
        val hideForFrame = deliverWhenReady || showWhenReady
        handler.post {
            hideOverlayForCapture = hideForFrame
            if (hideForFrame) overlayView?.visibility = View.INVISIBLE
            handler.postDelayed({ beginLiveCapture() }, CAPTURE_DELAY_MS)
        }
    }

    /**
     * Starts one live capture: a short burst of consecutive frames instead of a
     * single still, so the model can see the newest candle actually moving.
     */
    private fun beginLiveCapture() {
        liveFrames.clear()
        liveMisses = 0
        liveRound = 0
        handler.postDelayed({ captureLiveFrame() }, CAPTURE_DELAY_MS)
    }

    /**
     * Grabs one live frame from MediaProjection. A frame that comes back black or
     * empty is thrown away and asked for again: sending it used to make the model
     * answer "the screenshot is completely black" and post a fake WAIT. When a
     * whole round of frames is black the mirror surface itself is stale, so the
     * virtual display is rebuilt before the next round.
     */
    private fun captureLiveFrame() {
        if (!isRunning) {
            liveCaptureFailed("Screen capture stopped. Start the widget again.")
            return
        }

        val reader = imageReader
        if (reader == null) {
            liveCaptureFailed("Screen capture is not ready. Stop and start the widget again.")
            return
        }

        var image: android.media.Image? = null
        var bitmap: Bitmap? = null
        try {
            image = reader.acquireLatestImage()
            if (image != null && image.width > 0 && image.height > 0) {
                bitmap = imageToBitmap(image)
            }
        } catch (error: Exception) {
            Log.w(TAG, "Screen capture failed", error)
        } finally {
            image?.close()
        }

        // A sized frame can still be an all-black mirror surface.
        if (bitmap != null && !isFrameReadable(bitmap)) {
            bitmap.recycle()
            bitmap = null
        }

        if (bitmap == null) {
            liveMisses += 1
            if (liveMisses < MAX_FRAME_ATTEMPTS) {
                handler.postDelayed({ captureLiveFrame() }, FRAME_RETRY_MS)
                return
            }

            liveMisses = 0
            liveRound += 1
            if (liveRound >= LIVE_ROUNDS) {
                liveCaptureFailed(
                    "The chart came back black. Keep the chart on screen, turn off any " +
                        "'block screenshots' setting in the broker app, then tap again.",
                )
                return
            }
            rebuildCaptureSurface()
            handler.postDelayed({ captureLiveFrame() }, LIVE_ROUND_GAP_MS)
            return
        }

        liveMisses = 0
        liveFrames.add(bitmapToBase64(bitmap))
        bitmap.recycle()

        if (liveFrames.size >= LIVE_FRAME_COUNT) {
            val clip = liveFrames.toList()
            liveFrames.clear()
            // The clip is captured, so the widget can come back while the model runs.
            showOverlayAfterCapture()
            sendForAnalysis(clip)
            return
        }

        handler.postDelayed({ captureLiveFrame() }, LIVE_FRAME_GAP_MS)
    }

    private fun liveCaptureFailed(message: String) {
        liveFrames.clear()
        showOverlayAfterCapture()
        reportFailure(message)
        finishAnalysis(delivered = false)
    }

    /** A 32x32 luminance sample: the chart is bright, a dead mirror frame is black. */
    private fun isFrameReadable(bitmap: Bitmap): Boolean {
        if (bitmap.width <= 0 || bitmap.height <= 0) return false

        var sample: Bitmap? = null
        return try {
            sample = Bitmap.createScaledBitmap(bitmap, 32, 32, false)
            val pixels = IntArray(32 * 32)
            sample.getPixels(pixels, 0, 32, 0, 0, 32, 32)

            var lumaSum = 0.0
            var bright = 0
            for (pixel in pixels) {
                val red = (pixel shr 16) and 0xFF
                val green = (pixel shr 8) and 0xFF
                val blue = pixel and 0xFF
                val luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                lumaSum += luma
                if (luma > 24.0) bright += 1
            }

            val mean = lumaSum / pixels.size
            val brightRatio = bright.toDouble() / pixels.size
            val readable = mean >= MIN_FRAME_MEAN_LUMA && brightRatio >= MIN_FRAME_BRIGHT_RATIO
            if (!readable) {
                Log.w(
                    TAG,
                    "Dropped a black frame (mean luma " +
                        String.format(Locale.US, "%.1f", mean) +
                        ")",
                )
            }
            readable
        } catch (error: Exception) {
            Log.w(TAG, "Could not inspect the captured frame", error)
            // Unreadable inspection must not block a real capture.
            true
        } finally {
            sample?.recycle()
        }
    }

    /** Recreates the mirror display so the next frames are freshly composited. */
    private fun rebuildCaptureSurface() {
        val projection = mediaProjection ?: return
        try {
            virtualDisplay?.release()
        } catch (error: Exception) {
            Log.w(TAG, "Could not release the capture display", error)
        }
        virtualDisplay = null
        try {
            imageReader?.close()
        } catch (error: Exception) {
            Log.w(TAG, "Could not close the capture reader", error)
        }
        imageReader = null
        try {
            createVirtualDisplay(projection)
        } catch (error: Exception) {
            Log.w(TAG, "Could not rebuild the capture display", error)
        }
    }

    private fun showOverlayAfterCapture() {
        handler.post {
            if (hideOverlayForCapture) {
                hideOverlayForCapture = false
                overlayView?.visibility = View.VISIBLE
            }
        }
    }

    private fun imageToBitmap(image: android.media.Image): Bitmap? {
        val plane = image.planes.firstOrNull() ?: return null
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val paddedWidth = image.width + rowPadding / pixelStride

        // copyPixelsFromBuffer copies from the buffer's current position, and a
        // frame that was already touched sits at its end. Without the rewind the
        // copy throws on those frames, the capture never yields a bitmap and the
        // widget keeps the placeholder card instead of a signal.
        buffer.rewind()

        val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(buffer)

        val cropped = if (paddedWidth != image.width) {
            Bitmap.createBitmap(padded, 0, 0, image.width, image.height).also { padded.recycle() }
        } else {
            padded
        }

        if (cropped.width <= MAX_CAPTURE_WIDTH) return cropped

        val ratio = MAX_CAPTURE_WIDTH.toFloat() / cropped.width
        val scaled = Bitmap.createScaledBitmap(
            cropped,
            MAX_CAPTURE_WIDTH,
            (cropped.height * ratio).roundToInt().coerceAtLeast(1),
            true,
        )
        if (scaled != cropped) cropped.recycle()
        return scaled
    }

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    private fun sendForAnalysis(frames: List<String>) {
        val imageBase64 = frames.firstOrNull().orEmpty()
        if (serverUrl.isBlank()) {
            reportFailure("This build has no backend URL. Reinstall the official app.")
            finishAnalysis()
            return
        }
        if (userToken.isBlank()) {
            reportFailure("Your session expired. Open the app and sign in again.")
            finishAnalysis()
            return
        }

        val endpoint = "${serverUrl.trimEnd('/')}/api/analyze-chart"
        val requestMode = mode
        val now = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val timezone = TimeZone.getDefault().id

        networkExecutor.execute {
            var connection: HttpURLConnection? = null
            try {
                // Send the mode plus the trader's saved preferences so the
                // background scan uses exactly the same threshold, expiry /
                // timeframe and custom strategy as the in-app scan.
                val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val body = JSONObject()
                    .put("imageBase64", imageBase64)
                    .put("currentTime", now)
                    .put("timezone", timezone)
                    .put("mode", requestMode)

                // The whole live clip travels with the scan: the first frame stays
                // in imageBase64 so nothing older breaks, the rest let the model
                // read movement between frames.
                if (frames.size > 1) {
                    val clip = org.json.JSONArray()
                    frames.forEach { clip.put(it) }
                    body.put("frames", clip)
                    body.put("frameIntervalMs", LIVE_FRAME_GAP_MS)
                }

                if (requestMode == MODE_FOREX) {
                    body.put(
                        "min_confidence",
                        prefs.getInt(KEY_FOREX_MIN_CONFIDENCE, 60),
                    )
                    body.put("preferred_timeframe", prefs.getString(KEY_FOREX_TIMEFRAME, "15M"))
                    body.put("user_custom_strategy", prefs.getString(KEY_FOREX_STRATEGY, ""))
                } else {
                    body.put(
                        "min_confidence",
                        prefs.getInt(KEY_BINARY_MIN_CONFIDENCE, 60),
                    )
                    body.put(
                        "preferred_duration_seconds",
                        prefs.getInt(KEY_BINARY_DURATION, 60),
                    )
                    body.put("user_custom_strategy", prefs.getString(KEY_BINARY_STRATEGY, ""))
                }

                val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 20_000
                    // The backend budget is 70 s (GEMINI_TIMEOUT_MS). A client
                    // timeout of 75 s fired in the same instant as the answer and
                    // showed "timeout" on correct scans, so leave real headroom.
                    readTimeout = 110_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $userToken")
                }
                connection = conn

                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(body.toString())
                    writer.flush()
                }

                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val responseText = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()

                if (status !in 200..299) {
                    val message = runCatching {
                        JSONObject(responseText).optString("error")
                    }.getOrNull().takeUnless { it.isNullOrBlank() }
                        ?: "Server returned HTTP $status"
                    reportFailure(message)
                    finishAnalysis(delivered = false)
                    return@execute
                }

                val analysis = JSONObject(responseText)
                val decision = analysis.optString("signal").uppercase(Locale.US)
                if (decision !in DECISIONS) {
                    // A 200 without a decision is a failed scan, not a WAIT.
                    reportFailure("The server returned no signal. Tap to retry.")
                    finishAnalysis(delivered = false)
                    return@execute
                }

                // The model reports the candle clock with the signal, so the
                // entry becomes an absolute time before the answer is cached.
                stampEntryWindow(analysis)

                // Every answer warms the cache, but only the scan the trader
                // asked for reaches the card and the voice. A call that already
                // missed its open is a WAIT, not a late BUY.
                val speakNow = deliverWhenReady
                val showNow = speakNow || showWhenReady
                val late = showNow && entryIsLate(analysis)
                if (late) {
                    forgetCachedSignal()
                } else {
                    rememberAnalysis(analysis)
                }
                val display = if (late) markLateEntry(analysis) else analysis
                if (showNow) {
                    renderAnalysis(display, speak = speakNow)
                    broadcastAnalysis(display)
                    if (!late) noteDeliveredSignal(display)
                }
                finishAnalysis(delivered = showNow)
            } catch (error: Exception) {
                Log.e(TAG, "Analysis request failed", error)
                reportFailure("Network error: ${error.message ?: "request failed"}")
                finishAnalysis(delivered = false)
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun finishAnalysis(delivered: Boolean = false) {
        analyzing = false
        deliverWhenReady = false
        showWhenReady = false
        stopScanEffect()
        setActionsEnabled(true)
        if (!delivered) handler.post { bubbleHint?.text = "TAP\nFOR SIGNAL" }
    }

    // ---------------------------------------------------------- notification

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Trading overlay",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps the floating trading widget running; tap Signal for one live signal"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, FloatingWidgetService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val deliverIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, FloatingWidgetService::class.java).apply { action = ACTION_DELIVER },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AI Trading Assistant")
            .setContentText("Auto analysis on · tap Signal for one live signal")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp)
            .addAction(0, "Signal", deliverIntent)
            .addAction(0, "Stop", stopIntent)
            .build()
    }

    private fun startForegroundNotification() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun refreshNotification() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    // ------------------------------------------------------------- lifecycle

    private fun stopEverything() {
        handler.removeCallbacksAndMessages(null)
        isRunning = false
        broadcastState(false)
        hideOverlay()

        virtualDisplay?.release()
        virtualDisplay = null

        imageReader?.close()
        imageReader = null

        projectionCallback?.let { callback ->
            mediaProjection?.unregisterCallback(callback)
        }
        projectionCallback = null
        mediaProjection?.stop()
        mediaProjection = null

        tts?.stop()
        stopForeground(true)
        stopSelf()
    }

    private fun hideOverlay() {
        overlayView?.let { view ->
            try {
                windowManager.removeView(view)
            } catch (ignored: IllegalArgumentException) {
                // Not attached.
            }
        }
        overlayView = null
        bubbleView = null
        expandedView = null
        dragHandle = null
        bubbleMode = null
        bubbleSignal = null
        bubbleHint = null
        signalBadge = null
        modeBadge = null
        confidenceText = null
        assetText = null
        candleText = null
        timingText = null
        levelsText = null
        reasonText = null
        voiceText = null
        statusText = null
        jsonText = null
        deliverButton = null
        analyzeButton = null
        expandButton = null
        showLessButton = null
        stopScanEffect()
        scanLine = null
        expanded = false
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        networkExecutor.shutdownNow()
        hideOverlay()
        virtualDisplay?.release()
        imageReader?.close()
        projectionCallback?.let { mediaProjection?.unregisterCallback(it) }
        mediaProjection?.stop()
        tts?.stop()
        tts?.shutdown()
        tts = null
        val wasRunning = isRunning
        isRunning = false
        if (wasRunning) broadcastState(false)
        super.onDestroy()
    }

    // -------------------------------------------------------------- helpers

    private fun loadServerUrl(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_SERVER_URL, "")
            .orEmpty()
    }

    private fun loadUserToken(): String {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_USER_TOKEN, "")
            .orEmpty()
    }

    private fun persistMode(value: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MODE, value)
            .apply()
        if (isRunning) refreshNotification()
    }

    private fun broadcastAnalysis(analysis: JSONObject) {
        sendBroadcast(
            Intent(ACTION_ANALYSIS)
                .setPackage(packageName)
                .putExtra(EXTRA_ANALYSIS, analysis.toString()),
        )
    }

    private fun broadcastState(running: Boolean) {
        sendBroadcast(
            Intent(ACTION_STATE)
                .setPackage(packageName)
                .putExtra(EXTRA_RUNNING, running)
                .putExtra(EXTRA_MODE, mode),
        )
    }

    private fun broadcastError(message: String) {
        Log.w(TAG, message)
        sendBroadcast(
            Intent(ACTION_ERROR).setPackage(packageName).putExtra(EXTRA_MESSAGE, message),
        )
    }
}
