package bio.mourn.mobile.calls;

import java.net.URI;
import java.util.regex.Pattern;

/** Pure, fail-closed policy shared by FCM, notification intents and WebView capture. */
public final class CallPolicy {
    private CallPolicy() {}
    private static final Pattern UUID = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$");
    public static boolean validId(String id) { return id != null && UUID.matcher(id).matches(); }
    public static boolean validIncoming(String callId, String linkId, String deviceId, long expiry, long now) {
        // The server rings for 60 seconds; FCM TTL is 45 seconds. Never extend a received expiry.
        return validId(callId) && validId(linkId) && validId(deviceId) && expiry > now && expiry - now <= 60_000;
    }
    public static boolean trustedOrigin(String origin) {
        try {
            URI uri = new URI(origin);
            return "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                && (uri.getPath() == null || uri.getPath().isEmpty() || "/".equals(uri.getPath()))
                && uri.getQuery() == null && uri.getFragment() == null;
        } catch (Exception ignored) { return false; }
    }
    private static java.text.SimpleDateFormat dateFormat() {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        format.setLenient(false); format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return format;
    }
    public static long expiry(String value) {
        if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")) return 0;
        try { return dateFormat().parse(value).getTime(); } catch (Exception ignored) { return 0; }
    }
    public static String timestamp(long value) { return dateFormat().format(new java.util.Date(value)); }
    public static boolean repeatRingtone(int sdk, boolean quiet) {
        // Before API 26 an inexact alarm/process timer cannot guarantee a deadline.
        return sdk >= 26 && !quiet;
    }
    public static boolean canStart(boolean visible, boolean microphoneGranted, boolean userInitiated) {
        return visible && microphoneGranted && userInitiated;
    }
}
