/**
 * 数据统计面板（纯本地）
 * 展示联机时长、加入次数、房主/成员、最长/平均时长、活跃时段、常玩伙伴排行等。
 */

import React, { useMemo, useState } from 'react';
import { Modal, Empty, Popconfirm, Button, message } from 'antd';
import { statsService, formatDuration, BUCKET_LABELS, type ComputedStats } from '../../services/stats/statsService';
import './StatsPanel.css';

interface StatsPanelProps {
  visible: boolean;
  onClose: () => void;
}

const fmtDate = (ts: number) => (ts > 0 ? new Date(ts).toLocaleDateString() : '—');

export const StatsPanel: React.FC<StatsPanelProps> = ({ visible, onClose }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const stats: ComputedStats = useMemo(() => statsService.getStats(), [visible, refreshKey]);

  const handleClear = () => {
    statsService.clear();
    setRefreshKey((k) => k + 1);
    message.success('统计数据已清除');
  };

  return (
    <Modal title="数据统计" open={visible} onCancel={onClose} footer={null} width={520} centered className="stats-modal">
      {!stats.hasData ? (
        <Empty description="还没有联机记录，开始一局组网吧～" />
      ) : (
        <div className="stats-body">
          <div className="stats-grid">
            <div className="stats-card stats-highlight">
              <div className="stats-val">{formatDuration(stats.totalOnlineMs)}</div>
              <div className="stats-label">累计联机时长</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.joinCount}</div>
              <div className="stats-label">加入大厅次数</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.hostCount}</div>
              <div className="stats-label">作为房主</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.memberCount}</div>
              <div className="stats-label">作为成员</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{formatDuration(stats.maxSessionMs)}</div>
              <div className="stats-label">最长单次</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{formatDuration(stats.avgSessionMs)}</div>
              <div className="stats-label">平均单次</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.uniquePartners}</div>
              <div className="stats-label">组队伙伴总数</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.usedDays}</div>
              <div className="stats-label">已使用天数</div>
            </div>
          </div>

          <div className="stats-row-info">
            <span>最活跃时段：{stats.mostActiveBucket >= 0 ? BUCKET_LABELS[stats.mostActiveBucket] : '—'}</span>
            <span>首次使用：{fmtDate(stats.firstUseTs)}</span>
            <span>最近联机：{fmtDate(stats.lastOnlineTs)}</span>
          </div>

          <div className="stats-buckets">
            {stats.buckets.map((v, i) => {
              const max = Math.max(1, ...stats.buckets);
              return (
                <div key={i} className="stats-bucket">
                  <div className="stats-bucket-bar-box">
                    <div className="stats-bucket-bar" style={{ height: `${(v / max) * 100}%` }} />
                  </div>
                  <div className="stats-bucket-label">{BUCKET_LABELS[i]}</div>
                  <div className="stats-bucket-count">{v}</div>
                </div>
              );
            })}
          </div>

          <div className="stats-partner-title">常玩伙伴排行</div>
          {stats.partners.length === 0 ? (
            <div className="stats-empty-mini">还没有一起玩过的伙伴</div>
          ) : (
            <div className="stats-partner-list">
              {stats.partners.slice(0, 10).map((p, idx) => (
                <div key={p.name} className="stats-partner-item">
                  <span className="stats-partner-rank">{idx + 1}</span>
                  <span className="stats-partner-name">{p.name}</span>
                  <span className="stats-partner-count">{p.count} 次</span>
                </div>
              ))}
            </div>
          )}

          <div className="stats-footer">
            <Popconfirm title="确定清除所有统计数据？" okText="清除" cancelText="取消" onConfirm={handleClear}>
              <Button size="small" danger type="text">清除统计数据</Button>
            </Popconfirm>
          </div>
        </div>
      )}
    </Modal>
  );
};
