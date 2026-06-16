/**
 * 共享剪贴板接收弹窗（全局挂载）
 * 收到队友共享的剪贴板内容时弹出，可一键复制到本机剪贴板
 */

import React from 'react';
import { Modal, Button, Typography, message } from 'antd';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '../../stores';

const { Paragraph, Text } = Typography;

export const ClipboardReceiver: React.FC = () => {
  const incoming = useAppStore((s) => s.incomingClipboard);
  const setIncomingClipboard = useAppStore((s) => s.setIncomingClipboard);

  const close = () => setIncomingClipboard(null);

  const copy = async () => {
    if (!incoming) return;
    try {
      await writeText(incoming.text);
      message.success('已复制到剪贴板');
      close();
    } catch {
      message.error('复制失败');
    }
  };

  return (
    <Modal
      title="收到共享剪贴板"
      open={!!incoming}
      onCancel={close}
      centered
      footer={[
        <Button key="close" onClick={close}>关闭</Button>,
        <Button key="copy" type="primary" onClick={() => void copy()}>复制到剪贴板</Button>,
      ]}
    >
      {incoming && (
        <>
          <Text type="secondary" style={{ fontSize: 12 }}>来自 {incoming.from}</Text>
          <Paragraph
            copyable={false}
            style={{
              marginTop: 8,
              padding: '10px 12px',
              background: 'rgba(0,0,0,0.04)',
              borderRadius: 8,
              maxHeight: 300,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {incoming.text}
          </Paragraph>
        </>
      )}
    </Modal>
  );
};
