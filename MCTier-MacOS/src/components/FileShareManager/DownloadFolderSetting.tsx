import { useEffect, useState } from 'react';
import { Button, Input, message } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { tl } from '../../i18n';

/** Both settings screens edit the same persisted preference, without restarting the lobby. */
export function DownloadFolderSetting() {
  const [path, setPath] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    invoke<{ fileShareDownloadDir?: string }>('get_settings').then(settings => {
      if (active) { setPath(settings.fileShareDownloadDir || null); setReady(true); }
    }).catch(() => {
      if (active) message.error(tl('加载下载目录失败，请重新打开设置', 'Could not load the download folder; reopen settings'));
    });
    return () => { active = false; };
  }, []);
  const save = async (reset: boolean) => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const selected = reset ? null : await invoke<string | null>('select_file_share_download_folder');
      if (!reset && !selected) return;
      await invoke('set_file_share_download_dir', { path: selected });
      setPath(selected);
      message.success(reset ? tl('已恢复系统默认下载目录', 'System default download folder restored')
        : tl('文件共享下载目录已更新', 'File sharing download folder updated'));
    } catch {
      message.error(tl('保存下载目录失败', 'Failed to save download folder'));
    } finally { setBusy(false); }
  };
  return <div style={{ display: 'grid', gap: 10 }}>
    <Input readOnly aria-label={tl('文件共享下载目录', 'File sharing download folder')}
      value={ready ? path || tl('系统默认下载目录（MCTier）', 'System default download folder (MCTier)') : tl('加载中…', 'Loading…')} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button type="primary" disabled={!ready || busy} onClick={() => void save(false)}>{tl('选择文件夹', 'Choose folder')}</Button>
      {path && <Button disabled={!ready || busy} onClick={() => void save(true)}>{tl('恢复默认', 'Reset')}</Button>}
    </div>
    <div style={{ fontSize: 12, opacity: 0.65 }}>{tl('修改后自动保存，对后续下载生效。', 'Saved automatically and applied to subsequent downloads.')}</div>
  </div>;
}
