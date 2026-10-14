package io.github.monniale.gymtracker.resttimer;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import io.github.monniale.gymtracker.MainActivity;
import io.github.monniale.gymtracker.R;

/**
 * Process-independent rest-timer logic. Everything the notification actions and the
 * end alarm need lives in SharedPreferences, so the BroadcastReceiver works even when
 * the app process was killed and restarted only to handle the broadcast (no WebView,
 * no Bridge, no plugin instance).
 *
 * IDs (ROUTEMAP invariant 16): Android notification ids 4201/4202 and PendingIntent request
 * codes 4211-4215. Never shared with @capacitor/local-notifications (its ids are >= 10,000,000
 * and its content intents use the notification id as request code).
 */
// commit() on purpose: the next broadcast may start a fresh process that must read the new state.
@SuppressLint("ApplySharedPref")
public final class RestTimerController {

    private RestTimerController() {}

    // Channels (ROUTEMAP invariant 17): sound/importance/vibration are immutable after creation ->
    // bump the _vN id to change them.
    public static final String CH_COUNTDOWN = "rest_countdown_v1";
    /** Loud opt-in: alarm volume, rings on silent, plays on the phone speaker. */
    public static final String CH_ALERT = "rest_alert_v1";
    /** Default: discreet, follows the ringer mode, plays in earbuds when connected. */
    public static final String CH_ALERT_QUIET = "rest_alert_quiet_v1";

    public static final String ALERT_MODE_ALARM = "alarm";
    public static final String ALERT_MODE_NOTIFICATION = "notification";

    static final int NOTIF_COUNTDOWN = 4201;
    static final int NOTIF_ALERT = 4202;
    /** App notification group of the "Rest over" alert (see postAlert). */
    static final String GROUP_ALERT = "gt_rest";

    static final String ACTION_SKIP = "io.github.monniale.gymtracker.resttimer.SKIP";
    static final String ACTION_EXTEND = "io.github.monniale.gymtracker.resttimer.EXTEND";
    static final String ACTION_END = "io.github.monniale.gymtracker.resttimer.END";
    static final String ACTION_DISMISSED = "io.github.monniale.gymtracker.resttimer.DISMISSED";
    static final String EXTRA_DELTA_MS = "deltaMs";
    /** Hash route the app opens when a rest notification is tapped (RestTimerPlugin.handleOnNewIntent). */
    static final String EXTRA_ROUTE = "gt_route";
    private static final String ROUTE_SESSION = "/workout/session";

    private static final int RC_SKIP = 4211;
    private static final int RC_EXTEND = 4212;
    private static final int RC_END = 4213;
    private static final int RC_OPEN = 4214;
    private static final int RC_DISMISSED = 4215;

    static final long EXTEND_STEP_MS = 15_000L;

    private static final String PREFS = "rest_timer";
    private static final String K_RUNNING = "running";
    private static final String K_END_AT = "endAt";
    private static final String K_TOTAL_MS = "totalMs";
    private static final String K_TITLE = "title";
    private static final String K_BODY = "body";
    private static final String K_ENDED_AT = "endedAt";
    private static final String K_EXACT = "exact";
    private static final String K_COUNTDOWN = "countdown";
    private static final String K_ALERT = "alert";
    private static final String K_ALERT_MODE = "alertMode";

    /** Immutable snapshot of the persisted state. */
    public static final class State {

        public final boolean running;
        public final long endAt;
        public final long totalMs;
        public final long endedAt;
        public final boolean exact;

