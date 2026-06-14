/**
 * 最近联机管理弹窗
 * - 最近进入的大厅：点击即可快速重进（填入表单）
 * - 最近一起联机的玩家：信息展示
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Empty, Tabs, Popconfirm, message } from 'antd';
import { recentService, type RecentLobby, type RecentPlayer } from '../../services/recent/recentService';

interface RecentManagerProps {
  visible: boolean;
  onClose: () => void;
  /** 选择一个最近大厅以快速填充表单 */
  onSelectLobby: (lobby: RecentLobby) => void;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return `${day} 天前`;
}

export const RecentManager: React.FC<RecentManagerProps> = ({ visible, onClose, onSelectLobby }) => {
  const [lobbies, setLobbies] = useState<RecentLobby[]>([]);
  const [players, setPlayers] = useState<RecentPlayer[]>([]);
  const [activeTab, setActiveTab] = useState<string>('lobbies');

  const refresh = () => {
    setLobbies(recentService.getRecentLobbies());
    setPlayers(recentService.getRecentPlayers());
  };

  useEffect(() => {
    if (visible) refresh();
  }, [visible]);

  const handleSelect = (lobby: RecentLobby) => {
    onSelectLobby(lobby);
    onClose();
    message.success('已填入大厅信息');
  };

  const lobbiesTab = (
    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
      {lobbies.length === 0 ? (
        <Empty description="暂无最近进入的大厅" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lobbies.map((l) => (
            <div
              key={`${l.name}|${l.password}`}
              onClick={() => handleSelect(l)}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                  {l.playerName ? `玩家：${l.playerName} · ` : ''}{formatTime(l.lastJoined)}
                </div>
              </div>
              <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button type="primary" size="small" onClick={() => handleSelect(l)}>快速重进</Button>
                <Popconfirm
                  title="从最近列表移除？"
                  onConfirm={() => { recentService.removeLobby(l.name, l.password); refresh(); }}
                  okText="移除"
                  cancelText="取消"
                >
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const playersTab = (
    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
      {players.length === 0 ? (
        <Empty description="暂无最近联机的玩家" />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {players.map((p) => (
            <div
              key={p.name}
              title={`${formatTime(p.lastSeen)} · 共 ${p.count} 次`}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 16,
                padding: '4px 12px',
                fontSize: 13,
              }}
            >
              {p.name}
              <span style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 6, fontSize: 11 }}>
                {formatTime(p.lastSeen)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const handleClear = () => {
    if (activeTab === 'lobbies') {
      recentService.clearLobbies();
      message.success('已清空最近大厅');
    } else {
      recentService.clearPlayers();
      message.success('已清空最近玩家');
    }
    refresh();
  };

  return (
    <Modal
      title="最近联机"
      open={visible}
      onCancel={onClose}
      footer={[
        <Popconfirm
          key="clear"
          title={activeTab === 'lobbies' ? '确定清空全部最近大厅？' : '确定清空全部最近玩家？'}
          onConfirm={handleClear}
          okText="清空"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button danger style={{ float: 'left' }}>清空</Button>
        </Popconfirm>,
        <Button key="close" type="primary" onClick={onClose}>关闭</Button>,
      ]}
      width={500}
      centered
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'lobbies', label: '最近大厅', children: lobbiesTab },
          { key: 'players', label: '最近玩家', children: playersTab },
        ]}
      />
    </Modal>
  );
};
