/**
 * 数据统计面板（纯本地）
 * 展示联机时长、加入次数、房主/成员、最长/平均时长、活跃时段、常玩伙伴排行等。
 */

import React, { useEffect, useState } from 'react';
import { Modal, Empty, Popconfirm, Button, message } from 'antd';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { statsService, formatDuration, BUCKET_LABELS, type ComputedStats } from '../../services/stats/statsService';
import './StatsPanel.css';

interface StatsPanelProps {
  visible: boolean;
  onClose: () => void;
}

const fmtDate = (ts: number) => (ts > 0 ? new Date(ts).toLocaleDateString() : '—');

/** 房主/成员占比环形图 */
const Donut: React.FC<{ host: number; member: number }> = ({ host, member }) => {
  const total = host + member;
  const r = 38, c = 2 * Math.PI * r;
  const hostFrac = total > 0 ? host / total : 0;
  const hostLen = c * hostFrac;
  return (
    <div className="stats-donut">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="12" />
        {total > 0 && (
          <>
            <circle cx="50" cy="50" r={r} fill="none" stroke="#1668dc" strokeWidth="12"
              strokeDasharray={`${c} ${c}`} strokeLinecap="round" transform="rotate(-90 50 50)" />
            <motion.circle cx="50" cy="50" r={r} fill="none" stroke="#52c41a" strokeWidth="12"
              strokeLinecap="round" transform="rotate(-90 50 50)"
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${hostLen} ${c - hostLen}` }}
              transition={{ duration: 0.7, ease: 'easeOut' }} />
          </>
        )}
        <text x="50" y="48" textAnchor="middle" className="stats-donut-num">{total}</text>
        <text x="50" y="64" textAnchor="middle" className="stats-donut-label">总场次</text>
      </svg>
      <div className="stats-donut-legend">
        <div><span className="dot" style={{ background: '#52c41a' }} /> 房主 {host}</div>
        <div><span className="dot" style={{ background: '#1668dc' }} /> 成员 {member}</div>
      </div>
    </div>
  );
};

export const StatsPanel: React.FC<StatsPanelProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<ComputedStats>(() => statsService.getStats());

  useEffect(() => {
    if (visible) setStats(statsService.getStats());
  }, [visible]);

  const handleClear = () => {
    statsService.clear();
    setStats(statsService.getStats());
    message.success(t('stats.cleared'));
  };

  const maxB = Math.max(1, ...stats.buckets);

  return (
    <Modal title={t('stats.title')} open={visible} onCancel={onClose} footer={null} width={540} centered className="stats-modal">
      {!stats.hasData ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: 'rgba(255,255,255,0.55)' }}>{t('stats.empty')}</span>} />
      ) : (
        <motion.div className="stats-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <div className="stats-grid">
            <div className="stats-card stats-highlight">
              <div className="stats-val">{formatDuration(stats.totalOnlineMs)}</div>
              <div className="stats-label">{t('stats.totalOnline')}</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.maxSessionMs > 0 ? formatDuration(stats.maxSessionMs) : '—'}</div>
              <div className="stats-label">{t('stats.maxSession')}</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.avgSessionMs > 0 ? formatDuration(stats.avgSessionMs) : '—'}</div>
              <div className="stats-label">{t('stats.avgSession')}</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.uniquePartners}</div>
              <div className="stats-label">{t('stats.partners')}</div>
            </div>
            <div className="stats-card">
              <div className="stats-val">{stats.usedDays}</div>
              <div className="stats-label">{t('stats.usedDays')}</div>
            </div>
          </div>

          <div className="stats-section">
            <div className="stats-section-title">{t('stats.joinCount')}</div>
            <Donut host={stats.hostCount} member={stats.memberCount} />
          </div>

          <div className="stats-section">
            <div className="stats-section-title">{t('stats.activeBucket')}</div>
            <div className="stats-buckets">
              {stats.buckets.map((v, i) => (
                <div key={i} className="stats-bucket">
                  <div className="stats-bucket-bar-box">
                    <motion.div className={`stats-bucket-bar ${i === stats.mostActiveBucket ? 'peak' : ''}`}
                      initial={{ height: 0 }} animate={{ height: `${(v / maxB) * 100}%` }}
                      transition={{ duration: 0.5, delay: i * 0.06 }} />
                  </div>
                  <div className="stats-bucket-label">{BUCKET_LABELS[i]}</div>
                  <div className="stats-bucket-count">{v}</div>
                </div>
              ))}
            </div>
            <div className="stats-row-info">
              <span>{t('stats.firstUse')}：{fmtDate(stats.firstUseTs)}</span>
              <span>{t('stats.lastOnline')}：{fmtDate(stats.lastOnlineTs)}</span>
            </div>
          </div>

          <div className="stats-section">
            <div className="stats-section-title">{t('stats.partnerRank')}</div>
            {stats.partners.length === 0 ? (
              <div className="stats-empty-mini">{t('stats.noPartner')}</div>
            ) : (
              <div className="stats-partner-list">
                {stats.partners.slice(0, 10).map((p, idx) => (
                  <motion.div key={p.name} className="stats-partner-item"
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}>
                    <span className={`stats-partner-rank rank-${idx < 3 ? idx + 1 : 'n'}`}>{idx + 1}</span>
                    <span className="stats-partner-name">{p.name}</span>
                    <span className="stats-partner-count">{p.count} 次</span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          <div className="stats-footer">
            <Popconfirm title={t('stats.clearConfirm')} okText={t('common.confirm')} cancelText={t('common.cancel')} onConfirm={handleClear}>
              <Button size="small" danger>{t('stats.clear')}</Button>
            </Popconfirm>
          </div>
        </motion.div>
      )}
    </Modal>
  );
};
