package io.github.lijiahua1024.dsreplica;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.view.accessibility.AccessibilityManager;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + ASSET_HOST + "/index.html";
    private static final String PROFILE_KEY = "profile";
    private static final int MICROPHONE = 1;
    private static final int FILE_CHOOSER = 2;
    private static final int PHOTOS = 3;
    private static final int CAMERA = 4;
    private static final int EXPORT_HISTORY = 5;
    private WebView webView;
    private FrameLayout frame;
    private ApiKeyStore keys;
    private ApiKeyStore chatConfig;
    private final CustomChatTransport customChat = new CustomChatTransport();
    private SharedPreferences profilePreferences;
    private ValueCallback<Uri[]> fileCallback;
    private boolean choosingPhotos;
    private boolean keyboardVisible;
    private volatile float statusInset;
    private volatile float buttonNavigationInset;
    private boolean askedForPhotos;
    private Uri capture;
    private RecentPhotos recentPhotos;
    private FileExport historyExport;
    private ImageSave imageSave;
    private NativeRecorder recorder;
    private AppUpdater updater;
    private boolean backPreviewEnabled;
    private final InAppBackCallback inAppBack = new InAppBackCallback(this, this::handleBack,
        this::reportBackPreview);
    private final Map<String, A11yProxy> a11yProxies = new LinkedHashMap<>();
    private final ExecutorService photoExecutor = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private AccessibilityManager accessibility;
    private final AccessibilityManager.AccessibilityStateChangeListener accessibilityState =
        enabled -> {
            ui.post(() -> {
                if (enabled) primeAccessibility();
                webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('android-a11y-state'))", null);
            });
        };

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        keys = new ApiKeyStore(this);
        chatConfig = new ApiKeyStore(this, "custom-chat");
        profilePreferences = getSharedPreferences("account_profile", MODE_PRIVATE);
        recentPhotos = new RecentPhotos(getContentResolver());
        historyExport = new FileExport(getContentResolver());
        imageSave = new ImageSave(getContentResolver());
        recorder = new NativeRecorder();
        frame = new FrameLayout(this);
        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        SystemBars.applyInsets(getWindow(), frame, (safe, ime, buttonNavigationBottom) -> {
            // Let WebView paint behind the navigation buttons while CSS insets the controls.
            int webBottom = ime ? 0 : buttonNavigationBottom;
            frame.setPadding(safe.left, 0, safe.right, safe.bottom - webBottom);
            float density = getResources().getDisplayMetrics().density;
            float top = safe.top / density;
            float bottom = webBottom / density;
            if (top != statusInset || bottom != buttonNavigationInset || ime != keyboardVisible) {
                statusInset = top;
                buttonNavigationInset = bottom;
                keyboardVisible = ime;
                webView.evaluateJavascript("if (document.documentElement) { const root = document.documentElement;"
                    + "root.style.setProperty('--android-status-inset', '" + top + "px');"
                    + "root.style.setProperty('--android-button-nav-inset', '" + bottom + "px');"
                    + "root.toggleAttribute('data-button-navigation', " + (bottom > 0) + ");"
                    + "root.toggleAttribute('data-keyboard', " + ime + "); }", null);
            }
        });
        setContentView(frame);
        accessibility = getSystemService(AccessibilityManager.class);
        accessibility.addAccessibilityStateChangeListener(accessibilityState);
        setBars((getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES);
        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new AppPage());
        webView.setWebChromeClient(new DeviceFeatures());
        webView.addJavascriptInterface(new DeviceBridge(), "DeepSeekAndroid");
        updater = new AppUpdater(this, status ->
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-update', {detail: "
                + status + "}))", null));
        webView.loadUrl(HOME);
    }

    private void primeAccessibility() {
        if (webView == null) return;
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        AccessibilityNodeInfo host = webView.createAccessibilityNodeInfo();
        if (host != null) host.recycle();
    }

    private void updateA11yTargets(String payload) {
        try {
            JSONArray items = new JSONArray(payload);
            Set<String> live = new HashSet<>();
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.getJSONObject(index);
                String key = item.getString("key");
                JSONArray bounds = item.getJSONArray("bounds");
                JSONArray labelBounds = item.optJSONArray("labelBounds");
                A11yProxy proxy = a11yProxies.get(key);
                if (proxy == null) {
                    proxy = new A11yProxy(key);
                    a11yProxies.put(key, proxy);
                    frame.addView(proxy);
                }
                proxy.update(
                    item.getString("label"),
                    item.optBoolean("checked"),
                    !item.optBoolean("disabled"),
                    bounds.getInt(0),
                    bounds.getInt(1),
                    bounds.getInt(2),
                    bounds.getInt(3),
                    labelBounds,
                    item.optString("labelKind"),
                    item.optString("role", "view"),
                    item.optInt("labelDepth", 1),
                    item.optBoolean("checkable", true),
                    item.optBoolean("clickable", true),
                    item.optBoolean("longClickable"),
                    item.optBoolean("scrollable"),
                    item.optBoolean("focusable", true),
                    item.optBoolean("touchThrough"),
                    item.optBoolean("extraButton")
                );
                live.add(key);
            }
            for (String key : new HashSet<>(a11yProxies.keySet())) {
                if (!live.contains(key)) {
                    frame.removeView(a11yProxies.remove(key));
                }
            }
        } catch (Exception ignored) {
            // A malformed bridge payload must not affect the rendered page.
        }
    }

    private void forwardA11yClick(String key) {
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('android-a11y-click', {detail: "
                + JSONObject.quote(key) + "}))",
            null
        );
    }

    private void forwardA11yLongClick(String key) {
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('android-a11y-long-click', {detail: "
                + JSONObject.quote(key) + "}))",
            null
        );
    }

    private void forwardA11yScroll(String key, int direction) {
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('android-a11y-scroll', {detail: {key: "
                + JSONObject.quote(key) + ", direction: " + direction + "}}))",
            null
        );
    }

    private final class A11yProxy extends FrameLayout {
        private final String key;
        private View label;
        private View labelHost;
        private FrameLayout hintContainer;
        private TextView hintText;
        private TextView extraButton;
        private String childrenShape = "";
        private String description = "";
        private String role = "view";
        private boolean textLabel;
        private boolean checked;
        private boolean checkable = true;
        private boolean clickable = true;
        private boolean longClickable;
        private boolean scrollable;
        private boolean focusable = true;
        private boolean touchThrough;
        private boolean selfDescription;
        private boolean selfText;
        private boolean enabled = true;

        A11yProxy(String key) {
            super(MainActivity.this);
            this.key = key;
            setWillNotDraw(true);
            setClickable(true);
            setFocusable(false);
            setOnClickListener(ignored -> forwardA11yClick(key));
            setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            setAccessibilityDelegate(new AccessibilityDelegate() {
                @Override
                public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                    super.onInitializeAccessibilityNodeInfo(host, info);
                    info.setClassName(
                        "editText".equals(A11yProxy.this.role)
                            ? "android.widget.EditText"
                            : "textView".equals(A11yProxy.this.role)
                                ? "android.widget.TextView"
                                : "button".equals(A11yProxy.this.role)
                                    ? "android.widget.Button"
                                    : "android.view.View");
                    info.setText(A11yProxy.this.selfText ? A11yProxy.this.description : "");
                    info.setContentDescription(
                        A11yProxy.this.selfDescription ? A11yProxy.this.description : "");
                    info.setCheckable(A11yProxy.this.checkable);
                    info.setChecked(
                        A11yProxy.this.checkable && A11yProxy.this.checked);
                    info.setEnabled(A11yProxy.this.enabled);
                    info.setClickable(
                        A11yProxy.this.enabled && A11yProxy.this.clickable);
                    info.setLongClickable(
                        A11yProxy.this.enabled && A11yProxy.this.longClickable);
                    info.setScrollable(
                        A11yProxy.this.enabled && A11yProxy.this.scrollable);
                    info.setFocusable(
                        A11yProxy.this.enabled && A11yProxy.this.focusable);
                    info.setVisibleToUser(true);
                    if (A11yProxy.this.enabled && A11yProxy.this.clickable) {
                        info.addAction(AccessibilityNodeInfo.ACTION_CLICK);
                    }
                    if (A11yProxy.this.enabled && A11yProxy.this.longClickable) {
                        info.addAction(AccessibilityNodeInfo.ACTION_LONG_CLICK);
                    }
                    if (A11yProxy.this.enabled && A11yProxy.this.scrollable) {
                        info.addAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
                        info.addAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
                    }
                }

                @Override
                public boolean performAccessibilityAction(View host, int action, Bundle arguments) {
                    if (action == AccessibilityNodeInfo.ACTION_CLICK
                        && A11yProxy.this.enabled
                        && A11yProxy.this.clickable) {
                        forwardA11yClick(A11yProxy.this.key);
                        return true;
                    }
                    if (action == AccessibilityNodeInfo.ACTION_LONG_CLICK
                        && A11yProxy.this.enabled
                        && A11yProxy.this.longClickable) {
                        forwardA11yLongClick(A11yProxy.this.key);
                        return true;
                    }
                    if (action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                        && A11yProxy.this.enabled
                        && A11yProxy.this.scrollable) {
                        forwardA11yScroll(A11yProxy.this.key, 1);
                        return true;
                    }
                    if (action == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                        && A11yProxy.this.enabled
                        && A11yProxy.this.scrollable) {
                        forwardA11yScroll(A11yProxy.this.key, -1);
                        return true;
                    }
                    return super.performAccessibilityAction(host, action, arguments);
                }
            });
        }

        void update(String text, boolean isChecked, boolean isEnabled,
                    int left, int top, int right, int bottom,
                    JSONArray labelBounds, String labelKind, String nextRole,
                    int nextLabelDepth,
                    boolean nextCheckable, boolean nextClickable,
                    boolean nextLongClickable, boolean nextScrollable,
                    boolean nextFocusable, boolean nextTouchThrough,
                    boolean nextExtraButton) {
            checked = isChecked;
            enabled = isEnabled;
            description = text;
            role = nextRole;
            checkable = nextCheckable;
            clickable = nextClickable;
            longClickable = nextLongClickable;
            scrollable = nextScrollable;
            focusable = nextFocusable;
            touchThrough = nextTouchThrough;
            selfDescription = "none".equals(labelKind);
            selfText = "selfText".equals(labelKind);
            setClickable(nextClickable && !nextTouchThrough);
            setLongClickable(nextLongClickable && !nextTouchThrough);
            setFocusable(nextFocusable && !nextTouchThrough);

            String shape = role + "|" + labelKind + "|" + nextExtraButton + "|"
                + nextLabelDepth;
            if (!shape.equals(childrenShape)) {
                removeAllViews();
                label = null;
                labelHost = null;
                hintContainer = null;
                hintText = null;
                extraButton = null;
                textLabel = "text".equals(labelKind);
                childrenShape = shape;
                if (nextExtraButton) {
                    extraButton = new TextView(MainActivity.this);
                    extraButton.setTextColor(Color.TRANSPARENT);
                    extraButton.setImportantForAccessibility(
                        View.IMPORTANT_FOR_ACCESSIBILITY_YES);
                    extraButton.setClickable(false);
                    extraButton.setFocusable(false);
                    extraButton.setAccessibilityDelegate(new AccessibilityDelegate() {
                        @Override
                        public void onInitializeAccessibilityNodeInfo(
                            View host, AccessibilityNodeInfo info) {
                            super.onInitializeAccessibilityNodeInfo(host, info);
                            info.setClassName("android.widget.Button");
                            info.setText("");
                            info.setContentDescription("");
                            info.setClickable(false);
                            info.setFocusable(false);
                        }
                    });
                    addView(extraButton);
                }
                if ("hint".equals(labelKind)) {
                    buildHintLabel();
                } else if (!selfDescription && !selfText) {
                    buildLabel(textLabel, nextLabelDepth);
                }
            }
            if (hintText != null) {
                hintText.setText(text);
            } else if (label instanceof TextView) {
                ((TextView) label).setText(text);
            } else if (label != null) {
                label.setContentDescription(text);
            }
            FrameLayout.LayoutParams params =
                new FrameLayout.LayoutParams(right - left, bottom - top);
            params.leftMargin = left;
            params.topMargin = top;
            setLayoutParams(params);
            int labelLeft = left;
            int labelTop = top;
            int labelRight = right;
            int labelBottom = bottom;
            if (labelBounds != null) {
                labelLeft = labelBounds.optInt(0, left);
                labelTop = labelBounds.optInt(1, top);
                labelRight = labelBounds.optInt(2, right);
                labelBottom = labelBounds.optInt(3, bottom);
            }
            if (label != null) {
                label.setLayoutParams(new FrameLayout.LayoutParams(
                    Math.max(1, labelRight - labelLeft),
                    Math.max(1, labelBottom - labelTop)
                ));
                ((FrameLayout.LayoutParams) label.getLayoutParams()).leftMargin =
                    labelLeft - left;
                ((FrameLayout.LayoutParams) label.getLayoutParams()).topMargin =
                    labelTop - top;
            }
            if (hintContainer != null) {
                int inset = Math.min(42, Math.max(0, (right - left) / 4));
                int vertical = Math.min(32, Math.max(0, (bottom - top) / 4));
                FrameLayout.LayoutParams hintParams = new FrameLayout.LayoutParams(
                    Math.max(1, right - left - inset * 2),
                    Math.max(1, bottom - top - vertical * 2)
                );
                hintParams.leftMargin = inset;
                hintParams.topMargin = vertical;
                hintContainer.setLayoutParams(hintParams);
                int hintHeight = Math.min(116, hintParams.height);
                hintText.setLayoutParams(
                    new FrameLayout.LayoutParams(hintParams.width, hintHeight));
                View marker = hintContainer.getChildAt(1);
                marker.setLayoutParams(new FrameLayout.LayoutParams(
                    Math.min(294, hintParams.width),
                    Math.min(58, hintParams.height)
                ));
            }
            if (extraButton != null) {
                if ("description".equals(labelKind)) {
                    int size = 79;
                    FrameLayout.LayoutParams extraParams =
                        new FrameLayout.LayoutParams(size, size);
                    extraParams.leftMargin = Math.max(0, (right - left - size) / 2);
                    extraParams.topMargin = Math.max(0, (bottom - top - size) / 2);
                    extraButton.setLayoutParams(extraParams);
                } else {
                    extraButton.setLayoutParams(
                        new FrameLayout.LayoutParams(right - left, bottom - top));
                }
            }
            requestLayout();
            invalidate();
        }

        private void buildLabel(boolean wantsText, int depth) {
            if (wantsText) {
                TextView content = new TextView(MainActivity.this);
                content.setTextColor(Color.TRANSPARENT);
                label = content;
            } else {
                label = new View(MainActivity.this);
            }
            label.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            label.setClickable(false);
            label.setFocusable(false);
            if (depth > 1) {
                FrameLayout container = new FrameLayout(MainActivity.this);
                container.setImportantForAccessibility(
                    View.IMPORTANT_FOR_ACCESSIBILITY_YES);
                container.setClickable(false);
                container.setFocusable(false);
                container.setAccessibilityDelegate(new AccessibilityDelegate() {
                    @Override
                    public void onInitializeAccessibilityNodeInfo(
                        View host, AccessibilityNodeInfo info) {
                        super.onInitializeAccessibilityNodeInfo(host, info);
                        info.setClassName("android.view.View");
                        info.setText("");
                        info.setContentDescription("");
                        info.setClickable(false);
                        info.setFocusable(false);
                    }
                });
                container.addView(label);
                labelHost = container;
                addView(container);
            } else {
                labelHost = label;
                addView(label);
            }
        }

        private void buildHintLabel() {
            hintContainer = new FrameLayout(MainActivity.this);
            hintContainer.setImportantForAccessibility(
                View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            hintContainer.setClickable(false);
            hintContainer.setFocusable(false);
            hintContainer.setAccessibilityDelegate(new AccessibilityDelegate() {
                @Override
                public void onInitializeAccessibilityNodeInfo(
                    View host, AccessibilityNodeInfo info) {
                    super.onInitializeAccessibilityNodeInfo(host, info);
                    info.setClassName("android.view.View");
                    info.setText("");
                    info.setContentDescription("");
                    info.setClickable(false);
                    info.setFocusable(false);
                }
            });
            hintText = new TextView(MainActivity.this);
            hintText.setTextColor(Color.TRANSPARENT);
            hintText.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            hintText.setClickable(false);
            hintText.setFocusable(false);
            hintContainer.addView(hintText);
            View marker = new View(MainActivity.this);
            marker.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            marker.setClickable(false);
            marker.setFocusable(false);
            hintContainer.addView(marker);
            label = hintContainer;
            labelHost = hintContainer;
            addView(hintContainer);
        }

        @Override
        public void addChildrenForAccessibility(ArrayList<View> children) {
            if (labelHost != null) {
                children.add(labelHost);
            }
            if (extraButton != null) {
                children.add(extraButton);
            }
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation") // Legacy back still needs to ask the WebView first.
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        webView.evaluateJavascript("window.dispatchEvent(new Event('android-back', {cancelable: true}))",
            result -> { if ("true".equals(result)) finish(); });
    }

    private void reportBackPreview(InAppBackCallback.Preview event) {
        if (!backPreviewEnabled) return;
        String detail = "null";
        if (event != null) {
            float density = getResources().getDisplayMetrics().density;
            String edge = event.edge() == null ? "null" : "'" + event.edge() + "'";
            detail = "{progress: " + event.progress() + ", edge: " + edge
                + ", touchY: " + (event.touchY() / density) + "}";
        }
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-back-preview', {detail: "
            + detail + "}))", null);
    }

    private void setBars(boolean dark) {
        SystemBars.setAppearance(getWindow(), dark);
        int color = Color.parseColor(dark ? "#191919" : "#FFFFFF");
        frame.setBackgroundColor(color);
        webView.setBackgroundColor(color);
    }

    private static boolean isBundled(Uri url) {
        return "https".equals(url.getScheme()) && ASSET_HOST.equals(url.getHost())
            && url.getPort() == -1;
    }

    private final class AppPage extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            backPreviewEnabled = false;
            inAppBack.setEnabled(false);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (accessibility != null && accessibility.isEnabled()) {
                primeAccessibility();
                view.evaluateJavascript(
                    "window.dispatchEvent(new Event('android-a11y-state'))", null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (isBundled(request.getUrl())) {
                return !request.isForMainFrame() || !"/index.html".equals(request.getUrl().getPath());
            }
            String scheme = request.getUrl().getScheme();
            if (request.isForMainFrame() && ("https".equals(scheme) || "http".equals(scheme))) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (ActivityNotFoundException ignored) {
                    // The device has no browser for external links.
                }
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!isBundled(url)) return null;
            String path = url.getPath();
            if ("/recording.wav".equals(path)) {
                WebResourceResponse audio = recorder.takeWav();
                if (audio != null) return audio;
            }
            if (path != null && path.matches("/(recent|thumbnail)/[0-9]+")) {
                WebResourceResponse photo = recentPhotos.open(url.getLastPathSegment(),
                    path.startsWith("/thumbnail/"));
                if (photo != null) return photo;
            }
            if ("/index.html".equals(path) || (path != null && path.startsWith("/static/")
                    && !path.contains("/../"))) {
                String name = path.substring(1);
                String extension = name.substring(name.lastIndexOf('.') + 1);
                String type = "js".equals(extension) ? "text/javascript"
                    : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                Map<String, String> headers = Map.of("Content-Security-Policy",
                    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                    + "img-src 'self' https: data: blob:; font-src 'self' data:; "
                    + "media-src 'self' blob:; connect-src 'self' https://api.deepseek.com; "
                    + "frame-src 'none'; base-uri 'none'; form-action 'none';");
                try {
                    return new WebResourceResponse(type == null ? "application/octet-stream" : type,
                        "UTF-8", 200, "OK", headers, getAssets().open(name));
                } catch (IOException ignored) {
                    // Unknown paths must stay inside the bundled origin.
                }
            }
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Map.of(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private final class DeviceFeatures extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            choosingPhotos = false;
            if (params.isCaptureEnabled()) {
                if (granted(Manifest.permission.CAMERA)) {
                    launchCamera();
                } else {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA);
                }
                return true;
            }
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            String[] mimeTypes = Arrays.stream(params.getAcceptTypes())
                .map(type -> type.startsWith(".")
                    ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1)) : type)
                .filter(type -> type != null && type.contains("/"))
                .distinct().toArray(String[]::new);
            intent.setType(mimeTypes.length == 1 ? mimeTypes[0] : "*/*");
            if (mimeTypes.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
            choosingPhotos = Arrays.equals(mimeTypes, new String[]{"image/*"});
            if (Build.VERSION.SDK_INT >= 33 && choosingPhotos) {
                Intent picker = new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*");
                if (multiple) {
                    picker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 10);
                }
                try {
                    startActivityForResult(picker, FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    // Use the document picker on devices without the system photo picker.
                }
            }
            try {
                startActivityForResult(intent, FILE_CHOOSER);
            } catch (ActivityNotFoundException ignored) {
                fileCallback = null;
                callback.onReceiveValue(null);
            }
            return true;
        }
    }

    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasRecentPhotosPermission() {
        String imagesPermission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        return granted(imagesPermission) || (Build.VERSION.SDK_INT >= 34
            && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED));
    }

    private void showRecentPhotos() {
        String imagesPermission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (!hasRecentPhotosPermission() && !askedForPhotos) {
            askedForPhotos = true;
            String[] permissions = Build.VERSION.SDK_INT >= 34
                ? new String[]{imagesPermission, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED}
                : new String[]{imagesPermission};
            requestPermissions(permissions, PHOTOS);
        } else {
            notifyRecentPhotos();
        }
    }

    private void notifyRecentPhotos() {
        photoExecutor.execute(() -> {
            String photos = recentPhotos.list();
            runOnUiThread(() -> {
                if (!isFinishing() && !isDestroyed()) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-photos', "
                        + "{detail: " + photos + "}))", null);
                }
            });
        });
    }

    private void launchCamera() {
        try {
            capture = CaptureProvider.create(this);
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, capture)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            camera.setClipData(ClipData.newRawUri("photo", capture));
            startActivityForResult(camera, FILE_CHOOSER);
        } catch (IOException | ActivityNotFoundException ignored) {
            capture = null;
            completeFileChooser(null);
        }
    }

    private void completeFileChooser(Uri[] files) {
        if (fileCallback == null) return;
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        callback.onReceiveValue(files);
    }

    private void completePhotoChooser(Uri[] files) {
        ValueCallback<Uri[]> callback = fileCallback;
        photoExecutor.execute(() -> {
            for (int index = 0; index < files.length; index++) {
                Uri uri = files[index];
                try {
                    if (!SelectedPhoto.isHeif(getContentResolver().getType(uri))) continue;
                    Uri decoded = CaptureProvider.createPng(this);
                    try (OutputStream output = getContentResolver().openOutputStream(decoded)) {
                        if (output == null) continue;
                        SelectedPhoto.writePng(getContentResolver(), uri, output);
                    }
                    files[index] = decoded;
                } catch (IOException | SecurityException ignored) {
                    // The original document can still be handled by normal attachment validation.
                }
            }
            runOnUiThread(() -> {
                if (!isDestroyed() && fileCallback == callback) completeFileChooser(files);
            });
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MICROPHONE) {
            startRecording();
        } else if (code == PHOTOS) {
            notifyRecentPhotos();
        } else if (code == CAMERA && fileCallback != null) {
            if (granted(Manifest.permission.CAMERA)) {
                launchCamera();
            } else {
                completeFileChooser(null);
            }
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == AppUpdater.INSTALL_SOURCE_SETTINGS) {
            updater.permissionResult();
        } else if (code == EXPORT_HISTORY) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            reportExport(uri == null ? "cancelled" : historyExport.open(uri) ? "ready" : "error");
        } else if (code == FILE_CHOOSER && fileCallback != null) {
            Uri[] files = null;
            if (result == RESULT_OK) {
                if (capture != null) {
                    files = new Uri[]{capture};
                } else if (data != null && data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    files = new Uri[clip.getItemCount()];
                    for (int index = 0; index < files.length; index++) {
                        files[index] = clip.getItemAt(index).getUri();
                    }
                } else if (data != null && data.getData() != null) {
                    files = new Uri[]{data.getData()};
                }
            }
            capture = null;
            if (choosingPhotos && files != null) {
                completePhotoChooser(files);
            } else {
                completeFileChooser(files);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        updater.resume();
    }

    @Override
    protected void onPause() {
        updater.pause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        recorder.finish(false);
        webView.evaluateJavascript("window.dispatchEvent(new Event('android-recording-interrupted'))", null);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        customChat.close();
        inAppBack.setEnabled(false);
        if (accessibility != null) {
            accessibility.removeAccessibilityStateChangeListener(accessibilityState);
        }
        photoExecutor.shutdownNow();
        updater.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        recorder.finish(false);
        historyExport.close();
        imageSave.finish(false);
        for (A11yProxy proxy : a11yProxies.values()) {
            frame.removeView(proxy);
        }
        a11yProxies.clear();
        frame.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }

    private void reportExport(String state) {
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-export', "
            + "{detail: '" + state + "'}))", null);
    }

    private void startRecording() {
        String state = !granted(Manifest.permission.RECORD_AUDIO) ? "denied"
            : recorder.start() ? "ready" : "error";
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android-recording', "
            + "{detail: '" + state + "'}))", null);
    }

    private final class DeviceBridge {
        @JavascriptInterface
        public float statusInset() { return statusInset; }

        @JavascriptInterface
        public float buttonNavigationInset() { return buttonNavigationInset; }

        @JavascriptInterface
        public float systemFontScale() { return getResources().getConfiguration().fontScale; }

        @JavascriptInterface
        public int getMusicVolume() {
            AudioManager audio = getSystemService(AudioManager.class);
            return audio == null ? -1 : audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        }

        @JavascriptInterface
        public String updateStatus() { return updater.status(); }

        @JavascriptInterface
        public void checkForUpdate() { runOnUiThread(() -> updater.check()); }

        @JavascriptInterface
        public void installUpdate() { runOnUiThread(() -> updater.update()); }

        @JavascriptInterface
        public void openSourcePage(String url, boolean dark, String closeLabel, String browserLabel,
                                   String loadingLabel, String errorLabel, String retryLabel) {
            Uri uri = SourceBrowserActivity.webUri(url);
            if (uri == null) return;
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, SourceBrowserActivity.class)
                .setData(uri).putExtra("dark", dark)
                .putExtra("closeLabel", closeLabel).putExtra("browserLabel", browserLabel)
                .putExtra("loadingLabel", loadingLabel).putExtra("errorLabel", errorLabel)
                .putExtra("retryLabel", retryLabel)));
        }

        @JavascriptInterface
        public String readApiKey() { return keys.read(); }

        @JavascriptInterface
        public boolean writeApiKey(String value) { return keys.write(value); }

        @JavascriptInterface
        public String readChatConfig() { return chatConfig.read(); }

        @JavascriptInterface
        public boolean writeChatConfig(String value) { return chatConfig.write(value); }

        @JavascriptInterface
        public String beginChatRequest(String endpoint, String format, String body) {
            return customChat.begin(chatConfig.read(), endpoint, format, body, payload ->
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('android-custom-chat',{detail:"
                        + payload + "}))", null);
                }));
        }

        @JavascriptInterface
        public void cancelChatRequest(String id) { if (id != null) customChat.cancel(id); }

        @JavascriptInterface
        public String readAccountProfile() { return profilePreferences.getString(PROFILE_KEY, null); }

        @JavascriptInterface
        public boolean writeAccountProfile(String value) {
            SharedPreferences.Editor editor = profilePreferences.edit();
            if (value == null) editor.remove(PROFILE_KEY);
            else editor.putString(PROFILE_KEY, value);
            return editor.commit();
        }

        @JavascriptInterface
        public void setDarkBars(boolean dark) { runOnUiThread(() -> setBars(dark)); }

        @JavascriptInterface
        public void setHandlesBack(boolean handlesBack) {
            runOnUiThread(() -> { if (!isDestroyed()) inAppBack.setEnabled(handlesBack); });
        }

        @JavascriptInterface
        public void setBackPreviewEnabled(boolean enabled) {
            runOnUiThread(() -> { if (!isDestroyed()) backPreviewEnabled = enabled; });
        }

        @JavascriptInterface
        public void setImageViewerFullscreen(boolean fullscreen) {
            runOnUiThread(() -> SystemBars.setFullscreen(getWindow(), fullscreen));
        }

        @JavascriptInterface
        public void requestRecentPhotos() { runOnUiThread(() -> showRecentPhotos()); }

        @JavascriptInterface
        public void prefetchRecentPhotos() {
            runOnUiThread(() -> { if (hasRecentPhotosPermission()) notifyRecentPhotos(); });
        }

        @JavascriptInterface
        public void requestHistoryExport(String fileName) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/zip")
                    .putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(intent, EXPORT_HISTORY);
                } catch (ActivityNotFoundException ignored) {
                    reportExport("error");
                }
            });
        }

        @JavascriptInterface
        public boolean writeHistoryExport(String bytes) { return historyExport.append(bytes); }

        @JavascriptInterface
        public boolean finishHistoryExport() { return historyExport.close(); }

        @JavascriptInterface
        public boolean beginImageSave(String name, String mime) { return imageSave.begin(name, mime); }

        @JavascriptInterface
        public boolean writeImageSave(String bytes) { return imageSave.append(bytes); }

        @JavascriptInterface
        public boolean finishImageSave(boolean keep) { return imageSave.finish(keep); }

        @JavascriptInterface
        public void requestRecording() {
            runOnUiThread(() -> {
                if (granted(Manifest.permission.RECORD_AUDIO)) {
                    startRecording();
                } else {
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
                }
            });
        }

        @JavascriptInterface
        public boolean finishRecording(boolean keep) { return recorder.finish(keep); }

        @JavascriptInterface
        public double recordingLevel() { return recorder.level(); }

        @JavascriptInterface
        public boolean a11yEnabled() {
            return accessibility != null && accessibility.isEnabled();
        }

        @JavascriptInterface
        public void setA11yTargets(String payload) {
            runOnUiThread(() -> updateA11yTargets(payload));
        }
    }
}
