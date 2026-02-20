use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

use crate::modules::error::{AppError, log_error};

/// 音频设备类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    /// 麦克风（输入设备）
    Microphone,
    /// 扬声器（输出设备）
    Speaker,
}

/// 音频设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    /// 设备唯一标识符
    pub id: String,
    /// 设备名称
    pub name: String,
    /// 设备类型
    pub device_type: DeviceType,
    /// 是否为默认设备
    pub is_default: bool,
}

/// 玩家状态信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerStatus {
    /// 玩家唯一标识符
    pub player_id: String,
    /// 麦克风是否开启
    pub mic_enabled: bool,
    /// 时间戳
    pub timestamp: DateTime<Utc>,
}

/// WebRTC 信令消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SignalingMessage {
    /// SDP Offer 消息
    Offer {
        from: String,
        sdp: String,
    },
    /// SDP Answer 消息
    Answer {
        from: String,
        sdp: String,
    },
    /// ICE Candidate 消息
    IceCandidate {
        from: String,
        candidate: String,
    },
    /// 玩家加入消息
    PlayerJoined {
        player_id: String,
        player_name: String,
    },
    /// 玩家离开消息
    PlayerLeft {
        player_id: String,
    },
    /// 状态更新消息
    StatusUpdate {
        player_id: String,
        mic_enabled: bool,
    },
    /// 心跳消息
    Heartbeat {
        player_id: String,
        timestamp: i64,
    },
}

/// 语音服务错误类型
#[derive(Debug, thiserror::Error)]
pub enum VoiceError {
    #[error("音频设备未找到")]
    DeviceNotFound,
    
    #[error("初始化失败: {0}")]
    InitializationFailed(String),
    
    #[error("信令失败: {0}")]
    SignalingFailed(String),
    
    #[error("玩家未找到: {0}")]
    PlayerNotFound(String),
    
    #[error("操作失败: {0}")]
    OperationFailed(String),
}

impl From<VoiceError> for AppError {
    fn from(err: VoiceError) -> Self {
        AppError::AudioError(err.to_string())
    }
}

/// 语音服务
/// 
/// 负责管理 WebRTC 语音通信、音频设备、麦克风状态和玩家静音状态
pub struct VoiceService {
    /// 可用的音频设备列表
    audio_devices: Arc<RwLock<Vec<AudioDevice>>>,
    
    /// 当前麦克风是否开启
    mic_enabled: Arc<AtomicBool>,
    
    /// 被静音的玩家集合（玩家ID）
    muted_players: Arc<RwLock<HashSet<String>>>,
    
    /// 全局静音状态
    global_muted: Arc<AtomicBool>,
    
    /// 玩家状态映射（玩家ID -> 状态）
    player_statuses: Arc<RwLock<HashMap<String, PlayerStatus>>>,
    
    /// 信令消息队列
    signaling_queue: Arc<Mutex<Vec<SignalingMessage>>>,
    
    /// 当前选择的麦克风设备ID
    selected_mic_device: Arc<RwLock<Option<String>>>,
    
    /// 当前选择的扬声器设备ID
    selected_speaker_device: Arc<RwLock<Option<String>>>,
}

impl VoiceService {
    /// 创建新的语音服务实例
    /// 
    /// # 返回
    /// * `VoiceService` - 新的语音服务实例
    pub fn new() -> Self {
        log::info!("创建语音服务实例");
        
        Self {
            audio_devices: Arc::new(RwLock::new(Vec::new())),
            mic_enabled: Arc::new(AtomicBool::new(false)),
            muted_players: Arc::new(RwLock::new(HashSet::new())),
            global_muted: Arc::new(AtomicBool::new(false)),
            player_statuses: Arc::new(RwLock::new(HashMap::new())),
            signaling_queue: Arc::new(Mutex::new(Vec::new())),
            selected_mic_device: Arc::new(RwLock::new(None)),
            selected_speaker_device: Arc::new(RwLock::new(None)),
        }
    }
    
