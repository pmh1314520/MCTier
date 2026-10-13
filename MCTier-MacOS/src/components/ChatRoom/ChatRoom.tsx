import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input, Button, Dropdown } from 'antd';
import { BellOutlined, PushpinOutlined } from '@ant-design/icons';
import { sortPrivatePeers, notificationUnreadCount } from '../../services/chat/peerPreferences';
import { AudioOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, FileOutlined, LoadingOutlined, MessageOutlined, PaperClipOutlined, PlusOutlined, RollbackOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { isWithinRecallWindow, RECALL_WINDOW_MS } from '../../services/chat/recallPolicy';
import { EmojiPicker } from '../EmojiPicker/EmojiPicker';
import { MessageContextMenu } from './MessageContextMenu';
import { EmojiIcon, PauseIcon, PlayIcon } from '../icons';
import { Avatar } from '../Avatar/Avatar';
import { ImageViewer } from '../Avatar/ImageViewer';
import { saveAvatarData } from '../../services/avatar/avatarService';
import { createChatMessageId } from '../../services/chat/messageOrder';
import { unreadLabel } from '../../services/chat/unread';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { isSafeHttpUrl, isSafeImageDataUrl } from '../../security/trustBoundary';
import { shouldSubmitOnEnter } from '../../utils/imeSubmitPolicy';
import type { ChatMessage } from '../../types';
import './ChatRoom.css';

const { TextArea } = Input;
import { useHoldVoice } from '../../hooks/useHoldVoice';
import { safeVoiceUrl, voiceDataUrl, voiceMetadata } from '../../services/chat/voiceMessage';
import { fileToChatImageDataUrl, fileToOutgoingImageDataUrl } from '../../services/chat/imageData';
import { addDataUrlAsEmoji, syncBuiltinEmojiItems, type EmojiItem } from '../../services/emoji/emojiLibrary';
import { decodeBuiltinEmoji, encodeBuiltinEmoji } from '../../services/emoji/builtinEmojiMessage';
import { chatFileKind, formatFileSize, parseChatAttachment, previewOfficeFile, type ChatAttachment, type ChatFileKind } from '../../services/chat/fileAttachment';
import { transcribeVoiceMessage } from '../../services/chat/voiceTranscription';
import { showFeedback } from '../../services/ui/feedback';
import { voiceBubbleWidth, nonEmptySheets } from '../../services/chat/mediaLayout';
import { LocalFilePreview } from './LocalFilePreview';
const PdfPreview = React.lazy(() => import('./PdfPreview'));
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
  if (decodeBuiltinEmoji(content)) return tl('[内置表情]', '[Built-in emoji]');
  const parsed = parseReplyContent(content);
  return parsed ? `> ${parsed.quoteLine}\n${parsed.body}` : content;
};

const fuzzyMatch = (value: string, query: string) => {
  const haystack = value.normalize('NFKC').toLocaleLowerCase();
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase();
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const character of haystack) if (character === needle[cursor]) cursor += 1;
  return cursor === needle.length;
};

export const VoiceMessageBubble: React.FC<{ src: string; own: boolean; duration?: number }> = ({ src, own, duration: initialDuration = 0 }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(initialDuration);
  const [currentTime, setCurrentTime] = useState(0);
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { audio.pause(); setPlaying(false); }
  };
  const seek = (event: React.PointerEvent<HTMLSpanElement>) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    audio.currentTime = fraction * duration;
    setCurrentTime(audio.currentTime);
  };
  const progress = duration > 0 ? currentTime / duration : 0;
  return (
    <div className={`voice-message-bubble${own ? ' own' : ' other'}`} style={{ width: voiceBubbleWidth(duration) }}>
      <audio ref={audioRef} src={src || undefined} preload="metadata" onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setDuration(e.currentTarget.duration); }} onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setCurrentTime(0); }} />
      <button type="button" className="voice-message-play" onClick={toggle} aria-label={playing ? tl('暂停语音', 'Pause voice') : tl('播放语音', 'Play voice')}>
        {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
      </button>
      <span
        className="voice-message-wave"
        role="slider"
        aria-label={tl('语音播放进度', 'Voice playback progress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seek(event); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event); }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={(event) => {
          const audio = audioRef.current;
          if (!audio || !duration || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + (event.key === 'ArrowRight' ? 2 : -2)));
          setCurrentTime(audio.currentTime);
        }}
      >
        {Array.from({ length: 14 }, (_, i) => <i key={i} className={(i + 1) / 14 <= progress ? 'is-played' : ''} style={{ height: `${7 + ((i * 7) % 12)}px` }} />)}
      </span>
      <span className="voice-message-duration">{duration ? `${Math.round(duration)}s` : '--'}</span>
    </div>
  );
};

const formatMediaTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

const FileAudioBubble: React.FC<{ src: string; file: ChatAttachment; own: boolean }> = ({ src, file, own }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  return <div className={`file-audio-player ${own ? 'own' : 'other'}`}>
    <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
    <button type="button" className="file-media-play" onClick={(event) => { event.stopPropagation(); const audio = audioRef.current; if (!audio) return; if (audio.paused) void audio.play().then(() => setPlaying(true)); else { audio.pause(); setPlaying(false); } }} aria-label={playing ? tl('暂停', 'Pause') : tl('播放', 'Play')}>
      {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
    </button>
    <div className="file-audio-main">
      <strong title={file.name}>{file.name}</strong>
      <input className="file-media-range" type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={Math.min(current, duration || 0)} onClick={(event) => event.stopPropagation()} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setCurrent(value); }} aria-label={tl('音频播放进度', 'Audio playback progress')} />
      <span>{formatMediaTime(current)} / {duration ? formatMediaTime(duration) : '--:--'} · {formatFileSize(file.size)}</span>
    </div>
  </div>;
};

const FileVideoPlayer: React.FC<{ src: string; name: string }> = ({ src, name }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  return <div className="file-video-player">
    <video ref={videoRef} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
    <div className="file-video-controls">
      <button type="button" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play().then(() => setPlaying(true)); else { video.pause(); setPlaying(false); } }}>{playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</button>
      <input className="file-media-range" type="range" min={0} max={Math.max(duration, .01)} step={.01} value={Math.min(current, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = value; setCurrent(value); }} aria-label={tl('视频播放进度', 'Video playback progress')} />
      <span>{formatMediaTime(current)} / {formatMediaTime(duration)}</span>
    </div>
    <strong>{name}</strong>
  </div>;
};

const InlineVisualAttachment: React.FC<{ src: string; file: ChatAttachment; kind: 'image' | 'video'; onOpen: () => void }> = ({ src, file, kind, onOpen }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  return <button type="button" className={`chat-visual-attachment kind-${kind}`} onClick={onOpen} aria-label={kind === 'video' ? tl(`播放 ${file.name}`, `Play ${file.name}`) : tl(`查看 ${file.name}`, `View ${file.name}`)}>
    {kind === 'image'
      ? <img src={src} alt={file.name} loading="lazy" />
      : <video ref={videoRef} src={src} muted playsInline preload="auto" onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
        if (video.duration > .1) video.currentTime = Math.min(.1, video.duration / 2);
      }} />}
    {kind === 'video' && <span className="chat-video-play"><PlayIcon size={21} /></span>}
    {kind === 'video' && <span className="chat-video-meta"><strong>{file.name}</strong><small>{formatMediaTime(duration)}</small></span>}
  </button>;
};

