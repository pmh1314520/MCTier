import { useEffect, useState } from 'react';
import { tl } from '../../i18n';
import { versionCheckService } from './VersionCheckService';

export function startupVersionStage(mandatory: boolean, checked: boolean, optional: boolean) {
  if (mandatory) return 'mandatory';
  if (!checked) return 'checking';
  return optional ? 'optional' : 'ready';
}

interface StartupUpdate {
  latestVersion: string;
  currentVersion: string;
  updateMessage: string[];
}

/** Mounted only after consent. Keep lower-priority prompts queued until the check settles. */
export function useStartupUpdates() {
  const [checked, setChecked] = useState(false);
  const [update, setUpdate] = useState<StartupUpdate | null>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        if (!versionCheckService.shouldShowUpdatePrompt()) return;
        const info = await versionCheckService.fetchLatestVersion();
        if (!active || !info) return;
        if (info.hasUpdate) {
          const notes = info.updateMessage ? versionCheckService.formatUpdateMessage(info.updateMessage) : [];
          setUpdate({
            latestVersion: info.latestVersion,
            currentVersion: info.currentVersion,
            updateMessage: notes.length ? notes : [tl(
              '该版本未提供更新日志，请前往官网查看详情。',
              'No release notes were provided for this version. Visit the website for details.'
            )],
          });
        }
        versionCheckService.markUpdatePromptShown();
      } catch (error) {
        console.warn('启动版本检查失败:', error);
      } finally {
        // The service bounds the network request. Offline/current/skipped checks all release the queue.
        if (active) setChecked(true);
      }
    };
    // Defer one task so React StrictMode's discarded effect cannot consume the session check.
    const timer = setTimeout(() => void check(), 0);
    return () => { active = false; clearTimeout(timer); };
  }, []);
  return { checked, update, dismiss: () => setUpdate(null) };
}
