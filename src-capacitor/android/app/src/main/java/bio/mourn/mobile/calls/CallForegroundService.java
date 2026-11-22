package bio.mourn.mobile.calls;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import com.getcapacitor.JSObject;

/** Never launched by FCM or Answer receiver. Only the visible, permission-gated plugin starts it. */
public final class CallForegroundService extends Service {
    private static volatile CallForegroundService instance;
    private volatile String callId;
    private CallAudioRouter router;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable maximumDuration = () -> stopSelf();
    static String currentId() { return instance == null ? null : instance.callId; }
    static CallAudioRouter audio(String id) {
        return instance != null && id != null && id.equals(instance.callId) ? instance.router : null;
    }
    static void stop(Context c, String id) {
        if (id != null && id.equals(currentId())) {
            if (instance.router != null) instance.router.close();
            c.stopService(new Intent(c, CallForegroundService.class));
        }
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String id = intent == null ? null : intent.getStringExtra("callId");
        if (!CallPolicy.validId(id) || !CallsPlugin.consumeStartAuthorization(id)) {
            if (callId == null) stopSelf();
            CallsPlugin.serviceResult(id, "START_NOT_AUTHORIZED");
            return START_NOT_STICKY;
        }
        if (callId != null) {
            CallsPlugin.serviceResult(id, callId.equals(id) ? null : "CALL_BUSY");
            return START_NOT_STICKY;
        }
        callId = id; instance = this;
        try {
            if (!CallStore.active(this, id)) throw new IllegalStateException("CALL_STATE_UNAVAILABLE");
            if (Build.VERSION.SDK_INT >= 30) startForeground(CallNotification.ACTIVE_ID, CallNotification.ongoing(this, id), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(CallNotification.ACTIVE_ID, CallNotification.ongoing(this, id));
            router = new CallAudioRouter(this, id);
            router.start();
            CallNotification.cancel(this, id);
            handler.postDelayed(maximumDuration, 4 * 60 * 60 * 1000L);
            CallsPlugin.serviceResult(id, null);
            CallsPlugin.emit("callServiceState", new JSObject().put("callId", id).put("state", "started"));
        } catch (RuntimeException failure) {
            CallsPlugin.serviceResult(id, "CALL_SERVICE_START_FAILED");
            CallsPlugin.emit("callServiceState", new JSObject().put("callId", id).put("state", "error").put("code", "CALL_SERVICE_START_FAILED"));
            stopSelf();
        }
        return START_NOT_STICKY;
    }
    @Override public void onTaskRemoved(Intent rootIntent) { stopSelf(); }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (router != null) router.close();
        if (callId != null) {
            CallStore.finish(this, callId);
            CallsPlugin.emit("callServiceState", new JSObject().put("callId", callId).put("state", "stopped"));
        }
        CallsPlugin.clearCallWindow();
        instance = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
