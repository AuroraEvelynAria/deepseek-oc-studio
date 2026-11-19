package io.github.lijiahua1024.dsreplica;

import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

final class SystemBars {
    interface InsetsListener {
        void update(Insets safe, boolean keyboardVisible);
    }

    @SuppressWarnings("deprecation") // Android 10 reports the keyboard in the system window insets.
    static void applyInsets(Window window, View content, InsetsListener listener) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                listener.update(safe, insets.isVisible(WindowInsets.Type.ime()));
                return WindowInsets.CONSUMED;
            });
            return;
        }

        View decor = window.getDecorView();
        decor.setSystemUiVisibility(decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets safe = insets.getSystemWindowInsets();
            WindowInsets rootInsets = view.getRootWindowInsets();
            int navigation = rootInsets == null ? insets.getStableInsetBottom()
                : rootInsets.getStableInsetBottom();
            boolean keyboardVisible = safe.bottom > navigation;
            DisplayCutout cutout = insets.getDisplayCutout();
            if (cutout != null) {
                safe = Insets.of(Math.max(safe.left, cutout.getSafeInsetLeft()),
                    Math.max(safe.top, cutout.getSafeInsetTop()),
                    Math.max(safe.right, cutout.getSafeInsetRight()),
                    Math.max(safe.bottom, cutout.getSafeInsetBottom()));
            }
            listener.update(safe, keyboardVisible);
            return insets.consumeSystemWindowInsets().consumeStableInsets().consumeDisplayCutout();
        });
    }

    @SuppressWarnings("deprecation") // Android 10 controls icon colors through system UI flags.
    static void setAppearance(Window window, boolean dark) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            window.getInsetsController().setSystemBarsAppearance(dark ? 0 : flags, flags);
        } else {
            View decor = window.getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int visibility = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(dark ? visibility & ~flags : visibility | flags);
        }
        window.setNavigationBarContrastEnforced(false);
    }

    private SystemBars() {}
}
