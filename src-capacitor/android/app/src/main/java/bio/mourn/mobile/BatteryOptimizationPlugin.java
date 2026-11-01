package bio.mourn.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Battery-optimisation exemption.
 *
 * Android demotes an app it has not seen used for a while into the RARE / RESTRICTED
 * standby bucket, and a restricted app receives NO FCM messages at all until it is
 * opened again — which is exactly the "no notifications whatsoever until I open the
 * app" report. Being exempt from battery optimisation keeps the app in a normal
 * bucket so pushes are delivered with the app closed.
 */
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void isExempt(PluginCall call) {
        JSObject result = new JSObject();
        result.put("exempt", isIgnoringBatteryOptimizations());
        call.resolve(result);
    }

    @PluginMethod
    public void requestExemption(PluginCall call) {
        if (isIgnoringBatteryOptimizations()) {
            JSObject result = new JSObject();
            result.put("exempt", true);
            call.resolve(result);
            return;
        }

        // The direct per-app dialog needs the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
        // permission declared in the manifest; if the OEM forbids it, fall back to
        // the list screen so the user can still set it manually.
        JSObject result = new JSObject();
        try {
            Intent direct = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            direct.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(direct);
            result.put("requested", "direct");
        } catch (Exception directFailed) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                result.put("requested", "settings");
            } catch (Exception settingsFailed) {
                call.reject("Unable to open battery optimisation settings", settingsFailed);
                return;
            }
        }
        result.put("exempt", false);
        call.resolve(result);
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return powerManager != null && powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
