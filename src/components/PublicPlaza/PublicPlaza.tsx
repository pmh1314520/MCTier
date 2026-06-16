/**
 * 公开大厅广场
 * - 列出已发布到公开广场的大厅，陌生人可一键加入
 * - 通过临时连接信令服务器查询，不依赖已加入的会话
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Empty, Spin, Typography, Tag, message } from 'antd';
import { fetchPublicLobbies, type PublicLobby } from '../../services/lobby/publicLobbies';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';

const { Text } = Typography;

interface PublicPlazaProps {
  visible: boolean;
  onClose: () => void;
  /** 选择一个公开大厅加入（带出大厅名与密码） */
  onJoin: (lobby: PublicLobby) => void;
  /** 可选自定义信令服务器 */
  signalingServer?: string;
}

export const PublicPlaza: React.FC<PublicPlazaProps> = ({ visible, onClose, onJoin, signalingServer }) => {
  useTranslation();
  const [loading, setLoading] = useState(false);
  const [lobbies, setLobbies] = useState<PublicLobby[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchPublicLobbies(signalingServer);
      setLobbies(list);
    } catch (e) {
      message.error(`获取公开大厅失败：${e}`);
      setLobbies([]);
    } finally {
      setLoading(false);
    }
  }, [signalingServer]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  return (
    <Modal
      title={tl('公开广场', 'Public Plaza')}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="refresh" onClick={() => void refresh()} loading={loading}>{tl('刷新', 'Refresh')}</Button>,
        <Button key="close" type="primary" onClick={onClose}>{tl('关闭', 'Close')}</Button>,
      ]}
      width={520}
      centered
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : lobbies.length === 0 ? (
        <Empty description="暂无公开大厅，邀请房主在「房主管理」中发布吧" />
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lobbies.map((l, i) => {
            const full = !!l.maxPlayers && l.playerCount >= l.maxPlayers;
            return (
              <div
                key={`${l.lobbyName}-${i}`}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {l.lobbyName}
                    <Tag color={full ? 'red' : 'green'}>
                      {l.playerCount}{l.maxPlayers ? `/${l.maxPlayers}` : ''} 人
                    </Tag>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                    房主：{l.hostName}
                    {l.description ? ` · ${l.description}` : ''}
                  </div>
                </div>
                <Button
                  type="primary"
                  size="small"
                  disabled={full}
                  onClick={() => { onJoin(l); onClose(); }}
                >
                  {full ? tl('已满', 'Full') : tl('加入', 'Join')}
                </Button>
              </div>
            );
          })}
          <Text type="secondary" style={{ fontSize: 12 }}>{tl('提示：公开大厅由房主主动公开，加入即进入对应虚拟局域网。', 'Tip: public lobbies are opened by hosts; joining enters their virtual LAN.')}</Text>
        </div>
      )}
    </Modal>
  );
};
