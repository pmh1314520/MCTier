import { useEffect, useState } from 'react';
import { Button, Modal } from 'antd';
import {
  getQuarkSupportSnapshot,
  loadQuarkSupport,
  useQuarkSupport,
} from '../../services/quarkSupport';
import { getLanguage, tl } from '../../i18n';
import { isMacOSPlatform } from '../../utils/platform';
import { QuarkSupportWindow } from './QuarkSupport';

export const OPEN_QUARK_SUPPORT = 'mctier-open-quark-support';

/** Keep the invitation pending while a higher-priority version prompt is active. */
/** macOS 上「启动赞助提示只弹一次」的本地标记键。仅 macOS 生效：其它平台保持原样
 * （每次启动都提示），这是本次仅针对 macOS 体验的小改动。 */
const MACOS_PROMPT_SEEN_KEY = 'mctier.quarkStartupPrompt.seen';

function macosPromptAlreadySeen(): boolean {
  if (!isMacOSPlatform) return false;
  try {
    return localStorage.getItem(MACOS_PROMPT_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markMacosPromptSeen(): void {
  if (!isMacOSPlatform) return;
  try {
    localStorage.setItem(MACOS_PROMPT_SEEN_KEY, '1');
  } catch {
    /* localStorage 不可用时退化为本次会话内不再弹（由 handled 状态兜底） */
  }
}

export function QuarkStartupPrompt({ blocked, onBlockingChange }: { blocked: boolean; onBlockingChange: (blocking: boolean) => void }) {
  const state = useQuarkSupport();
  const [resolved, setResolved] = useState(false);
  // macOS 上若之前已经弹过，初始即视为已处理，启动时不再自动弹出。
  const [handled, setHandled] = useState(() => macosPromptAlreadySeen());
  const [supportOpen, setSupportOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void loadQuarkSupport().catch(() => {}).finally(() => {
      if (active) {
        setResolved(true);
        if (getQuarkSupportSnapshot().loggedIn) setHandled(true);
      }
    });
    const open = () => {
      setHandled(true);
      setSupportOpen(true);
    };
    window.addEventListener(OPEN_QUARK_SUPPORT, open);
    return () => {
      active = false;
      window.removeEventListener(OPEN_QUARK_SUPPORT, open);
    };
  }, []);
  const open = resolved && state.ready && !state.loggedIn && !handled;
  // macOS：提示一旦真正弹出就记下，之后启动不再自动弹（只弹一次）。
  useEffect(() => {
    if (open) markMacosPromptSeen();
  }, [open]);
  useEffect(() => { onBlockingChange(!resolved || open || supportOpen); }, [resolved, open, supportOpen, onBlockingChange]);
  return (
    <>
      <Modal
        open={open && !blocked}
        title={tl('免费持续支持 MCTier', 'Support MCTier for free')}
        centered
        width={420}
        zIndex={900}
        maskClosable={false}
        closable={false}
        onCancel={() => setHandled(true)}
        footer={[
          <Button
            key="later"
            style={{ color: '#686868', background: '#ededed', borderColor: '#d4d4d4' }}
            onClick={() => setHandled(true)}
          >
            {tl('下次一定', 'Maybe next time')}
          </Button>,
          <Button
            key="support"
            type="primary"
            style={{ background: '#27823b', borderColor: '#27823b', color: '#fff' }}
            onClick={() => {
              setHandled(true);
              setSupportOpen(true);
            }}
          >
            {tl('支持一下', 'Support MCTier')}
          </Button>,
        ]}
      >
        <p style={{ textIndent: '2em' }}>
          {getLanguage() === 'en' ? (
            <>Please sign in to <strong className="quark-startup-highlight">Quark</strong> through MCTier. Daily saves can bring in <strong className="quark-startup-highlight">a few tenths of a yuan</strong> to help fund ongoing updates.</>
          ) : (
            <>希望您能在MCTier上登录一下<strong className="quark-startup-highlight">夸克账号</strong>，这样就能每天为MCTier带来<strong className="quark-startup-highlight">几角钱的转存费</strong>以维持软件的更新迭代。</>
          )}
        </p>
        <p style={{ textIndent: '2em' }}>
          {getLanguage() === 'en' ? (
            <>You can keep supporting MCTier development through Quark Drive <strong className="quark-startup-highlight">without spending anything</strong>. Quark covers the costs.</>
          ) : (
            <><strong className="quark-startup-highlight">您不用掏一分钱</strong>，就能<strong className="quark-startup-highlight">利用夸克网盘来持续赞助MCTier</strong>的开发工作，所有的费用都由夸克出。</>
          )}
        </p>
        <p style={{ textIndent: '2em' }}>
          {getLanguage() === 'en' ? (
            <>Your <strong className="quark-startup-highlight">Quark account</strong> credentials are stored locally on your computer, and you can sign out at any time.</>
          ) : (
            <>登上的<strong className="quark-startup-highlight">夸克账号</strong>凭证完全保存在您电脑本地，并且可以随时退出登录。</>
          )}
        </p>
        <p style={{ textIndent: '2em' }}>
          {getLanguage() === 'en' ? (
            <>We hope you will support MCTier. <strong className="quark-startup-highlight">Your support is vital to its continued development</strong>!</>
          ) : (
            <>希望您能支持一下，<strong className="quark-startup-highlight">这对MCTier的发展至关重要</strong>！</>
          )}
        </p>
      </Modal>
      <QuarkSupportWindow
        open={supportOpen && !blocked}
        onClose={() => setSupportOpen(false)}
      />
    </>
  );
}
