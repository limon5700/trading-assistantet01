package com.aitrading.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
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
 * While the widget is open it captures the screen every few seconds and quietly
 * caches the latest analysis in either BINARY or FOREX mode. It never pops up or
 * speaks during that loop: the trader taps the compact bubble to receive the
 * signal, which renders the card, speaks it through TextToSpeech and expands to
 * the full structured view with the raw JSON.
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

        private const val CHANNEL_ID = "trading_overlay_channel"
        private const val NOTIFICATION_ID = 4310

        /** Background loop: within the 5-8 second window the brief asks for. */
        private const val ANALYSIS_INTERVAL_MS = 6_000L
        private const val CAPTURE_DELAY_MS = 300L
        private const val MAX_CAPTURE_WIDTH = 1280
        private const val JPEG_QUALITY = 80
        private const val MAX_FRAME_ATTEMPTS = 8
        private const val FRAME_RETRY_MS = 150L

        /** Older than this and a tap triggers a fresh on-demand scan. */
        private const val CACHE_FRESH_MS = 20_000L

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
    private var expanded = false

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var projectionCallback: MediaProjection.Callback? = null

    private val handler = Handler(Looper.getMainLooper())
    private val networkExecutor = Executors.newSingleThreadExecutor()
    private var analyzing = false
    @Volatile
    private var deliverWhenReady = false
    private var serverUrl: String = ""
    private var userToken: String = ""

    private var mode: String = MODE_BINARY
    private var voiceEnabled = true
    private var cachedAnalysis: JSONObject? = null
    private var cachedAt = 0L

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null

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
                if (isRunning) {
                    handler.removeCallbacks(analysisLoop)
                    if (!analyzing) captureAndAnalyze()
                    handler.postDelayed(analysisLoop, ANALYSIS_INTERVAL_MS)
                }
            }

            ACTION_DELIVER -> if (isRunning) deliverSignal()

            ACTION_SET_MODE -> {
                val next = normalizeMode(intent.getStringExtra(EXTRA_MODE))
                if (next != mode) {
                    mode = next
                    cachedAnalysis = null
                    cachedAt = 0L
                    persistMode(mode)
                    applyModeBadge()
                    updateStatus("${modeLabel()} mode · background analysis running")
                    broadcastState(isRunning)
                    if (isRunning) {
                        handler.removeCallbacks(analysisLoop)
                        if (!analyzing) captureAndAnalyze()
                        handler.postDelayed(analysisLoop, ANALYSIS_INTERVAL_MS)
                    }
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
                cachedAnalysis = null
                cachedAt = 0L
                updateStatus("${modeLabel()} mode · trade settings updated")
                if (isRunning) {
                    handler.removeCallbacks(analysisLoop)
                    if (!analyzing) captureAndAnalyze()
                    handler.postDelayed(analysisLoop, ANALYSIS_INTERVAL_MS)
                }
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
            updateStatus("${modeLabel()} mode · watching the chart silently")
            // Start capturing right away so the first tap already has a cached signal.
            handler.postDelayed(analysisLoop, 900L)
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
            handler.removeCallbacks(analysisLoop)
            if (!analyzing) captureAndAnalyze()
            handler.postDelayed(analysisLoop, ANALYSIS_INTERVAL_MS)
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

            else -> {
                badge.text = "WAIT"
                badge.setBackgroundResource(R.drawable.signal_wait)
            }
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
            val signal = analysis.optString("signal", "WAIT").uppercase(Locale.US)
            val resolvedMode = if (analysis.optString("mode", mode).uppercase(Locale.US) == MODE_FOREX) {
                MODE_FOREX
            } else {
                MODE_BINARY
            }

            applySignalBadge(bubbleSignal, signal)
            applySignalBadge(signalBadge, signal)
            bubbleHint?.text = "TAP\nFOR SIGNAL"

            confidenceText?.text = "${analysis.optInt("confidence", 0)}%"
            assetText?.text = "${if (resolvedMode == MODE_FOREX) "Forex" else "Binary"} · ${analysis.optString("asset", "—")}"
            candleText?.text = "Candle: " + when (analysis.optString("candle_entry")) {
                "RUNNING_CANDLE" -> "Running Candle"
                "NEXT_CANDLE" -> "Next Candle"
                else -> "—"
            }

            if (resolvedMode == MODE_FOREX) {
                timingText?.text = "Timeframe: ${analysis.optString("timeframe", "—")}"
                levelsText?.text = buildString {
                    append("Entry ").append(analysis.optString("entry_price", "—"))
                    append("  ·  SL ").append(analysis.optString("stop_loss", "—"))
                    append("  ·  TP ").append(analysis.optString("take_profit", "—"))
                }
            } else {
                val seconds = analysis.optInt("duration_seconds", 60)
                val expiry = analysis.optString("expiry_label").ifBlank { "${seconds}s" }
                timingText?.text = "Duration: $expiry  ·  ${analysis.optString("entry_time", "—")}"
                levelsText?.text = "Expiry ${seconds}s"
            }

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

    /** Quietly caches the result without any popup or speech. */
    private fun cacheAnalysis(analysis: JSONObject) {
        cachedAnalysis = analysis
        cachedAt = System.currentTimeMillis()
        handler.post {
            // The bubble only shows the mode while collapsed; the result appears on tap.
            bubbleHint?.text = "TAP\nFOR SIGNAL"
        }
        broadcastAnalysis(analysis)
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
     * One-tap delivery: speaks and shows the cached analysis when it is fresh,
     * otherwise runs an immediate on-demand scan and delivers that result.
     */
    private fun deliverSignal() {
        val cached = cachedAnalysis
        if (cached != null && System.currentTimeMillis() - cachedAt < CACHE_FRESH_MS) {
            renderAnalysis(cached, true)
            updateStatus("Signal delivered · ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())}")
            return
        }

        deliverWhenReady = true
        handler.removeCallbacks(analysisLoop)
        updateStatus("Scanning for an instant signal…")
        if (!analyzing) captureAndAnalyze()
        handler.postDelayed(analysisLoop, ANALYSIS_INTERVAL_MS)
    }

    private fun captureAndAnalyze() {
        if (analyzing || !isRunning) return
        if (deliverWhenReady) updateStatus("Scanning for an instant signal…") else updateStatus("Reading the chart…")
        analyzing = true
        setActionsEnabled(false)

        if (imageReader == null) {
            analyzing = false
            setActionsEnabled(true)
            updateStatus("Screen capture is not ready")
            return
        }

        handler.postDelayed({ captureFrame(0) }, CAPTURE_DELAY_MS)
    }

    /**
     * Grabs a real frame from MediaProjection. The first frames after a capture
     * session starts can be empty, so retry briefly instead of posting an empty
     * screenshot (which used to surface as "Analysis Failed").
     */
    private fun captureFrame(attempt: Int) {
        if (!isRunning) {
            analyzing = false
            setActionsEnabled(true)
            return
        }

        val reader = imageReader
        if (reader == null) {
            analyzing = false
            setActionsEnabled(true)
            updateStatus("Screen capture is not ready")
            return
        }

        var bitmap: Bitmap? = null
        var image: android.media.Image? = null
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

        if (bitmap == null || bitmap.width <= 0 || bitmap.height <= 0) {
            bitmap?.recycle()
            if (attempt < MAX_FRAME_ATTEMPTS) {
                handler.postDelayed({ captureFrame(attempt + 1) }, FRAME_RETRY_MS)
            } else {
                analyzing = false
                setActionsEnabled(true)
                updateStatus("Waiting for the screen…")
            }
            return
        }

        val payload = bitmapToBase64(bitmap)
        bitmap.recycle()
        sendForAnalysis(payload)
    }

    private fun imageToBitmap(image: android.media.Image): Bitmap? {
        val plane = image.planes.firstOrNull() ?: return null
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val paddedWidth = image.width + rowPadding / pixelStride

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

    private fun sendForAnalysis(imageBase64: String) {
        if (serverUrl.isBlank()) {
            finishAnalysis()
            broadcastError("This build has no backend URL. Reinstall the official app.")
            updateStatus("Backend URL missing")
            return
        }
        if (userToken.isBlank()) {
            finishAnalysis()
            broadcastError("Your session expired. Open the app and sign in again.")
            updateStatus("Sign-in required")
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

                if (requestMode == MODE_FOREX) {
                    body.put(
                        "min_confidence",
                        prefs.getInt(KEY_FOREX_MIN_CONFIDENCE, 70),
                    )
                    body.put("preferred_timeframe", prefs.getString(KEY_FOREX_TIMEFRAME, "15M"))
                    body.put("user_custom_strategy", prefs.getString(KEY_FOREX_STRATEGY, ""))
                } else {
                    body.put(
                        "min_confidence",
                        prefs.getInt(KEY_BINARY_MIN_CONFIDENCE, 70),
                    )
                    body.put(
                        "preferred_duration_seconds",
                        prefs.getInt(KEY_BINARY_DURATION, 60),
                    )
                    body.put("user_custom_strategy", prefs.getString(KEY_BINARY_STRATEGY, ""))
                }

                val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15_000
                    readTimeout = 75_000
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
                    broadcastError(message)
                    updateStatus(if (status == 401) "Sign-in required" else "Analysis failed")
                    finishAnalysis(delivered = false)
                    return@execute
                }

                val analysis = JSONObject(responseText)
                val shouldSpeak = deliverWhenReady
                cacheAnalysis(analysis)
                renderAnalysis(analysis, speak = shouldSpeak)
                finishAnalysis(delivered = true)
            } catch (error: Exception) {
                Log.e(TAG, "Analysis request failed", error)
                broadcastError("Network error: ${error.message ?: "request failed"}")
                updateStatus("Network error")
                finishAnalysis(delivered = false)
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun finishAnalysis(delivered: Boolean = false) {
        analyzing = false
        deliverWhenReady = false
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
            description = "Keeps the floating trading widget and background screen analysis running"
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
            .setContentText("${modeLabel()} background analysis is running")
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
