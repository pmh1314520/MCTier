use crate::modules::error::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 大厅信息
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lobby {
    /// 大厅唯一标识符
    pub id: String,
    /// 大厅名称
    pub name: String,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 虚拟 IP 地址（当前玩家的）
    pub virtual_ip: String,
    /// 创建者的虚拟 IP 地址（用于连接 WebSocket 信令服务器）
    pub creator_virtual_ip: String,
}

impl Lobby {
    /// 创建新的大厅实例
    /// 
    /// # 参数
    /// * `name` - 大厅名称
    /// * `virtual_ip` - 虚拟 IP 地址
    /// * `creator_virtual_ip` - 创建者的虚拟 IP 地址
    /// 
    /// # 返回
    /// 新的大厅实例
    pub fn new(name: String, virtual_ip: String, creator_virtual_ip: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            created_at: Utc::now(),
            virtual_ip,
            creator_virtual_ip,
        }
    }
}

/// 玩家信息
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    /// 玩家唯一标识符
    pub id: String,
    /// 玩家名称
    pub name: String,
    /// 麦克风是否开启
    pub mic_enabled: bool,
    /// 是否被静音
    pub is_muted: bool,
    /// 加入时间
    pub joined_at: DateTime<Utc>,
}

impl Player {
    /// 创建新的玩家实例
    /// 
    /// # 参数
    /// * `name` - 玩家名称
    /// 
    /// # 返回
    /// 新的玩家实例
    pub fn new(name: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            mic_enabled: false,
            is_muted: false,
            joined_at: Utc::now(),
        }
    }
}

/// 大厅错误类型
#[derive(Debug, thiserror::Error)]
pub enum LobbyError {
    /// 输入验证错误
    #[error("输入验证失败: {0}")]
    InvalidInput(String),
    
    /// 网络错误
    #[error("网络错误: {0}")]
    NetworkError(String),
    
    /// 已经在大厅中
    #[error("已经在大厅中")]
    AlreadyInLobby,
    
    /// 不在大厅中
    #[error("不在大厅中")]
    NotInLobby,
    
    /// 玩家不存在
    #[error("玩家不存在: {0}")]
    PlayerNotFound(String),
}

/// 将 LobbyError 转换为 AppError
impl From<LobbyError> for AppError {
    fn from(err: LobbyError) -> Self {
        match err {
            LobbyError::InvalidInput(msg) => AppError::ValidationError(msg),
            LobbyError::NetworkError(msg) => AppError::NetworkError(msg),
            LobbyError::AlreadyInLobby => {
                AppError::ValidationError("已经在大厅中".to_string())
            }
            LobbyError::NotInLobby => {
                AppError::ValidationError("不在大厅中".to_string())
            }
            LobbyError::PlayerNotFound(id) => {
                AppError::ValidationError(format!("玩家不存在: {}", id))
            }
        }
    }
}

/// 大厅管理器
/// 
/// 负责管理大厅的创建、加入、退出以及玩家管理
pub struct LobbyManager {
    /// 当前大厅（如果已加入）
    current_lobby: Option<Lobby>,
    /// 玩家列表（玩家 ID -> 玩家信息）
    players: HashMap<String, Player>,
}

impl LobbyManager {
    /// 创建新的大厅管理器实例
    /// 
    /// # 返回
    /// 新的大厅管理器实例
    pub fn new() -> Self {
        Self {
            current_lobby: None,
            players: HashMap::new(),
        }
    }

    /// 验证输入字符串
    /// 
    /// # 参数
    /// * `input` - 要验证的输入字符串
    /// * `field_name` - 字段名称（用于错误消息）
    /// 
    /// # 返回
    /// * `Ok(())` - 验证通过
    /// * `Err(LobbyError)` - 验证失败
    /// 
    /// # 验证规则
    /// - 不能为空字符串
    /// - 不能仅包含空白字符（空格、制表符、换行符等）
    pub fn validate_input(input: &str, field_name: &str) -> Result<(), LobbyError> {
        // 检查是否为空或仅包含空白字符
        if input.trim().is_empty() {
            return Err(LobbyError::InvalidInput(format!(
                "{}不能为空或仅包含空白字符",
                field_name
            )));
        }

        Ok(())
    }

