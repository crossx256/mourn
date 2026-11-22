package bio.mourn.mobile.calls;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import bio.mourn.mobile.MainActivity;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "MournCalls", permissions = {
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
    @Permission(alias = "bluetooth", strings = {Manifest.permission.BLUETOOTH_CONNECT})
})
public final class CallsPlugin extends Plugin {
    private static WeakReference<CallsPlugin> current = new WeakReference<>(null);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static String authorizedId;
    private static long authorizedUntil;
    private PluginCall pendingStart;
    private boolean resumed;
    private final Runnable startTimeout = () -> {
        if (pendingStart == null) return;
        String id = pendingStart.getString("callId");
        pendingStart.reject("Call service did not become ready", "CALL_SERVICE_TIMEOUT");
        pendingStart = null; authorizedId = null;
        CallForegroundService.stop(getContext(), id);
        clearCallWindow();
    };
    @Override public void load() { current = new WeakReference<>(this); }
    public static void emit(String name, JSObject payload) {
        MAIN.post(() -> { CallsPlugin p = current.get(); if (p != null) p.notifyListeners(name, payload); });
    }
    static boolean consumeStartAuthorization(String id) {
        CallsPlugin p = current.get();
        boolean allowed = p != null && p.resumed && id.equals(authorizedId) && SystemClock.elapsedRealtime() <= authorizedUntil;
        authorizedId = null;
        return allowed;
    }
    static void serviceResult(String id, String error) {
        CallsPlugin p = current.get();
        if (p == null || p.pendingStart == null || id == null || !id.equals(p.pendingStart.getString("callId"))) return;
        MAIN.removeCallbacks(p.startTimeout);
        PluginCall call = p.pendingStart; p.pendingStart = null;
        if (error == null) { p.callWindow(true); call.resolve(); }
        else { p.callWindow(false); call.reject("Could not start call lifecycle", error); }
    }
    static void clearCallWindow() { MAIN.post(() -> { CallsPlugin p = current.get(); if (p != null) p.callWindow(false); }); }
    private void callWindow(boolean on) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).setCallWindow(on);
    }
    private boolean trusted(PluginCall call) {
        String url = getBridge().getWebView().getUrl();
        boolean trusted = false;
        try {
            Uri page = Uri.parse(url);
            trusted = CallPolicy.trustedOrigin(page.getScheme() + "://" + page.getEncodedAuthority());
        } catch (Exception ignored) { }
        if (!trusted) call.reject("Calls require the packaged app origin", "UNTRUSTED_ORIGIN");
        return trusted;
    }
    private void ui(PluginCall call, Runnable action) {
        MAIN.post(() -> {
            if (!trusted(call)) return;
            try { action.run(); }
            catch (RuntimeException failure) { call.reject("Native call operation failed", "NATIVE_CALL_FAILED"); }
        });
    }
    private boolean validId(PluginCall call) {
        if (CallPolicy.validId(call.getString("callId"))) return true;
        call.reject("Invalid call id", "INVALID_CALL_ID"); return false;
    }
    @PluginMethod public void requestMicPermission(PluginCall call) {
        ui(call, () -> {
            if (!resumed) { call.reject("Visible activity required", "ACTIVITY_NOT_VISIBLE"); return; }
            if (getPermissionState("microphone") == PermissionState.GRANTED) micResult(call);
            else requestPermissionForAlias("microphone", call, "micResult");
        });
    }
    @PermissionCallback private void micResult(PluginCall call) { call.resolve(new JSObject().put("granted", getPermissionState("microphone") == PermissionState.GRANTED)); }
    @PluginMethod public void requestBluetoothPermission(PluginCall call) {
        ui(call, () -> {
            if (!resumed) { call.reject("Visible activity required", "ACTIVITY_NOT_VISIBLE"); return; }
            if (Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED) bluetoothResult(call);
            else requestPermissionForAlias("bluetooth", call, "bluetoothResult");
        });
    }
    @PermissionCallback private void bluetoothResult(PluginCall call) { call.resolve(new JSObject().put("granted", CallAudioRouter.bluetoothGranted(getContext()))); }
    @PluginMethod public void startCallService(PluginCall call) {
        ui(call, () -> {
            if (!validId(call)) return;
            boolean mic = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            if (!CallPolicy.canStart(resumed, mic, Boolean.TRUE.equals(call.getBoolean("userInitiated", false)))) {
                call.reject("Visible user acceptance and microphone permission required", "CALL_START_NOT_ALLOWED"); return;
            }
            String id = call.getString("callId");
            if (pendingStart != null || (CallForegroundService.currentId() != null && !id.equals(CallForegroundService.currentId()))) {
                call.reject("Another call is starting or active", "CALL_BUSY"); return;
            }
            if (id.equals(CallForegroundService.currentId())) { call.resolve(); return; }
            pendingStart = call; authorizedId = id; authorizedUntil = SystemClock.elapsedRealtime() + 5_000;
            MAIN.postDelayed(startTimeout, 5_000);
            try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), CallForegroundService.class).putExtra("callId", id)); }
            catch (RuntimeException denied) { authorizedId = null; serviceResult(id, "CALL_SERVICE_START_DENIED"); }
        });
    }
    @PluginMethod public void stopCallService(PluginCall call) {
        ui(call, () -> {
            if (!validId(call)) return;
            String id = call.getString("callId");
            if (pendingStart != null && id.equals(pendingStart.getString("callId"))) {
                authorizedId = null; serviceResult(id, "CALL_START_CANCELLED");
            }
            CallForegroundService.stop(getContext(), id);
            CallNotification.cancel(getContext(), id); CallStore.finish(getContext(), id);
            if (CallForegroundService.currentId() == null || id.equals(CallForegroundService.currentId())) callWindow(false);
            call.resolve();
        });
    }
    @PluginMethod public void setAudioRoute(PluginCall call) {
        ui(call, () -> {
            if (!validId(call)) return;
            CallAudioRouter router = CallForegroundService.audio(call.getString("callId"));
            String route = call.getString("route");
            if (router == null) { call.reject("No active call", "NO_ACTIVE_CALL"); return; }
            if (!"earpiece".equals(route) && !"speaker".equals(route) && !"bluetooth".equals(route) && !"wired".equals(route)) {
                call.reject("Invalid route", "INVALID_AUDIO_ROUTE"); return;
            }
            try { router.setRoute(route); call.resolve(); }
            catch (IllegalStateException error) { call.reject("Audio route unavailable", error.getMessage()); }
        });
    }
    @PluginMethod public void setMuted(PluginCall call) {
        ui(call, () -> {
            if (!validId(call)) return;
            CallAudioRouter router = CallForegroundService.audio(call.getString("callId"));
            Boolean muted = call.getBoolean("muted");
            if (router == null) { call.reject("No active call", "NO_ACTIVE_CALL"); return; }
            if (muted == null) { call.reject("muted is required", "INVALID_MUTED"); return; }
            router.setMuted(muted); call.resolve();
        });
    }
    @PluginMethod public void getAudioDevices(PluginCall call) { ui(call, () -> call.resolve(new JSObject().put("devices", CallAudioRouter.available(getContext())))); }
    @PluginMethod public void showIncoming(PluginCall call) {
        ui(call, () -> {
            String id = call.getString("callId");
            boolean stored = CallStore.incoming(getContext(), id, call.getString("linkId"), call.getString("callerDeviceId"), call.getString("expiresAt"));
            boolean shown = stored && CallNotification.incoming(getContext(), id, call.getString("expiresAt"));
            if (stored && !shown) CallStore.finish(getContext(), id);
            call.resolve(new JSObject().put("shown", shown));
        });
    }
    @PluginMethod public void cancelIncoming(PluginCall call) {
        ui(call, () -> {
            if (!validId(call)) return;
            String id = call.getString("callId");
            CallNotification.cancel(getContext(), id);
            if (!id.equals(CallForegroundService.currentId())) {
                CallStore.finish(getContext(), id);
                if (CallForegroundService.currentId() == null) callWindow(false);
            }
            call.resolve();
        });
    }
    @PluginMethod public void getPendingActions(PluginCall call) { ui(call, () -> call.resolve(new JSObject().put("actions", CallStore.drain(getContext())))); }
    @PluginMethod public void resetCallState(PluginCall call) {
        ui(call, () -> {
            resetNativeState();
            call.resolve();
        });
    }
    @PluginMethod public void setIncomingEnabled(PluginCall call) {
        ui(call, () -> {
            Boolean enabled = call.getBoolean("enabled");
            if (enabled == null) { call.reject("enabled is required", "INVALID_ENABLED"); return; }
            if (!enabled) resetNativeState();
            else {
                String ringtone = call.getString("ringtone", "system");
                if (!"system".equals(ringtone) && !"silent".equals(ringtone)) { call.reject("Invalid ringtone", "INVALID_RINGTONE"); return; }
                if (!CallStore.alertPreferences(getContext(), "silent".equals(ringtone), Boolean.TRUE.equals(call.getBoolean("vibrate", true)))
                    || !CallStore.enableIncoming(getContext())) { call.reject("Could not persist call eligibility", "CALL_STATE_UNAVAILABLE"); return; }
            }
            call.resolve();
        });
    }
    private void resetNativeState() {
        authorizedId = null;
        if (pendingStart != null) serviceResult(pendingStart.getString("callId"), "CALL_START_CANCELLED");
        String id = CallForegroundService.currentId();
        if (id != null) CallForegroundService.stop(getContext(), id);
        CallStore.reset(getContext());
        callWindow(false);
    }
    @Override protected void handleOnResume() { resumed = true; }
    @Override protected void handleOnPause() { resumed = false; }
    @Override protected void handleOnDestroy() {
        resumed = false; authorizedId = null;
        MAIN.removeCallbacks(startTimeout);
        if (pendingStart != null) { pendingStart.reject("Activity destroyed", "CALL_START_CANCELLED"); pendingStart = null; }
        String id = CallForegroundService.currentId();
        if (id != null) CallForegroundService.stop(getContext(), id);
        if (current.get() == this) current.clear();
    }
}
