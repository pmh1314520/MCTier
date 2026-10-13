import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, ConfigProvider, Modal, Spin, Typography, theme } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tl } from '../../i18n';
import { readThemePreference, resolveTheme } from '../../theme/themePreference';
import compliance from '../../../shared/compliance.json';

export function ComplianceDocuments() {
  const [selected, setSelected] = useState<(typeof compliance.documents)[number] | null>(null);
  const close = () => setSelected(null);
  return <>
    {compliance.documents.map(doc => <div key={doc.id} className="desktop-compliance-document">
      <Button type="text" block aria-haspopup="dialog" onClick={() => setSelected(doc)}>
        {tl(doc.titleZh, doc.titleEn)}
        <svg className="desktop-compliance-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 4 4 4-4 4" /></svg>
      </Button>
    </div>)}
    <Modal
      open={selected !== null}
      title={selected ? tl(selected.titleZh, selected.titleEn) : ''}
      onCancel={close}
      centered
      width={800}
      className="desktop-compliance-reader"
      footer={<Button type="primary" onClick={close}>{tl('我已阅读', 'I have read')}</Button>}
    >
      {selected && <Typography.Paragraph key={selected.id} className="desktop-compliance-body" tabIndex={0}>{tl(selected.zh, selected.en)}</Typography.Paragraph>}
    </Modal>
  </>;
}
export function DesktopComplianceGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setError(''); void invoke<boolean>('get_compliance_consent').then(setAccepted).catch(e => setError(String(e))); };
  useEffect(() => { load(); void getCurrentWindow().show(); }, []);
  const agree = async () => {
    setBusy(true); setError('');
    try { await invoke('accept_compliance'); setAccepted(true); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const disagree = async () => { try { await invoke('exit_app'); } catch (e) { setError(String(e)); } };
  if (accepted) return <>{children}</>;
  const dark = resolveTheme(readThemePreference(), matchMedia('(prefers-color-scheme: dark)').matches) === 'dark';
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: '#27823b' } }}>
    <div className="desktop-compliance-gate" style={{ background: dark ? '#11131c' : '#f3f5f7' }}>
      <Card bordered={false} className="desktop-compliance-card">
        <Typography.Title level={3}>{tl('欢迎使用 MCTier', 'Welcome to MCTier')}</Typography.Title>
        {accepted === null ? <><Spin />{error && <Button onClick={load}>{tl('重新读取', 'Retry')}</Button>}</> : <>
          <Typography.Paragraph>{tl('首次使用前，请阅读以下隐私与协议。点击“同意并继续”表示您已阅读并同意。', 'Before first use, please read the documents below. By selecting Agree & Continue, you confirm that you have read and accepted them.')}</Typography.Paragraph>
          <ComplianceDocuments />
          <Button type="primary" size="large" block loading={busy} onClick={() => void agree()}>{tl('同意并继续', 'Agree & Continue')}</Button>
        </>}
        {error && <Alert type="error" message={error} />}
        <Button type="text" block disabled={busy} onClick={() => void disagree()}>{tl('不同意并退出', 'Disagree & Exit')}</Button>
      </Card>
    </div>
  </ConfigProvider>;
}