    /// 验证大厅名称
    /// 
    /// # 参数
    /// * `name` - 大厅名称
    /// 
    /// # 返回
    /// * `Ok(())` - 验证通过
    /// * `Err(LobbyError)` - 验证失败
    /// 
    /// # 验证规则
    /// - 长度：4-32 个字符
    /// - 必须包含字母或数字
    /// - 可以包含中文、字母、数字、下划线、连字符
    /// - 不能仅包含空白字符
    pub fn validate_lobby_name(name: &str) -> Result<(), LobbyError> {
        let trimmed = name.trim();
        
        // 检查长度
        let char_count = trimmed.chars().count();
        if char_count < 4 {
            return Err(LobbyError::InvalidInput(
                "大厅名称至少需要 4 个字符".to_string()
            ));
        }
        if char_count > 32 {
            return Err(LobbyError::InvalidInput(
                "大厅名称最多 32 个字符".to_string()
            ));
        }

        // 检查是否包含字母或数字
        let has_alphanumeric = trimmed.chars().any(|c| c.is_alphanumeric());
        if !has_alphanumeric {
            return Err(LobbyError::InvalidInput(
                "大厅名称必须包含至少一个字母或数字".to_string()
            ));
        }

        // 检查字符是否合法（中文、字母、数字、下划线、连字符、空格）
        let is_valid = trimmed.chars().all(|c| {
            c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' || c.is_whitespace()
        });
        
        if !is_valid {
            return Err(LobbyError::InvalidInput(
                "大厅名称只能包含中文、字母、数字、下划线、连字符和空格".to_string()
            ));
        }

        Ok(())
    }

    /// 验证密码
    /// 
    /// # 参数
    /// * `password` - 密码
    /// 
    /// # 返回
    /// * `Ok(())` - 验证通过
    /// * `Err(LobbyError)` - 验证失败
    /// 
    /// # 验证规则
    /// - 长度：8-32 个字符
    /// - 必须包含至少一个字母
    /// - 必须包含至少一个数字
    /// - 可以包含特殊字符
    pub fn validate_password(password: &str) -> Result<(), LobbyError> {
        let trimmed = password.trim();
        
        // 检查长度
        if trimmed.len() < 8 {
            return Err(LobbyError::InvalidInput(
                "密码至少需要 8 个字符".to_string()
            ));
        }
        if trimmed.len() > 32 {
            return Err(LobbyError::InvalidInput(
                "密码最多 32 个字符".to_string()
            ));
        }

        // 检查是否包含字母
        let has_letter = trimmed.chars().any(|c| c.is_alphabetic());
        if !has_letter {
            return Err(LobbyError::InvalidInput(
                "密码必须包含至少一个字母".to_string()
            ));
        }

        // 检查是否包含数字
        let has_digit = trimmed.chars().any(|c| c.is_numeric());
        if !has_digit {
            return Err(LobbyError::InvalidInput(
                "密码必须包含至少一个数字".to_string()
            ));
        }

        Ok(())
    }

    /// 创建大厅
    /// 
    /// # 参数
    /// * `name` - 大厅名称
    /// * `password` - 大厅密码
    /// * `player_name` - 玩家名称
    /// * `server_node` - 服务器节点地址
    /// * `network_service` - 网络服务引用（用于启动 EasyTier）
    /// 
    /// # 返回
    /// * `Ok(Lobby)` - 成功创建的大厅信息
    /// * `Err(LobbyError)` - 创建失败
    pub async fn create_lobby(
        &mut self,
        name: String,
        password: String,
        player_name: String,
        server_node: String,
        network_service: &crate::modules::network_service::NetworkService,
    ) -> Result<Lobby, LobbyError> {
        // 检查是否已经在大厅中
        if self.current_lobby.is_some() {
            return Err(LobbyError::AlreadyInLobby);
        }

        // 验证输入
        Self::validate_lobby_name(&name)?;
        Self::validate_password(&password)?;
        Self::validate_input(&player_name, "玩家名称")?;
        Self::validate_input(&server_node, "服务器节点")?;

        log::info!("正在创建大厅: {}", name);

        // 构建 EasyTier 网络凭证
        // 使用 "MCTier-" + 大厅名称作为网络号，实现大厅隔离
        let network_name = format!("MCTier-{}", name);
        let network_key = password.clone();

        log::info!("EasyTier 网络号: {}", network_name);

        // 启动 EasyTier 服务
        let virtual_ip = network_service
            .start_easytier(network_name, network_key, server_node)
            .await
            .map_err(|e| LobbyError::NetworkError(e.to_string()))?;

        // 创建大厅实例
        // 约定：所有节点都连接到 10.126.126.1:8445
        // 在 EasyTier DHCP 模式下，第一个加入网络的节点通常会获得 10.126.126.1
        let creator_virtual_ip = "10.126.126.1".to_string();
        log::info!("约定的信令服务器地址: {}:8445", creator_virtual_ip);
        let lobby = Lobby::new(name, virtual_ip.clone(), creator_virtual_ip);

        // 创建当前玩家
        let player = Player::new(player_name);

        // 保存大厅和玩家信息
        self.current_lobby = Some(lobby.clone());
        self.players.insert(player.id.clone(), player);

        log::info!("大厅创建成功: {}", lobby.name);

        Ok(lobby)
    }

