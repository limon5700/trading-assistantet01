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
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Foreground service that shows the draggable overlay card and periodically
 * captures the screen with MediaProjection, posts it to the backend and renders
 * the returned trading signal.
 */
class FloatingWidgetService : Service() {

    companion object {
        private const val TAG = "FloatingWidget"

        const val ACTION_START = "com.aitrading.assistant.action.START"
        const val ACTION_STOP = "com.aitrading.assistant.action.STOP"
        const val ACTION_ANALYZE = "com.aitrading.assistant.action.ANALYZE"
        const val ACTION_UPDATE_SERVER = "com.aitrading.assistant.action.UPDATE_SERVER"

        const val ACTION_ANALYSIS = "com.aitrading.assistant.event.ANALYSIS"
        const val ACTION_STATE = "com.aitrading.assistant.event.STATE"
        const val ACTION_ERROR = "com.aitrading.assistant.event.ERROR"

        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_USER_TOKEN = "user_token"
        const val EXTRA_ANALYSIS = "analysis"
        const val EXTRA_RUNNING = "running"
        const val EXTRA_MESSAGE = "message"

        const val PREFS_NAME = "trading_overlay"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_USER_TOKEN = "user_token"

        private const val CHANNEL_ID = "trading_overlay_channel"
        private const val NOTIFICATION_ID = 4310
        private const val ANALYSIS_INTERVAL_MS = 15_000L
        private const val CAPTURE_DELAY_MS = 350L
        private const val MAX_CAPTURE_WIDTH = 1080

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private var rootLayout: LinearLayout? = null
    private var dragHandle: View? = null
    private var signalBadge: TextView? = null
    private var confidenceText: TextView? = null
    private var timingText: TextView? = null
    private var timeframeText: TextView? = null
    private var reasonText: TextView? = null
    private var statusText: TextView? = null
    private var analyzeButton: TextView? = null

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var projectionCallback: MediaProjection.Callback? = null

    private val handler = Handler(Looper.getMainLooper())
    private val networkExecutor = Executors.newSingleThreadExecutor()
    private var analyzing = false
    private var serverUrl: String = ""
    private var userToken: String = ""

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
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart(intent)
            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }
            ACTION_ANALYZE -> {
                if (isRunning && !analyzing) {
                    handler.removeCallbacks(analysisLoop)
                    captureAndAnalyze()
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
            updateStatus("Watching chart…")
            handler.postDelayed(analysisLoop, 1_200L)
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
                    if (isRunning) {
                        broadcastError("Screen capture stopped")
                    }
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
        rootLayout = view.findViewById(R.id.overlay_root)
        dragHandle = view.findViewById(R.id.drag_handle)
        signalBadge = view.findViewById(R.id.signal_badge)
        confidenceText = view.findViewById(R.id.confidence_text)
        timingText = view.findViewById(R.id.timing_text)
        timeframeText = view.findViewById(R.id.timeframe_text)
        reasonText = view.findViewById(R.id.reason_text)
        statusText = view.findViewById(R.id.status_text)
        analyzeButton = view.findViewById(R.id.analyze_button)

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

        attachDragHandler(params)
        attachActions(view)

        try {
            windowManager.addView(view, params)
        } catch (error: Exception) {
            Log.e(TAG, "Could not add the overlay view", error)
            broadcastError("Could not draw the overlay. Check the draw-over-apps permission.")
            stopEverything()
        }
    }

    private fun attachDragHandler(params: WindowManager.LayoutParams) {
        val handle = dragHandle ?: return
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f

        handle.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x
                    startY = params.y
                    touchX = event.rawX
                    touchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (event.rawX - touchX).roundToInt()
                    params.y = startY + (event.rawY - touchY).roundToInt()
                    overlayView?.let { view ->
                        try {
                            windowManager.updateViewLayout(view, params)
                        } catch (ignored: IllegalArgumentException) {
                            // View was removed while dragging.
                        }
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun attachActions(view: View) {
        analyzeButton?.setOnClickListener {
            if (analyzing) return@setOnClickListener
            handler.removeCallbacks(analysisLoop)
            captureAndAnalyze()
            handler.postDelayed(analysisLoop, ANALYSIS_INTERVAL_MS)
        }
        view.findViewById<TextView>(R.id.stop_button)?.setOnClickListener {
            stopEverything()
        }
    }

    private fun updateStatus(message: String) {
        handler.post { statusText?.text = message }
    }

    private fun renderAnalysis(analysis: JSONObject) {
        handler.post {
            val signal = analysis.optString("signal", "NO_TRADE").uppercase(Locale.US)
            val badge = signalBadge ?: return@post
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

            confidenceText?.text = "${analysis.optInt("confidence", 0)}%"
            timingText?.text = "Entry: ${analysis.optString("entry_timing", "—")}"
            timeframeText?.text = "Timeframe: ${analysis.optString("timeframe_detected", "—")}"
            reasonText?.text = analysis.optString("reason", "")
            updateStatus("Updated ${SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())}")
        }
    }

    // ------------------------------------------------------------- analysis

    private fun captureAndAnalyze() {
        if (analyzing || !isRunning) return
        analyzing = true
        updateStatus("Analyzing chart…")
        analyzeButton?.isEnabled = false

        val reader = imageReader
        if (reader == null) {
            analyzing = false
            analyzeButton?.isEnabled = true
            return
        }

        handler.postDelayed({
            var bitmap: Bitmap? = null
            var image: android.media.Image? = null
            try {
                image = reader.acquireLatestImage()
                if (image != null) {
                    bitmap = imageToBitmap(image)
                }
            } catch (error: Exception) {
                Log.w(TAG, "Screen capture failed", error)
            } finally {
                image?.close()
            }

            if (bitmap == null) {
                analyzing = false
                analyzeButton?.isEnabled = true
                updateStatus("Waiting for the screen…")
                return@postDelayed
            }

            val payload = bitmapToBase64(bitmap)
            bitmap.recycle()
            sendForAnalysis(payload)
        }, CAPTURE_DELAY_MS)
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
        bitmap.compress(Bitmap.CompressFormat.JPEG, 70, stream)
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    private fun sendForAnalysis(imageBase64: String) {
        val endpoint = "${serverUrl.trimEnd('/')}/api/analyze-chart"
        val now = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val timezone = TimeZone.getDefault().id

        networkExecutor.execute {
            var connection: HttpURLConnection? = null
            try {
                val body = JSONObject()
                    .put("imageBase64", imageBase64)
                    .put("currentTime", now)
                    .put("timezone", timezone)
                    .toString()

                val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15_000
                    readTimeout = 60_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept", "application/json")
                    if (userToken.isNotBlank()) {
                        setRequestProperty("Authorization", "Bearer $userToken")
                    }
                }
                connection = conn

                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(body)
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
                    updateStatus("Analysis failed")
                    return@execute
                }

                val analysis = JSONObject(responseText)
                broadcastAnalysis(analysis)
                renderAnalysis(analysis)
            } catch (error: Exception) {
                Log.e(TAG, "Analysis request failed", error)
                broadcastError("Network error: ${error.message ?: "request failed"}")
                updateStatus("Network error")
            } finally {
                connection?.disconnect()
                analyzing = false
                handler.post { analyzeButton?.isEnabled = true }
            }
        }
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
            description = "Keeps the floating trading widget and screen capture running"
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

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AI Trading Assistant")
            .setContentText("Screen analysis is running")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp)
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
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        networkExecutor.shutdownNow()
        hideOverlay()
        virtualDisplay?.release()
        imageReader?.close()
        projectionCallback?.let { mediaProjection?.unregisterCallback(it) }
        mediaProjection?.stop()
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

    private fun broadcastAnalysis(analysis: JSONObject) {
        sendBroadcast(
            Intent(ACTION_ANALYSIS)
                .setPackage(packageName)
                .putExtra(EXTRA_ANALYSIS, analysis.toString()),
        )
    }

    private fun broadcastState(running: Boolean) {
        sendBroadcast(
            Intent(ACTION_STATE).setPackage(packageName).putExtra(EXTRA_RUNNING, running),
        )
    }

    private fun broadcastError(message: String) {
        Log.w(TAG, message)
        sendBroadcast(
            Intent(ACTION_ERROR).setPackage(packageName).putExtra(EXTRA_MESSAGE, message),
        )
    }
}
