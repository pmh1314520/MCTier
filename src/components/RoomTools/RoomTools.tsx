/**
 * 房间内小工具
 * - 掷骰子：结果广播到聊天室（适合跑团/抽签/决定顺序）
 * - 倒计时：基于全局服务计时，切换界面/挂后台不中断，到点提醒
 * - 待办清单：多人协同，可勾选完成 / 分配给玩家 / 删除，实时同步全队
 * - 共享剪贴板：把坐标/指令一键同步给全队
 * - 共享白板：在白板上画标记并实时同步
 */

import React, { useState, useEffect } from 'react';
import { Modal, Tabs, Button, InputNumber, Select, Input, Space, Typography, Checkbox, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { useAppStore } from '../../stores';
import type { TodoItem } from '../../stores/appStore';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { countdownService } from '../../services/roomtools/countdownService';
import type { ChatMessage } from '../../types';
import './RoomTools.css';

const { Text } = Typography;

interface RoomToolsProps {
  visible: boolean;
  onClose: () => void;
  onOpenWorlds?: () => void;
  onOpenGameConnect?: () => void;
  onOpenDiagnostic?: () => void;
  hudOn?: boolean;
  onToggleHud?: () => void;
}

const popupContainer = (triggerNode: HTMLElement) =>
  (triggerNode.parentElement as HTMLElement) || document.body;

export const RoomTools: React.FC<RoomToolsProps> = ({ visible, onClose, onOpenWorlds, onOpenGameConnect, onOpenDiagnostic, hudOn, onToggleHud }) => {
  const { t } = useTranslation();
  const currentPlayerId = useAppStore((s) => s.currentPlayerId);
  const config = useAppStore((s) => s.config);
  const addChatMessage = useAppStore((s) => s.addChatMessage);

  const todos = useAppStore((s) => s.todos);
  const setTodos = useAppStore((s) => s.setTodos);

  const myName = config.playerName || '我';

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
    const localText =
      count > 1 ? `${count}d${sides}：${rolls.join(' + ')} = ${sum}` : `d${sides}：${rolls[0]} 点`;
    setLastRoll(localText);

    if (broadcast) {
      setRolling(true);
      try {
        const playerName = myName;
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
        message.success(tl('已广播到聊天室', 'Broadcast to chat'));
      } catch (e) {
        message.error(`${tl('广播失败', 'Broadcast failed')}：${e}`);
      } finally {
        setRolling(false);
      }
    }
  };

  // ===== 倒计时 =====
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
      message.warning(tl('请设置大于 0 的时间', 'Please set a time greater than 0'));
      return;
    }
    countdownService.start(total);
  };

  const stopCountdown = () => countdownService.stop();

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // ===== 待办清单（多人协同）=====
  const [newTodo, setNewTodo] = useState('');

  const commitTodos = (items: TodoItem[]) => {
    setTodos(items);
  };

  const addTodo = () => {
    const text = newTodo.trim();
    if (!text) return;
    commitTodos([
      ...todos,
      { id: `todo-${currentPlayerId || 'me'}-${Date.now()}`, text, done: false, assignee: '', creator: myName, ts: Date.now() },
    ]);
    setNewTodo('');
  };

  const toggleTodo = (id: string) => {
    commitTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id: string) => {
    commitTodos(todos.filter((t) => t.id !== id));
  };

  const clearDone = () => {
    commitTodos(todos.filter((t) => !t.done));
  };

  // ===== 共享剪贴板 =====
  const remainingCount = todos.filter((t) => !t.done).length;

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
        {lastRoll ? <Text strong style={{ fontSize: 16 }}>🎲 {lastRoll}</Text> : <Text type="secondary">{tl('点击下方按钮掷骰', 'Tap the button below to roll')}</Text>}
      </div>
      <Space>
        <Button onClick={() => void handleRoll(false)}>{t('roomTools.localRoll')}</Button>
        <Button type="primary" loading={rolling} onClick={() => void handleRoll(true)}>{t('roomTools.rollBroadcast')}</Button>
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
            <Button type="primary" onClick={startCountdown}>{t('roomTools.startTimer')}</Button>
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
            {tl('倒计时在后台或切换界面时仍会继续计时，到点自动提醒。', 'The countdown keeps running in the background or when switching views, and reminds you automatically when it ends.')}
          </Text>
        </>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: 2, color: remaining <= 10 ? '#ff4d4f' : undefined }}>
            {fmt(remaining)}
          </div>
          <Button danger style={{ marginTop: 12 }} onClick={stopCountdown}>{t('roomTools.stop')}</Button>
        </div>
      )}
    </div>
  );

  const todoTab = (
    <div style={{ padding: '8px 4px' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onPressEnter={addTodo}
          placeholder={t('roomTools.addTodoPlaceholder')}
          maxLength={100}
        />
        <Button type="primary" onClick={addTodo}>{t('roomTools.add')}</Button>
      </Space.Compact>

      <div className="room-todo-list">
        {todos.length === 0 ? (
          <div className="room-todo-empty">{t('roomTools.emptyTodo')}</div>
        ) : (
          todos.map((t) => (
            <div key={t.id} className={`room-todo-item ${t.done ? 'done' : ''}`}>
              <Checkbox checked={t.done} onChange={() => toggleTodo(t.id)}>
                <span className="room-todo-text">{t.text}</span>
              </Checkbox>
              <button className="room-todo-del" onClick={() => removeTodo(t.id)} title={tl('删除', 'Delete')}>
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
          <Text type="secondary" style={{ fontSize: 12 }}>{t('roomTools.remaining', { count: remainingCount })}</Text>
          <Button size="small" type="text" onClick={clearDone}>{t('roomTools.clearDone')}</Button>
        </div>
      )}
    </div>
  );
  return (
    <Modal title={t('roomTools.title')} open={visible} onCancel={onClose} footer={null} width={600} centered className="room-tools-modal">
      <Tabs
        size="small"
        tabBarGutter={20}
        more={{ icon: null }}
        items={[
          {
            key: 'net', label: tl('联机工具', 'Networking'), children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
                <Button block onClick={() => { onClose(); onOpenWorlds?.(); }}>{tl('局域网世界', 'LAN Worlds')}</Button>
                <Button block onClick={() => { onClose(); onOpenGameConnect?.(); }}>{tl('游戏快连', 'Game Quick-Connect')}</Button>
                <Button block onClick={() => { onClose(); onOpenDiagnostic?.(); }}>{tl('连接诊断', 'Connection Diagnostics')}</Button>
                <Button block type={hudOn ? 'primary' : 'default'} onClick={() => { onToggleHud?.(); }}>
                  {hudOn ? tl('关闭游戏内 HUD 浮层', 'Turn off in-game HUD') : tl('开启游戏内 HUD 浮层', 'Turn on in-game HUD')}
                </Button>
              </div>
            ),
          },
          { key: 'dice', label: t('roomTools.dice'), children: diceTab },
          { key: 'timer', label: t('roomTools.timer'), children: timerTab },
          { key: 'todo', label: t('roomTools.todo'), children: todoTab },
        ]}
      />
    </Modal>
  );
};