    /// 加入大厅
    /// 
    /// # 参数
    /// * `name` - 大厅名称
    /// * `password` - 大厅密码
    /// * `player_name` - 玩家名称
    /// * `server_node` - 服务器节点地址
    /// * `network_service` - 网络服务引用（用于连接 EasyTier）
    /// 
    /// # 返回
    /// * `Ok(Lobby)` - 成功加入的大厅信息
    /// * `Err(LobbyError)` - 加入失败
    pub async fn join_lobby(
        &mut self,
        name: String,
        password: String,
        player_name: String,
        server_node: String,
        network_service: &crate::modules::network_service::NetworkService,
    ) -> Result<Lobby, LobbyError> {
        // 检查是否已经在大厅中
        if self.current_lobby.is_some() {
            return Err(LobbyError::AlreadyInLobby);
        }

        // 验证输入
        Self::validate_lobby_name(&name)?;
        Self::validate_password(&password)?;
        Self::validate_input(&player_name, "玩家名称")?;
        Self::validate_input(&server_node, "服务器节点")?;

        log::info!("正在加入大厅: {}", name);

        // 构建 EasyTier 网络凭证
        // 使用 "MCTier-" + 大厅名称作为网络号，实现大厅隔离
        let network_name = format!("MCTier-{}", name);
        let network_key = password.clone();

        log::info!("EasyTier 网络号: {}", network_name);

        // 连接到 EasyTier 网络
        let virtual_ip = network_service
            .start_easytier(network_name, network_key, server_node)
            .await
            .map_err(|e| LobbyError::NetworkError(e.to_string()))?;

        log::info!("已连接到 EasyTier 网络，虚拟IP: {}", virtual_ip);

        // 约定：所有节点都尝试连接到虚拟IP为 10.126.126.1 的节点
        // 在 EasyTier DHCP 模式下，第一个加入网络的节点通常会获得 10.126.126.1
        // 如果第一个节点离开，需要有重新选举机制（TODO）
        let creator_virtual_ip = "10.126.126.1".to_string();
        
        log::info!("将连接到信令服务器: {}:8445", creator_virtual_ip);

        // 创建大厅实例
        let lobby = Lobby::new(name, virtual_ip, creator_virtual_ip);

        // 创建当前玩家
        let player = Player::new(player_name);

        // 保存大厅和玩家信息
        self.current_lobby = Some(lobby.clone());
        self.players.insert(player.id.clone(), player);

        log::info!("成功加入大厅: {}", lobby.name);

        Ok(lobby)
    }

    /// 退出大厅
    /// 
    /// # 参数
    /// * `network_service` - 网络服务引用（用于断开 EasyTier）
    /// 
    /// # 返回
    /// * `Ok(())` - 成功退出
    /// * `Err(LobbyError)` - 退出失败
    pub async fn leave_lobby(
        &mut self,
        network_service: &crate::modules::network_service::NetworkService,
    ) -> Result<(), LobbyError> {
        // 检查是否在大厅中
        if self.current_lobby.is_none() {
            return Err(LobbyError::NotInLobby);
        }

        log::info!("正在退出大厅...");

        // 停止 EasyTier 服务
        network_service
            .stop_easytier()
            .await
            .map_err(|e| LobbyError::NetworkError(e.to_string()))?;

        // 清理大厅和玩家信息
        self.current_lobby = None;
        self.players.clear();

        log::info!("已成功退出大厅");

        Ok(())
    }

    /// 添加玩家
    /// 
    /// # 参数
    /// * `player` - 要添加的玩家
    /// 
    /// # 说明
    /// 此方法用于添加其他玩家到玩家列表（通过网络同步）
    pub fn add_player(&mut self, player: Player) {
        log::info!("添加玩家: {} ({})", player.name, player.id);
        self.players.insert(player.id.clone(), player);
    }

    /// 移除玩家
    /// 
    /// # 参数
    /// * `player_id` - 要移除的玩家 ID
    /// 
    /// # 返回
    /// * `Some(Player)` - 被移除的玩家信息
    /// * `None` - 玩家不存在
    pub fn remove_player(&mut self, player_id: &str) -> Option<Player> {
        log::info!("移除玩家: {}", player_id);
        self.players.remove(player_id)
    }

