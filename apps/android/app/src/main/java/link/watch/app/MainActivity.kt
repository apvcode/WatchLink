package link.watch.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.os.Handler
import android.os.Looper
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader

class MainActivity : AppCompatActivity() {

    private lateinit var mainLayout: FrameLayout
    private lateinit var contentContainer: FrameLayout
    private lateinit var contentWebView: WebView
    private lateinit var uiWebView: WebView
    private lateinit var customViewContainer: FrameLayout

    private val loadHandler = Handler(Looper.getMainLooper())
    private var loadTimeout: Runnable? = null
    private var activeReply: androidx.webkit.JavaScriptReplyProxy? = null
    private var activeIsMainFrame = false
    private var pendingInvite: String? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var filePathCallback: android.webkit.ValueCallback<Array<Uri>>? = null

    private val pickFile = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        filePathCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        filePathCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        mainLayout = findViewById(R.id.mainLayout)
        contentContainer = findViewById(R.id.contentContainer)
        contentWebView = findViewById(R.id.contentWebView)
        uiWebView = findViewById(R.id.uiWebView)
        customViewContainer = findViewById(R.id.customViewContainer)

        requestHighRefreshRate()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        uiWebView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        setupContentWebView()
        setupUiWebView()
        setupBackPressHandler()
        handleIntentData()
        // Ask for the notification permission once, not on every launch.
        val prefs = getSharedPreferences("watchlink", MODE_PRIVATE)
        if (android.os.Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("askedNotifications", false)) {
            prefs.edit().putBoolean("askedNotifications", true).apply()
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    /** The keep-alive service runs only while the user is inside a room. */
    private fun setPlaybackService(on: Boolean) {
        try {
            val intent = Intent(this, PlaybackService::class.java)
            if (on) androidx.core.content.ContextCompat.startForegroundService(this, intent)
            else stopService(intent)
        } catch (_: Exception) {}
    }

    override fun onStop() {
        super.onStop()
        // Keep WebViews running (media, timers, WebRTC) while the app is minimized.
        contentWebView.onResume()
        uiWebView.onResume()
        contentWebView.resumeTimers()
    }

    /** Many phones keep apps at 60 Hz unless a higher display mode is requested. */
    private fun requestHighRefreshRate() {
        try {
            val display = if (android.os.Build.VERSION.SDK_INT >= 30) display else @Suppress("DEPRECATION") windowManager.defaultDisplay
            val current = display?.mode ?: return
            val best = display.supportedModes
                .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
                .maxByOrNull { it.refreshRate } ?: return
            val attrs = window.attributes
            attrs.preferredDisplayModeId = best.modeId
            window.attributes = attrs
        } catch (_: Exception) {}
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupContentWebView() {
        val settings = contentWebView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        // 1. Inject content adapter bridge before page scripts run
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val bridgeScript = loadAssetString("content-bridge.global.js")
            if (bridgeScript.isNotEmpty()) {
                WebViewCompat.addDocumentStartJavaScript(
                    contentWebView,
                    bridgeScript,
                    setOf("*")
                )
            }
        }

        // 2. Add type-safe web message listener for WatchLinkBridge
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                contentWebView,
                "WatchLinkBridge",
                setOf("*")
            ) { _, message, origin, isMainFrame, reply ->
                if (origin.scheme != "https" && !(BuildConfig.DEBUG && origin.scheme == "http")) return@addWebMessageListener
                // Once the page's own frame drives the player, embedded (ad) frames cannot take over.
                if (!isMainFrame && activeIsMainFrame) return@addWebMessageListener
                val data = message.data ?: return@addWebMessageListener
                if (data.length > 8192) return@addWebMessageListener
                runOnUiThread {
                    try {
                        val json = JSONObject(data)
                        if (json.optString("type") == "watchlink:state" && (json.optJSONObject("state")?.optDouble("duration", 0.0) ?: 0.0) > 0.0) { activeReply = reply; activeIsMainFrame = isMainFrame }
                        forwardToUi(data)
                    } catch (_: Exception) {}
                }
            }
        }