    /// 初始化语音服务
    /// 
    /// 枚举可用的音频设备并设置默认设备
    /// 
    /// # 返回
    /// * `Ok(())` - 初始化成功
    /// * `Err(VoiceError)` - 初始化失败
    pub async fn initialize(&self) -> Result<(), VoiceError> {
        log::info!("初始化语音服务");
        
        // 枚举音频设备
        match self.enumerate_audio_devices().await {
            Ok(devices) => {
                log::info!("成功枚举 {} 个音频设备", devices.len());
                
                // 设置默认设备
                self.set_default_devices(&devices).await;
                
                Ok(())
            }
            Err(e) => {
                log_error(&e.into(), "语音服务初始化");
                Err(VoiceError::InitializationFailed(
                    "无法枚举音频设备".to_string()
                ))
            }
        }
    }
    
    /// 枚举可用的音频设备
    /// 
    /// # 返回
    /// * `Ok(Vec<AudioDevice>)` - 音频设备列表
    /// * `Err(VoiceError)` - 枚举失败
    async fn enumerate_audio_devices(&self) -> Result<Vec<AudioDevice>, VoiceError> {
        log::info!("开始枚举音频设备");
        
        // 注意：这里是模拟实现，实际项目中需要使用 cpal 或其他音频库
        // 来真正枚举系统音频设备
        let mut devices = Vec::new();
        
        // 添加默认麦克风设备
        devices.push(AudioDevice {
            id: "default_mic".to_string(),
            name: "默认麦克风".to_string(),
            device_type: DeviceType::Microphone,
            is_default: true,
        });
        
        // 添加默认扬声器设备
        devices.push(AudioDevice {
            id: "default_speaker".to_string(),
            name: "默认扬声器".to_string(),
            device_type: DeviceType::Speaker,
            is_default: true,
        });
        
        // 更新内部设备列表
        let mut audio_devices = self.audio_devices.write().await;
        *audio_devices = devices.clone();
        
        log::info!("音频设备枚举完成，共 {} 个设备", devices.len());
        
        Ok(devices)
    }
    
    /// 设置默认音频设备
    async fn set_default_devices(&self, devices: &[AudioDevice]) {
        // 查找默认麦克风
        if let Some(default_mic) = devices.iter()
            .find(|d| d.device_type == DeviceType::Microphone && d.is_default) {
            let mut selected = self.selected_mic_device.write().await;
            *selected = Some(default_mic.id.clone());
            log::info!("设置默认麦克风: {}", default_mic.name);
        }
        
        // 查找默认扬声器
        if let Some(default_speaker) = devices.iter()
            .find(|d| d.device_type == DeviceType::Speaker && d.is_default) {
            let mut selected = self.selected_speaker_device.write().await;
            *selected = Some(default_speaker.id.clone());
            log::info!("设置默认扬声器: {}", default_speaker.name);
        }
    }
    
    /// 获取可用的音频设备列表
    /// 
    /// # 返回
    /// * `Vec<AudioDevice>` - 音频设备列表
    pub async fn get_audio_devices(&self) -> Vec<AudioDevice> {
        let devices = self.audio_devices.read().await;
        devices.clone()
    }
    
    /// 设置麦克风状态
    /// 
    /// # 参数
    /// * `enabled` - true 表示开启麦克风，false 表示关闭
    /// 
    /// # 返回
    /// * `Ok(bool)` - 新的麦克风状态
    /// * `Err(VoiceError)` - 操作失败
    pub async fn set_mic_enabled(&self, enabled: bool) -> Result<bool, VoiceError> {
        log::info!("设置麦克风状态: {}", if enabled { "开启" } else { "关闭" });
        
        // 检查是否有选择的麦克风设备
        let selected_device = self.selected_mic_device.read().await;
        if selected_device.is_none() {
            log::warn!("未选择麦克风设备");
            return Err(VoiceError::DeviceNotFound);
        }
        
        // 更新麦克风状态
        self.mic_enabled.store(enabled, Ordering::SeqCst);
        
        log::info!("麦克风状态已更新: {}", enabled);
        
        Ok(enabled)
    }
    
