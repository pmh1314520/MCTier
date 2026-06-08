/**
 * 房间内小工具
 * - 掷骰子：结果广播到聊天室（适合跑团/抽签/决定顺序）
 * - 倒计时：基于全局服务计时，切换界面/挂后台不中断，到点提醒
 * - 待办清单：一条一条的待办事项，可勾选完成 / 删除，本地持久化
 */

import React, { useState, useEffect } from 'react';
import { Modal, Tabs, Button, InputNumber, Select, Input, Space, Typography, Checkbox, message } from 'antd';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { countdownService } from '../../services/roomtools/countdownService';
import type { ChatMessage } from '../../types';
import './RoomTools.css';

const { Text } = Typography;

const TODO_KEY = 'mctier_room_todos';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface RoomToolsProps {
  visible: boolean;
  onClose: () => void;
}

const popupContainer = (triggerNode: HTMLElement) =>
  (triggerNode.parentElement as HTMLElement) || document.body;

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
    // 本地显示
    const localText =
      count > 1 ? `${count}d${sides}：${rolls.join(' + ')} = ${sum}` : `d${sides}：${rolls[0]} 点`;
    setLastRoll(localText);

    if (broadcast) {
      setRolling(true);
      try {
        const playerName = config.playerName || '我';
        // 更友好、可读性更好的广播文案
        const content =
          count > 1
            ? `🎲 ${playerName} 掷出 ${count}d${sides}：${rolls.join(' + ')} = ${sum}`
            : `🎲 ${playerName} 掷出了 ${rolls[0]} 点（d${sides}）`;
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

  // ===== 倒计时（使用全局服务，切换界面/挂后台不中断）=====
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(countdownService.getRemaining());

  useEffect(() => {
    const unsub = countdownService.subscribe((r) => setRemaining(r));
    return unsub;
  }, []);

  const startCountdown = () => {
    const total = (minutes || 0) * 60 + (seconds || 0);
    if (total <= 0) {
      message.warning('请设置大于 0 的时间');
      return;
    }
    countdownService.start(total);
  };

  const stopCountdown = () => {
    countdownService.stop();
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // ===== 待办清单 =====
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newTodo, setNewTodo] = useState('');

  useEffect(() => {
    if (visible) {
      try {
        const raw = localStorage.getItem(TODO_KEY);
        setTodos(raw ? JSON.parse(raw) : []);
      } catch {
        setTodos([]);
      }
    }
  }, [visible]);

  const persistTodos = (items: TodoItem[]) => {
    setTodos(items);
    try {
      localStorage.setItem(TODO_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  };

  const addTodo = () => {
    const text = newTodo.trim();
    if (!text) return;
    persistTodos([...todos, { id: `todo-${Date.now()}`, text, done: false }]);
    setNewTodo('');
  };

  const toggleTodo = (id: string) => {
    persistTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id: string) => {
    persistTodos(todos.filter((t) => t.id !== id));
  };

  const clearDone = () => {
    persistTodos(todos.filter((t) => !t.done));
  };

  const diceTab = (
    <div style={{ padding: '8px 4px' }}>
      <Space wrap align="center">
        <InputNumber min={1} max={10} value={diceCount} onChange={(v) => setDiceCount(v ?? 1)} addonBefore="数量" />
        <Select
          value={diceSides}
          onChange={(v) => setDiceSides(v)}
          style={{ width: 120 }}
          getPopupContainer={popupContainer}
          options={[4, 6, 8, 10, 12, 20, 100].map((n) => ({ value: n, label: `d${n}` }))}
        />
      </Space>
      <div style={{ margin: '14px 0', minHeight: 32 }}>
        {lastRoll ? <Text strong style={{ fontSize: 16 }}>🎲 {lastRoll}</Text> : <Text type="secondary">点击下方按钮掷骰</Text>}
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
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
            倒计时在后台或切换界面时仍会继续计时，到点自动提醒。
          </Text>
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

  const remainingCount = todos.filter((t) => !t.done).length;

  const todoTab = (
    <div style={{ padding: '8px 4px' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onPressEnter={addTodo}
          placeholder="添加一条待办事项，回车确认"
          maxLength={100}
        />
        <Button type="primary" onClick={addTodo}>添加</Button>
      </Space.Compact>

      <div className="room-todo-list">
        {todos.length === 0 ? (
          <div className="room-todo-empty">还没有待办事项，添加一条试试～</div>
        ) : (
          todos.map((t) => (
            <div key={t.id} className={`room-todo-item ${t.done ? 'done' : ''}`}>
              <Checkbox checked={t.done} onChange={() => toggleTodo(t.id)}>
                <span className="room-todo-text">{t.text}</span>
              </Checkbox>
              <button className="room-todo-del" onClick={() => removeTodo(t.id)} title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {todos.length > 0 && (
        <div className="room-todo-footer">
          <Text type="secondary" style={{ fontSize: 12 }}>剩余 {remainingCount} 项待完成</Text>
          <Button size="small" type="text" onClick={clearDone}>清除已完成</Button>
        </div>
      )}
    </div>
  );

  return (
    <Modal title="房间小工具" open={visible} onCancel={onClose} footer={null} width={460} centered className="room-tools-modal">
      <Tabs
        items={[
          { key: 'dice', label: '掷骰子', children: diceTab },
          { key: 'timer', label: '倒计时', children: timerTab },
          { key: 'todo', label: '待办清单', children: todoTab },
        ]}
      />
    </Modal>
  );
};
