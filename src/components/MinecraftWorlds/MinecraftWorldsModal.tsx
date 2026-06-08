/**
 * Minecraft 局域网世界自动发现弹窗
 * 扫描大厅内各玩家虚拟 IP 上开放的 Minecraft 服务器（默认 25565），
 * 列出可加入的世界（MOTD/版本/在线人数/延迟），一键复制地址。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Spin, Empty, message, Tag } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '../../stores/appStore';

interface DiscoveredServer {
  ip: string;
  port: number;
  playerName?: string | null;
  motd: string;
  version: string;
  onlinePlayers: number;
  maxPlayers: number;
  latencyMs: number;
}

interface MinecraftWorldsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const MinecraftWorldsModal: React.FC<MinecraftWorldsModalProps> = ({ visible, onClose }) => {
  const { players, lobby, currentPlayerId, config } = useAppStore();
  const [scanning, setScanning] = useState(false);
  const [servers, setServers] = useState<DiscoveredServer[]>([]);

  // 构建 IP -> 玩家名 映射（含自己）
  const buildIpNameMap = useCallback((): Map<string, string> => {
    const map = new Map<string, string>();
    if (lobby?.virtualIp) {
      map.set(lobby.virtualIp, `${config.playerName || '我'}（我）`);
    }
    players.forEach(p => {
      if (p.virtualIp) {
        const isSelf = p.id === currentPlayerId;
        map.set(p.virtualIp, isSelf ? `${p.name}（我）` : p.name);
      }
    });
    return map;
  }, [players, lobby, currentPlayerId, config.playerName]);

  const handleScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const ipNameMap = buildIpNameMap();
      const ips = Array.from(ipNameMap.keys());
      if (ips.length === 0) {
        setServers([]);
        return;
      }
      const result = await invoke<DiscoveredServer[]>('scan_minecraft_servers', {
        peerIps: ips,
        port: 25565,
      });
      // 回填玩家名 + 按延迟排序
      const withNames = result
        .map(s => ({ ...s, playerName: ipNameMap.get(s.ip) ?? s.ip }))
        .sort((a, b) => a.latencyMs - b.latencyMs);
      setServers(withNames);
    } catch (error) {
      console.error('扫描局域网世界失败:', error);
      message.error('扫描失败，请重试');
    } finally {
      setScanning(false);
    }
  }, [scanning, buildIpNameMap]);

  // 打开时自动扫描一次
  useEffect(() => {
    if (visible) {
      void handleScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleCopy = async (server: DiscoveredServer) => {
    const addr = server.port === 25565 ? server.ip : `${server.ip}:${server.port}`;
    try {
      await writeText(addr);
      message.success(`已复制服务器地址：${addr}，在 Minecraft「多人游戏 → 直接连接」粘贴即可加入`);
    } catch {
      message.error('复制失败，请手动输入地址：' + addr);
    }
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title="局域网世界"
      width={560}
      footer={[
        <Button key="refresh" onClick={() => void handleScan()} loading={scanning}>
          重新扫描
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 12, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
        自动扫描大厅成员是否开启了 Minecraft 世界（需对方开启「对局域网开放」或自建服务器，默认端口 25565）。
      </div>

      {scanning && servers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin tip="正在扫描局域网世界..." />
        </div>
      ) : servers.length === 0 ? (
        <Empty description="未发现可加入的世界。请确认对方已在游戏中点击「对局域网开放」或已开服。" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {servers.map((s) => (
            <div
              key={`${s.ip}:${s.port}`}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  {s.playerName} 的世界
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.motd || '（无描述）'}
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag color="blue">{s.version}</Tag>
                  <Tag color="green">{s.onlinePlayers}/{s.maxPlayers} 人</Tag>
                  <Tag color={s.latencyMs < 80 ? 'green' : s.latencyMs < 200 ? 'gold' : 'red'}>
                    {s.latencyMs}ms
                  </Tag>
                  <Tag>{s.port === 25565 ? s.ip : `${s.ip}:${s.port}`}</Tag>
                </div>
              </div>
              <Button type="primary" onClick={() => void handleCopy(s)}>
                复制地址
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};
