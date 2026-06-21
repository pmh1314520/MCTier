/**
 * Minecraft 局域网世界自动发现弹窗
 * 扫描大厅内各玩家虚拟 IP 上开放的 Minecraft 服务器（默认 25565），
 * 列出可加入的世界（MOTD/版本/在线人数/延迟），一键复制地址。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Spin, Empty, message, Tag, InputNumber, Tooltip, Switch } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
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

const DEFAULT_MC_PORT = 25565;
const MC_PORT_KEY = 'mctier_mc_scan_port';
const MC_AUTOLAN_KEY = 'mctier_mc_autolan';

export const MinecraftWorldsModal: React.FC<MinecraftWorldsModalProps> = ({ visible, onClose }) => {
  useTranslation();
  const { players, lobby, currentPlayerId, config } = useAppStore();
  const [scanning, setScanning] = useState(false);
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  // 在 Minecraft 局域网列表自动显示（免输IP）
  const [autoLan, setAutoLan] = useState<boolean>(() => localStorage.getItem(MC_AUTOLAN_KEY) === '1');
  // 扫描端口（默认 25565，支持自定义并本地记忆）
  const [port, setPort] = useState<number>(() => {
    const saved = Number(localStorage.getItem(MC_PORT_KEY));
    return saved >= 1 && saved <= 65535 ? saved : DEFAULT_MC_PORT;
  });

  // 自身虚拟 IP（广播时排除自己的世界，避免把自己代理给自己）
  const selfIp = lobby?.virtualIp || players.find(p => p.id === currentPlayerId)?.virtualIp || '';

  // 把发现的（非自己的）服务器推送到本机 Minecraft 局域网列表
  const pushBroadcast = useCallback(async (list: DiscoveredServer[]) => {
    const payload = list
      .filter(s => s.ip && s.ip !== selfIp)
      .map(s => ({ ip: s.ip, port: s.port, motd: s.motd || '' }));
    try { await invoke('start_mc_lan_broadcast', { servers: payload }); } catch (e) { console.warn('LAN 广播失败', e); }
  }, [selfIp]);

  // 构建 IP -> 玩家名 映射（含自己）
  const buildIpNameMap = useCallback((): Map<string, string> => {
    const map = new Map<string, string>();
    if (lobby?.virtualIp) {
      map.set(lobby.virtualIp, `${config.playerName || tl('我', 'Me')}${tl('（我）', ' (Me)')}`);
    }
    players.forEach(p => {
      if (p.virtualIp) {
        const isSelf = p.id === currentPlayerId;
        map.set(p.virtualIp, isSelf ? `${p.name}${tl('（我）', ' (Me)')}` : p.name);
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
        port,
      });
      // 回填玩家名 + 按延迟排序
      const withNames = result
        .map(s => ({ ...s, playerName: ipNameMap.get(s.ip) ?? s.ip }))
        .sort((a, b) => a.latencyMs - b.latencyMs);
      setServers(withNames);
      if (autoLan) void pushBroadcast(withNames);
    } catch (error) {
      console.error('扫描局域网世界失败:', error);
      message.error(tl('扫描失败，请重试', 'Scan failed, please retry'));
    } finally {
      setScanning(false);
    }
  }, [scanning, buildIpNameMap, port, autoLan, pushBroadcast]);

  // 自动显示开关：开启时周期重扫并刷新广播；关闭时停止本机 Minecraft 局域网广播
  useEffect(() => {
    if (!autoLan) {
      void invoke('stop_mc_lan_broadcast').catch(() => {});
      return;
    }
    void handleScan();
    const timer = window.setInterval(() => { void handleScan(); }, 8000);
    return () => { window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLan]);

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
      message.success(`${tl('已复制服务器地址：', 'Server address copied: ')}${addr}${tl('，在 Minecraft「多人游戏 → 直接连接」粘贴即可加入', ' — paste it in Minecraft "Multiplayer → Direct Connect" to join')}`);
    } catch {
      message.error(tl('复制失败，请手动输入地址：', 'Copy failed, please enter the address manually: ') + addr);
    }
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title={tl('局域网世界', 'LAN Worlds')}
      width={560}
      footer={[
        <Button key="refresh" onClick={() => void handleScan()} loading={scanning}>
          {tl('重新扫描', 'Rescan')}
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          {tl('关闭', 'Close')}
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{tl('扫描端口', 'Scan Port')}</span>
        <Tooltip title={tl('Minecraft「对局域网开放」默认端口为 25565；若你自建服务器或修改过端口，请填写实际端口后重新扫描', 'The default port for Minecraft "Open to LAN" is 25565. If you run your own server or changed the port, enter the actual port and rescan')}>
          <InputNumber
            min={1}
            max={65535}
            value={port}
            onChange={(v) => {
              const p = v && v >= 1 && v <= 65535 ? v : DEFAULT_MC_PORT;
              setPort(p);
              try { localStorage.setItem(MC_PORT_KEY, String(p)); } catch { /* ignore */ }
            }}
            style={{ width: 110 }}
          />
        </Tooltip>
        <Button size="small" onClick={() => { setPort(DEFAULT_MC_PORT); try { localStorage.setItem(MC_PORT_KEY, String(DEFAULT_MC_PORT)); } catch { /* ignore */ } }}>
          {tl('默认', 'Default')}
        </Button>
        <Button size="small" type="primary" onClick={() => void handleScan()} loading={scanning}>
          {tl('扫描此端口', 'Scan This Port')}
        </Button>
      </div>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
        {tl(`自动扫描大厅成员是否在端口 ${port} 上开启了 Minecraft 世界（需对方开启「对局域网开放」或自建服务器）。`, `Automatically scans whether lobby members have a Minecraft world open on port ${port} (they must use "Open to LAN" or run a server).`)}
      </div>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(124,207,0,0.10)', border: '1px solid rgba(124,207,0,0.25)' }}>
        <Switch
          checked={autoLan}
          onChange={(v) => { setAutoLan(v); try { localStorage.setItem(MC_AUTOLAN_KEY, v ? '1' : '0'); } catch { /* ignore */ } }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
            {tl('在 Minecraft 局域网列表自动显示（免输IP）', 'Auto-show in Minecraft LAN list (no IP typing)')}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {tl('开启后，大厅内发现的世界会直接出现在你 Minecraft 的「局域网」列表，点一下即可加入；保持开启即可后台持续刷新。', 'When on, discovered worlds appear directly in your Minecraft "LAN" tab — just click to join. Keep it on to refresh in the background.')}
          </div>
        </div>
      </div>

      {scanning && servers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin tip={tl('正在扫描局域网世界...', 'Scanning LAN worlds...')} />
        </div>
      ) : servers.length === 0 ? (
        <Empty description={tl('未发现可加入的世界。请确认对方已在游戏中点击「对局域网开放」或已开服。', 'No joinable worlds found. Make sure others have clicked "Open to LAN" in-game or started a server.')} />
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
                  {s.playerName} {tl('的世界', '\'s World')}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.motd || tl('（无描述）', '(No description)')}
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag color="blue">{s.version}</Tag>
                  <Tag color="green">{s.onlinePlayers}/{s.maxPlayers} {tl('人', '')}</Tag>
                  <Tag color={s.latencyMs < 80 ? 'green' : s.latencyMs < 200 ? 'gold' : 'red'}>
                    {s.latencyMs}ms
                  </Tag>
                  <Tag>{s.port === 25565 ? s.ip : `${s.ip}:${s.port}`}</Tag>
                </div>
              </div>
              <Button type="primary" onClick={() => void handleCopy(s)}>
                {tl('复制地址', 'Copy Address')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};
