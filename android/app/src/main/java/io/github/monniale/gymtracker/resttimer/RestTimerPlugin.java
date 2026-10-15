package io.github.monniale.gymtracker.resttimer;

import android.content.Intent;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.monniale.gymtracker.R;

/**
 * JS face of the native rest timer (src/native/restTimerPlugin.ts). No `permissions`:
 * POST_NOTIFICATIONS is requested through @capacitor/local-notifications, and the JS bridge only
 * starts the timer once it is granted. Registered in MainActivity before super.onCreate.
 *
 * Events (retained until a JS listener exists): actionSkip, actionExtend (+deltaSec), timerEnd,
 * notificationDismissed — payload = State JSON — and openRoute {route}.
 */
@CapacitorPlugin(name = "RestTimer")
public class RestTimerPlugin extends Plugin {

    /** Live instance while the Bridge exists; null when the process runs only for a broadcast. */
    private static volatile RestTimerPlugin instance;

    /** True between the activity's onResume and onPause: the in-app RestTimerBar handles the alert. */
    private static volatile boolean foreground;

    @Override
    public void load() {
        instance = this;
        RestTimerController.ensureChannels(getContext());
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
    }

    @Override
    protected void handleOnDestroy() {
        foreground = false;
        if (instance == this) instance = null;
    }

    /**
     * Tap on a rest notification (RestTimerController.openAppIntent). A cold start is delivered
     * too: BridgeActivity.load() calls onNewIntent(getIntent()) after the plugins are loaded.
     * The extra is removed so a later re-delivery of the same Intent object cannot navigate again.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra(RestTimerController.EXTRA_ROUTE);
        if (route == null) return;
        intent.removeExtra(RestTimerController.EXTRA_ROUTE);
        JSObject data = new JSObject();
        data.put("route", route);
        notifyListeners("openRoute", data, true);
    }

    static boolean isForeground() {
        return foreground;
    }

    /** Called from RestTimerReceiver (main thread). Retained until a JS listener is attached. */
    static void emit(@NonNull String event, @NonNull JSObject data) {
        RestTimerPlugin p = instance;
        if (p != null) p.notifyListeners(event, data, true);
    }

    @NonNull
    static JSObject toJs(@NonNull RestTimerController.State s) {
        JSObject o = new JSObject();
        o.put("running", s.running);
        o.put("endAt", s.endAt);
        o.put("totalSec", s.totalMs / 1000L);
        o.put("endedAt", s.endedAt);
        o.put("exact", s.exact);
        return o;
    }

    /** JS numbers arrive as Integer, Long or Double depending on magnitude: PluginCall.getLong() only accepts Long. */
    private static Long readLong(PluginCall call, String key) {
        Object v = call.getData().opt(key);
        return (v instanceof Number) ? ((Number) v).longValue() : null;
    }

    /** start({ endAt, totalSec?, title?, body?, countdown? = true, alert? = true, alertMode? = 'notification' }) */
    @PluginMethod
    public void start(PluginCall call) {
        Long endAt = readLong(call, "endAt");
        if (endAt == null || endAt <= System.currentTimeMillis()) {
            call.reject("endAt (epoch ms in the future) is required");
            return;
        }
        Long totalSec = readLong(call, "totalSec");
        long totalMs = totalSec != null ? totalSec * 1000L : endAt - System.currentTimeMillis();
        Boolean countdown = call.getBoolean("countdown", true);
        Boolean alert = call.getBoolean("alert", true);
        RestTimerController.State s = RestTimerController.start(
            getContext(),
            endAt,
            totalMs,
            call.getString("title", getContext().getString(R.string.rest_title)),
            call.getString("body"),
            countdown == null || countdown,
            alert == null || alert,
            RestTimerController.normalizeAlertMode(call.getString("alertMode"))
        );
        call.resolve(toJs(s));
    }

    @PluginMethod
    public void extend(PluginCall call) {
        Long seconds = readLong(call, "seconds");
        if (seconds == null || seconds == 0L) {
            call.reject("seconds (non-zero, may be negative) is required");
            return;
        }
        RestTimerController.State s = RestTimerController.extend(getContext(), seconds * 1000L);
        if (s == null) {
            call.reject("No rest timer running", "NOT_RUNNING");
            return;
        }
        call.resolve(toJs(s));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        RestTimerController.stop(getContext());
        call.resolve(toJs(RestTimerController.getState(getContext())));
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(toJs(RestTimerController.getState(getContext())));
    }
}
