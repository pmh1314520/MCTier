import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './MinecraftHelper.css';

interface MinecraftInfo {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export const MinecraftHelper: React.FC = () => {
  const [minecraftInfo, setMinecraftInfo] = useState<MinecraftInfo | null>(null);
  const [guide, setGuide] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    detectMinecraft();
  }, []);

  const detectMinecraft = async () => {
    setLoading(true);
    try {
      const info = await invoke<MinecraftInfo>('detect_minecraft_path');
      setMinecraftInfo(info);
      console.log('Minecraft 检测结果:', info);
    } catch (error) {
      console.error('检测 Minecraft 失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGuide = async () => {
    if (guide) {
      setShowGuide(!showGuide);
      return;
    }

    setLoading(true);
    try {
      const guideText = await invoke<string>('get_minecraft_lan_guide');
      setGuide(guideText);
      setShowGuide(true);
    } catch (error) {
      console.error('加载配置指南失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const openMinecraftFolder = async () => {
    if (!minecraftInfo?.path) return;

    try {
      await invoke('open_minecraft_folder', { path: minecraftInfo.path });
    } catch (error) {
      console.error('打开文件夹失败:', error);
    }
  };

  return (
    <div className="minecraft-helper">
      <div className="minecraft-helper-header">
        <svg className="minecraft-icon" viewBox="0 0 24 24">
          <path d="M4 4h16v16H4V4m2 2v12h12V6H6m2 2h8v8H8V8m2 2v4h4v-4h-4z" />
        </svg>
        <h2>Minecraft 联机助手</h2>
      </div>

      {/* Minecraft 安装信息 */}
      <div className="helper-section">
        <div className="section-title">
          <span>Minecraft 安装检测</span>
          {minecraftInfo && (
            <span className={`status-badge ${minecraftInfo.installed ? 'installed' : 'not-installed'}`}>
              {minecraftInfo.installed ? '✓ 已安装' : '✗ 未检测到'}
            </span>
          )}
        </div>

        {loading && !minecraftInfo ? (
          <div className="info-row">
            <div className="loading-spinner"></div>
            <span>正在检测...</span>
          </div>
        ) : minecraftInfo?.installed ? (
          <div className="minecraft-info">
            <div className="info-row">
              <span className="info-label">安装路径:</span>
              <span className="info-value">{minecraftInfo.path}</span>
            </div>
            {minecraftInfo.version && (
              <div className="info-row">
                <span className="info-label">检测到版本:</span>
                <span className="info-value">{minecraftInfo.version}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="info-row">
            <span className="info-value">未检测到 Minecraft 安装，请确保已安装 Minecraft Java 版</span>
          </div>
        )}

        <div className="action-buttons">
          <button className="helper-button secondary" onClick={detectMinecraft} disabled={loading}>
            {loading ? <div className="loading-spinner"></div> : null}
            重新检测
          </button>
          {minecraftInfo?.installed && (
            <button className="helper-button primary" onClick={openMinecraftFolder}>
              打开游戏文件夹
            </button>
          )}
        </div>
      </div>

      {/* 配置指南 */}
      <div className="helper-section">
        <div className="section-title">
          <span>局域网联机配置指南</span>
        </div>

        <div className="tip-box">
          <strong>重要提示：</strong>
          使用 MCTier 虚拟局域网，Minecraft 在"对局域网开放"后，其他玩家可以直接加入，无需额外配置正版验证。
          盗版和正版客户端都可以正常联机。
        </div>

        <div className="action-buttons">
          <button className="helper-button primary" onClick={loadGuide} disabled={loading}>
            {loading ? <div className="loading-spinner"></div> : null}
            {showGuide ? '隐藏指南' : '查看详细指南'}
          </button>
        </div>

        {showGuide && guide && (
          <div className="guide-content">{guide}</div>
        )}
      </div>

      {/* 快速使用步骤 */}
      <div className="helper-section">
        <div className="section-title">
          <span>快速使用步骤</span>
        </div>

        <div className="guide-content">
          {`1. 创建或加入 MCTier 大厅
   - 所有玩家必须在同一个大厅中
   - 记住您的虚拟 IP 地址

2. 房主开放局域网
   - 进入 Minecraft 单人游戏世界
   - 按 ESC，点击"对局域网开放"
   - 可以选择是否允许作弊
   - 点击"创建一个局域网世界"
   - 记下显示的端口号（通常是 25565）

3. 其他玩家加入游戏
   - 在 Minecraft 主菜单选择"多人游戏"
   - 点击"直接连接"
   - 输入房主的虚拟 IP 和端口号
   - 例如：192.168.0.100:25565
   - 点击"加入服务器"

4. 开始游戏
   - 所有玩家都可以正常游戏
   - 支持语音通话功能
   - 无需担心正版验证问题`}
        </div>
      </div>
    </div>
  );
};

export default MinecraftHelper;
