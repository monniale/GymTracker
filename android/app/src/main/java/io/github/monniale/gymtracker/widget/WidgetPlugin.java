package io.github.monniale.gymtracker.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS face of the home-screen widget (src/native/widget.ts). `update` stores the numbers in
 * SharedPreferences and redraws every placed widget; the provider reads them back, so the widget
 * keeps its last state while the app is closed. Registered in MainActivity before super.onCreate.
 */
@CapacitorPlugin(name = "Widget")
public class WidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        try {
            Context ctx = getContext();
            SharedPreferences.Editor e = ctx.getSharedPreferences(GymWidgetProvider.PREFS, Context.MODE_PRIVATE).edit();
            e.putInt(GymWidgetProvider.K_POINTS, call.getInt("points", 0));
            e.putString(GymWidgetProvider.K_TIER, call.getString("tier", ""));
            e.putString(GymWidgetProvider.K_TIER_COLOR, call.getString("tierColor", "#F97316"));
            e.putInt(GymWidgetProvider.K_STREAK, call.getInt("streakWeeks", 0));
            e.putInt(GymWidgetProvider.K_WEEK_DONE, call.getInt("weekDone", 0));
            e.putInt(GymWidgetProvider.K_WEEK_TARGET, call.getInt("weekTarget", 3));
            e.putString(GymWidgetProvider.K_NEXT, call.getString("nextWorkout", ""));
            e.putString(GymWidgetProvider.K_NEXT_TOMORROW, call.getString("nextWorkoutTomorrow", ""));
            JSArray byDay = call.getArray("nextWorkoutByDay");
            if (byDay != null) e.putString(GymWidgetProvider.K_NEXT_BY_DAY, byDay.toString());
            else e.remove(GymWidgetProvider.K_NEXT_BY_DAY);
            Long nextUntil = call.getLong("nextWorkoutUntil");
            e.putLong(GymWidgetProvider.K_NEXT_UNTIL, nextUntil != null ? nextUntil : 0L);
            Long weekEndsAt = call.getLong("weekEndsAt");
            e.putLong(GymWidgetProvider.K_WEEK_ENDS_AT, weekEndsAt != null ? weekEndsAt : 0L);
            Long updatedAt = call.getLong("updatedAt");
            e.putLong(GymWidgetProvider.K_UPDATED_AT, updatedAt != null ? updatedAt : System.currentTimeMillis());
            e.apply();
            GymWidgetProvider.refreshAll(ctx);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Widget update failed: " + ex.getMessage());
        }
    }

    /** Asks the launcher to place the widget (it shows its own confirmation). `supported` false: add it by hand. */
    @PluginMethod
    public void requestPin(PluginCall call) {
        JSObject o = new JSObject();
        boolean supported = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Context ctx = getContext();
                AppWidgetManager mgr = ctx.getSystemService(AppWidgetManager.class);
                supported = mgr != null && mgr.isRequestPinAppWidgetSupported()
                    && mgr.requestPinAppWidget(new ComponentName(ctx, GymWidgetProvider.class), null, null);
            } catch (Exception ignored) {
                supported = false;
            }
        }
        o.put("supported", supported);
        call.resolve(o);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject o = new JSObject();
        int widgets = 0;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            widgets = mgr.getAppWidgetIds(new ComponentName(ctx, GymWidgetProvider.class)).length;
        } catch (Exception ignored) {
            // no widget host (rare launchers): report none
        }
        o.put("widgets", widgets);
        o.put("updatedAt", ctx.getSharedPreferences(GymWidgetProvider.PREFS, Context.MODE_PRIVATE).getLong(GymWidgetProvider.K_UPDATED_AT, 0L));
        call.resolve(o);
    }
}
