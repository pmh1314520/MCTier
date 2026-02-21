import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input, Button } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import type { ChatMessage } from '../../types';
import './ChatRoom.css';

const { TextArea } = Input;

export const ChatRoom: React.FC = () => {
  const { currentPlayerId, chatMessages, addChatMessage, config } = useAppStore();
  const [inputValue, setInputValue] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [displayedMessageCount, setDisplayedMessageCount] = useState(30);
  const [lastReadMessageIndex, setLastReadMessageIndex] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  // 计算未读消息数量（只计算其他人发送的消息）
  const unreadMessages = chatMessages.filter((msg, index) => 
    msg.playerId !== currentPlayerId && index >= lastReadMessageIndex
  );
  const hasUnreadMessages = unreadMessages.length > 0;

  // 获取MiniWindow的已读消息标记函数
  const markMessagesAsRead = () => {
    // 通过事件通知MiniWindow标记消息为已读
    window.dispatchEvent(new CustomEvent('markChatMessagesAsRead'));
  };

  // 设置全局标志：当前在聊天室界面
  useEffect(() => {
    (window as any).__isInChatRoom__ = true;
    console.log('✅ 已设置全局标志：当前在聊天室界面');
    
    return () => {
      (window as any).__isInChatRoom__ = false;
      console.log('✅ 已清除全局标志：离开聊天室界面');
    };
  }, []);

  // 监听滚动位置
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
    
    setIsAtBottom(isBottom);
    
    // 如果滚动到底部，标记所有消息为已读
    if (isBottom) {
      setLastReadMessageIndex(chatMessages.length);
      markMessagesAsRead();
    }
    
    // 检测是否滚动到顶部，加载更多消息
    if (scrollTop < 100 && scrollTop < lastScrollTop.current && !isLoadingMore && hasMoreMessages) {
      loadMoreMessages();
    }
    
    lastScrollTop.current = scrollTop;
  };

  // 加载更多历史消息
  const loadMoreMessages = async () => {
    if (isLoadingMore || !hasMoreMessages) return;
    
    setIsLoadingMore(true);
    
    // 模拟加载延迟
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 增加显示的消息数量
    const newCount = displayedMessageCount + 30;
    setDisplayedMessageCount(newCount);
    
    // 如果已经显示所有消息，标记没有更多消息
    if (newCount >= chatMessages.length) {
      setHasMoreMessages(false);
    }
    
    setIsLoadingMore(false);
  };

  // 滚动到底部
  const scrollToBottom = (smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
      // 滚动到底部后标记所有消息为已读
      setLastReadMessageIndex(chatMessages.length);
      markMessagesAsRead();
    }
  };

  // 当有新消息时的处理
  useEffect(() => {
    if (chatMessages.length > 0) {
      if (isAtBottom) {
        // 如果在底部，自动滚动到新消息并标记为已读
        scrollToBottom();
      }
    }
  }, [chatMessages.length, isAtBottom]);

  // 发送消息
  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentPlayerId) return;
    
    // 获取当前玩家名称（优先从config获取，因为当前玩家不在players列表中）
    const currentPlayerName = config.playerName || '我';
    
    try {
      // 通过WebSocket发送消息到信令服务器
      await webrtcClient.sendChatMessage(inputValue.trim());
      
      // 添加到本地消息列表（自己发的消息）
      const newMessage: ChatMessage = {
        id: `msg-${Date.now()}-${currentPlayerId}`,
        playerId: currentPlayerId,
        playerName: currentPlayerName,
        content: inputValue.trim(),
        timestamp: Date.now(),
      };
      addChatMessage(newMessage);
      
      // 清空输入框
      setInputValue('');
      
      // 滚动到底部
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('发送聊天消息失败:', error);
    }
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // 获取要显示的消息（只显示最近的N条）
  const displayedMessages = chatMessages.slice(-displayedMessageCount);

  return (
    <div className="chat-room">
      <div 
        className="chat-messages" 
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {isLoadingMore && (
          <div className="chat-loading">
            <span>加载中...</span>
          </div>
        )}
        
        {!hasMoreMessages && chatMessages.length > displayedMessageCount && (
          <div className="chat-no-more">
            <span>没有更多消息了</span>
          </div>
        )}
        
        <AnimatePresence mode="popLayout">
          {displayedMessages.map((message) => {
            const isOwnMessage = message.playerId === currentPlayerId;
            
            return (
              <motion.div
                key={message.id}
                className={`chat-message ${isOwnMessage ? 'own' : 'other'}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                {/* 头像 */}
                <div className="message-avatar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                
                <span className="message-author-outside">
                  {message.playerName}
                  {isOwnMessage && ' (我)'}
                </span>
                <div className="message-content">
                  {message.content}
                </div>
                <span className="message-time-outside">
                  {formatTime(message.timestamp)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* 新消息提示 */}
      <AnimatePresence>
        {hasUnreadMessages && !isAtBottom && (
          <motion.div
            className="new-message-indicator"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollToBottom()}
            title="滚动到底部"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7"/>
            </svg>
            {hasUnreadMessages && <div className="new-message-badge" />}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 底栏输入区域 - 添加升起动画 */}
      <motion.div 
        className="chat-input-area"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ 
          type: 'spring',
          stiffness: 300,
          damping: 30,
          delay: 0.1
        }}
      >
        <TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息(Shift+Enter换行)"
          autoSize={{ minRows: 1, maxRows: 3 }}
          maxLength={500}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendMessage}
          disabled={!inputValue.trim()}
        >
          发送
        </Button>
      </motion.div>
    </div>
  );
};
