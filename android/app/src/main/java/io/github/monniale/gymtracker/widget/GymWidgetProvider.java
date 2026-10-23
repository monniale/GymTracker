package io.github.monniale.gymtracker.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.NonNull;
import io.github.monniale.gymtracker.MainActivity;
import io.github.monniale.gymtracker.R;
import io.github.monniale.gymtracker.resttimer.RestTimerController;
import java.text.NumberFormat;

/**
 * Home-screen widget: rank tier, points, streak, this week's sessions vs target and the next
 * workout. It shows what the app last pushed (WidgetPlugin.update), so the numbers refresh while
 * the app runs; a 3-hour `updatePeriodMillis` redraws it so the week count resets on Monday. A tap opens the Workout tab through the same `gt_route`
 * extra as the rest-timer notification (RestTimerPlugin.handleOnNewIntent → JS openRoute).
 */
public class GymWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "gt_widget";
    static final String K_POINTS = "points";
    static final String K_TIER = "tier";
    static final String K_TIER_COLOR = "tierColor";
    static final String K_STREAK = "streakWeeks";
    static final String K_WEEK_DONE = "weekDone";
    static final String K_WEEK_TARGET = "weekTarget";
    static final String K_NEXT = "nextWorkout";
    static final String K_UPDATED_AT = "updatedAt";
    static final String K_WEEK_ENDS_AT = "weekEndsAt";
    static final String K_NEXT_UNTIL = "nextWorkoutUntil";
    static final String K_NEXT_TOMORROW = "nextWorkoutTomorrow";

    /** PendingIntent request code of the widget tap (ROUTEMAP invariant 16). */
    private static final int RC_OPEN = 4301;
    private static final String ROUTE_WORKOUT = "/workout";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            try {
                mgr.updateAppWidget(id, build(ctx));
            } catch (Exception ignored) {
                // never crash the launcher's broadcast
            }
        }
    }

    /** Redraws every placed widget (after WidgetPlugin.update). */
    static void refreshAll(@NonNull Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, GymWidgetProvider.class));
        if (ids.length == 0) return;
        RemoteViews views = build(ctx);
        for (int id : ids) {
            try {
                mgr.updateAppWidget(id, views);
            } catch (Exception ignored) {
                // a stale id from a removed widget
            }
        }
    }

    @NonNull
    static RemoteViews build(@NonNull Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_gym);
        v.setOnClickPendingIntent(R.id.widget_root, openIntent(ctx));
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (p.getLong(K_UPDATED_AT, 0L) == 0L) {
            v.setViewVisibility(R.id.widget_content, View.GONE);
            v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            return v;
        }
        v.setViewVisibility(R.id.widget_content, View.VISIBLE);
        v.setViewVisibility(R.id.widget_empty, View.GONE);
        try {
            int points = p.getInt(K_POINTS, 0);
            int streak = p.getInt(K_STREAK, 0);
            // A new week started since the last push: nothing done yet (the system calls onUpdate
            // every few hours, so this resets without the app running).
            long weekEndsAt = p.getLong(K_WEEK_ENDS_AT, 0L);
            int done = weekEndsAt > 0 && System.currentTimeMillis() >= weekEndsAt ? 0 : p.getInt(K_WEEK_DONE, 0);
            int target = Math.max(1, p.getInt(K_WEEK_TARGET, 3));
            // The day changed since the last push: tomorrow's pick (the weekday schedule moves it).
            long nextUntil = p.getLong(K_NEXT_UNTIL, 0L);
            String next = nextUntil > 0 && System.currentTimeMillis() >= nextUntil
                ? p.getString(K_NEXT_TOMORROW, "")
                : p.getString(K_NEXT, "");

            v.setTextViewText(R.id.widget_tier, p.getString(K_TIER, ""));
            v.setTextColor(R.id.widget_tier, parseColor(p.getString(K_TIER_COLOR, null)));
            v.setTextViewText(R.id.widget_points,
                ctx.getString(R.string.widget_points, NumberFormat.getIntegerInstance().format(points)));
            v.setTextViewText(R.id.widget_streak, streak > 0
                ? ctx.getResources().getQuantityString(R.plurals.widget_streak, streak, streak)
                : ctx.getString(R.string.widget_no_streak));
            v.setTextViewText(R.id.widget_week, ctx.getString(R.string.widget_week, done, target));
            v.setProgressBar(R.id.widget_week_bar, target, Math.min(done, target), false);
            if (next == null || next.isEmpty()) {
                v.setViewVisibility(R.id.widget_next, View.GONE);
            } else {
                v.setViewVisibility(R.id.widget_next, View.VISIBLE);
                v.setTextViewText(R.id.widget_next, ctx.getString(R.string.widget_next, next));
            }
        } catch (Exception ignored) {
            // bad stored values: keep whatever the layout already shows
        }
        return v;
    }

    private static int parseColor(String hex) {
        try {
            return hex == null ? Color.parseColor("#F97316") : Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return Color.parseColor("#F97316");
        }
    }

    private static PendingIntent openIntent(@NonNull Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(RestTimerController.EXTRA_ROUTE, ROUTE_WORKOUT);
        return PendingIntent.getActivity(ctx, RC_OPEN, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