        contentWebView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                loadTimeout?.let { loadHandler.removeCallbacks(it) }
                forwardToUi(JSONObject().put("type", "watchlink:loading").put("loading", true).toString())
                loadTimeout = Runnable {
                    view.stopLoading()
                    showLoadError("Видео не загрузилось за 20 секунд. Проверьте, открывается ли YouTube в браузере телефона, и подключение VPN, если оно необходимо.")
                }
                loadHandler.postDelayed(loadTimeout!!, 20000)
            }
            override fun onPageFinished(view: WebView, url: String) {
                loadTimeout?.let { loadHandler.removeCallbacks(it) }
                forwardToUi(JSONObject().put("type", "watchlink:loading").put("loading", false).toString())
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showLoadError("Не удалось загрузить видео: ${error.description} (${error.errorCode}). Проверьте доступ к сайту с телефона.")
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep video navigation inside content view
                return request.url.scheme !in listOf("https", "http")
            }
        }

        contentWebView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                mainLayout.visibility = View.GONE
                customViewContainer.addView(view)
                customViewContainer.visibility = View.VISIBLE
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }

            override fun onHideCustomView() {
                if (customView == null) return
                mainLayout.visibility = View.VISIBLE
                customViewContainer.visibility = View.GONE
                customViewContainer.removeView(customView)
                customView = null
                customViewCallback?.onCustomViewHidden()
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupUiWebView() {
        val settings = uiWebView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false

        // Load bundled Preact UI via secure WebViewAssetLoader
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // <input type="file"> (avatar picker) needs an explicit chooser in a WebView.
        uiWebView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                callback: android.webkit.ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    pickFile.launch("image/*")
                    true
                } catch (_: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        uiWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }
        }

        // WebMessageListener for UI to Host communications
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                uiWebView,
                "WatchLinkHost",
                setOf("https://appassets.androidplatform.net")
            ) { _, message, origin, isMain, _ ->
                if (!isMain || origin.host != "appassets.androidplatform.net") return@addWebMessageListener
                val data = message.data ?: return@addWebMessageListener
                if (data.length > 8192) return@addWebMessageListener
                runOnUiThread {
                    handleUiMessage(data)
                }
            }
        }

        uiWebView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    private fun handleUiMessage(jsonString: String) {
        try {
            val json = JSONObject(jsonString)
            val type = json.optString("type")

            when (type) {
                "copy" -> {
                    val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("WatchLink", json.optString("text")))
                }
                "load" -> {
                    val url = json.optString("url")
                    val scheme = Uri.parse(url).scheme
                    if (scheme == "https" || (BuildConfig.DEBUG && scheme == "http")) {
                        activeReply = null
                        activeIsMainFrame = false
                        contentWebView.loadUrl(url)
                    } else {
                        showLoadError("Эта ссылка не поддерживается: на телефоне открываются только защищённые (https) адреса. / Only https links can be opened on the phone.")
                    }
                }
                "bounds" -> {
                    val rect = json.optJSONObject("rect")
                    val visible = rect != null && !json.optBoolean("hidden")
                    contentContainer.visibility = if (visible) View.VISIBLE else View.GONE
                    if (rect != null) {
                        val scale = resources.displayMetrics.density
                        val params = FrameLayout.LayoutParams((rect.optDouble("width") * scale).toInt().coerceAtLeast(1), (rect.optDouble("height") * scale).toInt().coerceAtLeast(1))
                        params.leftMargin = (rect.optDouble("x") * scale).toInt().coerceAtLeast(0)
                        params.topMargin = (rect.optDouble("y") * scale).toInt().coerceAtLeast(0)
                        contentContainer.layoutParams = params
                    }
                }
                "fullscreen" -> applyFullscreen(json.optBoolean("on"))
                "exit" -> finish()
                "clear" -> { contentContainer.visibility = View.GONE; activeReply = null; activeIsMainFrame = false; contentWebView.loadUrl("about:blank") }
                "service" -> setPlaybackService(json.optBoolean("on"))
                "ready" -> pendingInvite?.let { code ->
                    forwardToUi(JSONObject().put("type", "watchlink:host:join").put("roomCode", code).toString())
                    pendingInvite = null
                }
                "command" -> {
                    val action = json.optString("action")
                    if (action in listOf("play", "pause", "seek", "rate", "quality", "audio", "captions", "ambient", "getState")) {
                        json.put("type", "watchlink:cmd:$action")
                        if (activeReply != null) activeReply?.postMessage(json.toString())
                        else contentWebView.evaluateJavascript("window.postMessage(JSON.parse(${JSONObject.quote(json.toString())}), '*');", null)
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun applyFullscreen(on: Boolean) {
        requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, !on)
        if (on) {
            controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun showLoadError(message: String) {
        loadTimeout?.let { loadHandler.removeCallbacks(it) }
        contentContainer.visibility = View.GONE
        forwardToUi(JSONObject().put("type", "watchlink:loading").put("loading", false).toString())
        forwardToUi(JSONObject().put("type", "watchlink:error").put("message", message).toString())
    }

    private fun forwardToUi(jsonString: String) {
        val safeData = JSONObject.quote(jsonString)
        uiWebView.evaluateJavascript("window.postMessage(JSON.parse($safeData), '*');", null)
    }

    private fun setupBackPressHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    contentWebView.webChromeClient?.onHideCustomView()
                    return
                }
                // The UI owns navigation: it closes sheets, leaves rooms (after confirming) and
                // asks us to exit via the "exit" message.
                uiWebView.evaluateJavascript("window.postMessage({ type: 'watchlink:host:back' }, '*');", null)
            }
        })
    }

    private fun handleIntentData() {
        val uri = intent?.data
        if (uri?.scheme == "wl") pendingInvite = uri.toString()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntentData()
        pendingInvite?.let { code ->
            forwardToUi(JSONObject().put("type", "watchlink:host:join").put("roomCode", code).toString())
            pendingInvite = null
        }
    }
    override fun onDestroy() {
        stopService(Intent(this, PlaybackService::class.java))
        activeReply = null
        contentWebView.destroy()
        uiWebView.destroy()
        super.onDestroy()
    }

    private fun loadAssetString(path: String): String {
        return try {
            assets.open(path).use { stream ->
                BufferedReader(InputStreamReader(stream)).readText()
            }
        } catch (_: Exception) {
            ""
        }
    }
}
