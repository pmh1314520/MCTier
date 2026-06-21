import React, { useEffect, useState } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { voiceChangerService, VOICE_PRESETS } from '../../services/voice/voiceChangerService';
import type { VoicePreset } from '../../services/voice/voiceChanger';
import './VoiceChangerPicker.css';

/**
 * 音色选择器（全局默认 / 大厅动态实时切换共用）
 * 切换后立即生效（若正在开麦），并持久化为默认音色。
 * 提供"试听"：开麦说话后约 1 秒延迟回放变声效果。
 */
export const VoiceChangerPicker: React.FC = () => {
  useTranslation();
  const { message } = App.useApp();
  const [preset, setPreset] = useState<VoicePreset>(voiceChangerService.getPreset());
  const [auditioning, setAuditioning] = useState<boolean>(voiceChangerService.isAuditioning());

  // 组件卸载时停止试听，释放麦克风
  useEffect(() => {
    return () => { void voiceChangerService.stopAudition(); };
  }, []);

  const pick = (p: VoicePreset) => {
    setPreset(p);
    voiceChangerService.setPreset(p);
  };

  const toggleAudition = async () => {
    try {
      if (auditioning) {
        await voiceChangerService.stopAudition();
        setAuditioning(false);
      } else {
        await voiceChangerService.startAudition();
        setAuditioning(true);
        message.info(tl('试听已开启：请说话，即可实时听到变声效果', 'Audition on: speak now to hear the effect in real time'));
      }
    } catch (e) {
      console.error(e);
      message.error(tl('无法打开麦克风，请检查权限', 'Cannot access microphone, please check permissions'));
      setAuditioning(false);
    }
  };

  return (
    <div className="vc-picker-wrap">
      <div className="vc-picker">
        {VOICE_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`vc-chip ${preset === p.id ? 'active' : ''}`}
            onClick={() => pick(p.id)}
          >
            {tl(p.zh, p.en)}
          </button>
        ))}
      </div>
      <button
        className={`vc-audition-btn ${auditioning ? 'active' : ''}`}
        onClick={() => { void toggleAudition(); }}
      >
        {auditioning ? tl('停止试听', 'Stop audition') : tl('试听变声', 'Audition voice')}
      </button>
      <div className="vc-risk-note" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,90,90,0.8)' }}>
        {tl(
          '风险提示：变声功能仅供娱乐与正常社交使用，严禁用于电信网络诈骗、冒充他人身份或任何欺骗、骚扰行为，违者自负法律责任。',
          'Notice: the voice changer is for entertainment and normal social use only. Using it for telecom fraud, impersonation, deception or harassment is strictly prohibited; violators bear legal liability.'
        )}
      </div>
    </div>
  );
};