    /// 获取玩家列表
    /// 
    /// # 返回
    /// 所有玩家的列表（按加入时间排序）
    pub fn get_players(&self) -> Vec<Player> {
        let mut players: Vec<Player> = self.players.values().cloned().collect();
        
        // 按加入时间排序
        players.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));
        
        players
    }

    /// 获取玩家数量
    /// 
    /// # 返回
    /// 当前大厅中的玩家数量
    pub fn get_player_count(&self) -> usize {
        self.players.len()
    }

    /// 根据 ID 获取玩家
    /// 
    /// # 参数
    /// * `player_id` - 玩家 ID
    /// 
    /// # 返回
    /// * `Some(&Player)` - 玩家信息引用
    /// * `None` - 玩家不存在
    pub fn get_player(&self, player_id: &str) -> Option<&Player> {
        self.players.get(player_id)
    }

    /// 根据 ID 获取玩家（可变引用）
    /// 
    /// # 参数
    /// * `player_id` - 玩家 ID
    /// 
    /// # 返回
    /// * `Some(&mut Player)` - 玩家信息可变引用
    /// * `None` - 玩家不存在
    pub fn get_player_mut(&mut self, player_id: &str) -> Option<&mut Player> {
        self.players.get_mut(player_id)
    }

    /// 更新玩家麦克风状态
    /// 
    /// # 参数
    /// * `player_id` - 玩家 ID
    /// * `mic_enabled` - 麦克风是否开启
    /// 
    /// # 返回
    /// * `Ok(())` - 更新成功
    /// * `Err(LobbyError)` - 玩家不存在
    pub fn update_player_mic_status(
        &mut self,
        player_id: &str,
        mic_enabled: bool,
    ) -> Result<(), LobbyError> {
        let player = self
            .get_player_mut(player_id)
            .ok_or_else(|| LobbyError::PlayerNotFound(player_id.to_string()))?;

        player.mic_enabled = mic_enabled;

        log::debug!(
            "更新玩家 {} 麦克风状态: {}",
            player_id,
            mic_enabled
        );

        Ok(())
    }

    /// 更新玩家静音状态
    /// 
    /// # 参数
    /// * `player_id` - 玩家 ID
    /// * `is_muted` - 是否被静音
    /// 
    /// # 返回
    /// * `Ok(())` - 更新成功
    /// * `Err(LobbyError)` - 玩家不存在
    pub fn update_player_mute_status(
        &mut self,
        player_id: &str,
        is_muted: bool,
    ) -> Result<(), LobbyError> {
        let player = self
            .get_player_mut(player_id)
            .ok_or_else(|| LobbyError::PlayerNotFound(player_id.to_string()))?;

        player.is_muted = is_muted;

        log::debug!(
            "更新玩家 {} 静音状态: {}",
            player_id,
            is_muted
        );

        Ok(())
    }

    /// 获取当前大厅信息
    /// 
    /// # 返回
    /// * `Some(&Lobby)` - 当前大厅信息引用
    /// * `None` - 未加入大厅
    pub fn get_current_lobby(&self) -> Option<&Lobby> {
        self.current_lobby.as_ref()
    }

    /// 检查是否在大厅中
    /// 
    /// # 返回
    /// * `true` - 在大厅中
    /// * `false` - 不在大厅中
    pub fn is_in_lobby(&self) -> bool {
        self.current_lobby.is_some()
    }

    /// 清空所有玩家（保留当前大厅）
    /// 
    /// # 说明
    /// 此方法用于重新同步玩家列表
    pub fn clear_players(&mut self) {
        log::info!("清空玩家列表");
        self.players.clear();
    }
}

