/**
 * 游戏快连弹窗
 * 内置常见联机游戏的默认端口模板；选择游戏后：
 * - 作为房主：显示「我的虚拟IP:端口」一键复制，发给好友即可直连；
 * - 加入他人：列出大厅每位玩家的「虚拟IP:端口」，一键复制粘贴进游戏的「直接连接/输入IP」即可。
 * Minecraft 推荐使用「局域网世界」的自动发现（免输IP）。
 */

import React, { useMemo, useState } from 'react';
import { Modal, Button, Tag, InputNumber, message } from 'antd';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { useAppStore } from '../../stores/appStore';

interface GameQuickConnectModalProps {
  visible: boolean;
  onClose: () => void;
}

interface GamePreset {
  id: string;
  name: string;
  enName: string;
  port: number;
  note: string;
  enNote: string;
}

const PRESETS: GamePreset[] = [
  { id: 'mc', name: 'Minecraft Java', enName: 'Minecraft Java', port: 25565, note: '建议用「局域网世界」自动发现免输IP', enNote: 'Tip: use LAN Worlds for auto-discovery' },
  { id: 'mcbe', name: '我的世界 基岩版', enName: 'Minecraft Bedrock', port: 19132, note: '在「好友 → 添加服务器」中填写', enNote: 'Add under Friends → Add Server' },
  { id: 'terraria', name: '泰拉瑞亚', enName: 'Terraria', port: 7777, note: '多人游戏 → 通过IP加入', enNote: 'Multiplayer → Join via IP' },
  { id: 'dst', name: '饥荒联机版', enName: "Don't Starve Together", port: 10999, note: '需房主开服', enNote: 'Host must start a server' },
  { id: 'valheim', name: 'Valheim 英灵神殿', enName: 'Valheim', port: 2456, note: '加入游戏 → 通过IP加入', enNote: 'Join Game → Join via IP' },
  { id: 'source', name: 'CS/起源引擎', enName: 'CS / Source', port: 27015, note: '控制台 connect IP:端口', enNote: 'Console: connect IP:port' },
  { id: 'factorio', name: '异星工厂', enName: 'Factorio', port: 34197, note: '多人游戏 → 连接到地址', enNote: 'Multiplayer → Connect to address' },
];

export const GameQuickConnectModal: React.FC<GameQuickConnectModalProps> = ({ visible, onClose }) => {
  useTranslation();
  const { players, lobby, currentPlayerId, config } = useAppStore();
  const [selected, setSelected] = useState<string>('mc');
  const [customPort, setCustomPort] = useState<number>(25565);

  const preset = PRESETS.find(p => p.id === selected);
  const port = selected === 'custom' ? customPort : (preset?.port ?? 25565);

  const selfIp = lobby?.virtualIp || players.find(p => p.id === currentPlayerId)?.virtualIp || '';

  const others = useMemo(
    () => players.filter(p => p.id !== currentPlayerId && p.virtualIp),
    [players, currentPlayerId],
  );

  const copy = async (addr: string) => {
    try {
      await writeText(addr);
      message.success(`${tl('已复制：', 'Copied: ')}${addr}`);
    } catch {
      message.error(tl('复制失败，请手动复制', 'Copy failed, please copy manually') + '：' + addr);
    }
  };

  const fmt = (ip: string) => `${ip}:${port}`;

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title={tl('游戏快连', 'Game Quick-Connect')}
      width={560}
      footer={[<Button key="close" type="primary" onClick={onClose}>{tl('关闭', 'Close')}</Button>]}
    >
      <div style={{ marginBottom: 10, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
        {tl('选择游戏后，把对应地址粘贴进游戏的「直接连接 / 输入IP」即可与好友联机。', 'Pick a game, then paste the address into the game\'s "Direct Connect / Enter IP" to play with friends.')}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map(p => (
          <Button
            key={p.id}
            size="small"
            type={selected === p.id ? 'primary' : 'default'}
            onClick={() => setSelected(p.id)}
          >
            {tl(p.name, p.enName)}
          </Button>
        ))}
        <Button size="small" type={selected === 'custom' ? 'primary' : 'default'} onClick={() => setSelected('custom')}>
          {tl('自定义', 'Custom')}
        </Button>
        {selected === 'custom' && (
          <InputNumber min={1} max={65535} value={customPort} onChange={(v) => setCustomPort(v && v >= 1 && v <= 65535 ? v : 25565)} style={{ width: 110 }} />
        )}
      </div>

      {selected !== 'custom' && preset && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'rgba(124,207,0,0.9)' }}>
          {tl(preset.note, preset.enNote)}（{tl('端口', 'port')} {port}）
        </div>
      )}

      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>{tl('作为房主分享给好友', 'Share as host')}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid rgba(124,207,0,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, background: 'rgba(124,207,0,0.08)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{config.playerName || tl('我', 'Me')}{tl('（我）', ' (Me)')}</div>
          <div style={{ fontWeight: 600 }}>{selfIp ? fmt(selfIp) : tl('未分配虚拟IP', 'No virtual IP yet')}</div>
        </div>
        <Button type="primary" disabled={!selfIp} onClick={() => void copy(fmt(selfIp))}>{tl('复制地址', 'Copy')}</Button>
      </div>

      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>{tl('加入其他玩家', 'Join others')}</div>
      {others.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{tl('暂无其他玩家', 'No other players yet')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {others.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <Tag style={{ marginTop: 2 }}>{fmt(p.virtualIp!)}</Tag>
              </div>
              <Button onClick={() => void copy(fmt(p.virtualIp!))}>{tl('复制地址', 'Copy')}</Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};
