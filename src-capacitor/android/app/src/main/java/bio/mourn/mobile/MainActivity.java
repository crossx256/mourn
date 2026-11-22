package bio.mourn.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import bio.mourn.mobile.calls.CallActionReceiver;
import bio.mourn.mobile.calls.CallPolicy;
import bio.mourn.mobile.calls.CallsPlugin;
import java.util.Arrays;

public class MainActivity extends BridgeActivity {
    private final Handler callWindowHandler = new Handler(Looper.getMainLooper());
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(CallsPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Preserve Capacitor's dialogs/file chooser instead of replacing it with a bare client.
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override public void onPermissionRequest(PermissionRequest request) {
                boolean audioOnly = request.getResources().length == 1
                    && Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                boolean permission = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                if (audioOnly && permission && CallPolicy.trustedOrigin(request.getOrigin().toString())) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else request.deny();
            }
        });
        handleCallIntent(getIntent());
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleCallIntent(intent);
    }
    private void handleCallIntent(Intent intent) {
        long until = CallActionReceiver.handleLaunch(this, intent);
        if (until <= System.currentTimeMillis()) return;
        setCallWindow(true);
        callWindowHandler.postDelayed(() -> setCallWindow(false), until - System.currentTimeMillis());
    }
    public void setCallWindow(boolean active) {
        callWindowHandler.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(active);
            setTurnScreenOn(active);
        } else {
            int flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (active) getWindow().addFlags(flags); else getWindow().clearFlags(flags);
        }
    }
    @Override public void onDestroy() {
        callWindowHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