    /// 切换麦克风状态
    /// 
    /// # 返回
    /// * `Ok(bool)` - 新的麦克风状态
    /// * `Err(VoiceError)` - 操作失败
    pub async fn toggle_mic(&self) -> Result<bool, VoiceError> {
        let current = self.mic_enabled.load(Ordering::SeqCst);
        self.set_mic_enabled(!current).await
    }
    
    /// 获取当前麦克风状态
    /// 
    /// # 返回
    /// * `bool` - true 表示麦克风开启，false 表示关闭
    pub fn is_mic_enabled(&self) -> bool {
        self.mic_enabled.load(Ordering::SeqCst)
    }
    
    /// 静音或取消静音指定玩家
    /// 
    /// # 参数
    /// * `player_id` - 玩家唯一标识符
    /// * `muted` - true 表示静音，false 表示取消静音
    /// 
    /// # 返回
    /// * `Ok(())` - 操作成功
    /// * `Err(VoiceError)` - 操作失败
    pub async fn mute_player(&self, player_id: &str, muted: bool) -> Result<(), VoiceError> {
        log::info!(
            "{} 玩家: {}",
            if muted { "静音" } else { "取消静音" },
            player_id
        );
        
        let mut muted_players = self.muted_players.write().await;
        
        if muted {
            muted_players.insert(player_id.to_string());
        } else {
            muted_players.remove(player_id);
        }
        
        log::info!("玩家 {} 静音状态已更新: {}", player_id, muted);
        
        Ok(())
    }
    
    /// 检查玩家是否被静音
    /// 
    /// # 参数
    /// * `player_id` - 玩家唯一标识符
    /// 
    /// # 返回
    /// * `bool` - true 表示玩家被静音，false 表示未被静音
    pub async fn is_player_muted(&self, player_id: &str) -> bool {
        let muted_players = self.muted_players.read().await;
        muted_players.contains(player_id)
    }
    
    /// 全局静音或取消静音所有玩家
    /// 
    /// # 参数
    /// * `muted` - true 表示静音所有玩家，false 表示取消静音所有玩家
    /// 
    /// # 返回
    /// * `Ok(())` - 操作成功
    /// * `Err(VoiceError)` - 操作失败
    pub async fn mute_all(&self, muted: bool) -> Result<(), VoiceError> {
        log::info!("全局静音状态: {}", if muted { "开启" } else { "关闭" });
        
        self.global_muted.store(muted, Ordering::SeqCst);
        
        log::info!("全局静音状态已更新: {}", muted);
        
        Ok(())
    }
    
    /// 获取全局静音状态
    /// 
    /// # 返回
    /// * `bool` - true 表示全局静音，false 表示未全局静音
    pub fn is_global_muted(&self) -> bool {
        self.global_muted.load(Ordering::SeqCst)
    }
    
    /// 广播玩家状态更新
    /// 
    /// # 参数
    /// * `status` - 玩家状态信息
    /// 
    /// # 返回
    /// * `Ok(())` - 广播成功
    /// * `Err(VoiceError)` - 广播失败
    pub async fn broadcast_status(&self, status: PlayerStatus) -> Result<(), VoiceError> {
        log::info!("广播玩家状态: {} (麦克风: {})", status.player_id, status.mic_enabled);
        
        // 更新玩家状态
        let mut statuses = self.player_statuses.write().await;
        statuses.insert(status.player_id.clone(), status.clone());
        
        // 创建状态更新信令消息
        let message = SignalingMessage::StatusUpdate {
            player_id: status.player_id.clone(),
            mic_enabled: status.mic_enabled,
        };
        
        // 将消息加入信令队列
        let mut queue = self.signaling_queue.lock().await;
        queue.push(message);
        
        log::info!("状态广播已加入队列");
        
        Ok(())
    }
    
