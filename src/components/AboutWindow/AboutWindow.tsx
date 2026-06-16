import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button, Typography, Divider, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { GitHubIcon, GiteeIcon, GamepadIcon, LightbulbIcon } from '../icons';
import { useEscapeKey } from '../../hooks';
import { OnboardingWizard } from '../OnboardingWizard/OnboardingWizard';
import './AboutWindow.css';

const { Title, Paragraph, Text } = Typography;

interface AboutWindowProps {
  onClose: () => void;
}

/**
 * 关于软件窗口组件
 * 显示软件信息、技术栈、功能说明等
 */
export const AboutWindow: React.FC<AboutWindowProps> = ({ onClose }) => {
  useTranslation();
  const [showSponsorModal, setShowSponsorModal] = useState(false);
  const [enlargedQRCode, setEnlargedQRCode] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ESC键返回
  useEscapeKey(() => {
    // 如果有弹窗打开，先关闭弹窗
    if (enlargedQRCode) {
      setEnlargedQRCode(null);
    } else if (showSponsorModal) {
      setShowSponsorModal(false);
    } else if (showOnboarding) {
      setShowOnboarding(false);
    } else {
      // 否则关闭关于窗口
      onClose();
    }
  });

  return (
    <div className="about-window">
      {/* 顶部拖拽区域 */}
      <div className="about-window-drag-area" data-tauri-drag-region />
      
      <motion.div
        className="about-window-content"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <Title level={2} className="about-title">
            {tl('关于 MCTier', 'About MCTier')}
          </Title>
        </motion.div>

        <motion.div
          className="about-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <div className="about-section">
            <Title level={4} className="section-title">
              {tl('软件简介', 'Overview')}
            </Title>
            <Paragraph className="section-text">
              {tl(
                'MCTier 是一款通用的虚拟局域网联机工具，支持所有局域网联机游戏。基于 EasyTier 和 WebRTC 技术，让您可以轻松与好友跨越网络限制，享受联机游戏的乐趣。支持实时语音通话、P2P聊天、文件共享和屏幕共享等功能。',
                'MCTier is a universal virtual LAN gaming tool that supports all LAN multiplayer games. Built on EasyTier and WebRTC, it lets you easily play with friends across network barriers and enjoy multiplayer gaming. It supports real-time voice calls, P2P chat, file sharing, screen sharing and more.'
              )}
            </Paragraph>
            <div className="game-scope-tip">
              <GamepadIcon size={18} className="game-scope-icon" />
              <Text className="game-scope-text">
                {tl(
                  '适用于任何支持局域网联机的游戏，不仅仅只有 Minecraft',
                  'Works with any game that supports LAN multiplayer, not just Minecraft'
                )}
              </Text>
            </div>
            <div className="lan-access-tip">
              <span className="lan-access-icon">🌐</span>
              <Text className="lan-access-text">
                {tl(
                  '同一大厅内的玩家可以互相访问本地开放的网站和服务（如本地Web服务器、文件共享等）',
                  'Players in the same lobby can access each other\'s local sites and services (local web servers, file shares, etc.)'
                )}
              </Text>
            </div>
            <Button
              type="default"
              size="middle"
              block
              onClick={() => setShowOnboarding(true)}
              className="onboarding-entry-button"
              icon={<LightbulbIcon size={16} />}
            >
              {tl('查看新手引导', 'View Getting Started')}
            </Button>
          </div>

          <Divider className="about-divider" />

          <div className="about-section">
            <Title level={4} className="section-title">
              {tl('核心技术', 'Core Technology')}
            </Title>
            <div className="tech-list">
              <div className="tech-item">
                <span className="tech-icon">🌐</span>
                <div>
                  <Text strong>{tl('EasyTier 虚拟网络', 'EasyTier Virtual Network')}</Text>
                  <Paragraph className="tech-desc">
                    {tl(
                      '基于 P2P 技术的虚拟局域网，实现跨网络的直连通信',
                      'P2P-based virtual LAN enabling direct cross-network communication'
                    )}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <span className="tech-icon">🎙️</span>
                <div>
                  <Text strong>{tl('WebRTC 语音通信', 'WebRTC Voice')}</Text>
                  <Paragraph className="tech-desc">
                    {tl('低延迟、高质量的实时语音通话技术', 'Low-latency, high-quality real-time voice calls')}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <span className="tech-icon">💬</span>
                <div>
                  <Text strong>HTTP over WireGuard</Text>
                  <Paragraph className="tech-desc">
                    {tl('基于虚拟网络的P2P聊天和文件共享', 'P2P chat and file sharing over the virtual network')}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <span className="tech-icon">📺</span>
                <div>
                  <Text strong>{tl('WebRTC 屏幕共享', 'WebRTC Screen Sharing')}</Text>
                  <Paragraph className="tech-desc">
                    {tl('实时屏幕共享，支持查看队友画面', 'Real-time screen sharing to view teammates\' screens')}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <span className="tech-icon">⚡</span>
                <div>
                  <Text strong>Tauri + React</Text>
                  <Paragraph className="tech-desc">
                    {tl('现代化的桌面应用框架，轻量高效', 'Modern desktop app framework, lightweight and efficient')}
                  </Paragraph>
                </div>
              </div>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section">
            <Title level={4} className="section-title">
              {tl('主要功能', 'Key Features')}
            </Title>
            <ul className="feature-list">
              <li>🌐 {tl('虚拟局域网组网 - 基于 EasyTier 的 P2P 组网技术', 'Virtual LAN networking - EasyTier-based P2P networking')}</li>
              <li>🎙️ {tl('实时语音通信 - WebRTC 低延迟语音，支持快捷键控制', 'Real-time voice - WebRTC low-latency voice with hotkey control')}</li>
              <li>💬 {tl('P2P 聊天室 - 支持文本和图片消息，基于虚拟网络传输', 'P2P chat - text and image messages over the virtual network')}</li>
              <li>📁 {tl('文件夹共享 - HTTP 文件服务器，支持批量下载和先压后发', 'Folder sharing - HTTP file server with batch download and compression')}</li>
              <li>📺 {tl('屏幕共享 - WebRTC 实时屏幕共享，支持密码保护', 'Screen sharing - WebRTC real-time screen sharing with password protection')}</li>
              <li>🔧 {tl('多节点高可用 - 支持配置多个 EasyTier 节点，自动故障转移', 'Multi-node HA - configure multiple EasyTier nodes with auto failover')}</li>
              <li>🪟 {tl('迷你悬浮窗 - 游戏时不遮挡视野，可调节透明度和听筒音量', 'Mini overlay - unobtrusive in-game, adjustable opacity and volume')}</li>
              <li>🔒 {tl('大厅隔离机制 - 不同大厅之间完全隔离，保护隐私安全', 'Lobby isolation - full isolation between lobbies for privacy')}</li>
              <li>🚀 {tl('开机自启动 - 支持自动创建/加入大厅，一键启动', 'Auto-start - auto create/join lobby on launch')}</li>
              <li>🌍 {tl('虚拟域名 - 支持 Magic DNS，使用域名代替 IP 地址', 'Virtual domains - Magic DNS to use names instead of IPs')}</li>
              <li>⚙️ {tl('私有化部署 - 支持自建 EasyTier 节点和信令服务器', 'Self-hosting - run your own EasyTier nodes and signaling server')}</li>
            </ul>
          </div>

          <Divider className="about-divider" />

          <div className="about-section">
            <Title level={4} className="section-title">
              {tl('开发者：青云制作_彭明航', 'Developer: QingYun Studio_PengMingHang')}
            </Title>
            <div className="developer-info">
              <Paragraph className="project-info">
                {tl(
                  '这是我开源的第三款软件项目，希望能为 Minecraft 社区带来便利！',
                  'This is my third open-source software project. I hope it brings convenience to the community!'
                )}
              </Paragraph>
              <div className="repo-links">
                <a
                  href="https://mctier.pmhs.top"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <img src="/MCTierIcon.png" alt="MCTier" className="mctier-icon" />
                  <span>{tl('MCTier 官网', 'MCTier Website')}</span>
                </a>
                <a
                  href="https://github.com/pmh1314520/MCTier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <GitHubIcon size={16} />
                  <span>{tl('GitHub 开源仓库', 'GitHub Repository')}</span>
                </a>
                <a
                  href="https://gitee.com/peng-minghang/mctier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <GiteeIcon size={16} />
                  <span>{tl('Gitee 开源仓库', 'Gitee Repository')}</span>
                </a>
              </div>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section license-section">
            <Title level={4} className="section-title">
              {tl('开源协议', 'License')}
            </Title>
            <div className="license-content">
              <Paragraph className="license-text">
                {tl('本软件采用自定义开源协议，使用前请仔细阅读：', 'This software uses a custom open-source license. Please read carefully before use:')}
              </Paragraph>
              <ul className="license-list">
                <li className="license-item">
                  <span className="license-icon">🚫</span>
                  <Text className="license-desc">
                    {tl('禁止商业用途 - 本软件仅供个人学习和非商业使用', 'No commercial use - for personal learning and non-commercial use only')}
                  </Text>
                </li>
                <li className="license-item">
                  <span className="license-icon">✅</span>
                  <Text className="license-desc">
                    {tl('允许二次开发 - 欢迎基于本项目进行修改和扩展', 'Modification allowed - feel free to modify and extend this project')}
                  </Text>
                </li>
                <li className="license-item">
                  <span className="license-icon">📝</span>
                  <Text className="license-desc">
                    {tl('必须标明原作者 - 二次开发项目需注明原作者信息', 'Attribution required - derivative projects must credit the original author')}
                  </Text>
                </li>
                <li className="license-item">
                  <span className="license-icon">🔓</span>
                  <Text className="license-desc">
                    {tl('二次开发必须开源 - 衍生项目必须以相同协议开源', 'Derivatives must be open source under the same license')}
                  </Text>
                </li>
              </ul>
              <Paragraph className="license-note">{tl('使用本软件即表示您同意遵守以上协议条款', 'By using this software you agree to the terms above')}</Paragraph>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section sponsor-section">
            <Title level={4} className="section-title">
              {tl('支持开发者', 'Support the Developer')}
            </Title>
            <Paragraph className="sponsor-text">
              {tl('如果这个软件对您有帮助，欢迎请开发者喝杯咖啡 ☕', 'If this software helps you, feel free to buy the developer a coffee ☕')}
            </Paragraph>
            <Button
              type="default"
              size="middle"
              block
              onClick={() => setShowSponsorModal(true)}
              className="sponsor-button"
            >
              💖 {tl('赞助支持', 'Sponsor')}
            </Button>
          </div>

          <Divider className="about-divider" />

          <div className="about-section blessing-section">
            <div className="blessing-text">
              <span className="blessing-icon">🎮</span>
              <Text className="blessing-content">
                {tl('祝各位玩家游玩愉快，享受与好友联机的快乐时光！', 'Wishing everyone happy gaming and great times with friends!')}
              </Text>
              <span className="blessing-icon">✨</span>
            </div>
            <Paragraph className="free-text">✨ {tl('本软件完全免费开源', 'Completely free and open source')} ✨</Paragraph>
          </div>
        </motion.div>

        <motion.div
          className="about-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <Button type="primary" size="large" block onClick={onClose} className="close-button">
            {tl('返回', 'Back')}
          </Button>
        </motion.div>
      </motion.div>

      {/* 新手引导向导 */}
      <OnboardingWizard visible={showOnboarding} onClose={() => setShowOnboarding(false)} />

      {/* 赞助弹窗 */}
      <Modal
        open={showSponsorModal}
        onCancel={() => setShowSponsorModal(false)}
        footer={null}
        centered
        width={420}
        className="sponsor-modal"
      >
        <div className="sponsor-modal-content">
          <Title level={3} className="sponsor-modal-title">
            {tl('感谢您的支持', 'Thank You for Your Support')} 💖
          </Title>
          <Paragraph className="sponsor-modal-desc">{tl('您的支持是我持续开发的动力！', 'Your support keeps me developing!')}</Paragraph>
          <div className="qrcode-container">
            <div className="qrcode-item" onClick={() => setEnlargedQRCode('/zfb.jpg')}>
              <img src="/zfb.jpg" alt="Alipay" className="qrcode-image" />
              <Text className="qrcode-label">{tl('支付宝', 'Alipay')}</Text>
            </div>
            <div className="qrcode-item" onClick={() => setEnlargedQRCode('/wx.png')}>
              <img src="/wx.png" alt="WeChat" className="qrcode-image" />
              <Text className="qrcode-label">{tl('微信', 'WeChat')}</Text>
            </div>
          </div>
        </div>
      </Modal>

      {/* 二维码放大弹窗 */}
      <Modal
        open={!!enlargedQRCode}
        onCancel={() => setEnlargedQRCode(null)}
        footer={null}
        centered
        width="auto"
        className="qrcode-enlarged-modal"
        styles={{
          body: { padding: 0 },
        }}
      >
        {enlargedQRCode && (
          <img
            src={enlargedQRCode}
            alt="QR Code"
            className="qrcode-enlarged-image"
            onClick={() => setEnlargedQRCode(null)}
          />
        )}
      </Modal>
    </div>
  );
};
