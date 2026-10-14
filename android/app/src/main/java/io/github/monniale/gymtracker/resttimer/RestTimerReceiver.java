package io.github.monniale.gymtracker.resttimer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Manifest-declared, NOT exported. Reached only through our own explicit, immutable
 * PendingIntents (notification actions, delete intent, exact alarm). Works with the app
 * process dead: Android starts the process, runs onReceive, and the WebView is not involved.
 */
public class RestTimerReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        Context ctx = context.getApplicationContext();
        RestTimerController.ensureChannels(ctx); // the process may have started just for this broadcast

        switch (action) {
            case RestTimerController.ACTION_SKIP: {
                RestTimerController.stop(ctx);
                RestTimerPlugin.emit("actionSkip", RestTimerPlugin.toJs(RestTimerController.getState(ctx)));
                break;
            }
            case RestTimerController.ACTION_EXTEND: {
                long delta = intent.getLongExtra(RestTimerController.EXTRA_DELTA_MS, RestTimerController.EXTEND_STEP_MS);
                RestTimerController.State s = RestTimerController.extend(ctx, delta);
                if (s != null) {
                    RestTimerPlugin.emit("actionExtend", RestTimerPlugin.toJs(s).put("deltaSec", delta / 1000L));
                }
                break;
            }
            case RestTimerController.ACTION_END: {
                // Always emitted when the timer ends (alert posted or not — e.g. app in the foreground).
                if (RestTimerController.onEndAlarm(ctx)) {
                    RestTimerPlugin.emit("timerEnd", RestTimerPlugin.toJs(RestTimerController.getState(ctx)));
                }
                break;
            }
            case RestTimerController.ACTION_DISMISSED: {
                // User swiped the ongoing notification away (allowed since Android 14). Keep the end
                // alarm; do not re-post on our own (Live Updates guidance). JS may re-post on +/-.
                RestTimerPlugin.emit("notificationDismissed", RestTimerPlugin.toJs(RestTimerController.getState(ctx)));
                break;
            }
            default:
                break;
        }
    }
}