    /// 处理信令消息
    /// 
    /// # 参数
    /// * `message` - 信令消息
    /// 
    /// # 返回
    /// * `Ok(())` - 处理成功
    /// * `Err(VoiceError)` - 处理失败
    pub async fn handle_signaling(&self, message: SignalingMessage) -> Result<(), VoiceError> {
        log::debug!("处理信令消息: {:?}", message);
        
        match &message {
            SignalingMessage::Offer { from, .. } => {
                log::info!("收到来自 {} 的 Offer", from);
            }
            SignalingMessage::Answer { from, .. } => {
                log::info!("收到来自 {} 的 Answer", from);
            }
            SignalingMessage::IceCandidate { from, .. } => {
                log::debug!("收到来自 {} 的 ICE Candidate", from);
            }
            SignalingMessage::PlayerJoined { player_id, player_name } => {
                log::info!("玩家加入: {} ({})", player_name, player_id);
                
                // 初始化玩家状态
                let status = PlayerStatus {
                    player_id: player_id.clone(),
                    mic_enabled: false,
                    timestamp: Utc::now(),
                };
                
                let mut statuses = self.player_statuses.write().await;
                statuses.insert(player_id.clone(), status);
            }
            SignalingMessage::PlayerLeft { player_id } => {
                log::info!("玩家离开: {}", player_id);
                
                // 移除玩家状态
                let mut statuses = self.player_statuses.write().await;
                statuses.remove(player_id);
                
                // 移除静音状态
                let mut muted_players = self.muted_players.write().await;
                muted_players.remove(player_id);
            }
            SignalingMessage::StatusUpdate { player_id, mic_enabled } => {
                log::info!("玩家 {} 状态更新: 麦克风 {}", player_id, mic_enabled);
                
                // 更新玩家状态
                let mut statuses = self.player_statuses.write().await;
                if let Some(status) = statuses.get_mut(player_id) {
                    status.mic_enabled = *mic_enabled;
                    status.timestamp = Utc::now();
                } else {
                    // 如果玩家状态不存在，创建新状态
                    let status = PlayerStatus {
                        player_id: player_id.clone(),
                        mic_enabled: *mic_enabled,
                        timestamp: Utc::now(),
                    };
                    statuses.insert(player_id.clone(), status);
                }
            }
            SignalingMessage::Heartbeat { player_id, timestamp } => {
                log::debug!("收到玩家 {} 的心跳 (时间戳: {})", player_id, timestamp);
                
                // 更新玩家最后活跃时间
                let mut statuses = self.player_statuses.write().await;
                if let Some(status) = statuses.get_mut(player_id) {
                    status.timestamp = Utc::now();
                }
            }
        }
        
        Ok(())
    }
    
    /// 获取信令队列中的所有消息
    /// 
    /// 此方法会清空队列并返回所有消息
    /// 
    /// # 返回
    /// * `Vec<SignalingMessage>` - 信令消息列表
    pub async fn get_signaling_messages(&self) -> Vec<SignalingMessage> {
        let mut queue = self.signaling_queue.lock().await;
        let messages = queue.drain(..).collect();
        messages
    }
    
    /// 获取所有玩家的状态
    /// 
    /// # 返回
    /// * `HashMap<String, PlayerStatus>` - 玩家ID到状态的映射
    pub async fn get_player_statuses(&self) -> HashMap<String, PlayerStatus> {
        let statuses = self.player_statuses.read().await;
        statuses.clone()
    }
    
    /// 获取指定玩家的状态
    /// 
    /// # 参数
    /// * `player_id` - 玩家唯一标识符
    /// 
    /// # 返回
    /// * `Some(PlayerStatus)` - 玩家状态
    /// * `None` - 玩家不存在
    pub async fn get_player_status(&self, player_id: &str) -> Option<PlayerStatus> {
        let statuses = self.player_statuses.read().await;
        statuses.get(player_id).cloned()
    }
    
    /// 移除玩家
    /// 
    /// 清理指定玩家的所有状态信息
    /// 
    /// # 参数
    /// * `player_id` - 玩家唯一标识符
    /// 
    /// # 返回
    /// * `Ok(())` - 移除成功
    /// * `Err(VoiceError)` - 移除失败
    pub async fn remove_player(&self, player_id: &str) -> Result<(), VoiceError> {
        log::info!("移除玩家: {}", player_id);
        
        // 移除玩家状态
        let mut statuses = self.player_statuses.write().await;
        statuses.remove(player_id);
        
        // 移除静音状态
        let mut muted_players = self.muted_players.write().await;
        muted_players.remove(player_id);
        
        log::info!("玩家 {} 已移除", player_id);
        
        Ok(())
    }
    