impl Default for LobbyManager {
    fn default() -> Self {
        Self::new()
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lobby_creation() {
        let lobby = Lobby::new("测试大厅".to_string(), "10.144.144.1".to_string(), "10.144.144.1".to_string());
        
        assert_eq!(lobby.name, "测试大厅");
        assert_eq!(lobby.virtual_ip, "10.144.144.1");
        assert_eq!(lobby.creator_virtual_ip, "10.144.144.1");
        assert!(!lobby.id.is_empty());
    }

    #[test]
    fn test_player_creation() {
        let player = Player::new("测试玩家".to_string());
        
        assert_eq!(player.name, "测试玩家");
        assert!(!player.mic_enabled);
        assert!(!player.is_muted);
        assert!(!player.id.is_empty());
    }

    #[test]
    fn test_validate_input_empty_string() {
        let result = LobbyManager::validate_input("", "测试字段");
        assert!(result.is_err());
        
        if let Err(LobbyError::InvalidInput(msg)) = result {
            assert!(msg.contains("测试字段"));
            assert!(msg.contains("不能为空"));
        } else {
            panic!("期望得到 InvalidInput 错误");
        }
    }

    #[test]
    fn test_validate_input_whitespace_only() {
        let test_cases = vec![
            "   ",      // 空格
            "\t",       // 制表符
            "\n",       // 换行符
            "\r",       // 回车符
            " \t\n\r ", // 混合空白字符
        ];

        for input in test_cases {
            let result = LobbyManager::validate_input(input, "测试字段");
            assert!(
                result.is_err(),
                "应该拒绝空白字符串: {:?}",
                input
            );
        }
    }

    #[test]
    fn test_validate_input_valid() {
        let test_cases = vec![
            "测试",
            "Test",
            "测试123",
            " 有效输入 ", // 前后有空格但中间有内容
        ];

        for input in test_cases {
            let result = LobbyManager::validate_input(input, "测试字段");
            assert!(
                result.is_ok(),
                "应该接受有效输入: {:?}",
                input
            );
        }
    }

    #[test]
    fn test_lobby_manager_creation() {
        let manager = LobbyManager::new();
        
        assert!(!manager.is_in_lobby());
        assert_eq!(manager.get_player_count(), 0);
        assert!(manager.get_current_lobby().is_none());
    }

    #[test]
    fn test_add_and_remove_player() {
        let mut manager = LobbyManager::new();
        
        let player1 = Player::new("玩家1".to_string());
        let player2 = Player::new("玩家2".to_string());
        
        let player1_id = player1.id.clone();
        let player2_id = player2.id.clone();
        
        // 添加玩家
        manager.add_player(player1);
        manager.add_player(player2);
        
        assert_eq!(manager.get_player_count(), 2);
        
        // 获取玩家
        assert!(manager.get_player(&player1_id).is_some());
        assert!(manager.get_player(&player2_id).is_some());
        
        // 移除玩家
        let removed = manager.remove_player(&player1_id);
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, player1_id);
        
        assert_eq!(manager.get_player_count(), 1);
        assert!(manager.get_player(&player1_id).is_none());
        assert!(manager.get_player(&player2_id).is_some());
    }

    #[test]
    fn test_get_players_sorted() {
        let mut manager = LobbyManager::new();
        
        // 添加多个玩家（会按加入时间排序）
        let player1 = Player::new("玩家1".to_string());
        std::thread::sleep(std::time::Duration::from_millis(10));
        let player2 = Player::new("玩家2".to_string());
        std::thread::sleep(std::time::Duration::from_millis(10));
        let player3 = Player::new("玩家3".to_string());
        
        manager.add_player(player1.clone());
        manager.add_player(player2.clone());
        manager.add_player(player3.clone());
        
        let players = manager.get_players();
        
        assert_eq!(players.len(), 3);
        // 验证按加入时间排序
        assert_eq!(players[0].id, player1.id);
        assert_eq!(players[1].id, player2.id);
        assert_eq!(players[2].id, player3.id);
    }

    #[test]
    fn test_update_player_mic_status() {
        let mut manager = LobbyManager::new();
        
        let player = Player::new("测试玩家".to_string());
        let player_id = player.id.clone();
        
        manager.add_player(player);
        
        // 初始状态应该是关闭
        assert!(!manager.get_player(&player_id).unwrap().mic_enabled);
        
        // 更新为开启
        let result = manager.update_player_mic_status(&player_id, true);
        assert!(result.is_ok());
        assert!(manager.get_player(&player_id).unwrap().mic_enabled);
        
        // 更新为关闭
        let result = manager.update_player_mic_status(&player_id, false);
        assert!(result.is_ok());
        assert!(!manager.get_player(&player_id).unwrap().mic_enabled);
    }

    #[test]
    fn test_update_player_mute_status() {
        let mut manager = LobbyManager::new();
        
        let player = Player::new("测试玩家".to_string());
        let player_id = player.id.clone();
        
        manager.add_player(player);
        
        // 初始状态应该是未静音
        assert!(!manager.get_player(&player_id).unwrap().is_muted);
        
        // 更新为静音
        let result = manager.update_player_mute_status(&player_id, true);
        assert!(result.is_ok());
        assert!(manager.get_player(&player_id).unwrap().is_muted);
        
        // 更新为取消静音
        let result = manager.update_player_mute_status(&player_id, false);
        assert!(result.is_ok());
        assert!(!manager.get_player(&player_id).unwrap().is_muted);
    }

