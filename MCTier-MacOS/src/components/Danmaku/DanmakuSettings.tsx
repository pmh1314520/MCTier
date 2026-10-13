import React, { useState } from 'react';
import { Switch, Slider, App, ColorPicker } from 'antd';
import { CheckOutlined, BgColorsOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { danmakuService, type DanmakuConfig } from '../../services/danmaku/danmakuService';
import { randomDanmakuColor } from '../../services/danmaku/colors';
import './DanmakuSettings.css';

const PRESETS = ['#ffffff', '#52c41a', '#1890ff', '#faad14', '#ff4d4f', '#eb2f96'];

/**
 * 消息弹幕配置面板（全局设置 / 大厅动态设置共用）
 * 配置实时持久化并生效，无需退出大厅即可调整。
 */
export const DanmakuSettings: React.FC = () => {
  useTranslation();
  const { message: antdMessage } = App.useApp();
  const [cfg, setCfg] = useState<DanmakuConfig>(() => danmakuService.getConfig());
  const [randomColor, setRandomColor] = useState(randomDanmakuColor);

  const update = (patch: Partial<DanmakuConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (patch.color === 'rainbow') setRandomColor(randomDanmakuColor());
    void danmakuService.setConfig(patch);
  };

  // 行内预览：用当前配置循环播放一条示例弹幕
  const sampleDuration = Math.max(3, (520 + cfg.fontSize * 8) / cfg.speed);

  return (
    <div className="snd-manager">
      <div className="snd-block" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="snd-block-title-text">{tl('启用消息弹幕', 'Enable Danmaku')}</div>
          <div className="snd-block-desc">{tl('聊天消息将以弹幕飘过屏幕顶部，并置顶于其他窗口之上', 'Chat messages float across the top, above other windows')}</div>
        </div>
        <Switch checked={cfg.enabled} onChange={(v) => update({ enabled: v })} />
      </div>

      <div className="snd-block">
        <div className="snd-block-title"><span>{tl('字号', 'Font Size')}</span><span className="snd-vol-val">{cfg.fontSize}px</span></div>
        <Slider min={14} max={48} step={1} value={cfg.fontSize} onChange={(v) => update({ fontSize: v as number })} />
      </div>
      <div className="snd-block">
        <div className="snd-block-title"><span>{tl('滚动速度', 'Speed')}</span><span className="snd-vol-val">{cfg.speed}px/s</span></div>
        <Slider min={60} max={320} step={10} value={cfg.speed} onChange={(v) => update({ speed: v as number })} />
      </div>
      <div className="snd-block">
        <div className="snd-block-title"><span>{tl('不透明度', 'Opacity')}</span><span className="snd-vol-val">{Math.round(cfg.opacity * 100)}%</span></div>
        <Slider min={0.2} max={1} step={0.05} value={cfg.opacity} onChange={(v) => update({ opacity: v as number })} />
      </div>
      <div className="snd-block">
        <div className="snd-block-title"><span>{tl('弹幕轨道数', 'Tracks')}</span><span className="snd-vol-val">{cfg.tracks}</span></div>
        <Slider min={1} max={10} step={1} value={cfg.tracks} onChange={(v) => update({ tracks: v as number })} />
      </div>
      <div className="snd-block">
        <div className="snd-block-title-text">{tl('弹幕颜色', 'Danmaku Color')}</div>
        <div className="snd-block-desc">{tl('自定义弹幕文字颜色', 'Customize the danmaku text color')}</div>
        <div className="danmaku-color-options" role="group" aria-label={tl('弹幕颜色', 'Danmaku color')}>
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className="danmaku-color-swatch"
              aria-label={c}
              aria-pressed={cfg.color.toLowerCase() === c}
              onClick={() => update({ color: c })}
              title={c}
              style={{ background: c }}
            >{cfg.color.toLowerCase() === c && <CheckOutlined className="danmaku-color-check" />}</button>
          ))}
          <button
            type="button"
            className="danmaku-color-swatch danmaku-color-random"
            aria-label={tl('彩色（每条随机）', 'Rainbow (random per message)')}
            aria-pressed={cfg.color === 'rainbow'}
            onClick={() => update({ color: 'rainbow' })}
            title={tl('彩色（每条随机）', 'Rainbow (random per message)')}
          >{cfg.color === 'rainbow' && <CheckOutlined className="danmaku-color-check" />}</button>
          <ColorPicker
            value={cfg.color === 'rainbow' ? '#ffffff' : cfg.color}
            onChange={color => update({ color: color.toHexString() })}
            disabledAlpha
            format="hex"
            placement="bottomRight"
            rootClassName="mctier-color-picker"
            getPopupContainer={trigger => trigger.parentElement ?? document.body}
          >
            <button type="button" className="danmaku-color-custom" aria-label={tl('自定义颜色', 'Custom color')}
              aria-pressed={cfg.color !== 'rainbow' && !PRESETS.includes(cfg.color.toLowerCase())}>
              <BgColorsOutlined /><span>{tl('自定义', 'Custom')}</span>
              {cfg.color !== 'rainbow' && !PRESETS.includes(cfg.color.toLowerCase()) && <CheckOutlined />}
            </button>
          </ColorPicker>
        </div>
      </div>

      {/* 行内预览 */}
      <div className="snd-block">
        <div className="snd-block-title-text">{tl('预览', 'Preview')}</div>
        <div className="danmaku-preview-box" style={{ opacity: cfg.opacity }}>
          <span
            key={`${cfg.fontSize}-${cfg.speed}-${sampleDuration}-${cfg.color}`}
            className="danmaku-preview-bullet"
            onAnimationIteration={() => { if (cfg.color === 'rainbow') setRandomColor(randomDanmakuColor()); }}
            style={{
              fontSize: `${cfg.fontSize}px`,
              animationDuration: `${sampleDuration}s`,
              color: cfg.color === 'rainbow' ? randomColor : cfg.color,
              ['--danmaku-preview-color' as string]: cfg.color === 'rainbow' ? randomColor : cfg.color,
            }}
          >
            {tl('示例弹幕：开黑走起！🎮', 'Sample danmaku: Let\'s game! 🎮')}
          </span>
        </div>
        <button
          className="snd-text-btn"
          style={{ marginTop: 8 }}
          onClick={() => { void danmakuService.preview(tl('这是一条弹幕预览 🎮', 'This is a danmaku preview 🎮')); antdMessage.success(tl('已在屏幕上预览', 'Previewing on screen')); }}
        >
          {tl('在屏幕上预览', 'Preview on screen')}
        </button>
      </div>
    </div>
  );
};