const ChatImageBubble: React.FC<{
  src: string;
  name: string;
  onOpen: () => void;
  onDownload: () => void;
  onLoad?: () => void;
  downloading?: boolean;
  downloadedPath?: string;
}> = ({ src, name, onOpen, onDownload, onLoad, downloading = false, downloadedPath }) => (
  <div className="chat-image-wrapper">
    <img src={src} alt={name} className="chat-image" loading="lazy" onClick={onOpen} onLoad={onLoad} />
    <button
      className="image-download-btn"
      type="button"
      title={tl('下载图片', 'Download image')}
      aria-label={tl('下载图片', 'Download image')}
      disabled={downloading}
      onClick={(event) => { event.stopPropagation(); onDownload(); }}
    >
      {downloading ? <LoadingOutlined className="downloading-icon" /> : <DownloadOutlined />}
    </button>
    {downloadedPath && <div className="download-success-tip">{tl('已保存至', 'Saved to')} {downloadedPath.replace(/\\[^\\]+$/, '')}</div>}
  </div>
);

const FileDocumentViewer: React.FC<{ kind: ChatFileKind; sections: string[] }> = ({ kind, sections }) => {
  if (kind === 'sheet') sections = nonEmptySheets(sections);
  if (kind === 'word') return <article className="office-word-page">{sections.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article>;
  if (kind === 'slides') return <div className="office-slide-deck">{sections.map((section, index) => {
    const lines = section.split('\n').filter((line) => line.trim() && !/^--- \d+ ---$/.test(line.trim()));
    return <section className="office-slide" key={index}><span className="office-slide-number">{index + 1}</span>{lines[0] && <h3>{lines[0]}</h3>}<div>{lines.slice(1).map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</div></section>;
  })}</div>;
  if (kind === 'sheet') return <div className="office-workbook">{sections.map((section, index) => {
    const sheetNumber = section.match(/^--- (\d+) ---/)?.[1] ?? String(index + 1);
    const lines = section.split('\n').filter((line) => !/^--- \d+ ---$/.test(line.trim()));
    const rows = lines.map((line) => line.split('\t'));
    return <section className="office-sheet" key={index}><header>{tl(`工作表 ${sheetNumber}`, `Sheet ${sheetNumber}`)}</header><div><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></section>;
  })}</div>;
  return <pre className="office-text-preview">{sections.join('\n')}</pre>;
};

export const ChatRoom: React.FC = () => {
  const [builtinEmojis, setBuiltinEmojis] = useState<Map<string, EmojiItem>>(new Map());
  const [builtinEmojiStatus, setBuiltinEmojiStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadBuiltinEmojis = useCallback(async () => {
    setBuiltinEmojiStatus('loading');
    try {
      const items = await syncBuiltinEmojiItems();
      setBuiltinEmojis(new Map(items.map(item => [item.id, item])));
      setBuiltinEmojiStatus('ready');
    } catch { setBuiltinEmojiStatus('error'); }
  }, []);
  useEffect(() => { void loadBuiltinEmojis(); }, [loadBuiltinEmojis]);
  useTranslation();
  const { currentPlayerId, chatMessages, addChatMessage, deleteChatMessage, recallChatMessage, config } = useAppStore();
  const players = useAppStore((state) => state.players);
  const [inputValue, setInputValue] = useState('');
  const [chatTab, setChatTab] = useState<'lobby' | 'private'>('lobby');
  const [privatePeerId, setPrivatePeerId] = useState<string>('');
  const unreadChatMessages = useAppStore((state) => state.unreadChatMessages);
  const peerPreferences = useAppStore((state) => state.peerPreferences);
  const setPeerPreference = useAppStore((state) => state.setPeerPreference);
  const [peerMenuId, setPeerMenuId] = useState<string | null>(null);
  const setActiveChatConversation = useAppStore((state) => state.setActiveChatConversation);
  const conversation = chatTab === 'lobby' ? 'lobby' : privatePeerId ? `private:${privatePeerId}` : null;
  const conversationMessages = React.useMemo(() => chatMessages.filter(message => chatTab === 'private'
    ? !!privatePeerId && ((message.playerId === currentPlayerId && message.recipientId === privatePeerId) || (message.playerId === privatePeerId && message.recipientId === currentPlayerId))
    : !message.recipientId), [chatMessages, chatTab, privatePeerId, currentPlayerId]);
  useLayoutEffect(() => {
    const update = () => setActiveChatConversation(document.visibilityState === 'visible' && document.hasFocus() ? conversation : null);
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
      setActiveChatConversation(null);
    };
  }, [conversation, setActiveChatConversation]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [displayedMessageCount, setDisplayedMessageCount] = useState(30);
  const [lastReadMessageIndex, setLastReadMessageIndex] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCursor, setSearchCursor] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string; download?: () => void } | null>(null);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);
  const [downloadedImages, setDownloadedImages] = useState<Map<string, string>>(new Map());
  const [attachmentPaths, setAttachmentPaths] = useState<Map<string, string>>(new Map());
  const attachmentFetchesRef = useRef(new Set<string>());
  const [filePreview, setFilePreview] = useState<{
    message: ChatMessage; file: ChatAttachment; url: string; kind: ChatFileKind; loading: boolean; sections?: string[]; error?: string;
  } | null>(null);
  const [voiceTranscripts, setVoiceTranscripts] = useState<Map<string, { loading: boolean; text?: string; error?: string }>>(new Map());

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
  // 输入法组合会话标记：候选词面板打开期间的回车属于输入法，不能当作发送。
  const composingRef = useRef(false);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<number | null>(null);
  const highlightStartTimerRef = useRef<number | null>(null);
  const initializedScrollRef = useRef(false);

  useLayoutEffect(() => {
    setReplyTo(null);
    setShowEmojiPicker(false);
    setMentionOpen(false);
    setLastReadMessageIndex(conversationMessages.length);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    initializedScrollRef.current = false;
    if (messagesContainerRef.current) messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    // Only reset when switching conversations, not when messages arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

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
    const openSearch = () => setShowSearch(true);
    window.addEventListener('mctier-open-chat-search', openSearch);
    return () => window.removeEventListener('mctier-open-chat-search', openSearch);
  }, []);

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


  useEffect(() => setSearchCursor(0), [searchQuery, conversation]);

  // 计算未读消息数量（只计算其他人发送的消息）
  const unreadMessages = conversationMessages.filter((msg, index) =>
    msg.playerId !== currentPlayerId && index >= lastReadMessageIndex
  );
  const hasUnreadMessages = unreadMessages.length > 0;
  const unreadConversations = Object.values(unreadChatMessages);
  const privateUnreadFor = (playerId: string) => unreadConversations.filter(value => value === `private:${playerId}`).length;
  const privateUnread = notificationUnreadCount(Object.fromEntries(Object.entries(unreadChatMessages).filter(([, value]) => value.startsWith('private:'))), peerPreferences, players.map(p => p.id));
  const lobbyUnread = unreadConversations.filter(value => value === 'lobby').length;

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
      setLastReadMessageIndex(conversationMessages.length);
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
    if (newCount >= conversationMessages.length) {
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
    setLastReadMessageIndex(conversationMessages.length);
    markMessagesAsRead();
  };

  const getMessageAvatar = (message: ChatMessage) => (
    message.playerId === currentPlayerId
      ? config.avatarData
      : players.find((player) => player.id === message.playerId)?.avatarData
  );

  // Follow the bottom as the composer/picker resizes, without interrupting
  // someone reading older messages. ResizeObserver also covers multiline input.
  useLayoutEffect(() => {
    const element = messagesContainerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [conversation]);

  // 首次进入聊天室：在浏览器绘制前直接把滚动条置底（避免出现"从顶部滚到底部"的可见过程）。
  // 注意依赖 chatMessages.length：消息可能在挂载后才异步载入，确保有消息时才初始化一次，
  // 否则 initializedScrollRef 永远为 false 会导致后续自动滚动失效。
  useLayoutEffect(() => {
    if (initializedScrollRef.current) return;
    if (conversationMessages.length <= 0) return;
    initializedScrollRef.current = true;
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight; // 瞬间置底，无动画
    }
    setLastReadMessageIndex(conversationMessages.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationMessages.length, conversation]);

  // 新消息到达时：仅当用户当前已处于底部时才跟随他人消息（标准聊天行为）。
  // 不再因"最新消息是自己发的"而强制置底——那会导致用户往上翻历史时被反复拽回底部。
  // 自己发送消息时的瞬时置底由发送处理函数显式触发。
  useEffect(() => {
    if (conversationMessages.length <= 0) return;
    if (!initializedScrollRef.current) return;
    if (isAtBottomRef.current) scrollToBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationMessages.length]);

  const buildReplyContent = (body: string): string => {
    if (!replyTo) return body;
    const summary = replyTo.type === 'voice' ? tl('[语音]', '[Voice]') : replyTo.type === 'image'
      ? tl('[图片]', '[Image]')
      : getVisibleMessageContent(parseReplyContent(replyTo.content)?.body || replyTo.content).split('\n')[0].slice(0, 40);
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
      showFeedback('warning', tl('撤回时间已超过，无法撤回', 'The recall window has expired'));
      return;
    }
    try {
      await p2pChatService.recallMessage(message.id, chatTab === 'private' ? privatePeerId : undefined);
      recallChatMessage(message.id, currentPlayerId);
      if (replyTo?.id === message.id) setReplyTo(null);
      showFeedback('success', tl('消息已撤回', 'Message recalled'));
    } catch (error) {
      console.error('撤回消息失败:', error);
      showFeedback('error', tl('撤回失败，请检查网络后重试', 'Recall failed. Check the network and try again.'));
    }
  }, [currentPlayerId, recallChatMessage, replyTo, chatTab, privatePeerId]);

  const jumpToMessage = useCallback((target: ChatMessage) => {
    const targetIndex = conversationMessages.findIndex((message) => message.id === target.id);
    if (targetIndex < 0) return;
    if (highlightStartTimerRef.current) window.clearTimeout(highlightStartTimerRef.current);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    setHighlightedMessageId(null);
    setDisplayedMessageCount((count) => Math.max(count, conversationMessages.length - targetIndex));
    window.setTimeout(() => {
      messageRefs.current.get(target.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightStartTimerRef.current = window.setTimeout(() => {
        setHighlightedMessageId(target.id);
        highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 1250);
      }, 360);
    }, 50);
  }, [conversationMessages]);

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
            : candidate.type === 'file' ? candidate.attachment?.name ?? tl('[文件]', '[File]')
            : getVisibleMessageContent(parseReplyContent(candidate.content)?.body || candidate.content).split('\n')[0].slice(0, 40);
          if (candidate.playerName === playerName && candidateSummary === summary) {
            targetIndex = index;
            break;
          }
        }
      }
    }
    if (targetIndex < 0) {
      showFeedback('info', tl('原消息已不在聊天记录中', 'The original message is no longer available'));
      return;
    }
    jumpToMessage(chatMessages[targetIndex]);
  }, [chatMessages, jumpToMessage]);

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    if (message.recalled) return;
    try {
      await navigator.clipboard.writeText(message.type === 'voice' ? tl('[语音]', '[Voice]') : message.type === 'image' ? tl('[图片]', '[Image]') : message.type === 'file' ? message.attachment?.name ?? tl('[文件]', '[File]') : getVisibleMessageContent(message.content));
      showFeedback('success', tl('消息已复制', 'Message copied'));
    } catch (error) {
      console.error('复制消息失败:', error);
      showFeedback('error', tl('复制失败，请重试', 'Copy failed, please retry'));
    }
  }, []);

  // 发送文本消息
  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentPlayerId || (chatTab === 'private' && !privatePeerId)) return;
    
    const text = inputValue.trim();
    // 引用回复：在正文前加入 "> @名字 摘要" 引用行（与安卓端格式一致，跨端互通）
    const messageContent = buildReplyContent(text);
    
    // 清空输入框
    setInputValue('');
    setReplyTo(null);
    
    try {
      // 乐观更新：立即在本地显示自己发送的消息
      const optimisticMessage: ChatMessage = {
        id: createChatMessageId(currentPlayerId!),
        playerId: currentPlayerId,
        playerName: config.playerName || tl('我', 'Me'),
        content: messageContent,
        timestamp: Date.now(),
        type: 'text',
      };
      
      const recipientId = chatTab === 'private' ? privatePeerId : undefined;
      optimisticMessage.recipientId = recipientId;
      // 立即添加到本地消息列表
      addChatMessage(optimisticMessage);
      console.log('✅ [ChatRoom] 乐观更新：本地显示消息');
      // 发送消息的一瞬间：瞬时滚动到底部（一次性，不锁定）
      isAtBottomRef.current = true;
      scrollToBottom(false);
      
      // 发送到P2P网络
      const res = await p2pChatService.sendTextMessage(messageContent, optimisticMessage.id, recipientId);
      console.log('✅ [ChatRoom] 文本消息已发送到P2P网络', res);
      // 回执：有其他玩家但一个都没送达时，提示可能未送达
      if (res && res.total > 0 && res.delivered === 0) {
        showFeedback('warning', tl('消息可能未送达：其他玩家暂时不可达', 'Message may not be delivered: other players are unreachable'));
      }
    } catch (error) {
      console.error('发送聊天消息失败:', error);
      showFeedback('error', tl('发送消息失败', 'Failed to send message'));
      // 发送失败时恢复输入框内容
      setInputValue(text);
    }
  };

  const voice = useHoldVoice(!inputValue && !!currentPlayerId && (chatTab !== 'private' || !!privatePeerId), async (blob, duration) => {
    const recipientId = chatTab === 'private' ? privatePeerId : undefined;
    const lobbyId = useAppStore.getState().lobby?.id;
    const data = voiceDataUrl(Array.from(new Uint8Array(await blob.arrayBuffer())), blob.type);
    if (useAppStore.getState().currentPlayerId !== currentPlayerId || useAppStore.getState().lobby?.id !== lobbyId) return;
    const id = createChatMessageId(currentPlayerId!);
    addChatMessage({ id, playerId: currentPlayerId!, playerName: config.playerName || tl('我', 'Me'),
      content: JSON.stringify({ mime: blob.type, duration }), type: 'voice', timestamp: Date.now(), recipientId, delivery: 'sending',
      imageData: data });
    scrollToBottom(false);
    try {
      const result = await p2pChatService.sendVoiceMessage(blob, duration, id, recipientId);
      useAppStore.setState(state => ({ chatMessages: state.chatMessages.map(m => m.id === id ? { ...m, delivery: result.total > 0 && result.delivered === 0 ? 'failed' : undefined } : m) }));
      if (result.total > 0 && result.delivered === 0) showFeedback('warning', tl('语音未送达', 'Voice message was not delivered'));
    } catch (error) {
      useAppStore.setState(state => ({ chatMessages: state.chatMessages.map(m => m.id === id ? { ...m, delivery: 'failed' } : m) }));
      throw error;
    }
  }, () => showFeedback('error', tl('录音或发送失败，请检查麦克风设备、系统隐私设置和网络', 'Recording or sending failed. Check the microphone, system privacy settings and network')), `${currentPlayerId}:${chatTab}:${privatePeerId}`);

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
    if (chatTab === 'private') setMentionOpen(false);
    else detectMention(value, cursor);
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

  const sendImageDataUrl = useCallback(async (dataUrl: string, content = tl('[图片]', '[Image]')) => {
    if (!currentPlayerId || (chatTab === 'private' && !privatePeerId)) throw new Error('NO_RECIPIENT');
    const normalizedDataUrl = dataUrl.startsWith('data:')
      ? dataUrl
      : await fileToOutgoingImageDataUrl(await (await fetch(dataUrl)).blob());
    const messageContent = buildReplyContent(content);
    const recipientId = chatTab === 'private' ? privatePeerId : undefined;
    const optimisticMessage: ChatMessage = {
      id: createChatMessageId(currentPlayerId),
      playerId: currentPlayerId,
      playerName: config.playerName || tl('我', 'Me'),
      content: messageContent,
      timestamp: Date.now(),
      type: 'image',
      imageData: normalizedDataUrl,
      recipientId,
      delivery: 'sending',
    };
    addChatMessage(optimisticMessage);
    isAtBottomRef.current = true;
    scrollToBottom(false);
    try {
      await p2pChatService.sendImageMessage(normalizedDataUrl, messageContent, optimisticMessage.id, recipientId, prepared => {
        const ready = prepared.attachment
          ? { ...optimisticMessage, type: 'file', content: JSON.stringify(prepared.attachment), attachment: prepared.attachment, imageData: undefined }
          : { ...optimisticMessage, imageData: prepared.imageData };
        useAppStore.setState(state => ({ chatMessages: state.chatMessages.map(m => m.id === optimisticMessage.id ? { ...ready, type: prepared.attachment ? 'file' : 'image' } : m) }));
      });
      useAppStore.setState(state => ({ chatMessages: state.chatMessages.map(m => m.id === optimisticMessage.id ? { ...m, delivery: undefined } : m) }));
    } catch (error) {
      useAppStore.setState(state => ({ chatMessages: state.chatMessages.map(m => m.id === optimisticMessage.id ? { ...m, delivery: 'failed' } : m) }));
      throw error;
    }
    setReplyTo(null);
    isAtBottomRef.current = true;
    scrollToBottom(false);
  }, [currentPlayerId, chatTab, privatePeerId, config.playerName, addChatMessage, deleteChatMessage, buildReplyContent, scrollToBottom]);

  const sendImageFile = useCallback(async (file: File) => {
    await sendImageDataUrl(await fileToOutgoingImageDataUrl(file));
  }, [sendImageDataUrl]);

  const fetchAttachmentPath = useCallback(async (message: ChatMessage) => {
    const attachment = message.attachment ?? parseChatAttachment(message.content);
    if (!attachment) throw new Error('INVALID_ATTACHMENT');
    const existing = attachmentPaths.get(`${message.playerId}:${attachment.id}`);
    if (existing) return { attachment, path: existing, url: convertFileSrc(existing) };
    const path = await invoke<string>('fetch_chat_attachment', { ownerPlayerId: message.playerId, attachment });
    setAttachmentPaths((current) => new Map(current).set(`${message.playerId}:${attachment.id}`, path));
    return { attachment, path, url: convertFileSrc(path) };
  }, [attachmentPaths]);

  useEffect(() => {
    for (const message of conversationMessages) {
      const attachment = message.type === 'file' ? message.attachment ?? parseChatAttachment(message.content) : null;
      const kind = attachment ? chatFileKind(attachment) : null;
      const key = attachment ? `${message.playerId}:${attachment.id}` : '';
      if (!attachment || !kind || !['audio', 'image', 'video'].includes(kind) || attachmentPaths.has(key) || attachmentFetchesRef.current.has(key)) continue;
      attachmentFetchesRef.current.add(key);
      void fetchAttachmentPath(message).catch(() => undefined);
    }
  }, [conversationMessages, attachmentPaths, fetchAttachmentPath]);

  const handleFileUpload = useCallback(async () => {
    if (isUploading || !currentPlayerId || (chatTab === 'private' && !privatePeerId)) return;
    const sendingLobbyId = useAppStore.getState().lobby?.id;
    const recipientId = chatTab === 'private' ? privatePeerId : undefined;
    setIsUploading(true);
    try {
      const attachment = await invoke<ChatAttachment | null>('select_chat_attachment', { recipientId: recipientId ?? null });
      if (useAppStore.getState().lobby?.id !== sendingLobbyId || useAppStore.getState().currentPlayerId !== currentPlayerId) throw new Error(tl('聊天会话已变化，请重新发送', 'The chat session changed. Please send again.'));
      const safe = parseChatAttachment(attachment);
      if (!safe) return;
      const id = createChatMessageId(currentPlayerId);
      const content = JSON.stringify(safe);
      const optimistic: ChatMessage = { id, playerId: currentPlayerId, playerName: config.playerName || tl('我', 'Me'), content, timestamp: Date.now(), type: 'file', attachment: safe, recipientId };
      addChatMessage(optimistic);
      const result = await p2pChatService.sendFileMessage(safe, id, recipientId);
      if (result.total > 0 && result.delivered === 0) showFeedback('warning', tl('文件消息可能未送达', 'The file message may not have been delivered'));
      setReplyTo(null);
      scrollToBottom(false);
    } catch (error) {
      console.error('发送文件失败:', error);
      showFeedback('error', error instanceof Error ? error.message : tl('发送文件失败', 'Failed to send file'));
    } finally { setIsUploading(false); }
  }, [isUploading, currentPlayerId, chatTab, privatePeerId, config.playerName, addChatMessage, scrollToBottom]);

  const openFilePreview = useCallback(async (message: ChatMessage) => {
    const attachment = message.attachment ?? parseChatAttachment(message.content);
    if (!attachment) return;
    const kind = chatFileKind(attachment);
    setFilePreview({ message, file: attachment, url: '', kind, loading: true });
    try {
      const { url } = await fetchAttachmentPath(message);
      if (kind === 'archive' || (kind === 'slides' && attachment.name.toLowerCase().endsWith('.pptx'))) {
        setFilePreview({ message, file: attachment, url, kind, loading: false });
      } else if (kind === 'text' || kind === 'word' || kind === 'sheet' || kind === 'slides') {
        const response = await fetch(url);
        if (!response.ok) throw new Error('ATTACHMENT_CACHE_READ_FAILED');
        const blob = await response.blob();
        if (kind === 'text') {
          setFilePreview({ message, file: attachment, url, kind, loading: false, sections: [(await blob.text()).slice(0, 2 * 1024 * 1024)] });
        } else {
          const extension = attachment.name.split('.').pop()?.toLowerCase() ?? '';
          if (kind === 'sheet' && ['xls', 'xlsb'].includes(extension)) {
            const sections = await invoke<string[]>('preview_spreadsheet_attachment', { ownerPlayerId: message.playerId, attachment });
            setFilePreview({ message, file: attachment, url, kind, loading: false, sections });
          } else if ((kind === 'word' && ['doc', 'docx', 'odt', 'rtf'].includes(extension)) || (kind === 'slides' && ['ppt', 'pptx', 'odp'].includes(extension))) {
            try {
              const pdfPath = await invoke<string>('preview_office_attachment', { ownerPlayerId: message.playerId, attachment });
              setFilePreview({ message, file: attachment, url: convertFileSrc(pdfPath), kind: 'pdf', loading: false });
            } catch (nativeError) {
              if (kind === 'slides' || ['doc', 'ppt', 'rtf'].includes(extension)) throw nativeError;
              const sections = (await previewOfficeFile(blob, kind, attachment.name)).sections;
              setFilePreview({ message, file: attachment, url, kind, loading: false, sections });
            }
          } else {
            const sections = (await previewOfficeFile(blob, kind, attachment.name)).sections;
            setFilePreview({ message, file: attachment, url, kind, loading: false, sections });
          }
        }
      } else {
        setFilePreview({ message, file: attachment, url, kind, loading: false });
      }
    } catch (error) {
      console.error('预览文件失败:', error);
      setFilePreview({ message, file: attachment, url: '', kind, loading: false, error: tl('无法预览此文件，发送者可能已离线或文件格式不受支持', 'Preview unavailable. The sender may be offline or the format may not be supported.') });
    }
  }, [fetchAttachmentPath]);

  const downloadFileMessage = useCallback(async (message: ChatMessage) => {
    const attachment = message.attachment ?? parseChatAttachment(message.content);
    if (!attachment) return;
    try {
      const saved = await invoke<string | null>('save_chat_attachment', { ownerPlayerId: message.playerId, attachment });
      if (saved) showFeedback('success', tl('文件已下载', 'File downloaded'));
    } catch (error) {
      console.error('下载文件失败:', error);
      showFeedback('error', tl('下载文件失败', 'Failed to download file'));
    }
  }, []);

  const addFileImageToEmoji = useCallback(async (message: ChatMessage) => {
    const attachment = message.attachment ?? parseChatAttachment(message.content);
    if (!attachment || chatFileKind(attachment) !== 'image') throw new Error('NOT_IMAGE_ATTACHMENT');
    const { url } = await fetchAttachmentPath(message);
    await addDataUrlAsEmoji(url, 'custom', attachment.name);
  }, [fetchAttachmentPath]);

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

        try {
          setIsUploading(true);
          await sendImageFile(file);
          showFeedback('success', tl('图片发送成功', 'Image sent'));
        } catch (error) {
          console.error('粘贴图片失败:', error);
          showFeedback('error', tl('无法发送此图片', 'This image cannot be sent'));
        } finally { setIsUploading(false); }
        
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
    
    try {
      setIsUploading(true);
      await sendImageFile(file);
      showFeedback('success', tl('图片发送成功', 'Image sent'));
    } catch (error) {
      console.error('拖拽图片失败:', error);
      showFeedback('error', tl('无法发送此图片', 'This image cannot be sent'));
    } finally { setIsUploading(false); }
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
      // 组合态下的回车属于输入法确认候选词，必须放行给输入法而不是选中 @ 候选。
      const composingNow = e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current;
      if ((e.key === 'Enter' && !composingNow) || e.key === 'Tab') {
        e.preventDefault();
        selectMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === 'Enter') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (
      shouldSubmitOnEnter({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.keyCode,
        composingSession: composingRef.current,
      })
    ) {
      e.preventDefault();
      e.stopPropagation();
      handleSendMessage();
    }
  };

  // 处理Emoji选择
  const handleEmojiSelect = async (emoji: EmojiItem) => {
    try {
      if (emoji.builtin || emoji.categoryId === 'builtin') {
        if (!currentPlayerId || (chatTab === 'private' && !privatePeerId)) throw new Error('CHAT_NOT_READY');
        // Only the locally bundled index can authorize an ID as a built-in emoji.
        if (!(await syncBuiltinEmojiItems()).some(item => item.id === emoji.id)) throw new Error('UNKNOWN_BUILTIN_EMOJI');
        const content = encodeBuiltinEmoji(emoji.id);
        const recipientId = chatTab === 'private' ? privatePeerId : undefined;
        const id = createChatMessageId(currentPlayerId);
        addChatMessage({ id, playerId: currentPlayerId, playerName: config.playerName || tl('我', 'Me'), content, timestamp: Date.now(), type: 'text', recipientId });
        try {
          const result = await p2pChatService.sendTextMessage(content, id, recipientId);
          if (result.total > 0 && result.delivered === 0) showFeedback('warning', tl('表情可能未送达', 'The emoji may not have been delivered'));
        } catch (error) { deleteChatMessage(id); throw error; }
        setReplyTo(null);
        isAtBottomRef.current = true;
        scrollToBottom(false);
      } else {
        await sendImageDataUrl(emoji.dataUrl, tl('[表情]', '[Emoji]'));
      }
    }
    catch (error) {
      showFeedback('error', tl('表情发送失败', 'Failed to send emoji'));
      throw error;
    }
  };

  const handleVoiceTranscription = useCallback(async (message: ChatMessage) => {
    if (!safeVoiceUrl(message.imageData)) return;
    setVoiceTranscripts((current) => new Map(current).set(message.id, { loading: true }));
    try {
      const text = (await transcribeVoiceMessage(message.imageData, navigator.language, (completed, total) => {
        setVoiceTranscripts(current => new Map(current).set(message.id, { loading: true, text: completed < total
          ? tl(`正在初始化内置语音模型 ${Math.floor(completed * 100 / total)}%`, `Preparing bundled speech model ${Math.floor(completed * 100 / total)}%`)
          : tl('正在识别语音…', 'Transcribing voice…') }));
      })).trim();
      setVoiceTranscripts((current) => new Map(current).set(message.id, {
        loading: false,
        text: text || tl('未识别到清晰的语音内容', 'No clear speech was recognized'),
      }));
    } catch (error) {
      console.error('语音转文字失败:', error);
      setVoiceTranscripts((current) => new Map(current).set(message.id, {
        loading: false,
        error: typeof error === 'string' ? error : tl('离线语音识别失败，请重试', 'Offline transcription failed. Please try again.'),
      }));
      showFeedback('error', tl('语音转文字失败', 'Voice transcription failed'));
    }
  }, []);

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
      showFeedback('error', tl('下载图片失败', 'Failed to download image'));
      setDownloadingImageId(null);
    }
  };

  const handleDownloadBuiltinEmoji = async (emoji: EmojiItem, messageId: string) => {
    try {
      const response = await fetch(emoji.dataUrl);
      if (!response.ok) throw new Error('EMOJI_READ_FAILED');
      await handleDownloadImage(await fileToChatImageDataUrl(await response.blob()), messageId);
    } catch { showFeedback('error', tl('保存表情失败', 'Failed to save emoji')); }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // 获取要显示的消息（只显示最近的N条）
  const displayedMessages = conversationMessages.slice(-displayedMessageCount);
  const searchMatches = searchQuery.trim()
    ? conversationMessages.filter((message) => !message.recalled && fuzzyMatch(`${message.playerName} ${message.type === 'image' ? tl('[图片] [表情]', '[Image] [Emoji]') : message.type === 'file' ? message.attachment?.name ?? tl('[文件]', '[File]') : getVisibleMessageContent(message.content)}`, searchQuery))
    : [];

  // 当前玩家名（用于 @ 提醒判断）
  const ownName = (players.find((p) => p.id === currentPlayerId)?.name || config.playerName || '').trim();

  // 未读分隔线：定位第一条未读(他人)消息的 id，仅当当前不在底部且确有未读时显示
  const firstUnreadId =
    hasUnreadMessages && !isAtBottom
      ? conversationMessages.find(
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
      if (/^https?:\/\//i.test(seg)) {
        // 去掉结尾常见标点，避免把句号带进链接
        const trimmed = seg.replace(/[。，、,.!?；;）)】\]]+$/, '');
        const tail = seg.slice(trimmed.length);
        if (!isSafeHttpUrl(trimmed)) return <React.Fragment key={`u-${i}`}>{seg}</React.Fragment>;
        return (
          <React.Fragment key={`u-${i}`}>
            <a
              className="chat-link"
              href={trimmed}
              onClick={(e) => {
                e.preventDefault();
                void invoke('open_external_url', { url: trimmed }).catch(() => {
                  // Keep browser-based development usable; packaged Tauri uses the OS launcher above.
                  window.open(trimmed, '_blank', 'noopener,noreferrer');
                });
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
      <div className="chat-tabs" role="tablist">
        <button type="button" className={chatTab === 'lobby' ? 'active' : ''} onClick={() => setChatTab('lobby')}>{tl('大厅', 'Lobby')}{lobbyUnread > 0 && <span className="chat-tab-badge">{unreadLabel(lobbyUnread)}</span>}</button>
        <button type="button" className={chatTab === 'private' ? 'active' : ''} onClick={() => setChatTab('private')}>
          {tl('私聊', 'Private')}{privateUnread > 0 && <span className="chat-tab-badge">{unreadLabel(privateUnread)}</span>}
        </button>
        {chatTab === 'private' && privatePeerId && <button type="button" className="private-peer-current" title={tl('返回玩家列表', 'Back to players')} onClick={() => setPrivatePeerId('')}><RollbackOutlined /><span className="private-peer-name">{players.find((p) => p.id === privatePeerId)?.name}</span></button>}
        <button type="button" className={`chat-search-toggle${showSearch ? ' active' : ''}`} title={tl('搜索聊天记录', 'Search messages')} aria-label={tl('搜索聊天记录', 'Search messages')} onClick={() => setShowSearch((value) => !value)}><SearchOutlined /></button>
      </div>
      {showSearch && <section className="chat-search-panel" aria-label={tl('聊天记录搜索', 'Message search')}>
        <div className="chat-search-field"><SearchOutlined /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={tl('搜索当前会话', 'Search this conversation')} /><button type="button" onClick={() => { setSearchQuery(''); setShowSearch(false); }}><CloseOutlined /></button></div>
        {searchQuery.trim() && <div className="chat-search-results">
          <div className="chat-search-summary">{searchMatches.length ? tl(`找到 ${searchMatches.length} 条消息`, `${searchMatches.length} messages`) : tl('没有匹配消息', 'No matching messages')}</div>
          {searchMatches.slice().reverse().map((message, reverseIndex) => {
            const index = searchMatches.length - 1 - reverseIndex;
            return <button key={message.id} type="button" className={searchCursor === index ? 'active' : ''} onClick={() => { setSearchCursor(index); jumpToMessage(message); }}>
              <span><strong>{message.playerName}</strong><time>{formatTime(message.timestamp)}</time></span>
              <em>{message.type === 'image' ? tl('[图片/表情]', '[Image/emoji]') : message.type === 'file' ? message.attachment?.name ?? tl('[文件]', '[File]') : getVisibleMessageContent(message.content)}</em>
            </button>;
          })}
        </div>}
      </section>}
      <div 
        className="chat-messages" 
        onPointerDownCapture={() => setShowEmojiPicker(false)}
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {chatTab === 'private' && !privatePeerId && (
          <div className="private-peer-list">
            <div className="private-peer-list-title">{tl('选择要私聊的玩家', 'Choose a player to message')}</div>
            {sortPrivatePeers(players.filter((p) => p.id !== currentPlayerId), peerPreferences).map((p) => {
              const unread = privateUnreadFor(p.id);
              const preference = peerPreferences[p.id];
              return <Dropdown key={p.id} trigger={['contextMenu']} open={peerMenuId === p.id}
                onOpenChange={(open) => setPeerMenuId(current => open ? p.id : current === p.id ? null : current)} menu={{ items: [
                  { key: 'pin', icon: <PushpinOutlined />, label: preference?.pinned ? tl('取消置顶', 'Unpin') : tl('置顶', 'Pin') },
                  { key: 'unread', icon: <MessageOutlined />, label: tl('标记未读', 'Mark unread') },
                  { key: 'mute', icon: <BellOutlined />, label: preference?.muted ? tl('关闭免打扰', 'Disable Do Not Disturb') : tl('设置免打扰', 'Do Not Disturb') },
                ], onClick: ({ key }) => {
                  const patch = key === 'pin' ? { pinned: !preference?.pinned } : key === 'mute' ? { muted: !preference?.muted } : { markedUnread: true };
                  if (setPeerPreference(p.id, patch)) showFeedback('success', tl('私信设置已保存', 'Conversation preference saved'));
                  setPeerMenuId(null);
                } }}>
              <div className={`private-peer-item${preference?.pinned ? ' is-pinned' : ''}`}>
                <Avatar name={p.name} avatarData={p.avatarData} size={38} />
                <button type="button" className="private-peer-open" onClick={() => setPrivatePeerId(p.id)}
                  onKeyDown={(e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setPeerMenuId(p.id); } }}>
                  <span>{p.name}</span>
                  {preference?.pinned && <PushpinOutlined title={tl('已置顶', 'Pinned')} />}
                  {preference?.muted && <BellOutlined title={tl('免打扰', 'Do Not Disturb')} />}
                  {unread > 0 ? <span className={`private-peer-unread ${unread >= 10 ? 'pill' : ''} ${preference?.muted ? 'muted' : ''}`}>{unread > 99 ? '99+' : unread}</span>
                    : preference?.markedUnread && <span className={`private-peer-marked${preference?.muted ? ' muted' : ''}`} aria-label={tl('未读', 'Unread')} />}
                </button>
              </div></Dropdown>;
            })}
          </div>
        )}
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
            const canRecallMessage = isOwnMessage && !message.delivery && !message.recalled && isWithinRecallWindow(message.timestamp, recallClock);
            const showUnreadDivider = firstUnreadId && message.id === firstUnreadId;
            const imageData = isSafeImageDataUrl(message.imageData) ? message.imageData : undefined;
            const builtinId = message.type === 'text' && !message.recalled ? decodeBuiltinEmoji(message.content) : null;
            const builtinEmoji = builtinId ? builtinEmojis.get(builtinId) : undefined;
            
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
                <Avatar
                  className="message-avatar"
                  name={message.playerName || (message.playerId === currentPlayerId ? config.playerName : '')}
                  avatarData={getMessageAvatar(message)}
                  size={34}
                  editable={isOwnMessage}
                  onChange={(avatarData) => void saveAvatarData(avatarData)}
                />
                
                <span className="message-author-outside">
                  {message.playerName}
                  {isOwnMessage && ` (${tl('我', 'Me')})`}
                </span>
                
                <div className="message-bubble-stack">
                <div className={`message-content${(message.type === 'image' && imageData) || builtinId ? ' message-content-image' : ''}${message.type === 'voice' ? ' message-content-voice' : ''}${message.type === 'file' ? ' message-content-file' : ''}${message.recalled ? ' message-content-recalled' : ''}`}>
                  {message.recalled ? (
                    <span className="message-recalled-text message-text-body">{tl('此消息已撤回', 'This message was recalled')}</span>
                  ) : builtinId ? (
                    builtinEmoji ? <ChatImageBubble
                      src={builtinEmoji.dataUrl}
                      name={tl('内置表情', 'Built-in emoji')}
                      onOpen={() => setPreviewImage({ src: builtinEmoji.dataUrl, name: tl('内置表情', 'Built-in emoji'), download: () => void handleDownloadBuiltinEmoji(builtinEmoji, message.id) })}
                      onDownload={() => void handleDownloadBuiltinEmoji(builtinEmoji, message.id)}
                      downloading={downloadingImageId === message.id}
                      downloadedPath={downloadedImages.get(message.id)}
                      onLoad={() => { if (isAtBottom) scrollToBottom(); }}
                    /> : <button type="button" className="chat-visual-attachment loading" disabled={builtinEmojiStatus !== 'error'} onClick={() => void loadBuiltinEmojis()}>
                      {builtinEmojiStatus === 'loading' ? tl('正在准备内置表情…', 'Preparing built-in emoji…') : builtinEmojiStatus === 'error' ? tl('表情准备失败，点击重试', 'Emoji preparation failed. Click to retry') : tl('此内置表情不可用，请更新应用', 'This emoji is unavailable. Please update the app')}
                    </button>
                  ) : message.type === 'voice' && safeVoiceUrl(message.imageData) ? (
                    <div className={`voice-message-stack${isOwnMessage ? ' own' : ' other'}`}>
                      <VoiceMessageBubble src={message.imageData} own={isOwnMessage} duration={voiceMetadata(message.content)?.duration} />
                      {voiceTranscripts.has(message.id) && (() => {
                        const transcript = voiceTranscripts.get(message.id)!;
                        return <div className={`voice-transcript-inline${transcript.error ? ' error' : ''}`} aria-live="polite">
                          {transcript.loading
                            ? <><LoadingOutlined /><span>{transcript.text || tl('正在识别语音…', 'Transcribing voice…')}</span></>
                            : <span>{transcript.error || transcript.text}</span>}
                        </div>;
                      })()}
                    </div>
                  ) : message.type === 'file' && (message.attachment ?? parseChatAttachment(message.content)) ? (
                    (() => {
                      const file = (message.attachment ?? parseChatAttachment(message.content))!;
                      const cached = attachmentPaths.get(`${message.playerId}:${file.id}`);
                      const kind = chatFileKind(file);
                      if (kind === 'audio' && cached) return <FileAudioBubble src={convertFileSrc(cached)} file={file} own={isOwnMessage} />;
                      if (kind === 'image' && cached) {
                        const source = convertFileSrc(cached);
                        return <ChatImageBubble
                          src={source}
                          name={file.name}
                          onOpen={() => { setPreviewImage({ src: source, name: file.name, download: () => void downloadFileMessage(message) }); }}
                          onDownload={() => void downloadFileMessage(message)}
                        />;
                      }
                      if (kind === 'video' && cached) return <InlineVisualAttachment src={convertFileSrc(cached)} file={file} kind={kind} onOpen={() => void openFilePreview(message)} />;
                      if (kind === 'image' || kind === 'video') return <button type="button" className={`chat-visual-attachment loading kind-${kind}`} onClick={() => void fetchAttachmentPath(message).catch(() => showFeedback('error', tl('图片预览加载失败', 'Failed to load image preview')))}><LoadingOutlined /><span>{tl('正在加载预览', 'Loading preview')}</span></button>;
                      return <button type="button" className={`chat-file-bubble file-kind-${kind}`} onClick={() => void openFilePreview(message)}>
                        <span className="chat-file-icon"><FileOutlined /></span>
                        <span className="chat-file-info"><strong title={file.name}>{file.name}</strong><small>{file.mime} · {formatFileSize(file.size)}</small></span>
                        {kind === 'audio' && <span className="chat-file-action"><PlayIcon size={14} /></span>}
                      </button>;
                    })()
                  ) : message.type === 'image' && imageData ? (
                    <ChatImageBubble
                      src={imageData}
                      name={tl('聊天图片', 'Chat image')}
                      onOpen={() => { setPreviewImage({ src: imageData, name: tl('聊天图片', 'Chat image'), download: () => void handleDownloadImage(imageData, message.id) }); }}
                      onDownload={() => void handleDownloadImage(imageData, message.id)}
                      onLoad={() => { if (isAtBottom) { try { scrollToBottom(); } catch { /* ignore */ } } }}
                      downloading={downloadingImageId === message.id}
                      downloadedPath={downloadedImages.get(message.id)}
                    />
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
                    {message.delivery === 'sending' && ` · ${tl('发送中…', 'Sending…')}`}
                    {message.delivery === 'failed' && ` · ${tl('发送失败', 'Send failed')}`}
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
        <MessageContextMenu x={messageContextMenu.x} y={messageContextMenu.y}>
          {!messageContextMenu.message.recalled && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              handleQuoteMessage(messageContextMenu.message);
              setMessageContextMenu(null);
            }}>
              <MessageOutlined />
              <span>{tl('引用消息', 'Quote message')}</span>
            </button>
          )}
          {!messageContextMenu.message.recalled && messageContextMenu.message.type === 'voice' && safeVoiceUrl(messageContextMenu.message.imageData) && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              void handleVoiceTranscription(messageContextMenu.message);
              setMessageContextMenu(null);
            }}>
              <AudioOutlined />
              <span>{tl('语音转文字', 'Transcribe voice')}</span>
            </button>
          )}
          {!messageContextMenu.message.recalled && messageContextMenu.message.type === 'image' && isSafeImageDataUrl(messageContextMenu.message.imageData) && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              void addDataUrlAsEmoji(messageContextMenu.message.imageData!, 'custom').then(() => showFeedback('success', tl('已添加到表情库', 'Added to Emoji Library'))).catch(() => showFeedback('error', tl('添加表情失败，请检查格式、大小或表情库容量', 'Failed to add emoji. Check its format, size, or library capacity')));
              setMessageContextMenu(null);
            }}>
              <PlusOutlined />
              <span>{tl('添加到表情库', 'Add to Emoji Library')}</span>
            </button>
          )}
          {!messageContextMenu.message.recalled && messageContextMenu.message.type === 'file' && messageContextMenu.message.attachment && chatFileKind(messageContextMenu.message.attachment) === 'image' && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              void addFileImageToEmoji(messageContextMenu.message).then(() => showFeedback('success', tl('已添加到表情库', 'Added to Emoji Library'))).catch(() => showFeedback('error', tl('添加表情失败，请检查格式、大小或表情库容量', 'Failed to add emoji. Check its format, size, or library capacity')));
              setMessageContextMenu(null);
            }}>
              <PlusOutlined />
              <span>{tl('添加到表情库', 'Add to Emoji Library')}</span>
            </button>
          )}
          {!messageContextMenu.message.recalled && messageContextMenu.message.type === 'file' && messageContextMenu.message.attachment && (
            <button type="button" className="chat-message-context-item" onClick={() => {
              void downloadFileMessage(messageContextMenu.message);
              setMessageContextMenu(null);
            }}>
              <DownloadOutlined />
              <span>{tl('下载文件', 'Download file')}</span>
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
        </MessageContextMenu>
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
        {previewImage && <ImageViewer key={previewImage.src} {...previewImage} onClose={() => setPreviewImage(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {filePreview && <motion.div className="file-preview-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFilePreview(null)}>
          <section className={`file-preview-panel${filePreview.kind === 'video' ? ' visual-preview' : ''}`} onClick={(event) => event.stopPropagation()}>
            <header><div><strong>{filePreview.file.name}</strong><span>{formatFileSize(filePreview.file.size)} · {filePreview.file.mime}</span></div><div className="file-preview-header-actions"><button type="button" onClick={() => void downloadFileMessage(filePreview.message)} aria-label={tl('下载文件', 'Download file')} title={tl('下载文件', 'Download file')}><DownloadOutlined /></button><button type="button" onClick={() => setFilePreview(null)} aria-label={tl('关闭文件预览', 'Close file preview')}><CloseOutlined /></button></div></header>
            <div className="file-preview-body">
              {filePreview.loading ? <div className="file-preview-status">{tl('正在安全获取并解析文件…', 'Securely loading and parsing…')}</div>
                : filePreview.error ? <div className="file-preview-status error">{filePreview.error}</div>
                : filePreview.kind === 'audio' ? <FileAudioBubble src={filePreview.url} file={filePreview.file} own={false} />
                : filePreview.kind === 'video' ? <FileVideoPlayer src={filePreview.url} name={filePreview.file.name} />
                : filePreview.kind === 'pdf' ? <React.Suspense fallback={<div className="file-preview-status">{tl('正在加载 PDF…', 'Loading PDF…')}</div>}><PdfPreview key={filePreview.file.id} url={filePreview.url} /></React.Suspense>
                : filePreview.kind === 'slides' || filePreview.kind === 'archive' ? <LocalFilePreview key={filePreview.file.id} url={filePreview.url} name={filePreview.file.name} kind={filePreview.kind} />
                : filePreview.sections ? <FileDocumentViewer kind={filePreview.kind} sections={filePreview.sections} />
                : <div className="file-preview-status">{tl('此格式暂无内嵌内容视图，可通过消息右键菜单下载后使用系统应用打开。', 'This format has no embedded content view. Download it from the message menu and open it with a system app.')}</div>}
            </div>
          </section>
        </motion.div>}
      </AnimatePresence>

      {/* Emoji选择器 */}
      {showEmojiPicker && (chatTab !== 'private' || privatePeerId) && (
        <div className="emoji-picker-container">
          <EmojiPicker 
            onSelect={handleEmojiSelect}
          />
        </div>
      )}
      
      {/* 底栏输入区域 */}
      {replyTo && (
        <div className="reply-preview reply-preview-above-input">
          <div className="reply-preview-bar" />
          <div className="reply-preview-body">
            <div className="reply-preview-name">{tl('\u56de\u590d ', 'Reply to ')}{replyTo.playerName}</div>
            <div className="reply-preview-text">{replyTo.type === 'image' ? tl('[\u56fe\u7247]', '[Image]') : replyTo.type === 'file' ? replyTo.attachment?.name ?? tl('[文件]', '[File]') : getVisibleMessageContent(replyTo.content)}</div>
          </div>
          <button className="reply-preview-close" onClick={() => setReplyTo(null)} title={tl('取消引用', 'Cancel reply')} aria-label={tl('取消引用', 'Cancel reply')}>
            <CloseOutlined />
          </button>
        </div>
      )}

      {(chatTab !== 'private' || privatePeerId) && <motion.div
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
          {chatTab !== 'private' && mentionOpen && mentionCandidates.length > 0 && (
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
            icon={<PaperClipOutlined style={{ fontSize: 22 }} />}
            onClick={() => { setShowEmojiPicker(false); void handleFileUpload(); }}
            loading={isUploading}
            title={tl('发送文件', 'Send file')}
            className="file-button"
          />

          <TextArea
            {...voice.handlers}
            ref={textAreaRef}
            value={inputValue}
            onFocus={() => setShowEmojiPicker(false)}
            onClick={() => setShowEmojiPicker(false)}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onPaste={handlePaste}
            placeholder={tl('长按发送语音', 'Hold to record voice')}
            autoSize={{ minRows: 1, maxRows: 3 }}
            maxLength={500}
            style={{ flex: 1, touchAction: inputValue ? 'auto' : 'none' }}
          />
          
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendMessage}
            disabled={!inputValue.trim()}
            className="send-button"
          />
        </div>
      </motion.div>}

      {voice.seconds !== null && <div className="voice-recording-overlay" role="status" aria-live="polite">
        <div className="voice-recording-meter"><i /><i /><i /><i /><i /></div>
        <span>{voice.cancelling ? tl('松开取消', 'Release to cancel') : tl('正在录音，上滑取消', 'Recording, slide up to cancel')} {voice.seconds}s</span>
      </div>}
    </div>
  );
};
