package com.aitrading.assistant

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * JS bridge for the floating trading overlay.
 *
 * The plugin never talks to Gemini directly: it only hands a backend URL to
 * [FloatingWidgetService], which posts screenshots to `/api/analyze-chart`.
 */
@CapacitorPlugin(
    name = "TradingOverlay",
    permissions = [
        Permission(
            alias = "notifications",
            strings = [Manifest.permission.POST_NOTIFICATIONS],
        ),
    ],
)
class OverlayPlugin : Plugin() {

    companion object {
        private const val TAG = "OverlayPlugin"
        private const val REQ_OVERLAY_SETTINGS = 41021
    }

    private var receiverRegistered = false

    private val analysisReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                FloatingWidgetService.ACTION_ANALYSIS -> {
                    val payload = intent.getStringExtra(FloatingWidgetService.EXTRA_ANALYSIS)
                    if (payload != null) {
                        notifyListeners("analysis", JSObject(payload))
                    }
                }

                FloatingWidgetService.ACTION_STATE -> {
                    notifyListeners(
                        "overlayState",
                        JSObject().put(
                            "running",
                            intent.getBooleanExtra(FloatingWidgetService.EXTRA_RUNNING, false),
                        ),
                    )
                }

                FloatingWidgetService.ACTION_ERROR -> {
                    notifyListeners(
                        "overlayError",
                        JSObject().put(
                            "message",
                            intent.getStringExtra(FloatingWidgetService.EXTRA_MESSAGE)
                                ?: "Unexpected overlay error",
                        ),
                    )
                }
            }
        }
    }

    override fun load() {
        val filter = IntentFilter().apply {
            addAction(FloatingWidgetService.ACTION_ANALYSIS)
            addAction(FloatingWidgetService.ACTION_STATE)
            addAction(FloatingWidgetService.ACTION_ERROR)
        }
        ContextCompat.registerReceiver(
            context,
            analysisReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiverRegistered = true
    }

    override fun handleOnDestroy() {
        if (receiverRegistered) {
            try {
                context.unregisterReceiver(analysisReceiver)
            } catch (ignored: IllegalArgumentException) {
                // Already unregistered.
            }
            receiverRegistered = false
        }
        super.handleOnDestroy()
    }

    private fun canDrawOverlays(): Boolean = Settings.canDrawOverlays(context)

    private fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("overlay", canDrawOverlays())
                .put("notifications", hasNotificationPermission())
                .put("running", FloatingWidgetService.isRunning),
        )
    }

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        if (canDrawOverlays()) {
            call.resolve(JSObject().put("overlay", true))
            return
        }

        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        } else {
            Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                startActivityForResult(call, intent, "overlaySettingsResult")
            } else {
                call.resolve(JSObject().put("overlay", true))
            }
        } catch (error: Exception) {
            call.reject("Could not open the overlay permission settings", error)
        }
    }

    @ActivityCallback
    private fun overlaySettingsResult(call: PluginCall, result: ActivityResult) {
        call.resolve(JSObject().put("overlay", canDrawOverlays()))
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasNotificationPermission()) {
            call.resolve(JSObject().put("notifications", true))
            return
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult")
    }

    @PermissionCallback
    private fun notificationPermissionResult(call: PluginCall) {
        call.resolve(JSObject().put("notifications", hasNotificationPermission()))
    }

    @PluginMethod
    fun startOverlay(call: PluginCall) {
        val serverUrl = call.getString("serverUrl")?.trim()?.trimEnd('/')
        if (serverUrl.isNullOrEmpty()) {
            call.reject("A backend serverUrl is required")
            return
        }
        if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
            call.reject("serverUrl must start with http:// or https://")
            return
        }
        if (!canDrawOverlays()) {
            call.reject("OVERLAY_PERMISSION_REQUIRED")
            return
        }
        if (FloatingWidgetService.isRunning) {
            call.resolve(JSObject().put("started", true))
            return
        }

        persistServerUrl(serverUrl)

        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
            as? android.media.projection.MediaProjectionManager
        if (manager == null) {
            call.reject("Screen capture is not supported on this device")
            return
        }

        try {
            // The consent dialog result comes back to captureConsentResult below.
            startActivityForResult(
                call,
                manager.createScreenCaptureIntent(),
                "captureConsentResult",
            )
        } catch (error: Exception) {
            call.reject("Could not request screen capture", error)
        }
    }

    @ActivityCallback
    private fun captureConsentResult(call: PluginCall, result: ActivityResult) {
        val data = result.data
        if (result.resultCode != android.app.Activity.RESULT_OK || data == null) {
            call.resolve(JSObject().put("started", false))
            return
        }

        val serverUrl = call.getString("serverUrl")?.trim()?.trimEnd('/').orEmpty()
        val intent = Intent(context, FloatingWidgetService::class.java).apply {
            action = FloatingWidgetService.ACTION_START
            putExtra(FloatingWidgetService.EXTRA_RESULT_CODE, result.resultCode)
            putExtra(FloatingWidgetService.EXTRA_RESULT_DATA, data)
            putExtra(FloatingWidgetService.EXTRA_SERVER_URL, serverUrl)
        }

        try {
            ContextCompat.startForegroundService(context, intent)
            call.resolve(JSObject().put("started", true))
        } catch (error: Exception) {
            call.reject("Could not start the overlay service", error)
        }
    }

    @PluginMethod
    fun stopOverlay(call: PluginCall) {
        val intent = Intent(context, FloatingWidgetService::class.java).apply {
            action = FloatingWidgetService.ACTION_STOP
        }
        try {
            context.startService(intent)
        } catch (error: Exception) {
            android.util.Log.w(TAG, "Service was not running", error)
        }
        call.resolve()
    }

    @PluginMethod
    fun updateServerUrl(call: PluginCall) {
        val serverUrl = call.getString("serverUrl")?.trim()?.trimEnd('/')
        if (serverUrl.isNullOrEmpty()) {
            call.reject("serverUrl is required")
            return
        }
        persistServerUrl(serverUrl)
        if (FloatingWidgetService.isRunning) {
            val intent = Intent(context, FloatingWidgetService::class.java).apply {
                action = FloatingWidgetService.ACTION_UPDATE_SERVER
                putExtra(FloatingWidgetService.EXTRA_SERVER_URL, serverUrl)
            }
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun analyzeNow(call: PluginCall) {
        if (!FloatingWidgetService.isRunning) {
            call.reject("The overlay is not running")
            return
        }
        val intent = Intent(context, FloatingWidgetService::class.java).apply {
            action = FloatingWidgetService.ACTION_ANALYZE
        }
        context.startService(intent)
        call.resolve()
    }

    private fun persistServerUrl(serverUrl: String) {
        context.getSharedPreferences(FloatingWidgetService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(FloatingWidgetService.KEY_SERVER_URL, serverUrl)
            .apply()
    }
}
