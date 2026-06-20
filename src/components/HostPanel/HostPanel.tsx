/**
 * 房主管理面板
 * - 设置人数上限（0 = 不限）
 * - 发布/取消发布到公开广场（公开后陌生人可在广场看到并加入）
 * 仅房主可见与操作。
 */

import React, { useState, useEffect } from 'react';
import { Modal, InputNumber, Switch, Input, Button, Typography, Space, App as AntdApp } from 'antd';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface HostPanelProps {
  visible: boolean;
  onClose: () => void;
}

export const HostPanel: React.FC<HostPanelProps> = ({ visible, onClose }) => {
  useTranslation();
  const { message } = AntdApp.useApp();
  const maxPlayers = useAppStore((s) => s.maxPlayers);
  const isPublicLobby = useAppStore((s) => s.isPublicLobby);
  const lobby = useAppStore((s) => s.lobby);
  const players = useAppStore((s) => s.players);
  const announcement = useAppStore((s) => s.announcement);
  const setAnnouncement = useAppStore((s) => s.setAnnouncement);

  const [maxValue, setMaxValue] = useState<number>(maxPlayers ?? 0);
  const [pub, setPub] = useState<boolean>(isPublicLobby);
  const [desc, setDesc] = useState<string>('');
  const [announceDraft, setAnnounceDraft] = useState<string>('');
  const descStorageKey = lobby?.name ? `mctier_lobby_description_${lobby.name}` : '';

  useEffect(() => {
    if (visible) {
      setMaxValue(maxPlayers ?? 0);
      setPub(isPublicLobby);
      setDesc(descStorageKey ? (localStorage.getItem(descStorageKey) || '') : '');
      setAnnounceDraft(announcement);
    }
  }, [visible, maxPlayers, isPublicLobby, announcement, descStorageKey]);

  // 当前在线人数（含自己）= 其他玩家 + 1
  const currentCount = players.length + 1;

  const applyMax = () => {
    const v = Math.max(0, Math.min(100, maxValue || 0));
    if (v !== 0 && v < currentCount) {
      message.warning(tl('人数上限不能小于当前在线人数（', 'Max players cannot be less than current online count (') + currentCount + '）');
      return;
    }
    webrtcClient.setLobbyOptions({ maxPlayers: v });
    message.success(v === 0 ? tl('已取消人数上限', 'Player limit removed') : tl('人数上限已设为 ', 'Max players set to ') + v);
  };

  const applyPublic = (checked: boolean) => {
    setPub(checked);
    if (descStorageKey) localStorage.setItem(descStorageKey, desc);
    webrtcClient.setLobbyOptions({
      isPublic: checked,
      description: desc,
      // 公开时附带明文密码，供广场内一键加入
      password: checked ? (lobby?.password || '') : undefined,
      // 公开时附带房主当前使用的节点地址，供广场加入者自动同步（保证节点一致可互通）
      serverNode: checked ? (localStorage.getItem('mctier_current_node') || undefined) : undefined,
    });
    message.success(checked ? tl('已发布到公开广场', 'Published to public plaza') : tl('已从公开广场下架', 'Removed from public plaza'));
  };

  const publishAnnounce = () => {
    const text = announceDraft.trim();
    setAnnouncement(text);
    void p2pChatService.sendControlMessage('announce', text);
    message.success(text ? tl('公告已发布', 'Announcement published') : tl('已清空公告', 'Announcement cleared'));
  };

  return (
    <Modal title={tl('房主管理', 'Host Panel')} open={visible} onCancel={onClose} footer={[
      <Button key="close" type="primary" onClick={onClose}>{tl('完成', 'Done')}</Button>,
    ]} width={440} centered>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text strong>{tl('人数上限', 'Max Players')}</Text>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {tl('0 表示不限制。当前在线 ', '0 = unlimited. Online now: ')}{currentCount}{tl(' 人。', '')}
          </Paragraph>
          <Space>
            <InputNumber min={0} max={100} value={maxValue} onChange={(v) => setMaxValue(v ?? 0)} />
            <Button type="primary" onClick={applyMax}>{tl('应用', 'Apply')}</Button>
          </Space>
        </div>

        <div>
          <Space align="center">
            <Text strong>{tl('发布到公开广场', 'Publish to Plaza')}</Text>
            <Switch checked={pub} onChange={applyPublic} />
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            {tl('公开后，陌生人可在「公开广场」看到该大厅并一键加入（会公开大厅密码用于加入）。适合开服自由联机。', 'Once public, anyone can see and join this lobby from the Public Plaza (the lobby password is exposed for joining).')}
          </Paragraph>
          <TextArea
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              if (descStorageKey) localStorage.setItem(descStorageKey, e.target.value);
            }}
            onBlur={() => {
              if (descStorageKey) localStorage.setItem(descStorageKey, desc);
              if (pub) webrtcClient.setLobbyOptions({ isPublic: true, description: desc, password: lobby?.password || '' });
            }}
            placeholder={tl('可选：填写大厅描述（如玩法、版本），展示在广场上', 'Optional: lobby description (mode, version) shown in the plaza')}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={100}
          />
        </div>

        <div>
          <Text strong>{tl('大厅公告', 'Lobby Announcement')}</Text>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 8 }}>
            {tl('公告会在所有成员的大厅顶部以滚动条形式展示，新加入的玩家也会自动看到（适合写玩法规则、服务器地址等）。', 'The announcement scrolls at the top of every member\u2019s lobby, including newcomers.')}
          </Paragraph>
          <TextArea
            value={announceDraft}
            onChange={(e) => setAnnounceDraft(e.target.value)}
            placeholder={tl('输入公告内容，留空并发布可清除公告', 'Enter an announcement; publish empty to clear')}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={200}
          />
          <Space style={{ marginTop: 10 }}>
            <Button type="primary" onClick={publishAnnounce}>{tl('发布公告', 'Publish')}</Button>
            {announcement && (
              <Button onClick={() => { setAnnounceDraft(''); setAnnouncement(''); void p2pChatService.sendControlMessage('announce', ''); message.success(tl('已清空公告', 'Announcement cleared')); }}>{tl('清空', 'Clear')}</Button>
            )}
          </Space>
        </div>
      </Space>
    </Modal>
  );
};
