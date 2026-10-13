import { useEffect, useState, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Alert, Button, Select, Switch, Typography, message, Space } from 'antd';
import { VideoCameraOutlined, PauseOutlined, StopOutlined, FolderOpenFilled } from '@ant-design/icons';
import { tl } from '../../i18n';
import { isMacOSPlatform } from '../../utils/platform';
import { screenRecording, type RecordingOptions } from '../../services/screenRecording';
import './ScreenRecording.css';

export function ScreenRecordingExitHandler() {
  useEffect(() => {
    const unlisten = listen('screen-recording-exit', async () => {
      await screenRecording.stop();
      // Preparing may still be returning from a native picker or audio initialization.
      for (let i = 0; i < 300 && screenRecording.getSnapshot().phase !== 'idle'; i++) await new Promise(resolve => setTimeout(resolve, 100));
      if (screenRecording.getSnapshot().phase === 'idle' && !screenRecording.getSnapshot().error) await invoke('exit_app');
    });
    return () => { void unlisten.then(f => f()); };
  }, []);
  return null;
}

export function ScreenRecordingPanel() {
  const state = useSyncExternalStore(screenRecording.subscribe, screenRecording.getSnapshot);
  const [options, setOptions] = useState<RecordingOptions>({ resolution: 1080, frameRate: 60, bitrateMbps: 16, microphone: false, systemAudio: false, countdown: 3 });
  const [directory, setDirectory] = useState('');
  const [directoryBusy, setDirectoryBusy] = useState(false);
  useEffect(() => { void invoke<string>('recording_get_directory').then(setDirectory).catch(error => message.error(String(error))); }, []);
  const busy = state.phase !== 'idle';
  const field = (key: 'resolution' | 'frameRate' | 'bitrateMbps' | 'countdown', title: string, values: number[], unit: string) => (
    <label className="record-field"><span>{title}</span><Select aria-label={title} disabled={busy} value={options[key]} onChange={value => setOptions({ ...options, [key]: value })}
      getPopupContainer={trigger => trigger.parentElement!} popupClassName="room-tools-select-dropdown"
      options={values.map(value => ({ value, label: `${value}${unit}` }))} /></label>
  );
  return <div className="record-panel">
    <div className="record-heading"><VideoCameraOutlined /><div><strong>{tl('记录精彩，留住瞬间', 'Capture moments, keep them forever')}</strong><p>{tl('选择显示器或窗口，停止后保存视频。', 'Choose a display or window, then save the video when you stop.')}</p></div></div>
    <div className="record-location">
      <div className="record-location-path"><strong>{tl('视频保存位置', 'Video save location')}</strong><Typography.Text type="secondary" title={directory} ellipsis>{directory || tl('正在读取…', 'Loading…')}</Typography.Text></div>
      <Space>
        <Button size="small" disabled={busy || directoryBusy} icon={<FolderOpenFilled />} loading={directoryBusy} onClick={async () => { setDirectoryBusy(true); try { const chosen = await invoke<string | null>('recording_choose_directory'); if (chosen) setDirectory(chosen); } catch (error) { message.error(String(error)); } finally { setDirectoryBusy(false); } }}>{tl('修改', 'Change')}</Button>
        <Button size="small" disabled={busy || directoryBusy} onClick={async () => { setDirectoryBusy(true); try { setDirectory(await invoke<string>('recording_reset_directory')); } catch (error) { message.error(String(error)); } finally { setDirectoryBusy(false); } }}>{tl('恢复默认', 'Reset')}</Button>
      </Space>
    </div>
    <div className="record-fields">
      {field('resolution', tl('分辨率上限', 'Resolution'), [720, 1080, 1440, 2160], 'p')}
      {field('frameRate', tl('帧率', 'Frame rate'), [30, 60], ' FPS')}
      {field('bitrateMbps', tl('视频码率', 'Video bitrate'), [4, 8, 16, 32], ' Mbps')}
      {field('countdown', tl('开始倒计时', 'Countdown'), [0, 3, 5], tl(' 秒', ' s'))}
    </div>
    <div className="record-audio"><span>{tl('系统声音', 'System audio')}<small>{isMacOSPlatform ? tl('录制系统播放的声音（macOS 13+，需屏幕录制授权）', 'Record system playback (macOS 13+, Screen Recording permission)') : tl('录制默认输出设备上的声音', 'Record the default output device')}</small></span><Switch aria-label={tl('系统声音', 'System audio')} checked={options.systemAudio} disabled={busy} onChange={systemAudio => setOptions({ ...options, systemAudio })} /></div>
    <div className="record-audio"><span>{tl('麦克风', 'Microphone')}<small>{tl('使用系统默认麦克风；扬声器外放可能产生回声', 'Use the default microphone; speakers may cause echo')}</small></span><Switch aria-label={tl('麦克风', 'Microphone')} checked={options.microphone} disabled={busy} onChange={microphone => setOptions({ ...options, microphone })} /></div>
    {busy && <div className="record-status" role="status"><span className={state.phase === 'recording' ? 'record-dot' : ''} />{({ preparing: tl('准备录制', 'Preparing'), recording: tl('正在录制', 'Recording'), paused: tl('已暂停', 'Paused'), saving: tl('正在保存', 'Saving'), idle: '' })[state.phase]}<strong>{String(Math.floor(state.seconds / 60)).padStart(2, '0')}:{String(state.seconds % 60).padStart(2, '0')}</strong><span>{(state.bytes / 1048576).toFixed(1)} MB</span></div>}
    {!busy && state.path && !state.error && <div className="record-saved"><Typography.Text type="secondary" title={state.path} ellipsis>{tl('已保存：', 'Saved: ')}{state.path}</Typography.Text><Button size="small" icon={<FolderOpenFilled />} onClick={async () => { try { await invoke('open_file_location', { path: state.path }); } catch (error) { message.error(String(error)); } }}>{isMacOSPlatform ? tl('在访达中显示', 'Reveal in Finder') : tl('打开所在文件夹', 'Show in folder')}</Button></div>}
    {state.error && <Alert type="error" showIcon message={state.error} />}
    <div className={`record-actions${!busy ? ' record-actions-start' : ''}`}>
      {!busy ? <Button disabled={directoryBusy || !directory} type="primary" size="large" icon={<VideoCameraOutlined />} onClick={() => void screenRecording.start(options)}>{tl('选择画面并开始录制', 'Choose source and record')}</Button> : state.phase === 'preparing' ? <Button onClick={() => screenRecording.cancel()}>{tl('取消', 'Cancel')}</Button> : <><Button icon={<PauseOutlined />} disabled={state.phase === 'saving'} onClick={() => screenRecording.pause()}>{state.phase === 'paused' ? tl('继续', 'Resume') : tl('暂停', 'Pause')}</Button><Button danger type="primary" icon={<StopOutlined />} loading={state.phase === 'saving'} onClick={() => void screenRecording.stop()}>{tl('停止并保存', 'Stop and save')}</Button></>}
    </div>
    <Typography.Text type="secondary" className="record-panel-hint">{tl('关闭工具面板不会停止录制，请保存后再退出软件。', 'Closing this panel keeps recording. Save before exiting the app.')}</Typography.Text>
  </div>;
}
