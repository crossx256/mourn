package bio.mourn.mobile.calls;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Inherits Capacitor's token-refresh and ordinary foreground notification handling.
 * Firebase itself still displays ordinary notification messages while backgrounded.
 */
public final class MournMessagingService extends MessagingService {
    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"INCOMING_CALL".equals(data.get("event"))) {
            super.onMessageReceived(message);
            return;
        }
        // Call pushes must be data-only. Never forward them to generic message notifications.
        if (message.getNotification() != null) return;
        String id = data.get("callId"), expires = data.get("expiresAt");
        if (!CallStore.incoming(this, id, data.get("linkId"), data.get("callerDeviceId"), expires)) return;
        CallNotification.incoming(this, id, expires);
        // An already-visible app can still present its call UI when notification permission
        // is denied. This is a reconcile hint, never permission to answer/start the microphone.
        CallStore.enqueue(this, id, "open");
    }
    @Override public void onNewToken(@NonNull String token) {
        // Capacitor forwards registration to the existing authenticated JS push-token flow.
        // On cold start existing PushNotifications.register() obtains Firebase's current token.
        // No credentials are copied into a plaintext native store for a background POST.
        super.onNewToken(token);
    }
}