    /// 清理所有状态
    /// 
    /// 重置语音服务到初始状态，清理所有玩家信息
    /// 
    /// # 返回
    /// * `Ok(())` - 清理成功
    /// * `Err(VoiceError)` - 清理失败
    pub async fn cleanup(&self) -> Result<(), VoiceError> {
        log::info!("清理语音服务状态");
        
        // 关闭麦克风
        self.mic_enabled.store(false, Ordering::SeqCst);
        
        // 清除全局静音
        self.global_muted.store(false, Ordering::SeqCst);
        
        // 清除所有玩家状态
        let mut statuses = self.player_statuses.write().await;
        statuses.clear();
        
        // 清除所有静音状态
        let mut muted_players = self.muted_players.write().await;
        muted_players.clear();
        
        // 清空信令队列
        let mut queue = self.signaling_queue.lock().await;
        queue.clear();
        
        log::info!("语音服务状态已清理");
        
        Ok(())
    }
    
    /// 选择麦克风设备
    /// 
    /// # 参数
    /// * `device_id` - 设备唯一标识符
    /// 
    /// # 返回
    /// * `Ok(())` - 选择成功
    /// * `Err(VoiceError)` - 选择失败（设备不存在）
    pub async fn select_microphone(&self, device_id: &str) -> Result<(), VoiceError> {
        log::info!("选择麦克风设备: {}", device_id);
        
        // 验证设备是否存在
        let devices = self.audio_devices.read().await;
        let device_exists = devices.iter().any(|d| {
            d.id == device_id && d.device_type == DeviceType::Microphone
        });
        
        if !device_exists {
            log::warn!("麦克风设备不存在: {}", device_id);
            return Err(VoiceError::DeviceNotFound);
        }
        
        // 更新选择的设备
        let mut selected = self.selected_mic_device.write().await;
        *selected = Some(device_id.to_string());
        
        log::info!("麦克风设备已选择: {}", device_id);
        
        Ok(())
    }
    
    /// 选择扬声器设备
    /// 
    /// # 参数
    /// * `device_id` - 设备唯一标识符
    /// 
    /// # 返回
    /// * `Ok(())` - 选择成功
    /// * `Err(VoiceError)` - 选择失败（设备不存在）
    pub async fn select_speaker(&self, device_id: &str) -> Result<(), VoiceError> {
        log::info!("选择扬声器设备: {}", device_id);
        
        // 验证设备是否存在
        let devices = self.audio_devices.read().await;
        let device_exists = devices.iter().any(|d| {
            d.id == device_id && d.device_type == DeviceType::Speaker
        });
        
        if !device_exists {
            log::warn!("扬声器设备不存在: {}", device_id);
            return Err(VoiceError::DeviceNotFound);
        }
        
        // 更新选择的设备
        let mut selected = self.selected_speaker_device.write().await;
        *selected = Some(device_id.to_string());
        
        log::info!("扬声器设备已选择: {}", device_id);
        
        Ok(())
    }
    
    /// 获取当前选择的麦克风设备ID
    /// 
    /// # 返回
    /// * `Option<String>` - 设备ID，如果未选择则返回 None
    pub async fn get_selected_microphone(&self) -> Option<String> {
        let selected = self.selected_mic_device.read().await;
        selected.clone()
    }
    
    /// 获取当前选择的扬声器设备ID
    /// 
    /// # 返回
    /// * `Option<String>` - 设备ID，如果未选择则返回 None
    pub async fn get_selected_speaker(&self) -> Option<String> {
        let selected = self.selected_speaker_device.read().await;
        selected.clone()
    }
    
    /// 获取被静音的玩家列表
    /// 
    /// # 返回
    /// * `Vec<String>` - 被静音的玩家ID列表
    pub async fn get_muted_players(&self) -> Vec<String> {
        let muted_players = self.muted_players.read().await;
        muted_players.iter().cloned().collect()
    }
    
