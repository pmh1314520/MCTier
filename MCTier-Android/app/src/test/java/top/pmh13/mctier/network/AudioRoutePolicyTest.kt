package top.pmh13.mctier.network

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioRoutePolicyTest {
    @Test fun bluetoothWinsOverDefaultSpeakerRouting() {
        val available = setOf(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        )
        assertEquals(
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioRoutePolicy.preferredDeviceType(available, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, true),
        )
    }

    @Test fun currentExternalDeviceIsPreserved() {
        val available = setOf(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
        )
        assertEquals(
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioRoutePolicy.preferredDeviceType(available, AudioDeviceInfo.TYPE_WIRED_HEADSET, true),
        )
    }

    @Test fun connectedA2dpHeadsetCanTriggerLegacyScoRouting() {
        val available = setOf(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        )
        val target = AudioRoutePolicy.preferredDeviceType(available, null, true)
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, target)
        assertTrue(AudioRoutePolicy.isBluetooth(target!!))
    }

    @Test fun speakerAndEarpieceAreOnlyFallbacks() {
        val available = setOf(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
        )
        assertEquals(
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
            AudioRoutePolicy.preferredDeviceType(available, null, true),
        )
        assertEquals(
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
            AudioRoutePolicy.preferredDeviceType(available, null, false),
        )
        assertTrue(AudioRoutePolicy.isBluetooth(AudioDeviceInfo.TYPE_BLE_HEADSET))
    }
}