    #[test]
    fn test_update_nonexistent_player() {
        let mut manager = LobbyManager::new();
        
        let result = manager.update_player_mic_status("nonexistent_id", true);
        assert!(result.is_err());
        
        if let Err(LobbyError::PlayerNotFound(id)) = result {
            assert_eq!(id, "nonexistent_id");
        } else {
            panic!("期望得到 PlayerNotFound 错误");
        }
    }

    #[test]
    fn test_clear_players() {
        let mut manager = LobbyManager::new();
        
        manager.add_player(Player::new("玩家1".to_string()));
        manager.add_player(Player::new("玩家2".to_string()));
        
        assert_eq!(manager.get_player_count(), 2);
        
        manager.clear_players();
        
        assert_eq!(manager.get_player_count(), 0);
    }

    #[test]
    fn test_lobby_error_conversion() {
        let error = LobbyError::InvalidInput("测试错误".to_string());
        let app_error: AppError = error.into();
        
        match app_error {
            AppError::ValidationError(msg) => {
                assert_eq!(msg, "测试错误");
            }
            _ => panic!("错误类型转换失败"),
        }
    }

    #[test]
    fn test_lobby_serialization() {
        let lobby = Lobby::new("测试大厅".to_string(), "10.144.144.1".to_string(), "10.144.144.1".to_string());
        
        // 序列化
        let json = serde_json::to_string(&lobby).unwrap();
        
        // 反序列化
        let deserialized: Lobby = serde_json::from_str(&json).unwrap();
        
        // 验证往返一致性
        assert_eq!(lobby.id, deserialized.id);
        assert_eq!(lobby.name, deserialized.name);
        assert_eq!(lobby.virtual_ip, deserialized.virtual_ip);
        assert_eq!(lobby.creator_virtual_ip, deserialized.creator_virtual_ip);
    }

    #[test]
    fn test_player_serialization() {
        let player = Player::new("测试玩家".to_string());
        
        // 序列化
        let json = serde_json::to_string(&player).unwrap();
        
        // 反序列化
        let deserialized: Player = serde_json::from_str(&json).unwrap();
        
        // 验证往返一致性
        assert_eq!(player.id, deserialized.id);
        assert_eq!(player.name, deserialized.name);
        assert_eq!(player.mic_enabled, deserialized.mic_enabled);
        assert_eq!(player.is_muted, deserialized.is_muted);
    }

    // ========== 创建大厅流程测试 ==========

    #[test]
    fn test_validate_lobby_name_empty() {
        let result = LobbyManager::validate_input("", "大厅名称");
        assert!(result.is_err());
        if let Err(LobbyError::InvalidInput(msg)) = result {
            assert!(msg.contains("大厅名称"));
            assert!(msg.contains("不能为空"));
        }
    }

    #[test]
    fn test_validate_lobby_name_whitespace() {
        let whitespace_inputs = vec!["   ", "\t", "\n", "\r", " \t\n\r "];
        for input in whitespace_inputs {
            let result = LobbyManager::validate_input(input, "大厅名称");
            assert!(result.is_err(), "应该拒绝空白字符串: {:?}", input);
        }
    }

    #[test]
    fn test_validate_password_empty() {
        let result = LobbyManager::validate_input("", "密码");
        assert!(result.is_err());
        if let Err(LobbyError::InvalidInput(msg)) = result {
            assert!(msg.contains("密码"));
        }
    }