    /// 检查是否应该播放指定玩家的音频
    /// 
    /// 考虑全局静音和单个玩家静音状态
    /// 
    /// # 参数
    /// * `player_id` - 玩家唯一标识符
    /// 
    /// # 返回
    /// * `bool` - true 表示应该播放，false 表示不应该播放
    pub async fn should_play_audio(&self, player_id: &str) -> bool {
        // 如果全局静音，不播放任何音频
        if self.is_global_muted() {
            return false;
        }
        
        // 如果玩家被单独静音，不播放该玩家的音频
        if self.is_player_muted(player_id).await {
            return false;
        }
        
        true
    }
    
    /// 发送心跳消息
    /// 
    /// # 参数
    /// * `player_id` - 当前玩家的唯一标识符
    /// 
    /// # 返回
    /// * `Ok(())` - 发送成功
    /// * `Err(VoiceError)` - 发送失败
    pub async fn send_heartbeat(&self, player_id: &str) -> Result<(), VoiceError> {
        log::debug!("发送心跳: {}", player_id);
        
        let message = SignalingMessage::Heartbeat {
            player_id: player_id.to_string(),
            timestamp: Utc::now().timestamp(),
        };
        
        let mut queue = self.signaling_queue.lock().await;
        queue.push(message);
        
        Ok(())
    }
    
    /// 检查玩家心跳超时
    /// 
    /// 返回所有超时的玩家ID列表
    /// 
    /// # 参数
    /// * `timeout_seconds` - 超时时间（秒）
    /// 
    /// # 返回
    /// * `Vec<String>` - 超时的玩家ID列表
    pub async fn check_heartbeat_timeout(&self, timeout_seconds: i64) -> Vec<String> {
        let statuses = self.player_statuses.read().await;
        let now = Utc::now();
        
        let mut timeout_players = Vec::new();
        
        for (player_id, status) in statuses.iter() {
            let elapsed = now.signed_duration_since(status.timestamp);
            if elapsed.num_seconds() > timeout_seconds {
                log::warn!("玩家 {} 心跳超时 ({} 秒)", player_id, elapsed.num_seconds());
                timeout_players.push(player_id.clone());
            }
        }
        
        timeout_players
    }
}

