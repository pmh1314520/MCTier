import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input, Button, message as antdMessage } from 'antd';
import { CloseOutlined, CopyOutlined, DeleteOutlined, MessageOutlined, RollbackOutlined, SendOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { isWithinRecallWindow, RECALL_WINDOW_MS } from '../../services/chat/recallPolicy';
import { EmojiPicker } from '../EmojiPicker/EmojiPicker';
import { EmojiIcon, ImageIcon } from '../icons';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import type { ChatMessage } from '../../types';
import './ChatRoom.css';

const { TextArea } = Input;
const replyMarkerPattern = /^\[reply:([^\]]+)]\s*/;

const parseReplyContent = (content: string) => {
  if (!content.startsWith('> ')) return null;
  const newlineIndex = content.indexOf('\n');
  const rawQuote = (newlineIndex >= 0 ? content.slice(2, newlineIndex) : content.slice(2)).trim();
  const marker = rawQuote.match(replyMarkerPattern);
  let targetId: string | null = null;
  if (marker) {
    try { targetId = decodeURIComponent(marker[1]); } catch { targetId = marker[1]; }
  }
  return {
    targetId,
    quoteLine: rawQuote.replace(replyMarkerPattern, '').trim(),
    body: newlineIndex >= 0 ? content.slice(newlineIndex + 1) : '',
  };
};

const getVisibleMessageContent = (content: string) => {
  const parsed = parseReplyContent(content);
  return parsed ? `> ${parsed.quoteLine}\n${parsed.body}` : content;
};

