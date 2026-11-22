package bio.mourn.mobile.calls;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Map;
import java.util.UUID;

/** Only opaque call ids, expiry, local intent capabilities and action hints. NEVER credentials. */
final class CallStore {
    private static final String PREFS = "mourn_call_lifecycle";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static synchronized boolean incomingEnabled(Context c) { return prefs(c).getBoolean("incomingEnabled", false); }
    static synchronized boolean enableIncoming(Context c) { return prefs(c).edit().putBoolean("incomingEnabled", true).commit(); }
    // Non-sensitive presentation preferences only; never microphone identifiers.
    static synchronized boolean ringtoneSilent(Context c) { return prefs(c).getBoolean("ringtoneSilent", false); }
    static synchronized boolean vibrate(Context c) { return prefs(c).getBoolean("vibrate", true); }
    static synchronized boolean alertPreferences(Context c, boolean silent, boolean vibrate) {
        return prefs(c).edit().putBoolean("ringtoneSilent", silent).putBoolean("vibrate", vibrate).commit();
    }
    static long expiry(String value) {
        return CallPolicy.expiry(value);
    }
    private static JSONObject read(Context c, String id) {
        try { return new JSONObject(prefs(c).getString("call:" + id, "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }
    static synchronized boolean incoming(Context c, String id, String link, String device, String expires) {
        if (!incomingEnabled(c)) return false;
        long now = System.currentTimeMillis(), until = expiry(expires);
        if (!CallPolicy.validIncoming(id, link, device, until, now)) return false;
        prune(c, now);
        if (prefs(c).contains("call:" + id)) return false;
        long records = prefs(c).getAll().keySet().stream().filter(key -> key.startsWith("call:")).count();
        if (records >= 128) return false; // fail closed rather than evicting live replay tombstones
        if (CallForegroundService.currentId() != null) return false;
        // One ring at a time, matching the server's one-active-call invariant.
        for (Map.Entry<String, ?> entry : prefs(c).getAll().entrySet()) {
            if (entry.getKey().startsWith("call:")) {
                JSONObject old = read(c, entry.getKey().substring(5));
                if (!old.optBoolean("done") && old.optLong("until") > now) return false;
            }
        }
        JSONObject row = new JSONObject();
        try {
            row.put("callId", id).put("linkId", link).put("callerDeviceId", device).put("expiresAt", expires)
                .put("until", until).put("cap", UUID.randomUUID().toString());
        } catch (Exception ignored) { return false; }
        return prefs(c).edit().putString("call:" + id, row.toString()).commit();
    }
    static synchronized boolean active(Context c, String id) {
        if (!CallPolicy.validId(id)) return false;
        JSONObject row = read(c, id);
        try {
            row.put("callId", id).put("cap", UUID.randomUUID().toString()).put("done", false).put("active", true)
                .put("until", System.currentTimeMillis() + 4 * 60 * 60 * 1000L)
                .put("expiresAt", CallPolicy.timestamp(row.optLong("until")));
            return prefs(c).edit().putString("call:" + id, row.toString()).commit();
        } catch (Exception ignored) { return false; }
    }
    static synchronized Uri capability(Context c, String id, String action) {
        return new Uri.Builder().scheme("mourn-call").authority(action).appendPath(id)
            .appendQueryParameter("cap", read(c, id).optString("cap")).build();
    }
    static synchronized String validate(Context c, Intent intent, String action) {
        Uri uri = intent.getData();
        if (uri == null || !"mourn-call".equals(uri.getScheme()) || !action.equals(uri.getHost()) || uri.getPathSegments().size() != 1) return null;
        String id = uri.getPathSegments().get(0);
        if (!CallPolicy.validId(id)) return null;
        JSONObject row = read(c, id);
        String cap = row.optString("cap");
        if (cap.isEmpty() || !cap.equals(uri.getQueryParameter("cap")) || row.optBoolean("done")) return null;
        if (!"expire".equals(action) && row.optLong("until") <= System.currentTimeMillis()) return null;
        if ("expire".equals(action) && row.optLong("until") > System.currentTimeMillis()) return null;
        return id;
    }
    static synchronized long launchExpiry(Context c, String id) { return read(c, id).optLong("until"); }
    static synchronized void finish(Context c, String id) {
        if (!CallPolicy.validId(id)) return;
        JSONObject row = read(c, id);
        try {
            row.put("callId", id).put("done", true).put("cap", "").put("until", System.currentTimeMillis() + 600_000);
            prefs(c).edit().putString("call:" + id, row.toString()).commit();
        } catch (Exception ignored) { }
    }
    static synchronized void enqueue(Context c, String id, String action) {
        JSONObject row = read(c, id), hint = new JSONObject();
        try {
            for (String key : new String[]{"callId", "linkId", "callerDeviceId", "expiresAt"}) {
                if (row.has(key)) hint.put(key, row.get(key));
            }
            hint.put("action", action).put("queuedUntil", Math.min(row.optLong("until"), System.currentTimeMillis() + 60_000));
            prefs(c).edit().putString("action:" + id, hint.toString()).commit();
        } catch (Exception ignored) { return; }
        CallsPlugin.emit("callActionAvailable", new com.getcapacitor.JSObject());
    }
    /** Account/logout boundary. Invalidate capabilities, but retain bounded replay tombstones. */
    static synchronized void reset(Context c) {
        SharedPreferences.Editor edit = prefs(c).edit().putBoolean("incomingEnabled", false);
        for (Map.Entry<String, ?> entry : prefs(c).getAll().entrySet()) {
            if (entry.getKey().startsWith("action:")) edit.remove(entry.getKey());
            if (entry.getKey().startsWith("call:")) {
                String id = entry.getKey().substring(5);
                finish(c, id);
                CallNotification.cancel(c, id);
            }
        }
        edit.commit();
        prune(c, System.currentTimeMillis());
    }
    static synchronized JSONArray drain(Context c) {
        long now = System.currentTimeMillis();
        JSONArray out = new JSONArray();
        SharedPreferences.Editor edit = prefs(c).edit();
        for (Map.Entry<String, ?> entry : prefs(c).getAll().entrySet()) {
            if (!entry.getKey().startsWith("action:")) continue;
            edit.remove(entry.getKey());
            try {
                JSONObject row = new JSONObject(String.valueOf(entry.getValue()));
                boolean launch = "open".equals(row.optString("action")) || "answer".equals(row.optString("action"));
                boolean cancelled = launch && read(c, row.optString("callId")).optBoolean("done");
                if (!cancelled && row.optLong("queuedUntil") > now) { row.remove("queuedUntil"); out.put(row); }
            } catch (Exception ignored) { }
        }
        edit.commit();
        prune(c, now);
        return out;
    }
    private static void prune(Context c, long now) {
        SharedPreferences.Editor edit = prefs(c).edit();
        for (Map.Entry<String, ?> entry : prefs(c).getAll().entrySet()) {
            if (!entry.getKey().startsWith("call:") && !entry.getKey().startsWith("action:")) continue;
            try {
                JSONObject row = new JSONObject(String.valueOf(entry.getValue()));
                if (entry.getKey().startsWith("call:") && row.optBoolean("active") && !row.optBoolean("done")
                    && !row.optString("callId").equals(CallForegroundService.currentId())) {
                    // A dead process must not block all incoming calls for the former 4-hour cap.
                    row.put("done", true).put("cap", "").put("until", now + 600_000);
                    edit.putString(entry.getKey(), row.toString());
                }
                long retention = row.optLong("until") + (row.optBoolean("done") ? 0 : 600_000);
                if (entry.getKey().startsWith("call:") && retention < now) edit.remove(entry.getKey());
                if (entry.getKey().startsWith("action:") && row.optLong("queuedUntil") <= now) edit.remove(entry.getKey());
            } catch (Exception ignored) { edit.remove(entry.getKey()); }
        }
        edit.commit();
    }
}
