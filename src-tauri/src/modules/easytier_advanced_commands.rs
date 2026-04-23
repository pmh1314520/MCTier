// EasyTier 高级配置命令模块
// 
// 此模块提供全局和大厅级别的 EasyTier 高级配置管理命令

use tauri::State;
use crate::modules::tauri_commands::AppState;

// ==================== EasyTier 高级配置命令 ====================

/// 保存全局 EasyTier 高级配置
/// 
/// # 参数
/// * `config_json` - 配置 JSON 对象
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_global_easytier_advanced_config(
    config_json: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::EasyTierAdvancedConfig;
    
    log::info!("保存全局 EasyTier 高级配置");
    log::debug!("配置内容: {:?}", config_json);
    
    // 解析配置
    let config: EasyTierAdvancedConfig = serde_json::from_value(config_json)
        .map_err(|e| format!("解析配置失败: {}", e))?;
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    cfg_mgr.update_config(|user_config| {
        user_config.global_easytier_advanced_config = Some(config);
    }).await.map_err(|e| format!("保存全局 EasyTier 高级配置失败: {}", e))?;
    
    log::info!("全局 EasyTier 高级配置保存成功");
    Ok(())
}

/// 获取全局 EasyTier 高级配置
/// 
/// # 返回
/// * `Ok(serde_json::Value)` - 全局 EasyTier 高级配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_global_easytier_advanced_config(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    log::info!("获取全局 EasyTier 高级配置");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let config = cfg_mgr.get_config();
    
    let advanced_config = config.global_easytier_advanced_config.clone()
        .unwrap_or_else(|| crate::modules::config_manager::EasyTierAdvancedConfig::default());
    
    // 序列化为 JSON
    serde_json::to_value(&advanced_config)
        .map_err(|e| format!("序列化配置失败: {}", e))
}

/// 保存大厅 EasyTier 高级配置
/// 
/// # 参数
/// * `config_json` - 配置 JSON 对象
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_lobby_easytier_advanced_config(
    config_json: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::EasyTierAdvancedConfig;
    
    log::info!("========================================");
    log::info!("保存大厅 EasyTier 高级配置");
    log::info!("前端传入的配置 JSON: {}", serde_json::to_string_pretty(&config_json).unwrap_or_default());
    
    // 解析配置
    let config: EasyTierAdvancedConfig = serde_json::from_value(config_json.clone())
        .map_err(|e| format!("解析配置失败: {}", e))?;
    
    log::info!("解析后的配置:");
    log::info!("  - use_global_config: {}", config.use_global_config);
    log::info!("  - dev_name: {:?}", config.dev_name);
    log::info!("  - no_tun: {}", config.no_tun);
    log::info!("  - dhcp: {}", config.dhcp);
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    cfg_mgr.update_config(|user_config| {
        user_config.lobby_easytier_advanced_config = Some(config.clone());
    }).await.map_err(|e| format!("保存大厅 EasyTier 高级配置失败: {}", e))?;
    
    log::info!("✅ 大厅 EasyTier 高级配置已保存到配置文件");
    
    // 验证保存后的配置
    let saved_config = cfg_mgr.get_config().lobby_easytier_advanced_config.clone();
    if let Some(ref saved) = saved_config {
        log::info!("验证保存后的配置:");
        log::info!("  - use_global_config: {}", saved.use_global_config);
        log::info!("  - dev_name: {:?}", saved.dev_name);
    }
    log::info!("========================================");
    
    Ok(())
}

/// 获取大厅 EasyTier 高级配置
/// 
/// # 返回
/// * `Ok(serde_json::Value)` - 大厅 EasyTier 高级配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_lobby_easytier_advanced_config(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    log::info!("获取大厅 EasyTier 高级配置");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let config = cfg_mgr.get_config();
    
    let advanced_config = config.lobby_easytier_advanced_config.clone()
        .unwrap_or_else(|| crate::modules::config_manager::EasyTierAdvancedConfig::default());
    
    // 序列化为 JSON
    serde_json::to_value(&advanced_config)
        .map_err(|e| format!("序列化配置失败: {}", e))
}

/// 清除大厅 EasyTier 高级配置（重置为默认）
/// 
/// # 返回
/// * `Ok(())` - 清除成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn clear_lobby_easytier_advanced_config(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("========================================");
    log::info!("清除大厅 EasyTier 高级配置");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    cfg_mgr.update_config(|user_config| {
        user_config.lobby_easytier_advanced_config = None;
    }).await.map_err(|e| format!("清除大厅 EasyTier 高级配置失败: {}", e))?;
    
    log::info!("✅ 大厅 EasyTier 高级配置已清除");
    log::info!("========================================");
    
    Ok(())
}
