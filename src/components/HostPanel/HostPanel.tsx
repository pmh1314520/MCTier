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

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface HostPanelProps {
  visible: boolean;
  onClose: () => void;
}

export const HostPanel: React.FC<HostPanelProps> = ({ visible, onClose }) => {
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

  useEffect(() => {
    if (visible) {
      setMaxValue(maxPlayers ?? 0);
      setPub(isPublicLobby);
      setAnnounceDraft(announcement);
    }
  }, [visible, maxPlayers, isPublicLobby, announcement]);

  // 当前在线人数（含自己）= 其他玩家 + 1
  const currentCount = players.length + 1;

  const applyMax = () => {
    const v = Math.max(0, Math.min(100, maxValue || 0));
    if (v !== 0 && v < currentCount) {
      message.warning(`人数上限不能小于当前在线人数（${currentCount}）`);
      return;
    }
    webrtcClient.setLobbyOptions({ maxPlayers: v });
    message.success(v === 0 ? '已取消人数上限' : `人数上限已设为 ${v}`);
  };

  const applyPublic = (checked: boolean) => {
    setPub(checked);
    webrtcClient.setLobbyOptions({
      isPublic: checked,
      description: desc,
      // 公开时附带明文密码，供广场内一键加入
      password: checked ? (lobby?.password || '') : undefined,
    });
    message.success(checked ? '已发布到公开广场' : '已从公开广场下架');
  };

  const publishAnnounce = () => {
    const text = announceDraft.trim();
    setAnnouncement(text);
    void p2pChatService.sendControlMessage('announce', text);
    message.success(text ? '公告已发布' : '已清空公告');
  };

  return (
    <Modal title="房主管理" open={visible} onCancel={onClose} footer={[
      <Button key="close" type="primary" onClick={onClose}>完成</Button>,
    ]} width={440} centered>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text strong>人数上限</Text>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            0 表示不限制。当前在线 {currentCount} 人。
          </Paragraph>
          <Space>
            <InputNumber min={0} max={100} value={maxValue} onChange={(v) => setMaxValue(v ?? 0)} />
            <Button type="primary" onClick={applyMax}>应用</Button>
          </Space>
        </div>

        <div>
          <Space align="center">
            <Text strong>发布到公开广场</Text>
            <Switch checked={pub} onChange={applyPublic} />
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            公开后，陌生人可在「公开广场」看到该大厅并一键加入（会公开大厅密码用于加入）。适合开服自由联机。
          </Paragraph>
          <TextArea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => { if (pub) webrtcClient.setLobbyOptions({ isPublic: true, description: desc, password: lobby?.password || '' }); }}
            placeholder="可选：填写大厅描述（如玩法、版本），展示在广场上"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={100}
          />
        </div>

        <div>
          <Text strong>大厅公告</Text>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 8 }}>
            公告会在所有成员的大厅顶部以滚动条形式展示，新加入的玩家也会自动看到（适合写玩法规则、服务器地址等）。
          </Paragraph>
          <TextArea
            value={announceDraft}
            onChange={(e) => setAnnounceDraft(e.target.value)}
            placeholder="输入公告内容，留空并发布可清除公告"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={200}
          />
          <Space style={{ marginTop: 10 }}>
            <Button type="primary" onClick={publishAnnounce}>发布公告</Button>
            {announcement && (
              <Button onClick={() => { setAnnounceDraft(''); setAnnouncement(''); void p2pChatService.sendControlMessage('announce', ''); message.success('已清空公告'); }}>清空</Button>
            )}
          </Space>
        </div>
      </Space>
    </Modal>
  );
};
