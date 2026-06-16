/**
 * 最近联机管理弹窗
 * - 最近进入的大厅：点击即可快速重进（填入表单）
 * - 最近一起联机的玩家：信息展示
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Empty, Tabs, Popconfirm, message } from 'antd';
import { recentService, type RecentLobby, type RecentPlayer } from '../../services/recent/recentService';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';

interface RecentManagerProps {
  visible: boolean;
  onClose: () => void;
  /** 选择一个最近大厅以快速填充表单 */
  onSelectLobby: (lobby: RecentLobby) => void;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return tl('刚刚', 'just now');
  if (min < 60) return `${min}${tl(' 分钟前', ' min ago')}`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}${tl(' 小时前', ' h ago')}`;
  const day = Math.floor(hour / 24);
  return `${day}${tl(' 天前', ' d ago')}`;
}

export const RecentManager: React.FC<RecentManagerProps> = ({ visible, onClose, onSelectLobby }) => {
  useTranslation();
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
    message.success(tl('已填入大厅信息', 'Lobby info filled'));
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
                <Button type="primary" size="small" onClick={() => handleSelect(l)}>{tl('快速重进', 'Rejoin')}</Button>
                <Popconfirm
                  title={tl('从最近列表移除？', 'Remove from recent list?')}
                  onConfirm={() => { recentService.removeLobby(l.name, l.password); refresh(); }}
                  okText={tl('移除', 'Remove')}
                  cancelText={tl('取消', 'Cancel')}
                >
                  <Button size="small" danger>{tl('删除', 'Delete')}</Button>
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
      message.success(tl('已清空最近大厅', 'Recent lobbies cleared'));
    } else {
      recentService.clearPlayers();
      message.success(tl('已清空最近玩家', 'Recent players cleared'));
    }
    refresh();
  };

  return (
    <Modal
      title={tl('最近联机', 'Recent')}
      open={visible}
      onCancel={onClose}
      footer={[
        <Popconfirm
          key="clear"
          title={activeTab === 'lobbies' ? tl('确定清空全部最近大厅？', 'Clear all recent lobbies?') : tl('确定清空全部最近玩家？', 'Clear all recent players?')}
          onConfirm={handleClear}
          okText={tl('清空', 'Clear')}
          cancelText={tl('取消', 'Cancel')}
          okButtonProps={{ danger: true }}
        >
          <Button danger style={{ float: 'left' }}>{tl('清空', 'Clear')}</Button>
        </Popconfirm>,
        <Button key="close" type="primary" onClick={onClose}>{tl('关闭', 'Close')}</Button>,
      ]}
      width={500}
      centered
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'lobbies', label: tl('最近大厅', 'Recent Lobbies'), children: lobbiesTab },
          { key: 'players', label: tl('最近玩家', 'Recent Players'), children: playersTab },
        ]}
      />
    </Modal>
  );
};
