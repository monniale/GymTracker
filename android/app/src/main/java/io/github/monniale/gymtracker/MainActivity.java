package io.github.monniale.gymtracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.monniale.gymtracker.devicesettings.DeviceSettingsPlugin;
import io.github.monniale.gymtracker.resttimer.RestTimerPlugin;
import io.github.monniale.gymtracker.widget.WidgetPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered BEFORE super.onCreate (BridgeActivity.onCreate builds the bridge).
        registerPlugin(RestTimerPlugin.class);
        registerPlugin(DeviceSettingsPlugin.class);
        registerPlugin(WidgetPlugin.class);
        super.onCreate(savedInstanceState);
        // ROUTEMAP invariant 13: layouts are validated at 100 % text size, so ignore the One UI font scale.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setTextZoom(100);
        }
    }
}
