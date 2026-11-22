package bio.mourn.mobile.calls;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import bio.mourn.mobile.MainActivity;
import bio.mourn.mobile.R;

final class CallNotification {
    static final String RING_CHANNEL = "mourn_calls";
    static final String SOUND_CHANNEL = "mourn_calls_sound";
    static final String VIBRATE_CHANNEL = "mourn_calls_vibrate";
    static final String QUIET_CHANNEL = "mourn_calls_quiet";
    static final String ACTIVE_CHANNEL = "mourn_call_active";
    static final int ACTIVE_ID = 7801;
    static final int INCOMING_ID = 7802;
    private static final String TAG = "mourn-call:";
    static NotificationManager manager(Context c) { return c.getSystemService(NotificationManager.class); }
    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ring = new NotificationChannel(RING_CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ring.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
        ring.enableVibration(true);
        ring.setVibrationPattern(new long[]{0, 600, 400, 600});
        ring.setBypassDnd(false);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel quiet = new NotificationChannel(QUIET_CHANNEL, "Quiet incoming calls", NotificationManager.IMPORTANCE_HIGH);
        quiet.setSound(null, null);
        quiet.enableVibration(false);
        quiet.setBypassDnd(false);
        quiet.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel active = new NotificationChannel(ACTIVE_CHANNEL, "Ongoing calls", NotificationManager.IMPORTANCE_LOW);
        active.setSound(null, null);
        active.enableVibration(false);
        NotificationChannel sound = new NotificationChannel(SOUND_CHANNEL, "Incoming calls (sound only)", NotificationManager.IMPORTANCE_HIGH);
        sound.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
        sound.enableVibration(false);
        sound.setBypassDnd(false);
        sound.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel vibration = new NotificationChannel(VIBRATE_CHANNEL, "Incoming calls (vibration only)", NotificationManager.IMPORTANCE_HIGH);
        vibration.setSound(null, null);
        vibration.enableVibration(true);
        vibration.setVibrationPattern(new long[]{0, 600, 400, 600});
        vibration.setBypassDnd(false);
        vibration.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager(c).createNotificationChannel(sound);
        manager(c).createNotificationChannel(vibration);
        manager(c).createNotificationChannel(ring);
        manager(c).createNotificationChannel(quiet);
        manager(c).createNotificationChannel(active);
    }
    static PendingIntent activity(Context c, String id, String action) {
        Intent intent = new Intent(c, MainActivity.class).setAction("bio.mourn.mobile.CALL_" + action)
            .setData(CallStore.capability(c, id, action)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static PendingIntent receiver(Context c, String id, String action) {
        Intent intent = new Intent(c, CallActionReceiver.class).setAction("bio.mourn.mobile.CALL_" + action)
            .setData(CallStore.capability(c, id, action));
        return PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static boolean incoming(Context c, String id, String expires) {
        channels(c);
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = manager(c);
        if (!nm.areNotificationsEnabled()) return false;
        AudioManager audio = c.getSystemService(AudioManager.class);
        boolean quiet = audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL
            || nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL;
        boolean sound = !quiet && !CallStore.ringtoneSilent(c);
        boolean vibrate = !quiet && CallStore.vibrate(c);
        String channel = sound ? (vibrate ? RING_CHANNEL : SOUND_CHANNEL) : (vibrate ? VIBRATE_CHANNEL : QUIET_CHANNEL);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channel).getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        PendingIntent open = activity(c, id, "open"), answer = activity(c, id, "answer"), decline = receiver(c, id, "decline");
        long remaining = Math.max(1, CallStore.expiry(expires) - System.currentTimeMillis());
        Notification.Builder builder = base(c, channel).setContentTitle("Incoming Mourn call")
            .setContentIntent(open).setCategory(Notification.CATEGORY_CALL).setOngoing(true);
        if (Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(remaining);
        else {
            if (sound) builder.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());
            if (vibrate) builder.setVibrate(new long[]{0, 600, 400, 600});
        }
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setStyle(Notification.CallStyle.forIncomingCall(new Person.Builder().setName("Mourn").setImportant(true).build(), decline, answer));
        } else {
            builder.addAction(new Notification.Action.Builder(null, "Decline", decline).build());
            builder.addAction(new Notification.Action.Builder(null, "Answer", answer).build());
        }
        if (!quiet && (Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent())) builder.setFullScreenIntent(open, true);
        // Only loop when the OS can enforce timeout after process death (API 26+).
        Notification notification = builder.build();
        if (sound && CallPolicy.repeatRingtone(Build.VERSION.SDK_INT, quiet)) notification.flags |= Notification.FLAG_INSISTENT;
        try {
            nm.notify(TAG + id, INCOMING_ID, notification);
            PendingIntent expire = receiver(c, id, "expire");
            c.getSystemService(android.app.AlarmManager.class).setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, CallStore.expiry(expires), expire);
            // API 24/25 lack notification timeout; also cancel promptly while our process lives.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                try { expire.send(); } catch (PendingIntent.CanceledException ignored) { }
            }, remaining);
            return true;
        } catch (SecurityException ignored) { nm.cancel(TAG + id, INCOMING_ID); return false; }
    }
    static Notification ongoing(Context c, String id) {
        channels(c);
        PendingIntent end = receiver(c, id, "end");
        Notification.Builder builder = base(c, ACTIVE_CHANNEL).setContentTitle("Mourn call in progress")
            .setCategory(Notification.CATEGORY_CALL).setOngoing(true).setContentIntent(activity(c, id, "open"));
        if (Build.VERSION.SDK_INT >= 31) builder.setStyle(Notification.CallStyle.forOngoingCall(new Person.Builder().setName("Mourn").build(), end));
        else builder.addAction(new Notification.Action.Builder(null, "End call", end).build());
        return builder.build();
    }
    private static Notification.Builder base(Context c, String channel) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c);
        builder.setSmallIcon(R.drawable.ic_stat_mourn).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion((Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c))
                .setSmallIcon(R.drawable.ic_stat_mourn).setContentTitle("Mourn call").build());
        if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_MAX);
        return builder;
    }
    static void cancel(Context c, String id) { manager(c).cancel(TAG + id, INCOMING_ID); }
}
