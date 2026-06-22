/**
 * 一键连接诊断面板
 * 聚合每位成员的连接类型(P2P直连/中继)、延迟、丢包，给出整体评分与优化建议。
 * 数据来源：get_peer_connection_types(EasyTier 自身统计) + measure_peers_latency(兜底 RTT)。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Tag, Spin, Empty, Progress } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { useAppStore } from '../../stores/appStore';

interface ConnectionDiagnosticModalProps {
  visible: boolean;
  onClose: () => void;
}

interface PeerConn {
  ip: string;
  connType: 'p2p' | 'relay';
  latencyMs?: number | null;
  lossRate?: number;
}

interface Row {
  name: string;
  ip: string;
  connType: 'p2p' | 'relay' | 'unknown';
  latency: number | null;
  loss: number;
}

export const ConnectionDiagnosticModal: React.FC<ConnectionDiagnosticModalProps> = ({ visible, onClose }) => {
  useTranslation();
  const { players, currentPlayerId } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const run = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const others = players.filter(p => p.id !== currentPlayerId && p.virtualIp);
      const ips = others.map(p => p.virtualIp as string);
      if (ips.length === 0) { setRows([]); return; }

      const [conns, lats] = await Promise.all([
        invoke<PeerConn[]>('get_peer_connection_types').catch(() => [] as PeerConn[]),
        invoke<{ ip: string; latencyMs: number | null; lossRate: number }[]>('measure_peers_latency', { peerIps: ips }).catch(() => []),
      ]);
      const connMap = new Map(conns.map(c => [c.ip, c]));
      const latMap = new Map(lats.map(l => [l.ip, l]));

      const result: Row[] = others.map(p => {
        const c = connMap.get(p.virtualIp as string);
        const l = latMap.get(p.virtualIp as string);
        // 延迟优先用 EasyTier 自身统计，否则用兜底探测
        const latency = (c && c.latencyMs != null) ? c.latencyMs : (l ? l.latencyMs : null);
        const loss = (c && c.lossRate != null) ? c.lossRate : (l ? l.lossRate : 0);
        return {
          name: p.name,
          ip: p.virtualIp as string,
          connType: c ? c.connType : 'unknown',
          latency,
          loss,
        };
      });
      setRows(result);
    } finally {
      setLoading(false);
    }
  }, [loading, players, currentPlayerId]);

  useEffect(() => {
    if (visible) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 整体评分与建议
  const reachable = rows.filter(r => r.latency != null);
  const relayCount = rows.filter(r => r.connType === 'relay').length;
  const offlineCount = rows.filter(r => r.latency == null).length;
  const avgLatency = reachable.length > 0 ? Math.round(reachable.reduce((s, r) => s + (r.latency || 0), 0) / reachable.length) : null;
  const maxLoss = rows.reduce((m, r) => Math.max(m, r.loss), 0);

  // 评分（0~100）：基础100，中继/高延迟/丢包/离线扣分
  let score = 100;
  if (avgLatency != null) { if (avgLatency > 200) score -= 30; else if (avgLatency > 100) score -= 15; }
  score -= relayCount * 12;
  score -= offlineCount * 20;
  score -= Math.min(30, maxLoss);
  score = Math.max(0, Math.min(100, score));

  const suggestions: string[] = [];
  if (rows.length === 0) {
    // no-op
  } else {
    if (relayCount > 0) suggestions.push(tl(`${relayCount} 位成员走中继(非直连)，延迟更高。可在高级设置尝试开启「KCP 代理 / QUIC 代理」，或关闭「禁用 P2P / 禁用 UDP 打洞」以促成直连。`, `${relayCount} member(s) are relayed (not P2P). Try enabling KCP/QUIC proxy or disabling "Disable P2P / Disable UDP hole punching" in advanced settings to get direct connections.`));
    if (avgLatency != null && avgLatency > 150) suggestions.push(tl('平均延迟偏高。可尝试更换更近的 EasyTier 节点，或开启「延迟优先」。', 'Average latency is high. Try a closer EasyTier node or enable "Latency first".'));
    if (maxLoss >= 10) suggestions.push(tl('存在明显丢包，建议检查本地网络/WiFi 信号，或改用有线网络。', 'Noticeable packet loss. Check your local network/Wi-Fi or use a wired connection.'));
    if (offlineCount > 0) suggestions.push(tl(`${offlineCount} 位成员暂时不可达，可能对方未就绪或网络受限。`, `${offlineCount} member(s) are unreachable; they may not be ready or are network-restricted.`));
    if (suggestions.length === 0) suggestions.push(tl('连接质量良好，无需调整。', 'Connection quality is good. No action needed.'));
  }

  const scoreColor = score >= 80 ? '#52c41a' : score >= 50 ? '#faad14' : '#ff4d4f';

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title={tl('连接诊断', 'Connection Diagnostics')}
      width={560}
      footer={[
        <Button key="rescan" onClick={() => void run()} loading={loading}>{tl('重新诊断', 'Re-run')}</Button>,
        <Button key="close" type="primary" onClick={onClose}>{tl('关闭', 'Close')}</Button>,
      ]}
    >
      {loading && rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}><Spin tip={tl('正在诊断连接质量…', 'Diagnosing...')} /></div>
      ) : rows.length === 0 ? (
        <Empty description={tl('暂无其他成员可诊断', 'No other members to diagnose')} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <Progress type="dashboard" percent={score} size={90} strokeColor={scoreColor} format={(p) => <span style={{ color: scoreColor, fontWeight: 700 }}>{p}</span>} />
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.9 }}>
              <div>{tl('成员', 'Members')}：{rows.length}　{tl('直连', 'P2P')}：{rows.length - relayCount - offlineCount}　{tl('中继', 'Relay')}：{relayCount}</div>
              <div>{tl('平均延迟', 'Avg latency')}：{avgLatency != null ? `${avgLatency}ms` : '—'}　{tl('最高丢包', 'Max loss')}：{maxLoss}%</div>
              <div>{tl('不可达', 'Offline')}：{offlineCount}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {rows.map((r) => (
              <div key={r.ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ minWidth: 0, flex: 1, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                {r.connType === 'p2p' && <Tag color="green">{tl('直连', 'P2P')}</Tag>}
                {r.connType === 'relay' && <Tag color="gold">{tl('中继', 'Relay')}</Tag>}
                {r.connType === 'unknown' && <Tag>{tl('未知', 'Unknown')}</Tag>}
                <Tag color={r.latency == null ? 'red' : r.latency < 80 ? 'green' : r.latency < 200 ? 'gold' : 'orange'}>
                  {r.latency == null ? tl('不可达', 'Offline') : `${r.latency}ms`}
                </Tag>
                {r.loss > 0 && <Tag color="volcano">{tl('丢包', 'Loss')} {r.loss}%</Tag>}
              </div>
            ))}
          </div>

          <div style={{ background: 'rgba(124,207,0,0.08)', border: '1px solid rgba(124,207,0,0.25)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#7ccf00' }}>{tl('优化建议', 'Suggestions')}</div>
            {suggestions.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.7 }}>· {s}</div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};
