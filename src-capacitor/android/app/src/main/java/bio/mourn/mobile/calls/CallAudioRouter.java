package bio.mourn.mobile.calls;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

/** Owned by the FGS; restores only the audio state this call changed. */
final class CallAudioRouter implements AutoCloseable {
    private final Context context;
    private final AudioManager audio;
    private final String callId;
    private final int previousMode;
    private final boolean previousSpeaker, previousMute, previousSco;
    private final AudioDeviceInfo previousDevice;
    private AudioFocusRequest focusRequest;
    private PowerManager.WakeLock proximity, cpu;
    private boolean started, scoStarted, desiredMuted, closed, hasFocus;
    private String route = "earpiece";
    private final AudioManager.OnAudioFocusChangeListener focus = this::onFocus;
    private void onFocus(int change) {
        String value = change == AudioManager.AUDIOFOCUS_GAIN ? "gain" : change == AudioManager.AUDIOFOCUS_LOSS ? "loss"
            : change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ? "loss-transient" : "duck";
        hasFocus = change == AudioManager.AUDIOFOCUS_GAIN;
        if (!closed) audio.setMicrophoneMute(desiredMuted || !hasFocus);
        CallsPlugin.emit("audioFocusChanged", new JSObject().put("callId", callId).put("focus", value));
        if (change == AudioManager.AUDIOFOCUS_LOSS) CallForegroundService.stop(context, callId);
    }
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { changed(); }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { changed(); }
        private void changed() {
            if (!started || closed) return;
            try { setRoute(route); } catch (IllegalStateException ignored) { try { defaultRoute(); } catch (IllegalStateException unavailable) { /* manager receives device hint */ } }
            CallsPlugin.emit("audioDevicesChanged", new JSObject());
        }
    };
    CallAudioRouter(Context c, String id) {
        context = c; callId = id; audio = c.getSystemService(AudioManager.class);
        previousMode = audio.getMode(); previousSpeaker = audio.isSpeakerphoneOn(); previousMute = audio.isMicrophoneMute();
        previousSco = audio.isBluetoothScoOn();
        previousDevice = Build.VERSION.SDK_INT >= 31 ? audio.getCommunicationDevice() : null;
    }
    void start() {
        if (started) return;
        started = true;
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAcceptsDelayedFocusGain(false).setOnAudioFocusChangeListener(focus).build();
            result = audio.requestAudioFocus(focusRequest);
        } else result = audio.requestAudioFocus(focus, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IllegalStateException("AUDIO_FOCUS_DENIED");
        hasFocus = true;
        PowerManager power = context.getSystemService(PowerManager.class);
        cpu = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mourn:call-audio");
        cpu.setReferenceCounted(false);
        cpu.acquire(4 * 60 * 60 * 1000L);
        audio.setMicrophoneMute(false);
        audio.registerAudioDeviceCallback(devices, new Handler(Looper.getMainLooper()));
        defaultRoute();
    }
    private void defaultRoute() {
        if (find("wired") != null) setRoute("wired");
        else if (bluetoothGranted(context) && find("bluetooth") != null) setRoute("bluetooth");
        else setRoute("earpiece");
    }
    private AudioDeviceInfo find(String requested) {
        AudioDeviceInfo[] list = Build.VERSION.SDK_INT >= 31
            ? audio.getAvailableCommunicationDevices().toArray(new AudioDeviceInfo[0])
            : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        for (AudioDeviceInfo device : list) if (requested.equals(routeOf(device))) return device;
        return null;
    }
    void setRoute(String requested) {
        if ("bluetooth".equals(requested) && !bluetoothGranted(context)) throw new IllegalStateException("BLUETOOTH_PERMISSION_REQUIRED");
        AudioDeviceInfo device = find(requested);
        // Tablets can have no earpiece; explicitly use their speaker instead.
        if (device == null && "earpiece".equals(requested)) { requested = "speaker"; device = find(requested); }
        if (device == null) throw new IllegalStateException("AUDIO_ROUTE_UNAVAILABLE");
        if (Build.VERSION.SDK_INT >= 31) {
            if (!audio.setCommunicationDevice(device)) throw new IllegalStateException("AUDIO_ROUTE_UNAVAILABLE");
        } else {
            boolean bluetooth = "bluetooth".equals(requested);
            if (bluetooth && !scoStarted && !previousSco) { audio.startBluetoothSco(); scoStarted = true; }
            if (!bluetooth && scoStarted) { audio.stopBluetoothSco(); scoStarted = false; }
            audio.setBluetoothScoOn(bluetooth);
            audio.setSpeakerphoneOn("speaker".equals(requested));
        }
        route = requested;
        updateProximity("earpiece".equals(route));
    }
    void setMuted(boolean muted) { desiredMuted = muted; audio.setMicrophoneMute(muted || !hasFocus); }
    private void updateProximity(boolean enabled) {
        PowerManager power = context.getSystemService(PowerManager.class);
        if (proximity == null && power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            proximity = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "mourn:call-proximity");
            proximity.setReferenceCounted(false);
        }
        if (proximity == null) return;
        if (enabled && !proximity.isHeld()) proximity.acquire(4 * 60 * 60 * 1000L);
        else if (!enabled && proximity.isHeld()) proximity.release();
    }
    static boolean bluetoothGranted(Context c) {
        return Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(c, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }
    static String routeOf(AudioDeviceInfo device) {
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "earpiece";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "speaker";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLE_HEADSET: return "bluetooth";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "wired";
            default: return null;
        }
    }
    static JSArray available(Context c) {
        AudioManager a = c.getSystemService(AudioManager.class);
        JSArray result = new JSArray();
        AudioDeviceInfo[] list = Build.VERSION.SDK_INT >= 31 ? a.getAvailableCommunicationDevices().toArray(new AudioDeviceInfo[0]) : a.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        for (AudioDeviceInfo d : list) {
            String route = routeOf(d);
            if (route != null && (!"bluetooth".equals(route) || bluetoothGranted(c))) result.put(new JSObject().put("id", String.valueOf(d.getId())).put("route", route));
        }
        return result;
    }
    @Override public void close() {
        if (closed) return;
        closed = true;
        // Each restoration is independent: unplugging/revoking BT must not prevent focus/lock release.
        try { audio.unregisterAudioDeviceCallback(devices); } catch (RuntimeException ignored) { }
        try { if (proximity != null && proximity.isHeld()) proximity.release(); } catch (RuntimeException ignored) { }
        try { if (cpu != null && cpu.isHeld()) cpu.release(); } catch (RuntimeException ignored) { }
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                audio.clearCommunicationDevice();
                if (previousDevice != null) audio.setCommunicationDevice(previousDevice);
            } else {
                if (scoStarted) audio.stopBluetoothSco();
                audio.setBluetoothScoOn(previousSco);
                audio.setSpeakerphoneOn(previousSpeaker);
            }
        } catch (RuntimeException ignored) { }
        try { audio.setMicrophoneMute(previousMute); } catch (RuntimeException ignored) { }
        try { audio.setMode(previousMode); } catch (RuntimeException ignored) { }
        try {
            if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            else audio.abandonAudioFocus(focus);
        } catch (RuntimeException ignored) { }
    }
}
