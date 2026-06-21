import React, { useState } from 'react';
import { Switch, Slider, App } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { danmakuService, type DanmakuConfig } from '../../services/danmaku/danmakuService';

/**
 * 消息弹幕配置面板（全局设置 / 大厅动态设置共用）
 * 配置实时持久化并生效，无需退出大厅即可调整。
 */
export const DanmakuSettings: React.FC = () => {
  useTranslation();
  const { message: antdMessage } = App.useApp();
  const [cfg, setCfg] = useState<DanmakuConfig>(() => danmakuService.getConfig());

  const update = (patch: Partial<DanmakuConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {['#ffffff', '#52c41a', '#1890ff', '#faad14', '#ff4d4f', '#eb2f96'].map((c) => (
            <span
              key={c}
              onClick={() => update({ color: c })}
              title={c}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', flexShrink: 0,
                border: cfg.color.toLowerCase() === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.25)',
                boxShadow: cfg.color.toLowerCase() === c ? '0 0 6px rgba(255,255,255,0.6)' : 'none',
              }}
            />
          ))}
          <span
            onClick={() => update({ color: 'rainbow' })}
            title={tl('彩色（每条随机）', 'Rainbow (random per message)')}
            style={{
              width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
              background: 'conic-gradient(#ff4d4f,#faad14,#52c41a,#1890ff,#eb2f96,#ff4d4f)',
              border: cfg.color === 'rainbow' ? '2px solid #fff' : '2px solid rgba(255,255,255,0.25)',
              boxShadow: cfg.color === 'rainbow' ? '0 0 6px rgba(255,255,255,0.8)' : 'none',
            }}
          />
          <input
            type="color"
            value={cfg.color === 'rainbow' ? '#ffffff' : cfg.color}
            onChange={(e) => update({ color: e.target.value })}
            title={tl('自定义颜色', 'Custom color')}
            style={{ width: 34, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
          />
        </div>
      </div>

      {/* 行内预览 */}
      <div className="snd-block">
        <div className="snd-block-title-text">{tl('预览', 'Preview')}</div>
        <div className="danmaku-preview-box" style={{ opacity: cfg.opacity }}>
          <span
            key={`${cfg.fontSize}-${cfg.speed}-${sampleDuration}`}
            className={`danmaku-preview-bullet ${cfg.color === 'rainbow' ? 'rainbow' : ''}`}
            style={{ fontSize: `${cfg.fontSize}px`, animationDuration: `${sampleDuration}s`, color: cfg.color === 'rainbow' ? undefined : cfg.color }}
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