export const ChatRoom: React.FC = () => {
  useTranslation();
  const { currentPlayerId, chatMessages, addChatMessage, deleteChatMessage, recallChatMessage, config } = useAppStore();
  const players = useAppStore((state) => state.players);
  const [inputValue, setInputValue] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [displayedMessageCount, setDisplayedMessageCount] = useState(30);
  const [lastReadMessageIndex, setLastReadMessageIndex] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);
  const [downloadedImages, setDownloadedImages] = useState<Map<string, string>>(new Map());

  // @ 提及自动补全
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionCursor, setMentionCursor] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [messageContextMenu, setMessageContextMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [recallClock, setRecallClock] = useState(() => Date.now());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const textAreaRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<number | null>(null);
  const highlightStartTimerRef = useRef<number | null>(null);
  const initializedScrollRef = useRef(false);

  useEffect(() => {
    if (!messageContextMenu) return;
    const closeMenu = (event?: MouseEvent) => {
      const target = event?.target;
      if (target instanceof Element && target.closest('.chat-message-context-menu')) return;
      setMessageContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', closeMenu, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', closeMenu, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [messageContextMenu]);

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = chatMessages.reduce<number | null>((nearest, message) => {
      if (message.playerId !== currentPlayerId || message.recalled) return nearest;
      const expiry = message.timestamp + RECALL_WINDOW_MS;
      if (expiry < now) return nearest;
      return nearest === null || expiry < nearest ? expiry : nearest;
    }, null);
    if (nextExpiry === null) return;
    const timeout = window.setTimeout(() => setRecallClock(Date.now()), Math.max(0, nextExpiry - now + 1));
    return () => window.clearTimeout(timeout);
  }, [chatMessages, currentPlayerId, recallClock]);

  useEffect(() => {
    if (previewZoom <= 1) setPreviewPan({ x: 0, y: 0 });
  }, [previewZoom]);

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
    isAtBottomRef.current = isBottom;
    
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

  // 滚动到底部：直接滚动容器（比对 AnimatePresence 内的 ref 调 scrollIntoView 更可靠），
  // 并在消息进入动画结束后多次补滚，确保稳稳停在最新消息处
  const scrollToBottom = (smooth = true) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const doScroll = () => {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    };
    doScroll();
    // 新消息有入场动画(缩放/位移)，布局稳定前先补滚两次
    requestAnimationFrame(() => {
      doScroll();
      setTimeout(doScroll, 130);
      setTimeout(doScroll, 340);
    });
    // 滚动到底部后标记所有消息为已读
    setLastReadMessageIndex(chatMessages.length);
    markMessagesAsRead();
  };

  const getMessageInitial = (message: ChatMessage) => {
    const name = (message.playerName || (message.playerId === currentPlayerId ? config.playerName : '') || '?').trim();
    return (Array.from(name)[0] || '?').toUpperCase();
  };

  // 首次进入聊天室：在浏览器绘制前直接把滚动条置底（避免出现"从顶部滚到底部"的可见过程）。
  // 注意依赖 chatMessages.length：消息可能在挂载后才异步载入，确保有消息时才初始化一次，
  // 否则 initializedScrollRef 永远为 false 会导致后续自动滚动失效。
  useLayoutEffect(() => {
    if (initializedScrollRef.current) return;
    if (chatMessages.length <= 0) return;
    initializedScrollRef.current = true;
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight; // 瞬间置底，无动画
    }
    setLastReadMessageIndex(chatMessages.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length]);

  // 新消息到达时：仅当用户当前已处于底部时才跟随他人消息（标准聊天行为）。
  // 不再因"最新消息是自己发的"而强制置底——那会导致用户往上翻历史时被反复拽回底部。
  // 自己发送消息时的瞬时置底由发送处理函数显式触发。
  useEffect(() => {
    if (chatMessages.length <= 0) return;
    if (!initializedScrollRef.current) return;
    if (isAtBottomRef.current) scrollToBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length]);

  const buildReplyContent = (body: string): string => {
    if (!replyTo) return body;
    const summary = replyTo.type === 'image'
      ? tl('[图片]', '[Image]')
      : (parseReplyContent(replyTo.content)?.body || replyTo.content).split('\n')[0].slice(0, 40);
    return `> [reply:${encodeURIComponent(replyTo.id)}] @${replyTo.playerName} ${summary}\n${body}`;
  };

  const focusInputSoon = useCallback(() => {
    window.setTimeout(() => {
      textAreaRef.current?.focus?.();
    }, 0);
  }, []);

  const handleQuoteMessage = useCallback((message: ChatMessage) => {
    if (message.recalled) return;
    setReplyTo(message);
    focusInputSoon();
  }, [focusInputSoon]);

  const handleRecallMessage = useCallback(async (message: ChatMessage) => {
    if (message.playerId !== currentPlayerId || message.recalled) return;
    if (!isWithinRecallWindow(message.timestamp)) {
      antdMessage.warning(tl('撤回时间已超过，无法撤回', 'The recall window has expired'));
      return;
    }
    try {
      await p2pChatService.recallMessage(message.id);
      recallChatMessage(message.id, currentPlayerId);
      if (replyTo?.id === message.id) setReplyTo(null);
      antdMessage.success(tl('消息已撤回', 'Message recalled'));
    } catch (error) {
      console.error('撤回消息失败:', error);
      antdMessage.error(tl('撤回失败，请检查网络后重试', 'Recall failed. Check the network and try again.'));
    }
  }, [currentPlayerId, recallChatMessage, replyTo]);

  const handleJumpToReply = useCallback((sourceMessage: ChatMessage) => {
    const parsed = parseReplyContent(sourceMessage.content);
    if (!parsed) return;
    let targetIndex = parsed.targetId
      ? chatMessages.findIndex((message) => message.id === parsed.targetId)
      : -1;
    if (targetIndex < 0) {
      const legacyMatch = parsed.quoteLine.match(/^@([^\s]+)\s*(.*)$/);
      const sourceIndex = chatMessages.findIndex((message) => message.id === sourceMessage.id);
      if (legacyMatch && sourceIndex > 0) {
        const [, playerName, summary] = legacyMatch;
        for (let index = sourceIndex - 1; index >= 0; index -= 1) {
          const candidate = chatMessages[index];
          const candidateSummary = candidate.type === 'image'
            ? tl('[图片]', '[Image]')
            : (parseReplyContent(candidate.content)?.body || candidate.content).split('\n')[0].slice(0, 40);
          if (candidate.playerName === playerName && candidateSummary === summary) {
            targetIndex = index;
            break;
          }
        }
      }
    }
    if (targetIndex < 0) {
      antdMessage.info(tl('原消息已不在聊天记录中', 'The original message is no longer available'));
      return;
    }
    const target = chatMessages[targetIndex];
    if (highlightStartTimerRef.current) window.clearTimeout(highlightStartTimerRef.current);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    setHighlightedMessageId(null);
    setDisplayedMessageCount((count) => Math.max(count, chatMessages.length - targetIndex));
    window.setTimeout(() => {
      const element = messageRefs.current.get(target.id);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightStartTimerRef.current = window.setTimeout(() => {
        setHighlightedMessageId(target.id);
        highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 1250);
      }, 360);
    }, 50);
  }, [chatMessages]);

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    if (message.recalled) return;
    try {
      await navigator.clipboard.writeText(message.type === 'image' ? tl('[图片]', '[Image]') : getVisibleMessageContent(message.content));
      antdMessage.success(tl('消息已复制', 'Message copied'));
    } catch (error) {
      console.error('复制消息失败:', error);
      antdMessage.error(tl('复制失败，请重试', 'Copy failed, please retry'));
    }
  }, []);

  // 发送文本消息
  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentPlayerId) return;
    
    const text = inputValue.trim();
    // 引用回复：在正文前加入 "> @名字 摘要" 引用行（与安卓端格式一致，跨端互通）
    const messageContent = buildReplyContent(text);
    
    // 清空输入框
    setInputValue('');
    setReplyTo(null);
    
    try {
      // 乐观更新：立即在本地显示自己发送的消息
      const optimisticMessage: ChatMessage = {
        id: `msg-${currentPlayerId}-${Date.now()}`,
        playerId: currentPlayerId,
        playerName: config.playerName || tl('我', 'Me'),
        content: messageContent,
        timestamp: Date.now(),
        type: 'text',
      };
      
      // 立即添加到本地消息列表
      addChatMessage(optimisticMessage);
      console.log('✅ [ChatRoom] 乐观更新：本地显示消息');
      // 发送消息的一瞬间：瞬时滚动到底部（一次性，不锁定）
      isAtBottomRef.current = true;
      scrollToBottom(false);
      
      // 发送到P2P网络
      const res = await p2pChatService.sendTextMessage(messageContent, optimisticMessage.id);
      console.log('✅ [ChatRoom] 文本消息已发送到P2P网络', res);
      // 回执：有其他玩家但一个都没送达时，提示可能未送达
      if (res && res.total > 0 && res.delivered === 0) {
        antdMessage.warning(tl('消息可能未送达：其他玩家暂时不可达', 'Message may not be delivered: other players are unreachable'));
      }
    } catch (error) {
      console.error('发送聊天消息失败:', error);
      antdMessage.error(tl('发送消息失败', 'Failed to send message'));
      // 发送失败时恢复输入框内容
      setInputValue(text);
    }
  };

  // @ 提及候选列表（其他玩家 + 所有人）
  const mentionCandidates: string[] = (() => {
    const names = players
      .filter((p) => p.id !== currentPlayerId && p.name)
      .map((p) => p.name);
    const base = [tl('所有人', 'all'), ...names];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((n) => n.toLowerCase().includes(q));
  })();

  // 根据光标位置检测是否正在输入 @ 提及
  const detectMention = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) {
      setMentionOpen(false);
      return;
    }
    const between = before.slice(atIdx + 1);
    // @ 与光标之间不能有空白
    if (/\s/.test(between) || between.length > 20) {
      setMentionOpen(false);
      return;
    }
    // @ 必须在开头或前面是空白
    const charBefore = atIdx > 0 ? before[atIdx - 1] : ' ';
    if (atIdx !== 0 && charBefore !== ' ' && charBefore !== '\n') {
      setMentionOpen(false);
      return;
    }
    setMentionStart(atIdx);
    setMentionQuery(between);
    setMentionCursor(cursor);
    setMentionIndex(0);
    setMentionOpen(true);
  };

  // 输入框内容变化
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputValue(value);
    const cursor = e.target.selectionStart ?? value.length;
    detectMention(value, cursor);
  };

  // 选择一个 @ 提及候选
  const selectMention = (name: string) => {
    if (mentionStart < 0) return;
    const before = inputValue.slice(0, mentionStart);
    const after = inputValue.slice(mentionCursor);
    const inserted = `@${name} `;
    const newValue = before + inserted + after;
    setInputValue(newValue);
    setMentionOpen(false);
    // 重置光标到插入内容之后
    requestAnimationFrame(() => {
      const el = textAreaRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
      if (el) {
        const pos = (before + inserted).length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
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
          antdMessage.error(tl('图片大小不能超过10MB', 'Image cannot exceed 10MB'));
          setIsUploading(false);
          return;
        }

        console.log('📁 选择的图片文件:', file.name, '大小:', file.size);

        try {
          // 优化图片
          const optimizedDataUrl = await optimizeImage(file);
          const messageContent = buildReplyContent(tl('[图片]', '[Image]'));
          
          console.log('📤 发送优化后的图片消息');

          // 乐观更新：立即在本地显示自己发送的图片
          const optimisticMessage: ChatMessage = {
            id: `msg-${currentPlayerId}-${Date.now()}`,
            playerId: currentPlayerId!,
            playerName: config.playerName || tl('我', 'Me'),
            content: messageContent,
            timestamp: Date.now(),
            type: 'image',
            imageData: optimizedDataUrl,
          };
          
          // 立即添加到本地消息列表
          addChatMessage(optimisticMessage);
          console.log('✅ [ChatRoom] 乐观更新：本地显示图片');
          
          // 发送图片消息到P2P网络
          await p2pChatService.sendImageMessage(optimizedDataUrl, messageContent, optimisticMessage.id);
          setReplyTo(null);
          antdMessage.success(tl('图片发送成功', 'Image sent'));
          
          // 发送图片的一瞬间：瞬时滚动到底部（一次性）
          isAtBottomRef.current = true;
          scrollToBottom(false);
        } catch (error) {
          console.error('发送图片失败:', error);
          antdMessage.error(tl('发送图片失败', 'Failed to send image'));
        } finally {
          setIsUploading(false);
        }
      };

      input.click();
    } catch (error) {
      console.error('上传图片失败:', error);
      antdMessage.error(tl('上传图片失败', 'Failed to upload image'));
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
          antdMessage.error(tl('图片大小不能超过10MB', 'Image cannot exceed 10MB'));
          return;
        }

        try {
          setIsUploading(true);

          // 优化图片
          const optimizedDataUrl = await optimizeImage(file);
          const messageContent = buildReplyContent(tl('[图片]', '[Image]'));
          
          console.log('📤 发送粘贴的优化图片');

          // 乐观更新：立即在本地显示自己发送的图片
          const optimisticMessage: ChatMessage = {
            id: `msg-${currentPlayerId}-${Date.now()}`,
            playerId: currentPlayerId!,
            playerName: config.playerName || tl('我', 'Me'),
            content: messageContent,
            timestamp: Date.now(),
            type: 'image',
            imageData: optimizedDataUrl,
          };
          
          // 立即添加到本地消息列表
          addChatMessage(optimisticMessage);
          console.log('✅ [ChatRoom] 乐观更新：本地显示粘贴的图片');

          // 发送图片消息到P2P网络
          await p2pChatService.sendImageMessage(optimizedDataUrl, messageContent, optimisticMessage.id);
          setReplyTo(null);

          antdMessage.success(tl('图片发送成功', 'Image sent'));
          
          // 发送图片的一瞬间：瞬时滚动到底部（一次性）
          isAtBottomRef.current = true;
          scrollToBottom(false);
          
          setIsUploading(false);
        } catch (error) {
          console.error('粘贴图片失败:', error);
          antdMessage.error(tl('粘贴图片失败', 'Failed to paste image'));
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
      antdMessage.error(tl('只能拖拽图片文件', 'Only image files can be dropped'));
      return;
    }

    // 检查文件大小
    if (file.size > 10 * 1024 * 1024) {
      antdMessage.error(tl('图片大小不能超过10MB', 'Image cannot exceed 10MB'));
      return;
    }

    try {
      setIsUploading(true);

      // 优化图片
      const optimizedDataUrl = await optimizeImage(file);
      const messageContent = buildReplyContent(tl('[图片]', '[Image]'));
      
      console.log('📤 发送拖拽的优化图片');

      // 乐观更新：立即在本地显示自己发送的图片
      const optimisticMessage: ChatMessage = {
        id: `msg-${currentPlayerId}-${Date.now()}`,
        playerId: currentPlayerId!,
        playerName: config.playerName || tl('我', 'Me'),
        content: messageContent,
        timestamp: Date.now(),
        type: 'image',
        imageData: optimizedDataUrl,
      };
      
      // 立即添加到本地消息列表
      addChatMessage(optimisticMessage);
      console.log('✅ [ChatRoom] 乐观更新：本地显示拖拽的图片');

      // 发送图片消息到P2P网络
      await p2pChatService.sendImageMessage(optimizedDataUrl, messageContent, optimisticMessage.id);
      setReplyTo(null);

      antdMessage.success(tl('图片发送成功', 'Image sent'));
      
      // 发送图片的一瞬间：瞬时滚动到底部（一次性）
      isAtBottomRef.current = true;
      scrollToBottom(false);
      
      setIsUploading(false);
    } catch (error) {
      console.error('拖拽图片失败:', error);
      antdMessage.error(tl('拖拽图片失败', 'Failed to drop image'));
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // @ 提及下拉打开时，拦截上下/回车/Tab/Esc 用于选择候选
    if (mentionOpen && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

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
      antdMessage.error(tl('下载图片失败', 'Failed to download image'));
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

  // 当前玩家名（用于 @ 提醒判断）
  const ownName = (players.find((p) => p.id === currentPlayerId)?.name || config.playerName || '').trim();

  // 未读分隔线：定位第一条未读(他人)消息的 id，仅当当前不在底部且确有未读时显示
  const firstUnreadId =
    hasUnreadMessages && !isAtBottom
      ? chatMessages.find(
          (m, idx) => idx >= lastReadMessageIndex && m.playerId !== currentPlayerId
        )?.id
      : undefined;

  // 将文本消息渲染为富文本：识别链接（可点击外部打开）与 @提醒（高亮）
  const renderMessageText = (text: string): React.ReactNode => {
    if (!text) return text;
    // 先按 URL 切分，再对非 URL 片段按 @提醒切分
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const segments = text.split(urlRegex);
    return segments.map((seg, i) => {
      if (urlRegex.test(seg)) {
        // 去掉结尾常见标点，避免把句号带进链接
        const trimmed = seg.replace(/[。，、,.!?；;）)】\]]+$/, '');
        const tail = seg.slice(trimmed.length);
        return (
          <React.Fragment key={`u-${i}`}>
            <a
              className="chat-link"
              href={trimmed}
              onClick={(e) => {
                e.preventDefault();
                void openExternal(trimmed).catch(() => {});
              }}
            >
              {trimmed}
            </a>
            {tail}
          </React.Fragment>
        );
      }
      // 处理 @提醒
      const mentionRegex = /(@[^\s@]{1,20})/g;
      const parts = seg.split(mentionRegex);
      return parts.map((part, j) => {
        if (part.startsWith('@') && part.length > 1) {
          const mentionedName = part.slice(1);
          const isEveryone = mentionedName === '所有人' || mentionedName === '全体' || mentionedName.toLowerCase() === 'all';
          const isMe = !!ownName && mentionedName === ownName;
          const isKnown = players.some((p) => p.name === mentionedName);
          if (isMe || isKnown || isEveryone) {
            return (
              <span
                key={`m-${i}-${j}`}
                className="chat-mention"
              >
                {part}
              </span>
            );
          }
        }
        return <React.Fragment key={`t-${i}-${j}`}>{part}</React.Fragment>;
      });
    });
  };

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
            <span>{tl('加载中...', 'Loading...')}</span>
          </div>
        )}
        
        {!hasMoreMessages && chatMessages.length > displayedMessageCount && (
          <div className="chat-no-more">
            <span>{tl('没有更多消息了', 'No more messages')}</span>
          </div>
        )}
        
        <AnimatePresence mode="popLayout">
          {displayedMessages.map((message) => {
            const isOwnMessage = message.playerId === currentPlayerId;
            const canRecallMessage = isOwnMessage && !message.recalled && isWithinRecallWindow(message.timestamp, recallClock);
            const showUnreadDivider = firstUnreadId && message.id === firstUnreadId;
            
            return (
              <React.Fragment key={message.id}>
                {showUnreadDivider && (
                  <div className="chat-unread-divider">
                    <span className="chat-unread-divider-line" />
                    {tl('以下为新消息', 'New messages below')}
                    <span className="chat-unread-divider-line" />
                  </div>
                )}
                <motion.div
                  ref={(element) => {
                    if (element) messageRefs.current.set(message.id, element);
                    else messageRefs.current.delete(message.id);
                  }}
                  className={`chat-message ${isOwnMessage ? 'own' : 'other'}${highlightedMessageId === message.id ? ' message-highlighted' : ''}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setRecallClock(Date.now());
                    setMessageContextMenu({ message, x: event.clientX, y: event.clientY });
                  }}
                >
                {/* 头像 */}
                <div className="message-avatar">
                  <span>{getMessageInitial(message)}</span>
                </div>
                
                <span className="message-author-outside">
                  {message.playerName}
                  {isOwnMessage && ` (${tl('我', 'Me')})`}
                </span>
                
                <div className="message-bubble-stack">
                <div className={`message-content${message.type === 'image' && message.imageData ? ' message-content-image' : ''}${message.recalled ? ' message-content-recalled' : ''}`}>
                  {message.recalled ? (
                    <span className="message-recalled-text message-text-body">{tl('此消息已撤回', 'This message was recalled')}</span>
                  ) : message.type === 'image' && message.imageData ? (
                    <div className="chat-image-wrapper">
                      <img 
                        src={message.imageData} 
                        alt={tl('聊天图片', 'Chat image')} 
                        className="chat-image"
                        onClick={() => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); setPreviewImage(message.imageData!); }}
                        onLoad={() => { if (isAtBottom) { try { scrollToBottom(); } catch { /* ignore */ } } }}
                      />
                      <button
                        className="image-download-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadImage(message.imageData!, message.id);
                        }}
                        disabled={downloadingImageId === message.id}
                        title={tl('下载图片', 'Download image')}
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
                          {tl('已保存至', 'Saved to')} {downloadedImages.get(message.id)?.replace(/\\[^\\]+$/, '')}
                        </div>
                      )}
                    </div>
                  ) : (
                    (() => {
                      const parsed = parseReplyContent(message.content);
                      if (parsed) {
                        return (
                          <>
                            {parsed.quoteLine && (
                              <button type="button" className="chat-quote" onClick={() => handleJumpToReply(message)}>
                                {parsed.quoteLine}
                              </button>
                            )}
                            <span className="message-text-body">{renderMessageText(parsed.body)}</span>
                          </>
                        );
                      }
                      return <span className="message-text-body">{renderMessageText(message.content)}</span>;
                    })()
                  )}
                </div>
                {!message.recalled && (
                  <div className="message-hover-actions">
                    <button
                      className="message-action-btn"
                      title={tl('引用回复', 'Reply')}
                      onClick={() => handleQuoteMessage(message)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 17 4 12 9 7"></polyline>
                        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
                      </svg>
                    </button>
                    {canRecallMessage && (
                      <button
                        className="message-action-btn message-recall-btn"
                        title={tl('撤回消息', 'Recall message')}
                        onClick={() => void handleRecallMessage(message)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 14 4 9l5-5" />
                          <path d="M4 9h9a7 7 0 0 1 7 7v4" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                
                <span className="message-time-below">
                  {formatTime(message.timestamp)}
                </span>
                </div>
              </motion.div>
              </React.Fragment>
            );
          })}
        </AnimatePresence>
        
        <div ref={messagesEndRef} />
      </div>

      {messageContextMenu && (
        <div
          className="chat-message-context-menu"
          style={{
            left: Math.min(messageContextMenu.x, Math.max(8, window.innerWidth - 196)),
            top: Math.min(messageContextMenu.y, Math.max(8, window.innerHeight - 196)),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {!messageContextMenu.message.recalled && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              handleQuoteMessage(messageContextMenu.message);
              setMessageContextMenu(null);
            }}>
              <MessageOutlined />
              <span>{tl('引用消息', 'Quote message')}</span>
            </button>
          )}
          {!messageContextMenu.message.recalled && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              void handleCopyMessage(messageContextMenu.message);
              setMessageContextMenu(null);
            }}>
              <CopyOutlined />
              <span>{tl('复制消息', 'Copy message')}</span>
            </button>
          )}
          {messageContextMenu.message.playerId === currentPlayerId
            && !messageContextMenu.message.recalled
            && isWithinRecallWindow(messageContextMenu.message.timestamp, recallClock) && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              void handleRecallMessage(messageContextMenu.message);
              setMessageContextMenu(null);
            }}>
              <RollbackOutlined />
              <span>{tl('撤回消息', 'Recall message')}</span>
            </button>
          )}
          <button type="button" className="chat-message-context-item chat-message-context-danger" onClick={() => {
            deleteChatMessage(messageContextMenu.message.id);
            if (replyTo?.id === messageContextMenu.message.id) setReplyTo(null);
            setMessageContextMenu(null);
          }}>
            <DeleteOutlined />
            <span>{tl('删除消息', 'Delete message')}</span>
          </button>
        </div>
      )}
      
      {/* 新消息提示 */}
      <AnimatePresence>
        {hasUnreadMessages && !isAtBottom && (
          <motion.div
            className="new-message-indicator"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scrollToBottom()}
            title={tl('滚动到底部', 'Scroll to bottom')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7"/>
            </svg>
            {hasUnreadMessages && <div className="new-message-badge" />}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* ??????? */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            className="image-preview-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
          >
            <button
              type="button"
              className="image-preview-close"
              title={tl('关闭图片预览', 'Close image preview')}
              aria-label={tl('关闭图片预览', 'Close image preview')}
              onClick={(event) => { event.stopPropagation(); setPreviewImage(null); }}
            >
              <CloseOutlined />
            </button>
            <div className="image-preview-content" onClick={(e) => e.stopPropagation()}>
              <div
                className="image-preview-stage"
                onWheel={(e) => {
                  e.preventDefault();
                  setPreviewZoom((z) => Math.min(4, Math.max(0.5, z + (e.deltaY < 0 ? 0.15 : -0.15))));
                }}
                onPointerDown={(e) => {
                  if (previewZoom <= 1) return;
                  previewDragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const drag = previewDragRef.current;
                  if (!drag || drag.pointerId !== e.pointerId) return;
                  setPreviewPan((pan) => ({ x: pan.x + e.clientX - drag.x, y: pan.y + e.clientY - drag.y }));
                  previewDragRef.current = { ...drag, x: e.clientX, y: e.clientY };
                }}
                onPointerUp={(e) => {
                  if (previewDragRef.current?.pointerId === e.pointerId) previewDragRef.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => { previewDragRef.current = null; }}
              >
                <img
                  src={previewImage}
                  alt={tl('预览', 'Preview')}
                  onDoubleClick={() => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); }}
                  draggable={false}
                  style={{ transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})` }}
                />
              </div>
              <div className="image-preview-actions">
                <button type="button" onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.25))}>-</button>
                <button type="button" onClick={() => { setPreviewZoom(1); setPreviewPan({ x: 0, y: 0 }); }}>{Math.round(previewZoom * 100)}%</button>
                <button type="button" onClick={() => setPreviewZoom((z) => Math.min(4, z + 0.25))}>+</button>
              </div>
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
      {replyTo && (
        <div className="reply-preview reply-preview-above-input">
          <div className="reply-preview-bar" />
          <div className="reply-preview-body">
            <div className="reply-preview-name">{tl('\u56de\u590d ', 'Reply to ')}{replyTo.playerName}</div>
            <div className="reply-preview-text">{replyTo.type === 'image' ? tl('[\u56fe\u7247]', '[Image]') : replyTo.content}</div>
          </div>
          <button className="reply-preview-close" onClick={() => setReplyTo(null)} title={tl('取消引用', 'Cancel reply')} aria-label={tl('取消引用', 'Cancel reply')}>
            <CloseOutlined />
          </button>
        </div>
      )}

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
        {/* @ 提及候选下拉 */}
        <AnimatePresence>
          {mentionOpen && mentionCandidates.length > 0 && (
            <motion.div
              className="mention-dropdown"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.12 }}
            >
              {mentionCandidates.map((name, idx) => (
                <div
                  key={name}
                  className={`mention-item ${idx === mentionIndex ? 'active' : ''}`}
                  onMouseEnter={() => setMentionIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMention(name);
                  }}
                >
                  <span className="mention-at">@</span>
                  <span className="mention-name">{name}</span>
                  {name === tl('所有人', 'all') && <span className="mention-tag">{tl('全体提醒', 'Everyone')}</span>}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="chat-input-wrapper">
          <Button
            type="text"
            icon={<EmojiIcon size={22} />}
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title={tl('选择表情', 'Emoji')}
            className="emoji-button"
          />
          
          <Button
            type="text"
            icon={<ImageIcon size={22} />}
            onClick={handleImageUpload}
            loading={isUploading}
            title={tl('发送图片', 'Send image')}
            className="image-button"
          />

          <TextArea
            ref={textAreaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={tl('输入消息…', 'Type a message...')}
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
