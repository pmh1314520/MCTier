import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Modal, Spin, Tabs } from 'antd';
import {
  DesktopOutlined,
  AppstoreOutlined,
  CheckCircleFilled,
  ReloadOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import {
  registerCapturePicker,
  type CaptureChoice,
  type CaptureSource,
} from '../../services/screenShare/nativeCapture';
import './NativeCapture.css';

export function NativeCapturePicker() {
  useTranslation();
  const [request, setRequest] = useState<CaptureChoice | null>(null);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [kind, setKind] = useState('monitor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(() => registerCapturePicker(setRequest), []);
  const refresh = async () => {
    const version = ++revision.current;
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const next = await invoke<CaptureSource[]>('native_capture_sources');
      if (version !== revision.current) return;
      setSources(request?.remote ? next.filter((s) => s.kind === 'monitor' && s.primary) : next);
    } catch (e) {
      if (version === revision.current) {
        setSources([]);
        setError(String(e));
      }
    } finally {
      if (version === revision.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (request) {
      setKind('monitor');
      void refresh();
    }
    return () => {
      ++revision.current;
    };
  }, [request]);
  const visible = sources.filter((source) => source.kind === kind);
  return (
    <Modal
      open={!!request}
      title={request?.recording ? tl('选择要录制的内容', 'Choose what to record') : tl('选择要共享的内容', 'Choose what to share')}
      centered
      width={680}
      className="native-capture-picker"
      rootClassName="native-capture-picker-root"
      zIndex={100010}
      maskClosable={false}
      onCancel={() => request?.reject(new DOMException('Cancelled', 'AbortError'))}
      okText={request?.recording ? tl('录制所选内容', 'Record selected source') : tl('共享所选内容', 'Share selected source')}
      cancelText={tl('取消', 'Cancel')}
      okButtonProps={{ disabled: !selected || loading }}
      onOk={() => {
        if (selected) request?.resolve(selected);
      }}
    >
      <p className="capture-description">
        {request?.recording ? tl('选择要录制的显示器或窗口。', 'Choose a display or window to record.') : request?.remote
          ? tl(
              '选择主显示器后，对方才能看到并控制你的屏幕。你随时可以停止。',
              'Choose the primary display to let the peer see and control it. You can stop at any time.'
            )
          : tl(
              '仅共享你选择的显示器或窗口。共享开始后，可在 MCTier 窗口中点击“停止共享”；离开大厅时会自动停止。',
              'Only the selected display or window is shared. Click Stop sharing in MCTier to end it, or leave the lobby to stop automatically.'
            )}
      </p>
      <Tabs
        activeKey={kind}
        onChange={(value) => {
          setKind(value);
          setSelected(null);
        }}
        tabBarExtraContent={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void refresh()}
            loading={loading}
          >
            {tl('刷新', 'Refresh')}
          </Button>
        }
        items={[
          { key: 'monitor', label: tl('整个屏幕', 'Displays') },
          ...(!request?.remote ? [{ key: 'window', label: tl('应用窗口', 'Windows') }] : []),
        ]}
      />
      {error && (
        <Alert
          type="error"
          showIcon
          message={tl('无法获取共享目标', 'Cannot list capture sources')}
          description={error}
        />
      )}
      <Spin spinning={loading}>
        <div
          className="capture-source-grid"
          role="group"
          aria-label={tl('共享目标', 'Capture sources')}
        >
          {visible.map((source, index) => (
            <button
              type="button"
              key={source.id}
              className={`capture-source ${selected?.id === source.id ? 'selected' : ''}`}
              aria-pressed={selected?.id === source.id}
              onClick={() => setSelected(source)}
            >
              <span className="capture-source-icon">
                {source.kind === 'monitor' ? <DesktopOutlined /> : <AppstoreOutlined />}
              </span>
              <strong>
                {source.kind === 'monitor'
                  ? `${tl('显示器', 'Display')} ${index + 1}${source.primary ? tl('（主屏）', ' (Primary)') : ''}`
                  : source.name}
              </strong>
              <span className="capture-source-size">
                {source.width} × {source.height}
              </span>
              {selected?.id === source.id && <CheckCircleFilled className="capture-selected" />}
            </button>
          ))}
          {!loading && !visible.length && !error && (
            <Empty
              description={tl(
                '没有可共享的目标，请还原窗口后刷新',
                'No sources. Restore a window and refresh.'
              )}
            />
          )}
        </div>
      </Spin>
    </Modal>
  );
}
