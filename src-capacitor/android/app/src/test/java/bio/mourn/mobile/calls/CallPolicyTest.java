package bio.mourn.mobile.calls;

/** Dependency-free regression suite: run with javac/java, also callable from JUnit. */
public final class CallPolicyTest {
    private static final String ID = "0e844e6b-5b75-4f19-b4b4-63d287b8a95b";
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        long now = 1_800_000_000_000L;
        check(CallPolicy.validIncoming(ID, ID, ID, now + 45_000, now));
        check(!CallPolicy.validIncoming(ID, ID, ID, now, now));
        check(!CallPolicy.validIncoming(ID, ID, ID, now + 60_001, now));
        check(!CallPolicy.validIncoming(" " + ID, ID, ID, now + 1, now));
        check(!CallPolicy.validIncoming(ID, "not-an-id", ID, now + 1, now));
        check(CallPolicy.trustedOrigin("https://localhost"));
        check(CallPolicy.trustedOrigin("https://localhost:443/"));
        check(!CallPolicy.trustedOrigin("http://localhost"));
        check(!CallPolicy.trustedOrigin("https://localhost.evil"));
        check(!CallPolicy.trustedOrigin("https://evil@localhost"));
        check(!CallPolicy.trustedOrigin("https://localhost:444"));
        check(!CallPolicy.trustedOrigin("https://mourn.live"));
        check(!CallPolicy.trustedOrigin(null));
        check(CallPolicy.expiry("2027-01-15T08:00:00.000Z") > 0);
        check(CallPolicy.expiry("2027-02-30T08:00:00.000Z") == 0);
        check(CallPolicy.expiry("2027-01-15T08:00:00.000Zgarbage") == 0);
        check(CallPolicy.expiry(null) == 0);
        check(CallPolicy.expiry(CallPolicy.timestamp(now)) == now);
        // A dead API 24/25 process has no native notification timeout; an inexact
        // alarm must never be responsible for stopping an endlessly repeating ring.
        check(!CallPolicy.repeatRingtone(24, false));
        check(!CallPolicy.repeatRingtone(25, false));
        check(CallPolicy.repeatRingtone(26, false));
        check(!CallPolicy.repeatRingtone(36, true));
        check(CallPolicy.canStart(true, true, true));
        check(!CallPolicy.canStart(false, true, true));
        check(!CallPolicy.canStart(true, false, true));
        check(!CallPolicy.canStart(true, true, false));
        System.out.println("CallPolicyTest: all assertions passed");
    }
}