        State(boolean running, long endAt, long totalMs, long endedAt, boolean exact) {
            this.running = running;
            this.endAt = endAt;
            this.totalMs = totalMs;
            this.endedAt = endedAt;
            this.exact = exact;
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @NonNull
    public static State getState(@NonNull Context ctx) {
        SharedPreferences p = prefs(ctx);
        return new State(
            p.getBoolean(K_RUNNING, false),
            p.getLong(K_END_AT, 0L),
            p.getLong(K_TOTAL_MS, 0L),
            p.getLong(K_ENDED_AT, 0L),
            p.getBoolean(K_EXACT, true)
        );
    }

    /** Anything but "alarm" is the discreet default. */
    @NonNull
    static String normalizeAlertMode(@Nullable String mode) {
        return ALERT_MODE_ALARM.equals(mode) ? ALERT_MODE_ALARM : ALERT_MODE_NOTIFICATION;
    }

    // ---------------------------------------------------------------- public operations

    /**
     * Start (or restart: idempotent, re-arms and re-posts) a countdown ending at {@code endAt}
     * (epoch millis, wall clock).
     *
     * @param countdown post the ongoing chronometer notification (Live Update request)
     * @param alert     post the "Rest over" notification when the end alarm fires in the background
     * @param alertMode "alarm" (loud channel) or "notification" (discreet channel, the default)
     */
    @NonNull
    public static State start(
        @NonNull Context ctx,
        long endAt,
        long totalMs,
        @Nullable String title,
        @Nullable String body,
        boolean countdown,
        boolean alert,
        @Nullable String alertMode
    ) {
        ensureChannels(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(NOTIF_ALERT);
        prefs(ctx)
            .edit()
            .putBoolean(K_RUNNING, true)
            .putLong(K_END_AT, endAt)
            .putLong(K_TOTAL_MS, Math.max(1_000L, totalMs))
            .putString(K_TITLE, title != null ? title : "Rest")
            .putString(K_BODY, body)
            .putLong(K_ENDED_AT, 0L)
            .putBoolean(K_COUNTDOWN, countdown)
            .putBoolean(K_ALERT, alert)
            .putString(K_ALERT_MODE, normalizeAlertMode(alertMode))
            .commit(); // commit(): the receiver may run in a fresh process right after
        boolean exact = scheduleEndAlarm(ctx, endAt);
        prefs(ctx).edit().putBoolean(K_EXACT, exact).apply();
        if (countdown) {
            postCountdown(ctx);
        } else {
            nm.cancel(NOTIF_COUNTDOWN); // a previous rest may have posted one
        }
        return getState(ctx);
    }

    /** Add (or subtract, if negative) time. Returns null when no timer is running. */
    @Nullable
    public static State extend(@NonNull Context ctx, long deltaMs) {
        State s = getState(ctx);
        if (!s.running) return null;
        long now = System.currentTimeMillis();
        long newEnd = Math.max(now + 1_000L, s.endAt + deltaMs);
        long newTotal = Math.max(5_000L, s.totalMs + deltaMs);
        prefs(ctx).edit().putLong(K_END_AT, newEnd).putLong(K_TOTAL_MS, newTotal).commit();
        boolean exact = scheduleEndAlarm(ctx, newEnd);
        prefs(ctx).edit().putBoolean(K_EXACT, exact).apply();
        postCountdown(ctx);
        return getState(ctx);
    }

    /** Stop without alerting (Skip, or the app moved on). Also clears a pending "rest over" alert. */
    public static void stop(@NonNull Context ctx) {
        prefs(ctx).edit().putBoolean(K_RUNNING, false).commit();
        cancelEndAlarm(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(NOTIF_COUNTDOWN);
        nm.cancel(NOTIF_ALERT);
    }

    /**
     * Called by the exact alarm. Returns true when the timer ended (the caller emits timerEnd),
     * false when the alarm was stale (timer stopped) or early (re-armed).
     *
     * The "Rest over" notification is posted only when the alert is enabled for this rest AND the
     * app is not in the foreground: in the foreground the in-app RestTimerBar beep + haptic handle
     * it, and a heads-up over the app would only be noise.
     */
    static boolean onEndAlarm(@NonNull Context ctx) {
        State s = getState(ctx);
        if (!s.running) return false;
        long now = System.currentTimeMillis();
        if (now < s.endAt - 1_500L) { // fired early (e.g. clock change): re-arm
            scheduleEndAlarm(ctx, s.endAt);
            return false;
        }
        prefs(ctx).edit().putBoolean(K_RUNNING, false).putLong(K_ENDED_AT, now).commit();
        NotificationManagerCompat.from(ctx).cancel(NOTIF_COUNTDOWN);
        if (prefs(ctx).getBoolean(K_ALERT, true) && !RestTimerPlugin.isForeground()) {
            postAlert(ctx);
        }
        return true;
    }

    // ---------------------------------------------------------------- capabilities

    public static boolean canScheduleExact(@NonNull Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    // ---------------------------------------------------------------- notifications

    public static void ensureChannels(@NonNull Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        // Silent, but IMPORTANCE_DEFAULT so it is not filed under "Silent" and stays > IMPORTANCE_MIN
        // (a Live Update promotion requirement).
        NotificationChannel countdown = new NotificationChannel(
            CH_COUNTDOWN,
            "Rest timer (live countdown)",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        countdown.setDescription("Live countdown while you rest between sets");
        countdown.setSound(null, null);
        countdown.enableVibration(false);
        countdown.setShowBadge(false);
        countdown.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(countdown);

        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        // Default: USAGE_NOTIFICATION_EVENT follows the ringer (silent/vibrate) and routes to earbuds.
        NotificationChannel quiet = new NotificationChannel(
            CH_ALERT_QUIET,
            "Rest over — discreet (follows ringer)",
            NotificationManager.IMPORTANCE_HIGH
        );
        quiet.setDescription("Sound and vibration when the rest period ends. Follows the ringer mode; plays in earbuds.");
        quiet.setSound(
            sound,
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        quiet.enableVibration(true);
        quiet.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 700 });
        quiet.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(quiet);

        // Opt-in: USAGE_ALARM plays at alarm volume, even in vibrate/silent ringer mode, on the speaker.
        NotificationChannel loud = new NotificationChannel(
            CH_ALERT,
            "Rest over — loud (alarm volume)",
            NotificationManager.IMPORTANCE_HIGH
        );
        loud.setDescription("Alarm-volume sound when the rest period ends. Rings on silent; plays on the phone speaker.");
        loud.setSound(
            sound,
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        loud.enableVibration(true);
        loud.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 700 });
        loud.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(loud);
    }

    @SuppressWarnings("MissingPermission") // POST_NOTIFICATIONS: the JS bridge only starts the timer when granted
    static void postCountdown(@NonNull Context ctx) {
        State s = getState(ctx);
        if (!s.running) return;
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(K_COUNTDOWN, true)) return;
        String title = p.getString(K_TITLE, "Rest");
        String body = p.getString(K_BODY, null);
        long now = System.currentTimeMillis();

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_COUNTDOWN)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(title) // required for promotion
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_ALARM) // "alarm or timer"; not hidden by DND when alarms are allowed
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true) // required for promotion
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(s.endAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(true) // API 24+
            .setTimeoutAfter(Math.max(1_000L, s.endAt - now + 2_000L)) // safety net if the alarm is late
            .setRequestPromotedOngoing(true) // Android 16 Live Update request (writes android.requestPromotedOngoing)
            .setContentIntent(openAppIntent(ctx))
            .setDeleteIntent(broadcast(ctx, ACTION_DISMISSED, RC_DISMISSED, 0L))
            .addAction(0, "Skip", broadcast(ctx, ACTION_SKIP, RC_SKIP, 0L))
            .addAction(0, "+15 s", broadcast(ctx, ACTION_EXTEND, RC_EXTEND, EXTEND_STEP_MS));
        // Do NOT call setShortCriticalText() while counting: in AOSP SystemUI the text wins over the
        // chronometer in the status-bar chip. Do NOT setColorized(true): it disqualifies promotion.

        NotificationManagerCompat.from(ctx).notify(NOTIF_COUNTDOWN, b.build());
    }

