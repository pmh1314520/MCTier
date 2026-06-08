/**
 * 房间内小工具
 * - 掷骰子：结果广播到聊天室（适合跑团/抽签/决定顺序）
 * - 倒计时：本地计时，到点提醒（适合活动/比赛）
 * - 便签：本地持久化的临时记事
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, Tabs, Button, InputNumber, Select, Input, Space, Typography, message } from 'antd';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import type { ChatMessage } from '../../types';

const { Text } = Typography;
const { TextArea } = Input;

const NOTE_KEY = 'mctier_room_note';

interface RoomToolsProps {
  visible: boolean;
  onClose: () => void;
}

export const RoomTools: React.FC<RoomToolsProps> = ({ visible, onClose }) => {
  const currentPlayerId = useAppStore((s) => s.currentPlayerId);
  const config = useAppStore((s) => s.config);
  const addChatMessage = useAppStore((s) => s.addChatMessage);

  // ===== 掷骰子 =====
  const [diceCount, setDiceCount] = useState(1);
  const [diceSides, setDiceSides] = useState(6);
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<string>('');

  const handleRoll = async (broadcast: boolean) => {
    const count = Math.max(1, Math.min(10, diceCount || 1));
    const sides = Math.max(2, Math.min(100, diceSides || 6));
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }
    const sum = rolls.reduce((a, b) => a + b, 0);
    const detail = count > 1 ? `${rolls.join(' + ')} = ${sum}` : `${rolls[0]}`;
    const text = `掷出 ${count}d${sides}：${detail}`;
    setLastRoll(text);

    if (broadcast) {
      setRolling(true);
      try {
        const playerName = config.playerName || '我';
        const content = `[掷骰] ${text}`;
        if (currentPlayerId) {
          const optimistic: ChatMessage = {
            id: `msg-${currentPlayerId}-${Date.now()}`,
            playerId: currentPlayerId,
            playerName,
            content,
            timestamp: Date.now(),
            type: 'text',
          };
          addChatMessage(optimistic);
        }
        await p2pChatService.sendTextMessage(content);
        message.success('已广播到聊天室');
      } catch (e) {
        message.error(`广播失败：${e}`);
      } finally {
        setRolling(false);
      }
    }
  };

  // ===== 倒计时 =====
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startCountdown = () => {
    const total = (minutes || 0) * 60 + (seconds || 0);
    if (total <= 0) {
      message.warning('请设置大于 0 的时间');
      return;
    }
    clearTimer();
    setRemaining(total);
    timerRef.current = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearTimer();
          message.success('倒计时结束！');
          try {
            // 简单提示音
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            osc.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.start();
            setTimeout(() => { osc.stop(); ctx.close().catch(() => {}); }, 350);
          } catch { /* ignore */ }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const stopCountdown = () => {
    clearTimer();
    setRemaining(null);
  };

  useEffect(() => () => clearTimer(), []);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // ===== 便签 =====
  const [note, setNote] = useState('');
  useEffect(() => {
    if (visible) {
      try {
        setNote(localStorage.getItem(NOTE_KEY) || '');
      } catch { /* ignore */ }
    }
  }, [visible]);

  const saveNote = (val: string) => {
    setNote(val);
    try {
      localStorage.setItem(NOTE_KEY, val);
    } catch { /* ignore */ }
  };

  const diceTab = (
    <div style={{ padding: '8px 4px' }}>
      <Space wrap align="center">
        <InputNumber min={1} max={10} value={diceCount} onChange={(v) => setDiceCount(v ?? 1)} addonBefore="数量" />
        <Select
          value={diceSides}
          onChange={(v) => setDiceSides(v)}
          style={{ width: 120 }}
          options={[4, 6, 8, 10, 12, 20, 100].map((n) => ({ value: n, label: `d${n}` }))}
        />
      </Space>
      <div style={{ margin: '14px 0', minHeight: 32 }}>
        {lastRoll ? <Text strong style={{ fontSize: 16 }}>{lastRoll}</Text> : <Text type="secondary">点击下方按钮掷骰</Text>}
      </div>
      <Space>
        <Button onClick={() => void handleRoll(false)}>本地掷骰</Button>
        <Button type="primary" loading={rolling} onClick={() => void handleRoll(true)}>掷骰并广播</Button>
      </Space>
    </div>
  );

  const timerTab = (
    <div style={{ padding: '8px 4px' }}>
      {remaining === null ? (
        <>
          <Space align="center">
            <InputNumber min={0} max={180} value={minutes} onChange={(v) => setMinutes(v ?? 0)} addonAfter="分" />
            <InputNumber min={0} max={59} value={seconds} onChange={(v) => setSeconds(v ?? 0)} addonAfter="秒" />
          </Space>
          <div style={{ marginTop: 14 }}>
            <Button type="primary" onClick={startCountdown}>开始倒计时</Button>
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: 2, color: remaining <= 10 ? '#ff4d4f' : undefined }}>
            {fmt(remaining)}
          </div>
          <Button danger style={{ marginTop: 12 }} onClick={stopCountdown}>停止</Button>
        </div>
      )}
    </div>
  );

  const noteTab = (
    <div style={{ padding: '8px 4px' }}>
      <TextArea
        value={note}
        onChange={(e) => saveNote(e.target.value)}
        placeholder="临时记点东西，自动保存在本地（仅自己可见）"
        autoSize={{ minRows: 6, maxRows: 12 }}
        maxLength={2000}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>内容自动保存，下次打开仍在。</Text>
    </div>
  );

  return (
    <Modal title="房间小工具" open={visible} onCancel={onClose} footer={null} width={460} centered>
      <Tabs
        items={[
          { key: 'dice', label: '掷骰子', children: diceTab },
          { key: 'timer', label: '倒计时', children: timerTab },
          { key: 'note', label: '便签', children: noteTab },
        ]}
      />
    </Modal>
  );
};
