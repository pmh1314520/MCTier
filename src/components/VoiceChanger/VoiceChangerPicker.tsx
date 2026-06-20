import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { voiceChangerService, VOICE_PRESETS } from '../../services/voice/voiceChangerService';
import type { VoicePreset } from '../../services/voice/voiceChanger';
import './VoiceChangerPicker.css';

/**
 * 音色选择器（全局默认 / 大厅动态实时切换共用）
 * 切换后立即生效（若正在开麦），并持久化为默认音色。
 */
export const VoiceChangerPicker: React.FC = () => {
  useTranslation();
  const [preset, setPreset] = useState<VoicePreset>(voiceChangerService.getPreset());

  const pick = (p: VoicePreset) => {
    setPreset(p);
    voiceChangerService.setPreset(p);
  };

  return (
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
  );
};
