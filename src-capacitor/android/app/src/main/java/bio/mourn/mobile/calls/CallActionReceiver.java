package bio.mourn.mobile.calls;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class CallActionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        for (String action : new String[]{"decline", "end", "expire"}) {
            if (!("bio.mourn.mobile.CALL_" + action).equals(intent.getAction())) continue;
            String id = CallStore.validate(context, intent, action);
            if (id == null) return;
            if (!"expire".equals(action)) CallStore.enqueue(context, id, action);
            CallNotification.cancel(context, id);
            CallStore.finish(context, id);
            if ("end".equals(action)) CallForegroundService.stop(context, id);
            if (CallForegroundService.currentId() == null) CallsPlugin.clearCallWindow();
            // No bearer is stored natively. If JS is unavailable, decline is local only.
            return;
        }
    }
    /** Answer is a direct Activity PendingIntent (no Android notification trampoline). */
    public static long handleLaunch(Context context, Intent intent) {
        if (intent == null) return 0;
        for (String action : new String[]{"open", "answer"}) {
            if (!("bio.mourn.mobile.CALL_" + action).equals(intent.getAction())) continue;
            String id = CallStore.validate(context, intent, action);
            if (id == null) return 0;
            CallStore.enqueue(context, id, action);
            if ("answer".equals(action)) CallNotification.cancel(context, id);
            // Never requests microphone or starts a foreground service here.
            long expiry = CallStore.launchExpiry(context, id);
            intent.setAction(null); intent.setData(null);
            return expiry;
        }
        return 0;
    }
}
