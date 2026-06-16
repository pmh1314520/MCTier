import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import './MinecraftHelper.css';

interface MinecraftInfo {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export const MinecraftHelper: React.FC = () => {
  useTranslation();
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
        <h2>{tl('Minecraft 联机助手', 'Minecraft Multiplayer Helper')}</h2>
      </div>

      {/* Minecraft 安装信息 */}
      <div className="helper-section">
        <div className="section-title">
          <span>{tl('Minecraft 安装检测', 'Minecraft Installation Detection')}</span>
          {minecraftInfo && (
            <span className={`status-badge ${minecraftInfo.installed ? 'installed' : 'not-installed'}`}>
              {minecraftInfo.installed ? tl('✓ 已安装', '✓ Installed') : tl('✗ 未检测到', '✗ Not detected')}
            </span>
          )}
        </div>

        {loading && !minecraftInfo ? (
          <div className="info-row">
            <div className="loading-spinner"></div>
            <span>{tl('正在检测...', 'Detecting...')}</span>
          </div>
        ) : minecraftInfo?.installed ? (
          <div className="minecraft-info">
            <div className="info-row">
              <span className="info-label">{tl('安装路径:', 'Install path:')}</span>
              <span className="info-value">{minecraftInfo.path}</span>
            </div>
            {minecraftInfo.version && (
              <div className="info-row">
                <span className="info-label">{tl('检测到版本:', 'Detected version:')}</span>
                <span className="info-value">{minecraftInfo.version}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="info-row">
            <span className="info-value">{tl('未检测到 Minecraft 安装，请确保已安装 Minecraft Java 版', 'Minecraft not detected, please make sure Minecraft Java Edition is installed')}</span>
          </div>
        )}

        <div className="action-buttons">
          <button className="helper-button secondary" onClick={detectMinecraft} disabled={loading}>
            {loading ? <div className="loading-spinner"></div> : null}
            {tl('重新检测', 'Re-detect')}
          </button>
          {minecraftInfo?.installed && (
            <button className="helper-button primary" onClick={openMinecraftFolder}>
              {tl('打开游戏文件夹', 'Open Game Folder')}
            </button>
          )}
        </div>
      </div>

      {/* 配置指南 */}
      <div className="helper-section">
        <div className="section-title">
          <span>{tl('局域网联机配置指南', 'LAN Multiplayer Setup Guide')}</span>
        </div>

        <div className="tip-box">
          <strong>{tl('重要提示：', 'Important: ')}</strong>
          {tl(
            '使用 MCTier 虚拟局域网，Minecraft 在"对局域网开放"后，其他玩家可以直接加入，无需额外配置正版验证。盗版和正版客户端都可以正常联机。',
            'With the MCTier virtual LAN, once Minecraft is "Open to LAN", other players can join directly without extra license verification setup. Both licensed and offline clients can play together.'
          )}
        </div>

        <div className="action-buttons">
          <button className="helper-button primary" onClick={loadGuide} disabled={loading}>
            {loading ? <div className="loading-spinner"></div> : null}
            {showGuide ? tl('隐藏指南', 'Hide Guide') : tl('查看详细指南', 'View Detailed Guide')}
          </button>
        </div>

        {showGuide && guide && (
          <div className="guide-content">{guide}</div>
        )}
      </div>

      {/* 快速使用步骤 */}
      <div className="helper-section">
        <div className="section-title">
          <span>{tl('快速使用步骤', 'Quick Start Steps')}</span>
        </div>

        <div className="guide-content">
          {tl(
            `1. 创建或加入 MCTier 大厅
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
   - 无需担心正版验证问题`,
            `1. Create or join an MCTier lobby
   - All players must be in the same lobby
   - Remember your virtual IP address

2. Host opens to LAN
   - Enter a Minecraft singleplayer world
   - Press ESC and click "Open to LAN"
   - Choose whether to allow cheats
   - Click "Start LAN World"
   - Note the displayed port (usually 25565)

3. Other players join
   - In the Minecraft main menu choose "Multiplayer"
   - Click "Direct Connect"
   - Enter the host's virtual IP and port
   - For example: 192.168.0.100:25565
   - Click "Join Server"

4. Start playing
   - All players can play normally
   - Voice chat is supported
   - No need to worry about license verification`
          )}
        </div>
      </div>
    </div>
  );
};

export default MinecraftHelper;