    @SuppressWarnings("MissingPermission")
    private static void postAlert(@NonNull Context ctx) {
        SharedPreferences p = prefs(ctx);
        String channel = ALERT_MODE_ALARM.equals(p.getString(K_ALERT_MODE, ALERT_MODE_NOTIFICATION)) ? CH_ALERT : CH_ALERT_QUIET;
        String body = p.getString(K_BODY, null);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle("Rest over")
            .setContentText(body != null && !body.isEmpty() ? body : "Time for your next set")
            .setCategory(NotificationCompat.CATEGORY_ALARM) // exempt from notification cooldown; DND "alarms"
            .setPriority(NotificationCompat.PRIORITY_HIGH) // pre-O heads-up; O+ uses the channel
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000L)
            // App group, no summary: Android 16 force-groups ungrouped alerting notifications when
            // they are posted and (on its base release) marks them FLAG_SILENT, so "Rest over" next
            // to an unread reminder made no sound. App-grouped ones are re-checked only 3 s later,
            // after the alert. Keep the default GROUP_ALERT_ALL (the child must alert).
            .setGroup(GROUP_ALERT)
            .setContentIntent(openAppIntent(ctx));
        NotificationManagerCompat.from(ctx).notify(NOTIF_ALERT, b.build());
    }

    // ---------------------------------------------------------------- alarm

    /** @return true if an exact alarm was set, false if it fell back to an inexact one. */
    private static boolean scheduleEndAlarm(@NonNull Context ctx, long endAt) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        PendingIntent pi = broadcast(ctx, ACTION_END, RC_END, 0L);
        am.cancel(pi);
        if (canScheduleExact(ctx)) {
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
                return true;
            } catch (SecurityException ignored) {
                // permission revoked between the check and the call: fall through
            }
        }
        // Inexact: may fire up to min(75% of the delay, 10 min) late (AlarmManagerService
        // getMinimumAllowedWindow). The notification's setTimeoutAfter still removes the countdown.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
        return false;
    }

    private static void cancelEndAlarm(@NonNull Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(broadcast(ctx, ACTION_END, RC_END, 0L));
    }

    // ---------------------------------------------------------------- PendingIntents

    /** Explicit intent to our own non-exported receiver; immutable. */
    private static PendingIntent broadcast(@NonNull Context ctx, String action, int requestCode, long deltaMs) {
        Intent i = new Intent(ctx, RestTimerReceiver.class).setAction(action);
        if (deltaMs != 0L) i.putExtra(EXTRA_DELTA_MS, deltaMs);
        return PendingIntent.getBroadcast(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Tap on a rest notification: open the activity directly (no trampoline, Android 12+ rule) on
     * the active session. singleTask -> onNewIntent -> RestTimerPlugin.handleOnNewIntent -> "openRoute".
     */
    private static PendingIntent openAppIntent(@NonNull Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_ROUTE, ROUTE_SESSION);
        return PendingIntent.getActivity(ctx, RC_OPEN, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