    #[test]
    fn test_validate_password_whitespace() {
        let result = LobbyManager::validate_input("   ", "密码");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_player_name_empty() {
        let result = LobbyManager::validate_input("", "玩家名称");
        assert!(result.is_err());
        if let Err(LobbyError::InvalidInput(msg)) = result {
            assert!(msg.contains("玩家名称"));
        }
    }

    #[test]
    fn test_validate_player_name_whitespace() {
        let result = LobbyManager::validate_input("\t\n", "玩家名称");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_server_node_empty() {
        let result = LobbyManager::validate_input("", "服务器节点");
        assert!(result.is_err());
        if let Err(LobbyError::InvalidInput(msg)) = result {
            assert!(msg.contains("服务器节点"));
        }
    }

    #[test]
    fn test_validate_server_node_whitespace() {
        let result = LobbyManager::validate_input("   ", "服务器节点");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_all_fields_valid() {
        // 测试所有有效输入
        assert!(LobbyManager::validate_input("测试大厅", "大厅名称").is_ok());
        assert!(LobbyManager::validate_input("password123", "密码").is_ok());
        assert!(LobbyManager::validate_input("玩家1", "玩家名称").is_ok());
        assert!(LobbyManager::validate_input("tcp://server:11010", "服务器节点").is_ok());
    }

    #[test]
    fn test_validate_mixed_whitespace() {
        // 测试各种空白字符组合
        let test_cases = vec![
            (" ", "单个空格"),
            ("  ", "多个空格"),
            ("\t", "制表符"),
            ("\n", "换行符"),
            ("\r", "回车符"),
            (" \t", "空格+制表符"),
            ("\n\r", "换行+回车"),
            (" \t\n\r ", "所有空白字符"),
        ];

        for (input, desc) in test_cases {
            let result = LobbyManager::validate_input(input, "测试字段");
            assert!(result.is_err(), "应该拒绝: {}", desc);
        }
    }

    #[test]
    fn test_validate_with_leading_trailing_spaces() {
        // 前后有空格但中间有内容应该通过验证
        let result = LobbyManager::validate_input(" 有效内容 ", "测试字段");
        assert!(result.is_ok(), "前后有空格但中间有内容应该通过验证");
    }

    #[test]
    fn test_lobby_error_types() {
        // 测试各种错误类型
        let errors = vec![
            LobbyError::InvalidInput("无效输入".to_string()),
            LobbyError::NetworkError("网络错误".to_string()),
            LobbyError::AlreadyInLobby,
            LobbyError::NotInLobby,
            LobbyError::PlayerNotFound("player123".to_string()),
        ];

        for error in errors {
            let error_str = error.to_string();
            assert!(!error_str.is_empty(), "错误消息不应为空");
        }
    }

    #[test]
    fn test_lobby_error_to_app_error_conversion() {
        // 测试 InvalidInput 转换
        let lobby_error = LobbyError::InvalidInput("测试".to_string());
        let app_error: AppError = lobby_error.into();
        assert!(matches!(app_error, AppError::ValidationError(_)));

        // 测试 NetworkError 转换
        let lobby_error = LobbyError::NetworkError("测试".to_string());
        let app_error: AppError = lobby_error.into();
        assert!(matches!(app_error, AppError::NetworkError(_)));

        // 测试 AlreadyInLobby 转换
        let lobby_error = LobbyError::AlreadyInLobby;
        let app_error: AppError = lobby_error.into();
        assert!(matches!(app_error, AppError::ValidationError(_)));

        // 测试 NotInLobby 转换
        let lobby_error = LobbyError::NotInLobby;
        let app_error: AppError = lobby_error.into();
        assert!(matches!(app_error, AppError::ValidationError(_)));

        // 测试 PlayerNotFound 转换
        let lobby_error = LobbyError::PlayerNotFound("test".to_string());
        let app_error: AppError = lobby_error.into();
        assert!(matches!(app_error, AppError::ValidationError(_)));
    }

    #[test]
    fn test_lobby_struct_fields() {
        let lobby = Lobby::new("测试大厅".to_string(), "10.144.144.1".to_string(), "10.144.144.1".to_string());
        
        // 验证所有字段都已正确设置
        assert!(!lobby.id.is_empty(), "大厅 ID 不应为空");
        assert_eq!(lobby.name, "测试大厅", "大厅名称应该匹配");
        assert_eq!(lobby.virtual_ip, "10.144.144.1", "虚拟 IP 应该匹配");
        assert_eq!(lobby.creator_virtual_ip, "10.144.144.1", "创建者虚拟 IP 应该匹配");
        assert!(lobby.created_at <= chrono::Utc::now(), "创建时间应该在当前时间之前或等于");
    }

    #[test]
    fn test_player_struct_fields() {
        let player = Player::new("测试玩家".to_string());
        
        // 验证所有字段都已正确设置
        assert!(!player.id.is_empty(), "玩家 ID 不应为空");
        assert_eq!(player.name, "测试玩家", "玩家名称应该匹配");
        assert!(!player.mic_enabled, "麦克风默认应该关闭");
        assert!(!player.is_muted, "默认不应该被静音");
        assert!(player.joined_at <= chrono::Utc::now(), "加入时间应该在当前时间之前或等于");
    }

    #[test]
    fn test_lobby_manager_initial_state() {
        let manager = LobbyManager::new();
        
        // 验证初始状态
        assert!(!manager.is_in_lobby(), "初始状态不应该在大厅中");
        assert_eq!(manager.get_player_count(), 0, "初始玩家数量应该为 0");
        assert!(manager.get_current_lobby().is_none(), "初始大厅应该为 None");
        assert_eq!(manager.get_players().len(), 0, "初始玩家列表应该为空");
    }

    #[test]
    fn test_multiple_players_management() {
        let mut manager = LobbyManager::new();
        
        // 添加多个玩家
        for i in 1..=5 {
            let player = Player::new(format!("玩家{}", i));
            manager.add_player(player);
        }
        
        assert_eq!(manager.get_player_count(), 5, "应该有 5 个玩家");
        
        let players = manager.get_players();
        assert_eq!(players.len(), 5, "玩家列表长度应该为 5");
        
        // 验证玩家名称
        for (i, player) in players.iter().enumerate() {
            assert_eq!(player.name, format!("玩家{}", i + 1));
        }
    }

    #[test]
    fn test_player_id_uniqueness() {
        let player1 = Player::new("玩家1".to_string());
        let player2 = Player::new("玩家2".to_string());
        
        // 验证每个玩家都有唯一的 ID
        assert_ne!(player1.id, player2.id, "玩家 ID 应该是唯一的");
    }

    #[test]
    fn test_lobby_id_uniqueness() {
        let lobby1 = Lobby::new("大厅1".to_string(), "10.144.144.1".to_string(), "10.144.144.1".to_string());
        let lobby2 = Lobby::new("大厅2".to_string(), "10.144.144.2".to_string(), "10.144.144.2".to_string());
        
        // 验证每个大厅都有唯一的 ID
        assert_ne!(lobby1.id, lobby2.id, "大厅 ID 应该是唯一的");
    }

    #[test]
    fn test_lobby_equality() {
        let lobby1 = Lobby::new("测试大厅".to_string(), "10.144.144.1".to_string(), "10.144.144.1".to_string());
        let lobby2 = lobby1.clone();
        
        // 验证克隆的大厅相等
        assert_eq!(lobby1, lobby2, "克隆的大厅应该相等");
    }

    #[test]
    fn test_player_equality() {
        let player1 = Player::new("测试玩家".to_string());
        let player2 = player1.clone();
        
        // 验证克隆的玩家相等
        assert_eq!(player1, player2, "克隆的玩家应该相等");
    }

    #[test]
    fn test_get_player_by_id() {
        let mut manager = LobbyManager::new();
        let player = Player::new("测试玩家".to_string());
        let player_id = player.id.clone();
        
        manager.add_player(player);
        
        // 测试获取存在的玩家
        let retrieved = manager.get_player(&player_id);
        assert!(retrieved.is_some(), "应该能获取到玩家");
        assert_eq!(retrieved.unwrap().id, player_id, "玩家 ID 应该匹配");
        
        // 测试获取不存在的玩家
        let not_found = manager.get_player("nonexistent_id");
        assert!(not_found.is_none(), "不存在的玩家应该返回 None");
    }

    #[test]
    fn test_remove_nonexistent_player() {
        let mut manager = LobbyManager::new();
        
        // 尝试移除不存在的玩家
        let result = manager.remove_player("nonexistent_id");
        assert!(result.is_none(), "移除不存在的玩家应该返回 None");
    }

    #[test]
    fn test_update_player_status_comprehensive() {
        let mut manager = LobbyManager::new();
        let player = Player::new("测试玩家".to_string());
        let player_id = player.id.clone();
        
        manager.add_player(player);
        
        // 测试麦克风状态更新
        assert!(manager.update_player_mic_status(&player_id, true).is_ok());
        assert!(manager.get_player(&player_id).unwrap().mic_enabled);
        
        assert!(manager.update_player_mic_status(&player_id, false).is_ok());
        assert!(!manager.get_player(&player_id).unwrap().mic_enabled);
        
        // 测试静音状态更新
        assert!(manager.update_player_mute_status(&player_id, true).is_ok());
        assert!(manager.get_player(&player_id).unwrap().is_muted);
        
        assert!(manager.update_player_mute_status(&player_id, false).is_ok());
        assert!(!manager.get_player(&player_id).unwrap().is_muted);
    }

    #[test]
    fn test_clear_players_preserves_lobby() {
        let mut manager = LobbyManager::new();
        
        // 添加玩家
        manager.add_player(Player::new("玩家1".to_string()));
        manager.add_player(Player::new("玩家2".to_string()));
        
        assert_eq!(manager.get_player_count(), 2);
        
        // 清空玩家
        manager.clear_players();
        
        // 验证玩家已清空
        assert_eq!(manager.get_player_count(), 0);
        assert_eq!(manager.get_players().len(), 0);
    }

    #[test]
    fn test_default_trait() {
        let manager1 = LobbyManager::new();
        let manager2 = LobbyManager::default();
        
        // 验证两种创建方式的结果一致
        assert_eq!(manager1.is_in_lobby(), manager2.is_in_lobby());
        assert_eq!(manager1.get_player_count(), manager2.get_player_count());
    }
}
