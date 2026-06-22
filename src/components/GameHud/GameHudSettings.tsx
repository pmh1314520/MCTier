import React, { useState } from 'react';
import { Slider } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { gameHudService } from '../../services/gamehud/gameHudService';

/**
 * 游戏内 HUD 浮层配置面板（全局设置 / 大厅动态设置共用）
 * 目前提供透明度调节，拖动后实时持久化并即时作用于 HUD 浮层窗口。
 */
export const GameHudSettings: React.FC = () => {
  useTranslation();
  const [opacity, setOpacity] = useState<number>(() => gameHudService.getOpacity());

  const update = (v: number) => {
    setOpacity(v);
    void gameHudService.setOpacity(v);
  };

  return (
    <div className="snd-manager">
      <div className="snd-block">
        <div className="snd-block-title">
          <span>{tl('HUD 浮层透明度', 'HUD Opacity')}</span>
          <span className="snd-vol-val">{Math.round(opacity * 100)}%</span>
        </div>
        <Slider min={0.2} max={1} step={0.05} value={opacity} onChange={(v) => update(v as number)} />
        <div className="snd-block-desc">
          {tl('调整游戏内 HUD 浮层的透明度，数值越低越不挡视野。在「房间工具 - 联机」中开启 HUD 后即时生效。', 'Adjust the in-game HUD overlay opacity; lower values block your view less. Takes effect immediately once HUD is enabled in Room Tools - Networking.')}
        </div>
      </div>
    </div>
  );
};
