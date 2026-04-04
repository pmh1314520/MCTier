import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input, Button, message as antdMessage } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { EmojiPicker } from '../EmojiPicker/EmojiPicker';
import { EmojiIcon, ImageIcon } from '../icons';
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);
  const [downloadedImages, setDownloadedImages] = useState<Map<string, string>>(new Map());
  
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
    
    // 清空输入框
    setInputValue('');
    
    try {
      // 乐观更新：立即在本地显示自己发送的消息
      const optimisticMessage: ChatMessage = {
        id: `msg-${currentPlayerId}-${Date.now()}`,
        playerId: currentPlayerId,
        playerName: config.playerName || '我',
        content: messageContent,
        timestamp: Date.now(),
        type: 'text',
      };
      
      // 立即添加到本地消息列表
      addChatMessage(optimisticMessage);
      console.log('✅ [ChatRoom] 乐观更新：本地显示消息');
      
      // 发送到P2P网络
      await p2pChatService.sendTextMessage(messageContent);
      console.log('✅ [ChatRoom] 文本消息已发送到P2P网络');
    } catch (error) {
      console.error('发送聊天消息失败:', error);
      antdMessage.error('发送消息失败');
      // 发送失败时恢复输入框内容
      setInputValue(messageContent);
    }
  };

  // 优化图片质量（保持原图尺寸，压缩质量）
  const optimizeImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // 创建canvas
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('无法创建canvas上下文'));
            return;
          }

          // 保持原图尺寸
          canvas.width = img.width;
          canvas.height = img.height;

          // 绘制图片
          ctx.drawImage(img, 0, 0);

          // 转换为JPEG格式，质量0.92（高质量压缩）
          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
          
          console.log('🖼️ 图片优化完成:', {
            原始大小: file.size,
            优化后大小: Math.round(optimizedDataUrl.length * 0.75), // Base64大约是原始的1.33倍
            压缩率: Math.round((1 - (optimizedDataUrl.length * 0.75) / file.size) * 100) + '%'
          });
          
          resolve(optimizedDataUrl);
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
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
      
      // 【修复】监听取消事件：当用户关闭文件选择器时重置loading状态
      const resetLoading = () => {
        // 延迟检查，因为onchange可能会在focus之后触发
        setTimeout(() => {
          // 如果没有选择文件，重置loading状态
          if (!input.files || input.files.length === 0) {
            console.log('⚠️ [ChatRoom] 用户取消了文件选择');
            setIsUploading(false);
          }
        }, 100);
      };

      // 监听窗口焦点恢复（用户关闭文件选择器后会恢复焦点）
      window.addEventListener('focus', resetLoading, { once: true });
      
      input.onchange = async (e) => {
        // 移除焦点监听器，因为用户已经选择了文件
        window.removeEventListener('focus', resetLoading);
        
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          setIsUploading(false);
          return;
        }

        // 检查文件大小（限制10MB，因为会压缩）
        if (file.size > 10 * 1024 * 1024) {
          antdMessage.error('图片大小不能超过10MB');
          setIsUploading(false);
          return;
        }

        console.log('📁 选择的图片文件:', file.name, '大小:', file.size);

        try {
          // 优化图片
          const optimizedDataUrl = await optimizeImage(file);
          
          console.log('📤 发送优化后的图片消息');

          // 乐观更新：立即在本地显示自己发送的图片
          const optimisticMessage: ChatMessage = {
            id: `msg-${currentPlayerId}-${Date.now()}`,
            playerId: currentPlayerId!,
            playerName: config.playerName || '我',
            content: '[图片]',
            timestamp: Date.now(),
            type: 'image',
            imageData: optimizedDataUrl,
          };
          
          // 立即添加到本地消息列表
          addChatMessage(optimisticMessage);
          console.log('✅ [ChatRoom] 乐观更新：本地显示图片');
          
          // 发送图片消息到P2P网络
          await p2pChatService.sendImageMessage(optimizedDataUrl);
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
        if (file.size > 10 * 1024 * 1024) {
          antdMessage.error('图片大小不能超过10MB');
          return;
        }

        try {
          setIsUploading(true);

          // 优化图片
          const optimizedDataUrl = await optimizeImage(file);
          
          console.log('📤 发送粘贴的优化图片');

          // 乐观更新：立即在本地显示自己发送的图片
          const optimisticMessage: ChatMessage = {
            id: `msg-${currentPlayerId}-${Date.now()}`,
            playerId: currentPlayerId!,
            playerName: config.playerName || '我',
            content: '[图片]',
            timestamp: Date.now(),
            type: 'image',
            imageData: optimizedDataUrl,
          };
          
          // 立即添加到本地消息列表
          addChatMessage(optimisticMessage);
          console.log('✅ [ChatRoom] 乐观更新：本地显示粘贴的图片');

          // 发送图片消息到P2P网络
          await p2pChatService.sendImageMessage(optimizedDataUrl);

          antdMessage.success('图片发送成功');
          
          // 滚动到底部
          setTimeout(() => scrollToBottom(), 100);
          
          setIsUploading(false);
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
    if (file.size > 10 * 1024 * 1024) {
      antdMessage.error('图片大小不能超过10MB');
      return;
    }

    try {
      setIsUploading(true);

      // 优化图片
      const optimizedDataUrl = await optimizeImage(file);
      
      console.log('📤 发送拖拽的优化图片');

      // 乐观更新：立即在本地显示自己发送的图片
      const optimisticMessage: ChatMessage = {
        id: `msg-${currentPlayerId}-${Date.now()}`,
        playerId: currentPlayerId!,
        playerName: config.playerName || '我',
        content: '[图片]',
        timestamp: Date.now(),
        type: 'image',
        imageData: optimizedDataUrl,
      };
      
      // 立即添加到本地消息列表
      addChatMessage(optimisticMessage);
      console.log('✅ [ChatRoom] 乐观更新：本地显示拖拽的图片');

      // 发送图片消息到P2P网络
      await p2pChatService.sendImageMessage(optimizedDataUrl);

      antdMessage.success('图片发送成功');
      
      // 滚动到底部
      setTimeout(() => scrollToBottom(), 100);
      
      setIsUploading(false);
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
  const handleDownloadImage = async (imageData: string, messageId: string) => {
    try {
      console.log('🖼️ 开始下载图片...');
      setDownloadingImageId(messageId);
      
      // 从Data URL中提取Base64数据
      const base64Data = imageData.split(',')[1];
      
      // 调用后端保存图片
      const filePath = await invoke<string>('save_chat_image', {
        imageData: base64Data,
      });
      
      console.log('✅ 图片已保存到:', filePath);
      
      // 保存文件路径，用于显示
      setDownloadedImages(prev => new Map(prev).set(messageId, filePath));
      setDownloadingImageId(null);
      
      // 3秒后清除下载状态
      setTimeout(() => {
        setDownloadedImages(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
      }, 3000);
      
    } catch (error) {
      console.error('❌ 下载图片失败:', error);
      antdMessage.error('下载图片失败');
      setDownloadingImageId(null);
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
                    <div className="chat-image-wrapper">
                      <img 
                        src={message.imageData} 
                        alt="聊天图片" 
                        className="chat-image"
                        onClick={() => setPreviewImage(message.imageData!)}
                      />
                      <button
                        className="image-download-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadImage(message.imageData!, message.id);
                        }}
                        disabled={downloadingImageId === message.id}
                        title="下载图片"
                      >
                        {downloadingImageId === message.id ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="downloading-icon">
                            <circle cx="12" cy="12" r="10" opacity="0.25"/>
                            <path d="M12 2 A10 10 0 0 1 22 12" strokeLinecap="round"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                          </svg>
                        )}
                      </button>
                      {downloadedImages.has(message.id) && (
                        <div className="download-success-tip">
                          已保存至 {downloadedImages.get(message.id)?.replace(/\\[^\\]+$/, '')}
                        </div>
                      )}
                    </div>
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
              <img 
                src={previewImage} 
                alt="预览" 
                onClick={() => setPreviewImage(null)}
                style={{ cursor: 'pointer' }}
              />

            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Emoji选择器 */}
      {showEmojiPicker && (
        <div className="emoji-picker-container">
          <EmojiPicker 
            onSelect={handleEmojiSelect}
            onClose={() => setShowEmojiPicker(false)}
          />
        </div>
      )}
      
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
          <Button
            type="text"
            icon={<EmojiIcon size={22} />}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="选择表情"
            className="emoji-button"
          />
          
          <Button
            type="text"
            icon={<ImageIcon size={22} />}
            onClick={handleImageUpload}
            loading={isUploading}
            title="发送图片"
            className="image-button"
          />
          
          <TextArea
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Shift+Enter换行"
            autoSize={{ minRows: 1, maxRows: 3 }}
            maxLength={500}
            style={{ flex: 1 }}
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
