import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button, Typography, Divider, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-shell';
import { tl } from '../../i18n';
import {
  GitHubIcon,
  GiteeIcon,
  GamepadIcon,
  LightbulbIcon,
  GlobeIcon,
  MicrophoneIcon,
  ChatIcon,
  ScreenShareIcon,
  LightningIcon,
  FolderIcon,
  SettingsIcon,
  WindowIcon,
  LockIcon,
  RocketIcon,
  CloseCircleIcon,
  CheckIcon,
  FileIcon,
  CoffeeIcon,
  HeartIcon,
  SparklesIcon,
} from '../icons';
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

  const openTrustedExternal = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void open(event.currentTarget.href).catch((error) => {
      console.error('打开外部链接失败:', error);
    });
  };

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
              <GlobeIcon size={16} className="lan-access-icon" />
              <Text className="lan-access-text">
                {tl(
                  '同一大厅内的玩家可以互相访问本地开放的网站和服务（如本地Web服务器、文件共享等）',
                  "Players in the same lobby can access each other's local sites and services (local web servers, file shares, etc.)"
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
                <GlobeIcon size={20} className="tech-icon" />
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
                <MicrophoneIcon size={20} className="tech-icon" />
                <div>
                  <Text strong>{tl('WebRTC 语音通信', 'WebRTC Voice')}</Text>
                  <Paragraph className="tech-desc">
                    {tl(
                      '低延迟、高质量的实时语音通话技术',
                      'Low-latency, high-quality real-time voice calls'
                    )}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <ChatIcon size={20} className="tech-icon" />
                <div>
                  <Text strong>HTTP over WireGuard</Text>
                  <Paragraph className="tech-desc">
                    {tl(
                      '基于虚拟网络的P2P聊天和文件共享',
                      'P2P chat and file sharing over the virtual network'
                    )}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <ScreenShareIcon size={20} className="tech-icon" />
                <div>
                  <Text strong>{tl('WebRTC 屏幕共享', 'WebRTC Screen Sharing')}</Text>
                  <Paragraph className="tech-desc">
                    {tl(
                      '实时屏幕共享，支持查看队友画面',
                      "Real-time screen sharing to view teammates' screens"
                    )}
                  </Paragraph>
                </div>
              </div>
              <div className="tech-item">
                <LightningIcon size={20} className="tech-icon" />
                <div>
                  <Text strong>Tauri + React</Text>
                  <Paragraph className="tech-desc">
                    {tl(
                      '现代化的桌面应用框架，轻量高效',
                      'Modern desktop app framework, lightweight and efficient'
                    )}
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
              <li>
                <GlobeIcon size={16} className="feature-icon" />
                {tl(
                  '虚拟局域网组网 - 基于 EasyTier 的 P2P 组网技术',
                  'Virtual LAN networking - EasyTier-based P2P networking'
                )}
              </li>
              <li>
                <MicrophoneIcon size={16} className="feature-icon" />
                {tl(
                  '实时语音通信 - WebRTC 低延迟语音，支持快捷键控制',
                  'Real-time voice - WebRTC low-latency voice with hotkey control'
                )}
              </li>
              <li>
                <ChatIcon size={16} className="feature-icon" />
                {tl(
                  'P2P 聊天室 - 支持文本和图片消息，基于虚拟网络传输',
                  'P2P chat - text and image messages over the virtual network'
                )}
              </li>
              <li>
                <FolderIcon size={16} className="feature-icon" />
                {tl(
                  '文件夹共享 - HTTP 文件服务器，支持批量下载和先压后发',
                  'Folder sharing - HTTP file server with batch download and compression'
                )}
              </li>
              <li>
                <ScreenShareIcon size={16} className="feature-icon" />
                {tl(
                  '屏幕共享 - WebRTC 实时屏幕共享，支持密码保护',
                  'Screen sharing - WebRTC real-time screen sharing with password protection'
                )}
              </li>
              <li>
                <SettingsIcon size={16} className="feature-icon" />
                {tl(
                  '多节点高可用 - 支持配置多个 EasyTier 节点，自动故障转移',
                  'Multi-node HA - configure multiple EasyTier nodes with auto failover'
                )}
              </li>
              <li>
                <WindowIcon size={16} className="feature-icon" />
                {tl(
                  '迷你悬浮窗 - 游戏时不遮挡视野，可调节透明度和听筒音量',
                  'Mini overlay - unobtrusive in-game, adjustable opacity and volume'
                )}
              </li>
              <li>
                <LockIcon size={16} className="feature-icon" />
                {tl(
                  '大厅隔离机制 - 不同大厅之间完全隔离，保护隐私安全',
                  'Lobby isolation - full isolation between lobbies for privacy'
                )}
              </li>
              <li>
                <RocketIcon size={16} className="feature-icon" />
                {tl(
                  '开机自启动 - 支持自动创建/加入大厅，一键启动',
                  'Auto-start - auto create/join lobby on launch'
                )}
              </li>
              <li>
                <GlobeIcon size={16} className="feature-icon" />
                {tl(
                  '虚拟域名 - 支持 Magic DNS，使用域名代替 IP 地址',
                  'Virtual domains - Magic DNS to use names instead of IPs'
                )}
              </li>
              <li>
                <SettingsIcon size={16} className="feature-icon" />
                {tl(
                  '私有化部署 - 支持自建 EasyTier 节点和信令服务器',
                  'Self-hosting - run your own EasyTier nodes and signaling server'
                )}
              </li>
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
                  onClick={openTrustedExternal}
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <img src="/MCTierIcon.png" alt="MCTier" className="mctier-icon" />
                  <span>{tl('MCTier 官网', 'MCTier Website')}</span>
                </a>
                <a
                  href="https://github.com/pmh1314520/MCTier"
                  target="_blank"
                  onClick={openTrustedExternal}
                  rel="noopener noreferrer"
                  className="repo-link"
                >
                  <GitHubIcon size={16} />
                  <span>{tl('GitHub 开源仓库', 'GitHub Repository')}</span>
                </a>
                <a
                  href="https://gitee.com/peng-minghang/mctier"
                  target="_blank"
                  onClick={openTrustedExternal}
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
              {tl('许可协议', 'License')}
            </Title>
            <div className="license-content">
              <Paragraph className="license-text">
                {tl(
                  '本软件自有代码采用自定义源码可得（非商业）许可，使用前请仔细阅读：',
                  'MCTier\u2019s own code uses a custom source-available (non-commercial) license. Please read carefully before use:'
                )}
              </Paragraph>
              <ul className="license-list">
                <li className="license-item">
                  <CloseCircleIcon size={18} className="license-icon" />
                  <Text className="license-desc">
                    {tl(
                      '禁止商业用途 - 本软件仅供个人学习和非商业使用',
                      'No commercial use - for personal learning and non-commercial use only'
                    )}
                  </Text>
                </li>
                <li className="license-item">
                  <CheckIcon size={18} className="license-icon" />
                  <Text className="license-desc">
                    {tl(
                      '允许二次开发 - 欢迎基于本项目进行修改和扩展',
                      'Modification allowed - feel free to modify and extend this project'
                    )}
                  </Text>
                </li>
                <li className="license-item">
                  <FileIcon size={18} className="license-icon" />
                  <Text className="license-desc">
                    {tl(
                      '必须标明原作者 - 二次开发项目需注明原作者信息',
                      'Attribution required - derivative projects must credit the original author'
                    )}
                  </Text>
                </li>
                <li className="license-item">
                  <LockIcon open size={18} className="license-icon" />
                  <Text className="license-desc">
                    {tl(
                      '二次开发必须开源 - 衍生项目必须以相同协议开源',
                      'Derivatives must be open source under the same license'
                    )}
                  </Text>
                </li>
              </ul>
              <Paragraph className="license-note">
                {tl(
                  '使用本软件即表示您同意遵守以上协议条款',
                  'By using this software you agree to the terms above'
                )}
              </Paragraph>
              <Paragraph className="license-boundary-note">
                {tl(
                  '注意：以上限制仅适用于 MCTier 自有代码，不适用于下方所列的 EasyTier（LGPL-3.0）组件。',
                  'Note: the restrictions above apply only to MCTier\u2019s own code, not to the EasyTier (LGPL-3.0) components listed below.'
                )}
              </Paragraph>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section third-party-section">
            <Title level={4} className="section-title">
              {tl('第三方开源组件声明', 'Third-Party Open Source Notices')}
            </Title>
            <div className="third-party-content">
              <div className="third-party-item">
                <Text strong className="third-party-name">
                  EasyTier
                </Text>
                <Paragraph className="third-party-line">
                  EasyTier Copyright (c) EasyTier contributors.
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl(
                    'EasyTier 依据 GNU Lesser General Public License version 3.0（LGPL-3.0）授权，其使用与再分发受 LGPL-3.0 约束。',
                    'EasyTier is licensed under the GNU Lesser General Public License version 3.0 (LGPL-3.0); its use and redistribution are governed by LGPL-3.0.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl(
                    'MCTier 的自定义协议（含“禁止商业用途”“二次开发必须以相同协议开源”）不适用于 EasyTier，且不得被解释为限制 LGPL-3.0 赋予您的权利。',
                    'MCTier\u2019s custom license (including "no commercial use" and "derivatives must be open source") does not apply to EasyTier and shall not be construed to limit your rights under LGPL-3.0.'
                  )}
                </Paragraph>
                <ul className="third-party-meta">
                  <li>
                    {tl('Windows 端：', 'Windows: ')}
                    {tl(
                      'v2.5.0（commit 88a45d11...），独立进程调用，未修改源码',
                      'v2.5.0 (commit 88a45d11...), run as a separate process, source unmodified'
                    )}
                  </li>
                  <li>
                    {tl('Android 端：', 'Android: ')}
                    {tl(
                      '基于 v2.6.0（commit 79b562cd...）构建的动态库，已修改，补丁随源码仓库提供',
                      'shared libraries built from v2.6.0 (commit 79b562cd...), modified; the patch is provided in the source repository'
                    )}
                  </li>
                </ul>
                <Paragraph className="third-party-line">
                  {tl('上游源码地址：', 'Upstream source: ')}
                  <a
                    href="https://github.com/EasyTier/EasyTier"
                    target="_blank"
                    onClick={openTrustedExternal}
                    rel="noopener noreferrer"
                    className="third-party-link"
                  >
                    https://github.com/EasyTier/EasyTier
                  </a>
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl(
                    '完整的版本、commit、SHA-256、修改说明、许可证全文与源码获取方式，见发布包内的 THIRD_PARTY_NOTICES.md 与 licenses/ 目录。',
                    'For full versions, commits, SHA-256 hashes, modification details, license texts and how to obtain the corresponding source, see THIRD_PARTY_NOTICES.md and the licenses/ directory included in the release package.'
                  )}
                </Paragraph>
              </div>

              <div className="third-party-item">
                <Text strong className="third-party-name">
                  WebRTC
                </Text>
                <Paragraph className="third-party-line">
                  {tl(
                    'Copyright (c) The WebRTC project authors，依据 BSD-3-Clause 授权。',
                    'Copyright (c) The WebRTC project authors, licensed under BSD-3-Clause.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl('源码地址：', 'Source: ')}
                  <a
                    href="https://webrtc.googlesource.com/src"
                    target="_blank"
                    onClick={openTrustedExternal}
                    rel="noopener noreferrer"
                    className="third-party-link"
                  >
                    https://webrtc.googlesource.com/src
                  </a>
                </Paragraph>
              </div>

              <div className="third-party-item">
                <Text strong className="third-party-name">
                  Wintun
                </Text>
                <Paragraph className="third-party-line">
                  Copyright (C) 2018-2021 WireGuard LLC. All Rights Reserved.
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl(
                    '版本 0.14.1，依据 Wintun Prebuilt Binaries License 分发（仅通过官方 wintun.h 的 Permitted API 使用，未作修改）。WireGuard LLC、WireGuard 项目与 Wintun 项目均未对本软件作任何背书。',
                    'Version 0.14.1, distributed under the Wintun Prebuilt Binaries License (used only via the Permitted API in the official wintun.h, unmodified). Neither WireGuard LLC, the WireGuard project, nor the Wintun project endorses this software.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl('源码/下载地址：', 'Source/downloads: ')}
                  <a
                    href="https://www.wintun.net"
                    target="_blank"
                    onClick={openTrustedExternal}
                    rel="noopener noreferrer"
                    className="third-party-link"
                  >
                    https://www.wintun.net
                  </a>
                </Paragraph>
              </div>

              <div className="third-party-item">
                <Text strong className="third-party-name">
                  WinDivert
                </Text>
                <Paragraph className="third-party-line">
                  {tl(
                    '版本 2.2.2，采用 LGPL-3.0 / GPL-2.0 双许可，本项目选择 LGPL-3.0 分支，未作修改。',
                    'Version 2.2.2, dual-licensed under LGPL-3.0 / GPL-2.0; this project chooses the LGPL-3.0 branch. Unmodified.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl('项目地址：', 'Project: ')}
                  <a
                    href="https://reqrypt.org/windivert.html"
                    target="_blank"
                    onClick={openTrustedExternal}
                    rel="noopener noreferrer"
                    className="third-party-link"
                  >
                    https://reqrypt.org/windivert.html
                  </a>
                </Paragraph>
              </div>

              <div className="third-party-item">
                <Text strong className="third-party-name">
                  Npcap
                </Text>
                <Paragraph className="third-party-line">
                  Copyright (c) 2023, Insecure.Com LLC.
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl(
                    'Npcap 不是开源软件，依 Nmap Project 的专有许可条款授权。若你的系统缺少 Npcap，请自行前往官网下载安装。',
                    'Npcap is not open source software; it is licensed under the Nmap Project\u2019s proprietary terms. If your system lacks Npcap, please download and install it yourself.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl('官网：', 'Website: ')}
                  <a
                    href="https://npcap.com"
                    target="_blank"
                    onClick={openTrustedExternal}
                    rel="noopener noreferrer"
                    className="third-party-link"
                  >
                    https://npcap.com
                  </a>
                </Paragraph>
              </div>

              <div className="third-party-item">
                <Text strong className="third-party-name">
                  LocalVQE / GGML
                </Text>
                <Paragraph className="third-party-line">
                  {tl(
                    'LocalVQE 依据 Apache-2.0 授权；其内嵌的 GGML 依据 MIT 授权（Copyright (c) 2023 Georgi Gerganov）。仅 Android 端使用；桌面端已改为不加处理的原声通话，不再包含该组件。',
                    'LocalVQE is licensed under Apache-2.0; the bundled GGML is licensed under MIT (Copyright (c) 2023 Georgi Gerganov). Used by the Android client only; the desktop client now sends unprocessed microphone audio and no longer bundles this component.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl(
                    'Android 端语音降噪模型的训练数据包含 Microsoft DNS Challenge / AEC Challenge 素材，依 CC BY 4.0 授权。',
                    'The Android noise-suppression model\u2019s training data includes material from the Microsoft DNS Challenge / AEC Challenge, licensed under CC BY 4.0.'
                  )}
                </Paragraph>
                <Paragraph className="third-party-line">
                  {tl('源码地址：', 'Source: ')}
                  <a
                    href="https://github.com/localai-org/LocalVQE"
                    target="_blank"
                    onClick={openTrustedExternal}
                    rel="noopener noreferrer"
                    className="third-party-link"
                  >
                    https://github.com/localai-org/LocalVQE
                  </a>
                </Paragraph>
              </div>

              <Paragraph className="third-party-footnote">
                {tl(
                  '以上组件均不适用 MCTier 自有代码的许可条款，而按各自许可证授权；MCTier 的“禁止商业用途”“衍生须同协议开源”不得被解释为限制这些许可证赋予你的权利。完整清单（含版本、SHA-256、修改状态与源码获取方式）见发布包内的 THIRD_PARTY_NOTICES.md 与 licenses/ 目录。',
                  'None of the components above are covered by MCTier\u2019s own license terms; each remains under its own license. MCTier\u2019s "no commercial use" and "derivatives must be open source" clauses shall not be construed to limit the rights those licenses grant you. For the full list (versions, SHA-256 hashes, modification status and how to obtain source), see THIRD_PARTY_NOTICES.md and the licenses/ directory in the release package.'
                )}
              </Paragraph>

              <Paragraph className="third-party-footnote">
                {tl(
                  '本项目不是官方 Minecraft 产品，未获 Mojang Studios 或 Microsoft 批准、认可、关联或背书。Minecraft 是 Mojang Synergies AB 及其关联主体的商标。',
                  'This project is not an official Minecraft product. It is not approved by or associated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Synergies AB.'
                )}
              </Paragraph>
            </div>
          </div>

          <Divider className="about-divider" />

          <div className="about-section sponsor-section">
            <Title level={4} className="section-title">
              {tl('支持开发者', 'Support the Developer')}
            </Title>
            <Paragraph className="sponsor-text">
              {tl(
                '如果这个软件对您有帮助，欢迎请开发者喝杯咖啡',
                'If this software helps you, feel free to buy the developer a coffee'
              )}{' '}
              <CoffeeIcon size={15} className="inline-icon" />
            </Paragraph>
            <Button
              type="default"
              size="middle"
              block
              onClick={() => setShowSponsorModal(true)}
              className="sponsor-button"
            >
              <HeartIcon size={16} className="inline-icon" /> {tl('赞助支持', 'Sponsor')}
            </Button>
          </div>

          <Divider className="about-divider" />

          <div className="about-section blessing-section">
            <div className="blessing-text">
              <GamepadIcon size={20} className="blessing-icon" />
              <Text className="blessing-content">
                {tl(
                  '祝各位玩家游玩愉快，享受与好友联机的快乐时光！',
                  'Wishing everyone happy gaming and great times with friends!'
                )}
              </Text>
              <SparklesIcon size={20} className="blessing-icon" />
            </div>
            <Paragraph className="free-text">
              <SparklesIcon size={16} className="inline-icon" />{' '}
              {tl(
                '本软件对个人非商业使用完全免费，源代码完整公开',
                'Free for personal, non-commercial use; source code fully public'
              )}{' '}
              <SparklesIcon size={16} className="inline-icon" />
            </Paragraph>
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
            {tl('感谢您的支持', 'Thank You for Your Support')}{' '}
            <HeartIcon size={18} className="inline-icon" />
          </Title>
          <Paragraph className="sponsor-modal-desc">
            {tl('您的支持是我持续开发的动力！', 'Your support keeps me developing!')}
          </Paragraph>
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
