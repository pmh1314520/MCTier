package top.pmh13.mctier.data

import kotlinx.serialization.json.Json

val MctierJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    explicitNulls = false
}

/**
 * 外发线缆编码器：encodeDefaults = true，确保即使字段等于默认值也会被序列化。
 * 用于 POST 给桌面端的聊天消息——桌面端 message_type 是必填枚举，
 * 若省略（"text" 恰为默认值被 kotlinx 省略）会导致反序列化失败、消息被拒收。
 */
val MctierWireJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}
