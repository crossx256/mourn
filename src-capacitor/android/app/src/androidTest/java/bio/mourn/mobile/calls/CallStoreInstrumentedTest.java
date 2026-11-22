package bio.mourn.mobile.calls;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Android-framework behavior tests. Compile anywhere; execution requires an emulator/device. */
@RunWith(AndroidJUnit4.class)
public final class CallStoreInstrumentedTest {
    private Context context;
    private static final String ID = "0e844e6b-5b75-4f19-b4b4-63d287b8a95b";
    private SharedPreferences prefs() { return context.getSharedPreferences("mourn_call_lifecycle", Context.MODE_PRIVATE); }
    private String expiry() { return CallPolicy.timestamp(System.currentTimeMillis() + 45_000); }
    @Before public void setup() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        prefs().edit().clear().commit();
        assertTrue(CallStore.enableIncoming(context));
    }
    @After public void cleanup() { prefs().edit().clear().commit(); }
    @Test public void incomingRejectsStaleAndDeduplicatesAfterCancel() {
        assertFalse(CallStore.incoming(context, ID, ID, ID, CallPolicy.timestamp(System.currentTimeMillis() - 1)));
        assertTrue(CallStore.incoming(context, ID, ID, ID, expiry()));
        assertFalse(CallStore.incoming(context, ID, ID, ID, expiry()));
        CallStore.finish(context, ID);
        assertFalse(CallStore.incoming(context, ID, ID, ID, expiry()));
    }
    @Test public void launchRequiresAnUnexpiredPrivateCapability() throws Exception {
        assertTrue(CallStore.incoming(context, ID, ID, ID, expiry()));
        Intent answer = new Intent().setData(CallStore.capability(context, ID, "answer"));
        assertEquals(ID, CallStore.validate(context, answer, "answer"));
        assertNull(CallStore.validate(context, answer, "decline"));
        Intent forged = new Intent().setData(answer.getData().buildUpon().clearQuery().appendQueryParameter("cap", "forged").build());
        assertNull(CallStore.validate(context, forged, "answer"));
        JSONObject row = new JSONObject(prefs().getString("call:" + ID, "{}"));
        row.put("until", System.currentTimeMillis() - 1);
        prefs().edit().putString("call:" + ID, row.toString()).commit();
        assertNull(CallStore.validate(context, answer, "answer"));
    }
    @Test public void actionHintsAreAtomicLatestPerCallAndOneShot() throws Exception {
        assertTrue(CallStore.incoming(context, ID, ID, ID, expiry()));
        CallStore.enqueue(context, ID, "open");
        CallStore.enqueue(context, ID, "answer");
        JSONArray actions = CallStore.drain(context);
        assertEquals(1, actions.length());
        assertEquals("answer", actions.getJSONObject(0).getString("action"));
        assertFalse(actions.getJSONObject(0).has("cap"));
        assertEquals(0, CallStore.drain(context).length());
    }
    @Test public void outgoingEndActionsContainNoInventedPeerOrCredentials() throws Exception {
        CallStore.active(context, ID);
        CallStore.enqueue(context, ID, "end");
        JSONObject action = CallStore.drain(context).getJSONObject(0);
        assertEquals(ID, action.getString("callId"));
        assertFalse(action.has("linkId"));
        assertFalse(action.has("callerDeviceId"));
        assertFalse(action.has("token"));
        assertFalse(action.has("cap"));
    }
    @Test public void cancelledLaunchCannotReviveTheOverlay() {
        assertTrue(CallStore.incoming(context, ID, ID, ID, expiry()));
        CallStore.enqueue(context, ID, "answer");
        CallStore.finish(context, ID);
        assertEquals(0, CallStore.drain(context).length());
    }
    @Test public void deadActiveRecordDoesNotBlockTheNextIncomingCall() {
        assertTrue(CallStore.active(context, ID));
        String next = "19cf3d88-1a52-4d84-88b9-4048c40eca10";
        assertTrue(CallStore.incoming(context, next, next, next, expiry()));
    }
    @Test public void metadataIsBoundedWithoutEvictingReplayTombstones() throws Exception {
        for (int i = 0; i < 128; i++) {
            prefs().edit().putString("call:" + i, new JSONObject().put("done", true)
                .put("until", System.currentTimeMillis() + 600_000).toString()).commit();
        }
        assertFalse(CallStore.incoming(context, ID, ID, ID, expiry()));
    }
    @Test public void logoutRevokesEligibilityHintsAndExistingCapabilities() {
        assertTrue(CallStore.incoming(context, ID, ID, ID, expiry()));
        Intent answer = new Intent().setData(CallStore.capability(context, ID, "answer"));
        CallStore.enqueue(context, ID, "answer");
        CallStore.reset(context);
        assertFalse(CallStore.incomingEnabled(context));
        assertNull(CallStore.validate(context, answer, "answer"));
        assertEquals(0, CallStore.drain(context).length());
        String next = "19cf3d88-1a52-4d84-88b9-4048c40eca10";
        assertFalse(CallStore.incoming(context, next, next, next, expiry()));
        assertTrue(CallStore.enableIncoming(context));
        assertFalse(CallStore.incoming(context, ID, ID, ID, expiry()));
        assertTrue(CallStore.incoming(context, next, next, next, expiry()));
        // Pruning JSON metadata must not erase the scalar eligibility preference.
        CallStore.drain(context);
        assertTrue(CallStore.incomingEnabled(context));
    }
}