impl Default for VoiceService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_voice_service_creation() {
        let service = VoiceService::new();
        assert!(!service.is_mic_enabled());
        assert!(!service.is_global_muted());
    }
    
    #[tokio::test]
    async fn test_initialize() {
        let service = VoiceService::new();
        let result = service.initialize().await;
        assert!(result.is_ok());
        
        let devices = service.get_audio_devices().await;
        assert!(!devices.is_empty());
    }
    
    #[tokio::test]
    async fn test_mic_toggle() {
        let service = VoiceService::new();
        service.initialize().await.unwrap();
        
        // 初始状态应该是关闭
        assert!(!service.is_mic_enabled());
        
        // 切换到开启
        let result = service.toggle_mic().await;
        assert!(result.is_ok());
        assert!(service.is_mic_enabled());
        
        // 再次切换到关闭
        let result = service.toggle_mic().await;
        assert!(result.is_ok());
        assert!(!service.is_mic_enabled());
    }
    
    #[tokio::test]
    async fn test_set_mic_enabled() {
        let service = VoiceService::new();
        service.initialize().await.unwrap();
        
        let result = service.set_mic_enabled(true).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), true);
        assert!(service.is_mic_enabled());
        
        let result = service.set_mic_enabled(false).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), false);
        assert!(!service.is_mic_enabled());
    }
    
    #[tokio::test]
    async fn test_mute_player() {
        let service = VoiceService::new();
        let player_id = "player_123";
        
        // 初始状态未静音
        assert!(!service.is_player_muted(player_id).await);
        
        // 静音玩家
        let result = service.mute_player(player_id, true).await;
        assert!(result.is_ok());
        assert!(service.is_player_muted(player_id).await);
        
        // 取消静音
        let result = service.mute_player(player_id, false).await;
        assert!(result.is_ok());
        assert!(!service.is_player_muted(player_id).await);
    }
    
    #[tokio::test]
    async fn test_mute_all() {
        let service = VoiceService::new();
        
        // 初始状态未全局静音
        assert!(!service.is_global_muted());
        
        // 开启全局静音
        let result = service.mute_all(true).await;
        assert!(result.is_ok());
        assert!(service.is_global_muted());
        
        // 关闭全局静音
        let result = service.mute_all(false).await;
        assert!(result.is_ok());
        assert!(!service.is_global_muted());
    }
    
    #[tokio::test]
    async fn test_broadcast_status() {
        let service = VoiceService::new();
        
        let status = PlayerStatus {
            player_id: "player_123".to_string(),
            mic_enabled: true,
            timestamp: Utc::now(),
        };
        
        let result = service.broadcast_status(status.clone()).await;
        assert!(result.is_ok());
        
        // 验证状态已保存
        let saved_status = service.get_player_status("player_123").await;
        assert!(saved_status.is_some());
        assert_eq!(saved_status.unwrap().mic_enabled, true);
        
        // 验证信令消息已加入队列
        let messages = service.get_signaling_messages().await;
        assert_eq!(messages.len(), 1);
    }
    
    #[tokio::test]
    async fn test_handle_signaling_player_joined() {
        let service = VoiceService::new();
        
        let message = SignalingMessage::PlayerJoined {
            player_id: "player_123".to_string(),
            player_name: "测试玩家".to_string(),
        };
        
        let result = service.handle_signaling(message).await;
        assert!(result.is_ok());
        
        // 验证玩家状态已创建
        let status = service.get_player_status("player_123").await;
        assert!(status.is_some());
        assert_eq!(status.unwrap().mic_enabled, false);
    }
    
    #[tokio::test]
    async fn test_handle_signaling_player_left() {
        let service = VoiceService::new();
        
        // 先添加玩家
        let join_message = SignalingMessage::PlayerJoined {
            player_id: "player_123".to_string(),
            player_name: "测试玩家".to_string(),
        };
        service.handle_signaling(join_message).await.unwrap();
        
        // 静音该玩家
        service.mute_player("player_123", true).await.unwrap();
        
        // 玩家离开
        let leave_message = SignalingMessage::PlayerLeft {
            player_id: "player_123".to_string(),
        };
        service.handle_signaling(leave_message).await.unwrap();
        
        // 验证玩家状态已移除
        let status = service.get_player_status("player_123").await;
        assert!(status.is_none());
        
        // 验证静音状态已移除
        assert!(!service.is_player_muted("player_123").await);
    }
    
    #[tokio::test]
    async fn test_handle_signaling_status_update() {
        let service = VoiceService::new();
        
        let message = SignalingMessage::StatusUpdate {
            player_id: "player_123".to_string(),
            mic_enabled: true,
        };
        
        let result = service.handle_signaling(message).await;
        assert!(result.is_ok());
        
        // 验证状态已更新
        let status = service.get_player_status("player_123").await;
        assert!(status.is_some());
        assert_eq!(status.unwrap().mic_enabled, true);
    }
    
    #[tokio::test]
    async fn test_remove_player() {
        let service = VoiceService::new();
        
        // 添加玩家
        let message = SignalingMessage::PlayerJoined {
            player_id: "player_123".to_string(),
            player_name: "测试玩家".to_string(),
        };
        service.handle_signaling(message).await.unwrap();
        
        // 静音玩家
        service.mute_player("player_123", true).await.unwrap();
        
        // 移除玩家
        let result = service.remove_player("player_123").await;
        assert!(result.is_ok());
        
        // 验证玩家已移除
        let status = service.get_player_status("player_123").await;
        assert!(status.is_none());
        assert!(!service.is_player_muted("player_123").await);
    }
    
    #[tokio::test]
    async fn test_cleanup() {
        let service = VoiceService::new();
        service.initialize().await.unwrap();
        
        // 设置一些状态
        service.set_mic_enabled(true).await.unwrap();
        service.mute_all(true).await.unwrap();
        
        let message = SignalingMessage::PlayerJoined {
            player_id: "player_123".to_string(),
            player_name: "测试玩家".to_string(),
        };
        service.handle_signaling(message).await.unwrap();
        
        // 清理
        let result = service.cleanup().await;
        assert!(result.is_ok());
        
        // 验证所有状态已重置
        assert!(!service.is_mic_enabled());
        assert!(!service.is_global_muted());
        
        let statuses = service.get_player_statuses().await;
        assert!(statuses.is_empty());
        
        let muted = service.get_muted_players().await;
        assert!(muted.is_empty());
    }
    
    #[tokio::test]
    async fn test_select_microphone() {
        let service = VoiceService::new();
        service.initialize().await.unwrap();
        
        // 选择默认麦克风
        let result = service.select_microphone("default_mic").await;
        assert!(result.is_ok());
        
        let selected = service.get_selected_microphone().await;
        assert_eq!(selected, Some("default_mic".to_string()));
        
        // 选择不存在的设备
        let result = service.select_microphone("non_existent").await;
        assert!(result.is_err());
    }
    
    #[tokio::test]
    async fn test_select_speaker() {
        let service = VoiceService::new();
        service.initialize().await.unwrap();
        
        // 选择默认扬声器
        let result = service.select_speaker("default_speaker").await;
        assert!(result.is_ok());
        
        let selected = service.get_selected_speaker().await;
        assert_eq!(selected, Some("default_speaker".to_string()));
        
        // 选择不存在的设备
        let result = service.select_speaker("non_existent").await;
        assert!(result.is_err());
    }
    
    #[tokio::test]
    async fn test_should_play_audio() {
        let service = VoiceService::new();
        let player_id = "player_123";
        
        // 默认应该播放
        assert!(service.should_play_audio(player_id).await);
        
        // 全局静音后不应该播放
        service.mute_all(true).await.unwrap();
        assert!(!service.should_play_audio(player_id).await);
        
        // 取消全局静音
        service.mute_all(false).await.unwrap();
        assert!(service.should_play_audio(player_id).await);
        
        // 单独静音玩家后不应该播放
        service.mute_player(player_id, true).await.unwrap();
        assert!(!service.should_play_audio(player_id).await);
        
        // 取消单独静音
        service.mute_player(player_id, false).await.unwrap();
        assert!(service.should_play_audio(player_id).await);
    }
    
    #[tokio::test]
    async fn test_send_heartbeat() {
        let service = VoiceService::new();
        let player_id = "player_123";
        
        let result = service.send_heartbeat(player_id).await;
        assert!(result.is_ok());
        
        let messages = service.get_signaling_messages().await;
        assert_eq!(messages.len(), 1);
        
        match &messages[0] {
            SignalingMessage::Heartbeat { player_id: id, .. } => {
                assert_eq!(id, player_id);
            }
            _ => panic!("期望心跳消息"),
        }
    }
    
    #[tokio::test]
    async fn test_check_heartbeat_timeout() {
        let service = VoiceService::new();
        
        // 添加一个玩家
        let message = SignalingMessage::PlayerJoined {
            player_id: "player_123".to_string(),
            player_name: "测试玩家".to_string(),
        };
        service.handle_signaling(message).await.unwrap();
        
        // 立即检查，不应该超时
        let timeout_players = service.check_heartbeat_timeout(30).await;
        assert!(timeout_players.is_empty());
        
        // 等待2秒后检查（使用1秒的超时时间进行测试）
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        let timeout_players = service.check_heartbeat_timeout(1).await;
        assert_eq!(timeout_players.len(), 1);
        assert_eq!(timeout_players[0], "player_123");
    }
    
    #[tokio::test]
    async fn test_get_muted_players() {
        let service = VoiceService::new();
        
        // 静音多个玩家
        service.mute_player("player_1", true).await.unwrap();
        service.mute_player("player_2", true).await.unwrap();
        service.mute_player("player_3", true).await.unwrap();
        
        let muted = service.get_muted_players().await;
        assert_eq!(muted.len(), 3);
        assert!(muted.contains(&"player_1".to_string()));
        assert!(muted.contains(&"player_2".to_string()));
        assert!(muted.contains(&"player_3".to_string()));
        
        // 取消静音一个玩家
        service.mute_player("player_2", false).await.unwrap();
        
        let muted = service.get_muted_players().await;
        assert_eq!(muted.len(), 2);
        assert!(!muted.contains(&"player_2".to_string()));
    }
}
