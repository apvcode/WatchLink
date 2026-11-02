package link.watch.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {

    @Test
    fun testProtocolCommandSerialization() {
        val json = JSONObject().apply {
            put("type", "watchlink:cmd:play")
            put("timestamp", 123456789L)
        }
        assertEquals("watchlink:cmd:play", json.getString("type"))
        assertEquals(123456789L, json.getLong("timestamp"))
    }

    @Test
    fun testIntentSchemeFormat() {
        val testUri = "wl://join#wl-room-742"
        val prefix = "wl://join#"
        assertTrue(testUri.startsWith(prefix))
        val roomCode = testUri.substring(prefix.length)
        assertEquals("wl-room-742", roomCode)
    }

    @Test
    fun testPeerStateUpdatePayload() {
        val statePayload = JSONObject().apply {
            put("type", "watchlink:state")
            put("playing", true)
            put("position", 42.5)
            put("rate", 1.0)
        }
        assertTrue(statePayload.getBoolean("playing"))
        assertEquals(42.5, statePayload.getDouble("position"), 0.001)
        assertEquals(1.0, statePayload.getDouble("rate"), 0.001)
    }
}
