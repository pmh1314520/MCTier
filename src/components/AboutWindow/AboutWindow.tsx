import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button, Typography, Divider, Modal } from 'antd';
import { GitHubIcon, GiteeIcon, GamepadIcon } from '../icons';
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
  const [showSponsorModal, setShowSponsorModal] = useState(false);
  const [enlargedQRCode, setEnlargedQRCode] = useState<string | null>(null);

  return (
    <div className="about-window">
      <motion.div
        className="about-window-content"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          data-tauri-drag-region
        >
          <Title level={2} className="about-title">
            关于 MCTier
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
              软件简介
            </Title>
            <Paragraph className="section-text">
              MCTier 是一款专为 Minecraft 玩家打造的虚拟局域网联机工具，
              让您可以轻松与好友跨越网络限制，享受联机游戏的乐趣。
            </Paragraph>
            <div className="game-scope-tip">
              <GamepadIcon size={18} className="game-scope-icon" />
              <Text className="game-scope-text">
                适用于任何支持局域网联机的游戏，不仅仅只有 Minecraft
              </Text>
            </div>
            <div className="lan-access-tip">
              <span className="lan-access-icon">🌐</span>
              <Text className="lan-access-text">
                同一大厅内的玩家可以互相访问本地开放的网站和服务（如本地Web服务器、文件共享等）
              </Text>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section">
            <Title level={4} className="section-title">
              核心技术
            </Title>
            <div className="tech-list">
              <div className="tech-item">
                <span className="tech-icon">🌐</span>
                <div>
                  <Text strong>EasyTier 虚拟网络</Text>
                  <Paragraph className="tech-desc">
                    基于 P2P 技术的虚拟局域网，实现跨网络的直连通信
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <span className="tech-icon">🎙️</span>
                <div>
                  <Text strong>WebRTC 语音通信</Text>
                  <Paragraph className="tech-desc">低延迟、高质量的实时语音通话技术</Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <span className="tech-icon">⚡</span>
                <div>
                  <Text strong>Tauri + React</Text>
                  <Paragraph className="tech-desc">现代化的桌面应用框架，轻量高效</Paragraph>
                </div>
              </div>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section">
            <Title level={4} className="section-title">
              主要功能
            </Title>
            <ul className="feature-list">
              <li>创建/加入虚拟局域网大厅</li>
              <li>实时语音通信，支持快捷键控制</li>
              <li>自动网络配置，无需手动设置</li>
              <li>迷你悬浮窗，游戏时不遮挡视野</li>
              <li>大厅隔离机制，保护隐私安全</li>
            </ul>
          </div>

          <Divider className="about-divider" />

          <div className="about-section">
            <Title level={4} className="section-title">
              开发者：青云制作_彭明航
            </Title>
            <div className="developer-info">
              <Paragraph className="project-info">
                这是我开源的第三款软件项目，希望能为 Minecraft 社区带来便利！
              </Paragraph>
              <div className="repo-links">
                <a
                  href="https://mctier.pmhs.top"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <img src="/MCTierIcon.png" alt="MCTier" className="mctier-icon" />
                  <span>MCTier 官网</span>
                </a>
                <a
                  href="https://github.com/pmh1314520/MCTier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <GitHubIcon size={16} />
                  <span>GitHub 开源地址</span>
                </a>
                <a
                  href="https://gitee.com/peng-minghang/mctier"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <GiteeIcon size={16} />
                  <span>Gitee 开源地址</span>
                </a>
              </div>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section license-section">
            <Title level={4} className="section-title">
              开源协议
            </Title>
            <div className="license-content">
              <Paragraph className="license-text">
                本软件采用自定义开源协议，使用前请仔细阅读：
              </Paragraph>
              <ul className="license-list">
                <li className="license-item">
                  <span className="license-icon">🚫</span>
                  <Text className="license-desc">
                    禁止商业用途 - 本软件仅供个人学习和非商业使用
                  </Text>
                </li>
                <li className="license-item">
                  <span className="license-icon">✅</span>
                  <Text className="license-desc">允许二次开发 - 欢迎基于本项目进行修改和扩展</Text>
                </li>
                <li className="license-item">
                  <span className="license-icon">📝</span>
                  <Text className="license-desc">
                    必须标明原作者 - 二次开发项目需注明原作者信息
                  </Text>
                </li>
                <li className="license-item">
                  <span className="license-icon">🔓</span>
                  <Text className="license-desc">
                    二次开发必须开源 - 衍生项目必须以相同协议开源
                  </Text>
                </li>
              </ul>
              <Paragraph className="license-note">使用本软件即表示您同意遵守以上协议条款</Paragraph>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section sponsor-section">
            <Title level={4} className="section-title">
              支持开发者
            </Title>
            <Paragraph className="sponsor-text">
              如果这个软件对您有帮助，欢迎请开发者喝杯咖啡 ☕
            </Paragraph>
            <Button
              type="default"
              size="middle"
              block
              onClick={() => setShowSponsorModal(true)}
              className="sponsor-button"
            >
              💖 赞助支持
            </Button>
          </div>

          <Divider className="about-divider" />

          <div className="about-section blessing-section">
            <div className="blessing-text">
              <span className="blessing-icon">🎮</span>
              <Text className="blessing-content">
                祝各位玩家游玩愉快，享受与好友联机的快乐时光！
              </Text>
              <span className="blessing-icon">✨</span>
            </div>
            <Paragraph className="free-text">✨ 本软件完全免费开源 ✨</Paragraph>
          </div>
        </motion.div>

        <motion.div
          className="about-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <Button type="primary" size="large" block onClick={onClose} className="close-button">
            返回
          </Button>
        </motion.div>
      </motion.div>

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
            感谢您的支持 💖
          </Title>
          <Paragraph className="sponsor-modal-desc">您的支持是我持续开发的动力！</Paragraph>
          <div className="qrcode-container">
            <div className="qrcode-item" onClick={() => setEnlargedQRCode('/zfb.jpg')}>
              <img src="/zfb.jpg" alt="支付宝收款码" className="qrcode-image" />
              <Text className="qrcode-label">支付宝</Text>
            </div>
            <div className="qrcode-item" onClick={() => setEnlargedQRCode('/wx.png')}>
              <img src="/wx.png" alt="微信收款码" className="qrcode-image" />
              <Text className="qrcode-label">微信</Text>
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
            alt="收款码"
            className="qrcode-enlarged-image"
            onClick={() => setEnlargedQRCode(null)}
          />
        )}
      </Modal>
    </div>
  );
};
