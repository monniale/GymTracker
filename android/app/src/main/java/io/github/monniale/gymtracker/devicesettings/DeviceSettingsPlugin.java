package io.github.monniale.gymtracker.devicesettings;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.LocaleManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.usage.UsageStatsManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.LocaleList;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Device status and deep links into system settings, for Settings › Notifications
 * (src/native/deviceSettings.ts + status.ts).
 *
 * Everything here is defensive: an exception escaping a @PluginMethod becomes an uncaught
 * RuntimeException on the plugin thread (Bridge.callPluginMethod) and kills the app, and the risky
 * calls are OEM / API-36 ones (One UI's "Never sleeping apps" activity, Live-Update settings,
 * standby buckets). Every status read falls back to a neutral value; every startActivity catches
 * ActivityNotFoundException | SecurityException, falls back to the app details page, and only then
 * rejects with "UNAVAILABLE".
 */
@CapacitorPlugin(name = "DeviceSettings")
public class DeviceSettingsPlugin extends Plugin {

    private static final String TAG = "DeviceSettings";

    /** One UI "Never sleeping apps" list (developer.samsung.com/mobile/app-management.html): activity_type 2. */
    private static final String SAMSUNG_LIST_ACTION = "com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY";
    private static final String SAMSUNG_DEVICE_CARE = "com.samsung.android.lool";

    private interface Check<T> {
        T get() throws Exception;
    }

    /** Runs a status read; any exception or linkage error (OEM framework without the method) → fallback. */
    private static <T> T safe(String what, Check<T> check, T fallback) {
        try {
            T v = check.get();
            return v != null ? v : fallback;
        } catch (Exception | LinkageError e) {
            Logger.warn(TAG, "status " + what + " unavailable: " + e);
            return fallback;
        }
    }

    /**
     * Android 13+: makes the app's own resources (rest-timer "Rest over"/Skip, channel names, the
     * widget) follow the in-app language instead of the phone's. `locale` is in MainActivity's
     * configChanges, so the activity is not recreated. Older Android: no-op ({applied: false}).
     */
    @PluginMethod
    public void setAppLanguage(PluginCall call) {
        JSObject res = new JSObject();
        boolean applied = false;
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                String tag = call.getString("lang", "");
                LocaleManager lm = getContext().getSystemService(LocaleManager.class);
                LocaleList want = tag == null || tag.isEmpty() ? LocaleList.getEmptyLocaleList() : LocaleList.forLanguageTags(tag);
                if (lm != null) {
                    if (!want.equals(lm.getApplicationLocales())) lm.setApplicationLocales(want);
                    applied = true;
                }
            } catch (Exception e) {
                Logger.warn("DeviceSettings", "setAppLanguage failed: " + e.getMessage());
            }
        }
        res.put("applied", applied);
        call.resolve(res);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        JSObject r = new JSObject();

        r.put("notificationsEnabled", safe("notifications", () -> NotificationManagerCompat.from(ctx).areNotificationsEnabled(), true));
        r.put("canScheduleExactAlarms", safe("exact", () -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
            AlarmManager am = ctx.getSystemService(AlarmManager.class);
            return am != null && am.canScheduleExactAlarms();
        }, false));
        r.put("ignoringBatteryOptimizations", safe("battery", () -> {
            PowerManager pm = ctx.getSystemService(PowerManager.class);
            return pm != null && pm.isIgnoringBatteryOptimizations(pkg);
        }, false));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Boolean restricted = safe("backgroundRestricted", () -> {
                ActivityManager am = ctx.getSystemService(ActivityManager.class);
                return am != null ? am.isBackgroundRestricted() : null;
            }, null);
            if (restricted != null) r.put("backgroundRestricted", restricted);
            Integer bucket = safe("standbyBucket", () -> {
                UsageStatsManager usm = ctx.getSystemService(UsageStatsManager.class);
                return usm != null ? usm.getAppStandbyBucket() : null;
            }, null);
            if (bucket != null) r.put("standbyBucket", bucket);
        }
        // androidx.core 1.17: false below API 36.
        r.put("promotedAllowed", safe("promoted", () -> NotificationManagerCompat.from(ctx).canPostPromotedNotifications(), false));
        r.put("channels", safe("channels", () -> channels(ctx), new JSArray()));
        r.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
        r.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @NonNull
    private static JSArray channels(Context ctx) {
        JSArray out = new JSArray();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return out;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return out;
        for (NotificationChannel ch : nm.getNotificationChannels()) {
            JSObject o = new JSObject();
            o.put("id", ch.getId());
            o.put("importance", ch.getImportance());
            out.put(o);
        }
        return out;
    }

    /**
     * { target: 'app_notifications'|'channel'|'exact_alarm'|'battery_request'|'battery_list'|
     *   'samsung_never_sleeping'|'promotion'|'app_details', channelId? } → { fallback: boolean }
     */
    @PluginMethod
    public void open(PluginCall call) {
        String target = call.getString("target", "app_details");
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        Intent intent = intentFor(target == null ? "app_details" : target, call.getString("channelId"), pkg);
        JSObject res = new JSObject();
        if (tryStart(intent)) {
            res.put("fallback", false);
            call.resolve(res);
            return;
        }
        if (tryStart(appDetails(pkg))) {
            res.put("fallback", true);
            call.resolve(res);
            return;
        }
        call.reject("No settings screen available for " + target, "UNAVAILABLE");
    }

    // BatteryLife: the direct "allow unrestricted" dialog is a Play-policy concern only; this app is sideloaded.
    @SuppressLint("BatteryLife")
    @NonNull
    private static Intent intentFor(@NonNull String target, @Nullable String channelId, @NonNull String pkg) {
        switch (target) {
            case "app_notifications":
                return appNotifications(pkg);
            case "channel":
                if (channelId == null || channelId.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return appNotifications(pkg);
                return new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
            case "exact_alarm":
                // Below API 31 exact alarms need no grant: the app page is the closest thing.
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return appDetails(pkg);
                return new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri(pkg));
            case "battery_request":
                // System dialog; needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest.
                return new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri(pkg));
            case "battery_list":
                return new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            case "samsung_never_sleeping":
                return new Intent(SAMSUNG_LIST_ACTION).setPackage(SAMSUNG_DEVICE_CARE).putExtra("activity_type", 2);
            case "promotion":
                if (Build.VERSION.SDK_INT < 36) return appNotifications(pkg);
                return new Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            case "app_details":
            default:
                return appDetails(pkg);
        }
    }

    private static Uri packageUri(String pkg) {
        return Uri.parse("package:" + pkg);
    }

    private static Intent appNotifications(String pkg) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return appDetails(pkg);
        return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
    }

    private static Intent appDetails(String pkg) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(pkg));
    }

    /** startActivity that never throws: false when the screen is missing, protected or broken. */
    private boolean tryStart(@NonNull Intent intent) {
        try {
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                getContext().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Logger.warn(TAG, "cannot open " + intent.getAction() + ": " + e);
            return false;
        } catch (RuntimeException e) {
            // Anything else an OEM settings app may throw (bad extras, …) must not crash the app either.
            Logger.warn(TAG, "cannot open " + intent.getAction() + ": " + e);
            return false;
        }
    }
}
