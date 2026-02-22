import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input, Button, message as antdMessage } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { EmojiPicker } from '../EmojiPicker/EmojiPicker';
import { EmojiIcon, ImageIcon } from '../icons';
import type { ChatMessage } from '../../types';
import './ChatRoom.css';

const { TextArea } = Input;

export const ChatRoom: React.FC = () => {
  const { currentPlayerId, chatMessages, addChatMessage, config, players, lobby } = useAppStore();
  const [inputValue, setInputValue] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [displayedMessageCount, setDisplayedMessageCount] = useState(30);
  const [lastReadMessageIndex, setLastReadMessageIndex] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const textAreaRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 初始化P2P聊天服务
  useEffect(() => {
    if (!lobby || !currentPlayerId) {
      console.log('⚠️ 大厅或玩家ID未就绪，跳过P2P聊天服务初始化');
      return;
    }

    // 获取所有玩家的虚拟IP（包括自己）
    const playerIPs = players.map(p => p.virtualIp).filter(Boolean) as string[];
    // 添加自己的虚拟IP
    if (lobby.virtualIp && !playerIPs.includes(lobby.virtualIp)) {
      playerIPs.push(lobby.virtualIp);
    }

    console.log('🚀 初始化P2P聊天服务，玩家IPs:', playerIPs);

    // 初始化P2P聊天服务
    p2pChatService.initialize(playerIPs, currentPlayerId);

    // 设置消息接收回调
    p2pChatService.onMessage((message) => {
      console.log('📨 收到P2P消息:', message);
      
      // 查找发送者名称
      let senderName = '未知玩家';
      if (message.playerId === currentPlayerId) {
        senderName = config.playerName || '我';
      } else {
        const sender = players.find(p => p.id === message.playerId);
        senderName = sender?.name || '未知玩家';
      }

      // 添加到消息列表
      const chatMessage: ChatMessage = {
        id: message.id,
        playerId: message.playerId,
        playerName: senderName,
        content: message.content,
        timestamp: message.timestamp,
        type: message.type,
        imageData: message.imageData,
      };
      
      addChatMessage(chatMessage);
    });

    // 开始轮询消息
    p2pChatService.startPolling();

    return () => {
      // 停止轮询
      p2pChatService.stopPolling();
      console.log('✅ 已停止P2P聊天服务轮询');
    };
  }, [lobby, currentPlayerId, players, config.playerName, addChatMessage]);

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

  // 发送文本消息
  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentPlayerId) return;
    
    const messageContent = inputValue.trim();
    const currentPlayerName = config.playerName || '我';
    
    // 立即添加到本地消息列表（乐观更新）
    const localMessage: ChatMessage = {
      id: `msg-${Date.now()}-${currentPlayerId}`,
      playerId: currentPlayerId,
      playerName: currentPlayerName,
      content: messageContent,
      timestamp: Date.now(),
      type: 'text',
    };
    addChatMessage(localMessage);
    
    // 清空输入框
    setInputValue('');
    
    // 滚动到底部
    setTimeout(() => scrollToBottom(), 50);
    
    try {
      // 异步发送到P2P网络
      await p2pChatService.sendTextMessage(messageContent);
    } catch (error) {
      console.error('发送聊天消息失败:', error);
      antdMessage.error('发送消息失败');
    }
  };

  // 处理图片上传
  const handleImageUpload = async () => {
    if (isUploading) return;

    try {
      setIsUploading(true);

      // 创建文件选择器
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          setIsUploading(false);
          return;
        }

        // 检查文件大小（限制5MB）
        if (file.size > 5 * 1024 * 1024) {
          antdMessage.error('图片大小不能超过5MB');
          setIsUploading(false);
          return;
        }

        console.log('📁 选择的图片文件:', file.name, '大小:', file.size);

        // 读取文件为Base64
        const reader = new FileReader();
        reader.onload = async (event) => {
          const dataUrl = event.target?.result as string;
          
          console.log('📤 发送图片消息');

          try {
            // 发送图片消息
            await p2pChatService.sendImageMessage(dataUrl);
            antdMessage.success('图片发送成功');
            
            // 滚动到底部
            setTimeout(() => scrollToBottom(), 100);
          } catch (error) {
            console.error('发送图片失败:', error);
            antdMessage.error('发送图片失败');
          } finally {
            setIsUploading(false);
          }
        };
        reader.onerror = () => {
          antdMessage.error('读取图片失败');
          setIsUploading(false);
        };
        reader.readAsDataURL(file);
      };

      input.click();
    } catch (error) {
      console.error('上传图片失败:', error);
      antdMessage.error('上传图片失败');
      setIsUploading(false);
    }
  };

  // 处理粘贴事件
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        
        const file = item.getAsFile();
        if (!file) continue;

        // 检查文件大小
        if (file.size > 5 * 1024 * 1024) {
          antdMessage.error('图片大小不能超过5MB');
          return;
        }

        try {
          setIsUploading(true);

          // 读取文件为Base64
          const reader = new FileReader();
          reader.onload = async (event) => {
            const dataUrl = event.target?.result as string;
            
            console.log('📤 发送粘贴的图片');

            // 发送图片消息
            await p2pChatService.sendImageMessage(dataUrl);

            antdMessage.success('图片发送成功');
            
            // 滚动到底部
            setTimeout(() => scrollToBottom(), 100);
            
            setIsUploading(false);
          };
          reader.onerror = () => {
            antdMessage.error('读取图片失败');
            setIsUploading(false);
          };
          reader.readAsDataURL(file);
        } catch (error) {
          console.error('粘贴图片失败:', error);
          antdMessage.error('粘贴图片失败');
          setIsUploading(false);
        }
        
        break;
      }
    }
  };

  // 处理拖拽事件
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    
    // 检查是否为图片
    if (!file.type.startsWith('image/')) {
      antdMessage.error('只能拖拽图片文件');
      return;
    }

    // 检查文件大小
    if (file.size > 5 * 1024 * 1024) {
      antdMessage.error('图片大小不能超过5MB');
      return;
    }

    try {
      setIsUploading(true);

      // 读取文件为Base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        
        console.log('📤 发送拖拽的图片');

        // 发送图片消息
        await p2pChatService.sendImageMessage(dataUrl);

        antdMessage.success('图片发送成功');
        
        // 滚动到底部
        setTimeout(() => scrollToBottom(), 100);
        
        setIsUploading(false);
      };
      reader.onerror = () => {
        antdMessage.error('读取图片失败');
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('拖拽图片失败:', error);
      antdMessage.error('拖拽图片失败');
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSendMessage();
    }
  };

  // 处理Emoji选择
  const handleEmojiSelect = (emoji: string) => {
    // 插入Emoji到输入框
    setInputValue(prev => prev + emoji);
    setShowEmojiPicker(false);
    
    // 聚焦输入框
    if (textAreaRef.current) {
      textAreaRef.current.focus();
    }
  };

  // 下载图片
  const handleDownloadImage = (imageData: string) => {
    try {
      const link = document.createElement('a');
      link.href = imageData;
      link.download = `chat-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      antdMessage.success('图片已下载');
    } catch (error) {
      console.error('下载图片失败:', error);
      antdMessage.error('下载图片失败');
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
    <div 
      className="chat-room"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
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
                  {message.type === 'image' && message.imageData ? (
                    <img 
                      src={message.imageData} 
                      alt="聊天图片" 
                      className="chat-image"
                      onClick={() => setPreviewImage(message.imageData!)}
                    />
                  ) : (
                    message.content
                  )}
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
      
      {/* 图片预览模态框 */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            className="image-preview-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
          >
            <div className="image-preview-content" onClick={(e) => e.stopPropagation()}>
              <img src={previewImage} alt="预览" />
              <div className="image-preview-actions">
                <Button
                  type="primary"
                  onClick={() => handleDownloadImage(previewImage)}
                >
                  下载图片
                </Button>
                <Button onClick={() => setPreviewImage(null)}>
                  关闭
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Emoji选择器 */}
      <AnimatePresence>
        {showEmojiPicker && (
          <motion.div
            className="emoji-picker-container"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            <EmojiPicker 
              onSelect={handleEmojiSelect}
              onClose={() => setShowEmojiPicker(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 底栏输入区域 */}
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
        <div className="chat-input-wrapper">
          <div className="input-with-emoji">
            <TextArea
              ref={textAreaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入消息(Shift+Enter换行，支持粘贴/拖拽图片)"
              autoSize={{ minRows: 1, maxRows: 3 }}
              maxLength={500}
            />
            <Button
              type="text"
              icon={<EmojiIcon size={20} />}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              title="选择表情"
              className="emoji-button-inline"
            />
          </div>
          
          <Button
            type="text"
            icon={<ImageIcon size={22} />}
            onClick={handleImageUpload}
            loading={isUploading}
            title="发送图片"
            className="image-button"
          />
          
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendMessage}
            disabled={!inputValue.trim()}
            className="send-button"
          />
        </div>
      </motion.div>
      
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            // 处理文件上传
            console.log('选择的文件:', file);
          }
        }}
      />
    </div>
  );
};
