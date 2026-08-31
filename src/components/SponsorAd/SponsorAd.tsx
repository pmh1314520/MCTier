import { useCallback } from 'react';
import { App as AntdApp } from 'antd';
import { tl } from '../../i18n';
import './SponsorAd.css';

/** 赞助商落地页。已加入 tauri.conf.json 的 shell.open 白名单，否则会被拦下。 */
const SPONSOR_URL = 'https://langlangy.cn/?imctier';

/**
 * 赞助商推广位（浪浪云）。
 *
 * 放在「私有服务器」配置附近：自建信令服务器本来就需要一台公网主机，
 * 在这里出现比塞在无关分区更贴合用户当下的意图。
 *
 * Logo 随主题切换由 CSS 完成（`html[data-theme]` + 两张同尺寸图），
 * 不用 JS 读主题，避免主题切换瞬间闪一下旧图。
 */
export const SponsorAd: React.FC = () => {
  const { message } = AntdApp.useApp();

  const openSponsor = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(SPONSOR_URL);
    } catch (error) {
      console.error('打开赞助商页面失败:', error);
      message.error(tl('打开链接失败', 'Failed to open the link'));
    }
  }, [message]);

  return (
    <div className="sponsor-ad">
      <button
        type="button"
        className="sponsor-ad-body"
        onClick={openSponsor}
        title={tl('浪浪云 BGP 服务器 · 让游戏组网延迟更低更快', 'Langlangyun BGP servers — lower latency and faster game networking')}
      >
        <span className="sponsor-ad-logo" role="img" aria-label={tl('浪浪云', 'Langlangyun')} />
        <span className="sponsor-ad-text">
          <span className="sponsor-ad-headline">
            {tl('浪浪云 BGP 服务器', 'Langlangyun BGP Servers')}
          </span>
          <span className="sponsor-ad-sub">
            {tl('让游戏组网延迟更低更快', 'Lower latency and faster game networking')}
          </span>
        </span>
        <span className="sponsor-ad-arrow" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" />
            <path d="M9 7h8v8" />
          </svg>
        </span>
      </button>
      <span className="sponsor-ad-badge">{tl('赞助商', 'Sponsor')}</span>
    </div>
  );
};
