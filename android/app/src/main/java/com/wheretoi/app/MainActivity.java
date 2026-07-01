package com.wheretoi.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final String LOG_TAG = "WhereToI";
    private static final int LOCATION_PERMISSION_REQUEST = 1001;
    private static final long LOAD_TIMEOUT_MILLIS = 45_000;
    private static final String APP_ORIGIN = "https://wheretoi-webapp-lvvt.onrender.com";
    private static final String APP_URL = APP_ORIGIN + "/?source=android-apk";
    private static final String APP_HOST = Uri.parse(APP_ORIGIN).getHost();

    private WebView webView;
    private ProgressBar loadingIndicator;
    private LinearLayout errorPanel;
    private TextView errorMessage;
    private GeolocationPermissions.Callback pendingLocationCallback;
    private String pendingLocationOrigin;
    private boolean currentLoadFailed;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable loadTimeout = () -> showLoadError(getString(R.string.load_timeout));

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(251, 252, 247));
        getWindow().setNavigationBarColor(Color.rgb(251, 252, 247));

        createNativeShell();
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(isDebuggable);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " WhereToIAndroid/1.0");

        webView.setWebViewClient(createWebViewClient());
        webView.setWebChromeClient(createWebChromeClient());

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(APP_URL);
        }
    }

    private void createNativeShell() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(243, 241, 235));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(243, 241, 235));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        loadingIndicator = new ProgressBar(this);
        FrameLayout.LayoutParams loadingParams = new FrameLayout.LayoutParams(dp(52), dp(52));
        loadingParams.gravity = Gravity.CENTER;
        root.addView(loadingIndicator, loadingParams);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(Color.rgb(255, 255, 251));
        errorPanel.setVisibility(View.GONE);

        TextView errorTitle = new TextView(this);
        errorTitle.setText(R.string.load_error_title);
        errorTitle.setTextColor(Color.rgb(31, 42, 51));
        errorTitle.setTextSize(22);
        errorTitle.setGravity(Gravity.CENTER);
        errorPanel.addView(errorTitle, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        errorMessage = new TextView(this);
        errorMessage.setTextColor(Color.rgb(100, 113, 127));
        errorMessage.setTextSize(15);
        errorMessage.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        messageParams.setMargins(0, dp(12), 0, dp(24));
        errorPanel.addView(errorMessage, messageParams);

        Button retryButton = new Button(this);
        retryButton.setText(R.string.retry);
        retryButton.setOnClickListener((view) -> webView.loadUrl(APP_URL));
        errorPanel.addView(retryButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48)
        ));

        Button browserButton = new Button(this);
        browserButton.setText(R.string.open_in_browser);
        browserButton.setOnClickListener((view) -> openExternal(Uri.parse(APP_URL)));
        LinearLayout.LayoutParams browserParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48)
        );
        browserParams.setMargins(0, dp(10), 0, 0);
        errorPanel.addView(browserButton, browserParams);

        root.addView(errorPanel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
    }

    private WebViewClient createWebViewClient() {
        return new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                beginPageLoad();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!currentLoadFailed) {
                    finishPageLoad();
                }
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    showLoadError(getString(R.string.load_error_detail, error.getDescription()));
                }
            }

            @Override
            public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceResponse errorResponse
            ) {
                if (request.isForMainFrame()) {
                    showLoadError(getString(R.string.http_error_detail, errorResponse.getStatusCode()));
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showLoadError(getString(R.string.secure_connection_error));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }
        };
    }

    private WebChromeClient createWebChromeClient() {
        return new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(LOG_TAG, consoleMessage.message() + " @" + consoleMessage.lineNumber());
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                    String origin,
                    GeolocationPermissions.Callback callback
            ) {
                if (!APP_ORIGIN.equals(origin)) {
                    callback.invoke(origin, false, false);
                    return;
                }

                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }

                pendingLocationOrigin = origin;
                pendingLocationCallback = callback;
                requestPermissions(
                        new String[] {
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        LOCATION_PERMISSION_REQUEST
                );
            }

            @Override
            public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
            ) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        openExternal(request.getUrl());
                        popupView.destroy();
                        return true;
                    }

                    @Override
                    @SuppressWarnings("deprecation")
                    public boolean shouldOverrideUrlLoading(WebView popupView, String url) {
                        openExternal(Uri.parse(url));
                        popupView.destroy();
                        return true;
                    }
                });

                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        };
    }

    private void beginPageLoad() {
        currentLoadFailed = false;
        mainHandler.removeCallbacks(loadTimeout);
        mainHandler.postDelayed(loadTimeout, LOAD_TIMEOUT_MILLIS);
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        loadingIndicator.setVisibility(View.VISIBLE);
    }

    private void finishPageLoad() {
        mainHandler.removeCallbacks(loadTimeout);
        loadingIndicator.setVisibility(View.GONE);
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private void showLoadError(String detail) {
        currentLoadFailed = true;
        mainHandler.removeCallbacks(loadTimeout);
        loadingIndicator.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        errorMessage.setText(detail);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        boolean isWebUrl = "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);

        if (isWebUrl && APP_HOST != null && APP_HOST.equalsIgnoreCase(host)) {
            return false;
        }

        if (isWebUrl) {
            openExternal(uri);
            return true;
        }

        return false;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // The WebView remains on the current page when no matching app exists.
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_PERMISSION_REQUEST || pendingLocationCallback == null) {
            return;
        }

        boolean granted = hasLocationPermission();
        pendingLocationCallback.invoke(pendingLocationOrigin, granted, false);
        pendingLocationCallback = null;
        pendingLocationOrigin = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacks(loadTimeout);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
