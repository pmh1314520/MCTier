package top.pmh13.mctier.network

import android.media.AudioDeviceInfo

internal object AudioRoutePolicy {
    private val externalPriority = listOf(
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_HEARING_AID,
        AudioDeviceInfo.TYPE_BLE_SPEAKER,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
    )

    fun preferredDeviceType(
        availableTypes: Set<Int>,
        currentType: Int?,
        speakerphoneOn: Boolean,
    ): Int? {
        if (currentType != null && currentType in availableTypes && isExternal(currentType)) {
            return currentType
        }
        externalPriority.firstOrNull(availableTypes::contains)?.let { return it }
        val internalType = if (speakerphoneOn) {
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
        } else {
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
        }
        return internalType.takeIf(availableTypes::contains)
            ?: AudioDeviceInfo.TYPE_BUILTIN_SPEAKER.takeIf(availableTypes::contains)
            ?: AudioDeviceInfo.TYPE_BUILTIN_EARPIECE.takeIf(availableTypes::contains)
    }

    fun isBluetooth(type: Int): Boolean = type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
        type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
        type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
        type == AudioDeviceInfo.TYPE_HEARING_AID ||
        type == AudioDeviceInfo.TYPE_BLE_SPEAKER

    fun isExternal(type: Int): Boolean = type in externalPriority
}
