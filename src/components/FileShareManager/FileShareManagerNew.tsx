/**
 * 文件共享管理器 - 全新重构版本
 * 专门为HTTP over WireGuard设计
 * 支持多选批量下载、断点续传、先压后发
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Button, Input, Switch, message, Checkbox, Progress } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../stores/appStore';
import type { SharedFolder, SharedFolderSummary, FileInfo } from '../../types/fileShare';
import { FolderIcon, DownloadIcon, ShareIcon, CloseIcon, BackIcon, TrashIcon } from '../icons';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import {
  isSafeIdentifier,
  isSafeRelativePath,
  isSafeResourceId,
  isSafeVirtualIp,
  sanitizeUntrustedText,
} from '../../security/trustBoundary';
import './FileShareManager.css';

// 简化的远程共享类型
interface SimpleRemoteShare {
  share: SharedFolderSummary;
  ownerName: string;
  ownerIp: string;
}

type DownloadRetry = (password: string) => void;

// 下载任务状态
interface DownloadTask {
  id: string;
  fileName: string;
  fileSize: number;
  downloaded: number;
  status: 'downloading' | 'completed' | 'failed';
  url: string;
  savePath: string;
  headers?: HeadersInit;
  error?: string;
  abortController?: AbortController; // 用于取消下载
  speed?: number; // 下载速度（bytes/s）
  lastUpdateTime?: number; // 上次更新时间
  lastDownloaded?: number; // 上次下载的字节数
  isBatchDownload?: boolean; // 是否为批量下载（文件夹）
}

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function safeDownloadFileName(fileName: string): string {
  const basename = fileName.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  let safe = basename
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error(tl('文件名无效', 'Invalid file name'));
  }
  const stem = safe.split('.')[0]?.toUpperCase() ?? '';
  if (WINDOWS_RESERVED_NAMES.has(stem)) safe = `_${safe}`;
  return safe;
}

function normalizeSharedFolderSummary(value: unknown): SharedFolderSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = isSafeResourceId(item.id) ? item.id : '';
  const name = sanitizeUntrustedText(item.name, 255).trim();
  if (!id || !name || typeof item.has_password !== 'boolean') return null;
  const expireTime = typeof item.expire_time === 'number' && Number.isFinite(item.expire_time)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.expire_time)))
    : undefined;
  const createdAt = typeof item.created_at === 'number' && Number.isFinite(item.created_at)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.created_at)))
    : 0;
  return {
    id,
    name,
    has_password: item.has_password,
    ...(expireTime === undefined ? {} : { expire_time: expireTime }),
    compress_before_send: item.compress_before_send === true,
    owner_id: sanitizeUntrustedText(item.owner_id, 128).trim(),
    created_at: createdAt,
  };
}

function normalizeFileInfo(value: unknown): FileInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = sanitizeUntrustedText(item.name, 255).trim();
  const path = isSafeRelativePath(item.path) ? item.path : '';
  const size = typeof item.size === 'number' && Number.isSafeInteger(item.size)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, item.size))
    : -1;
  const modified = typeof item.modified === 'number' && Number.isFinite(item.modified)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.modified)))
    : 0;
  if (!name || !path || size < 0 || typeof item.is_dir !== 'boolean') return null;
  return { name, path, size, is_dir: item.is_dir, modified };
}

function encodeRelativePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function buildDownloadUrl(ownerIp: string, shareId: string, filePath: string): string | null {
  if (!isSafeVirtualIp(ownerIp) || !isSafeResourceId(shareId) || !isSafeRelativePath(filePath) || !filePath) return null;
  return `http://${ownerIp}:14539/api/shares/${encodeURIComponent(shareId)}/download/${encodeRelativePath(filePath)}`;
}

function parseDownloadUrl(url: string): { peerIp: string; shareId: string; filePath: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.port !== '14539' || !isSafeVirtualIp(parsed.hostname)) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 5 || segments[0] !== 'api' || segments[1] !== 'shares' || segments[3] !== 'download') return null;
    const shareId = decodeURIComponent(segments[2]);
    const filePath = segments.slice(4).map((segment) => decodeURIComponent(segment)).join('/');
    if (!isSafeResourceId(shareId) || !isSafeRelativePath(filePath) || !filePath) return null;
    return { peerIp: parsed.hostname, shareId, filePath };
  } catch {
    return null;
  }
}

// 模块级缓存：跨组件卸载/重挂(返回大厅再进文件共享视图)保留下载记录，避免记录丢失
let downloadsCache: DownloadTask[] = [];

export const FileShareManagerNew: React.FC = () => {
  useTranslation();
  // 基础状态
  const [activeTab, setActiveTab] = useState<'local' | 'remote' | 'transfers'>('local');
  const [localShares, setLocalShares] = useState<SharedFolder[]>([]);
  const [remoteShares, setRemoteShares] = useState<SimpleRemoteShare[]>([]);
  const [showAddShare, setShowAddShare] = useState(false);
  
  // 文件浏览状态
  const [selectedShare, setSelectedShare] = useState<SimpleRemoteShare | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  
  // 下载状态（用模块级缓存初始化，并在每次更新时同步到缓存，使记录跨视图保留）
  const [downloads, _setDownloads] = useState<DownloadTask[]>(() => downloadsCache);
  const setDownloads = React.useCallback(
    (updater: DownloadTask[] | ((prev: DownloadTask[]) => DownloadTask[])) => {
      _setDownloads(prev => {
        const next = typeof updater === 'function'
          ? (updater as (p: DownloadTask[]) => DownloadTask[])(prev)
          : updater;
        downloadsCache = next;
        return next;
      });
    },
    [],
  );
  const [transferSubTab, setTransferSubTab] = useState<'downloading' | 'completed'>('downloading');
  
  // 密码验证
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingShare, setPendingShare] = useState<SimpleRemoteShare | null>(null);
  const [sharePasswordMap, setSharePasswordMap] = useState<Record<string, string>>({});
  const pendingBrowsePathRef = useRef<string>('');
  const pendingDownloadRetryRef = useRef<DownloadRetry | null>(null);

  // 从Store获取数据
  const { lobby, players, config } = useAppStore();

  // 加载本地共享
  const loadLocalShares = async () => {
    try {
      const shares = await invoke<SharedFolder[]>('get_local_shares');
      setLocalShares(shares);
    } catch (error) {
      console.error('加载本地共享失败:', error);
    }
  };

  const getShareKey = (ownerIp: string, shareId: string): string => `${ownerIp}__${shareId}`;

  const getSharePasswordHeader = (ownerIp: string, shareId: string, passwordOverride?: string): HeadersInit => {
    const shareKey = getShareKey(ownerIp, shareId);
    const password = passwordOverride ?? sharePasswordMap[shareKey];
    if (!password) return {};

    return {
      'x-share-password': password,
    };
  };

  const isUnauthorizedDownloadError = (error: unknown): boolean => {
    const text = String(error);
    return text.includes('401') || text.includes('访问被拒绝') || text.includes('密码错误');
  };

  const requestDownloadPassword = (remoteShare: SimpleRemoteShare, retry: DownloadRetry) => {
    pendingDownloadRetryRef.current = retry;
    pendingBrowsePathRef.current = currentPath;
    setPendingShare(remoteShare);
    setPasswordInput('');
    setShowPasswordModal(true);
    message.error(tl('下载需要密码，请输入后重试', 'Download requires a password; enter it to retry'));
  };

  // 加载远程共享 - 简化版本
  const loadRemoteShares = async () => {
    
    const allShares: SimpleRemoteShare[] = [];
    const now = Math.floor(Date.now() / 1000);
    
    // 1. 加载自己的共享
    if (lobby?.virtualIp && isSafeVirtualIp(lobby.virtualIp)) {
      try {
        const shares = await invoke<unknown>('get_remote_shares', { peerIp: lobby.virtualIp });
        const safeShares = Array.isArray(shares)
          ? shares.flatMap((item) => {
              const share = normalizeSharedFolderSummary(item);
              return share ? [share] : [];
            })
          : [];
        safeShares.forEach(share => {
          // 过滤掉过期的共享
          if (!share.expire_time || share.expire_time > now) {
            allShares.push({
              share,
              ownerName: `${config.playerName || tl('我', 'Me')} (${tl('我', 'Me')})`,
              ownerIp: lobby.virtualIp!
            });
          }
        });
      } catch (error) {
        console.error('获取自己的共享失败:', error);
      }
    }
    
    // 2. 加载其他玩家的共享
    for (const player of players) {
      if (player.virtualIp && isSafeVirtualIp(player.virtualIp)) {
        try {
          const shares = await invoke<unknown>('get_remote_shares', { peerIp: player.virtualIp });
          const safeShares = Array.isArray(shares)
            ? shares.flatMap((item) => {
                const share = normalizeSharedFolderSummary(item);
                return share ? [share] : [];
              })
            : [];
          safeShares.forEach(share => {
            // 过滤掉过期的共享
            if (!share.expire_time || share.expire_time > now) {
              allShares.push({
                share,
                ownerName: player.name,
                ownerIp: player.virtualIp!
              });
            }
          });
        } catch (error) {
          console.error(`获取 ${player.name} 的共享失败:`, error);
        }
      }
    }
    
    // 检查当前正在浏览的共享是否还存在
    // 只有在正在浏览共享时才检查
    if (selectedShare && activeTab === 'remote') {
      const stillExists = allShares.some(
        s => s.ownerIp === selectedShare.ownerIp && s.share.id === selectedShare.share.id
      );
      if (!stillExists) {
        // 共享已被删除，退出浏览
        setSelectedShare(null);
        setCurrentPath('');
        setFiles([]);
        setSelectedFiles(new Set());
        message.warning(tl('该共享文件夹已被删除', 'This shared folder has been deleted'));
      }
    }
    
    setRemoteShares(allShares);
  };

  // 组件挂载时加载本地共享
  useEffect(() => {
    loadLocalShares();
  }, []);

  // 【事件驱动】监听文件共享事件
  useEffect(() => {
    console.log('📡 [FileShareManager] 设置文件共享事件监听器');
    
    // 文件共享添加事件
    const handleFileShareAdded = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const input = detail as Record<string, unknown>;
      const shareId = isSafeResourceId(input.shareId) ? input.shareId : '';
      const shareName = sanitizeUntrustedText(input.shareName, 255).trim();
      const playerId = isSafeIdentifier(input.playerId) ? input.playerId : '';
      const playerName = sanitizeUntrustedText(input.playerName, 64).trim();
      const hasPassword = input.hasPassword === true;
      if (!shareId || !shareName || !playerId || !playerName || typeof input.hasPassword !== 'boolean') return;
      
      // 查找玩家的虚拟IP
      const player = players.find(p => p.id === playerId);
      if (!player || !player.virtualIp || !isSafeVirtualIp(player.virtualIp)) {
        console.warn('⚠️ [FileShareManager] 找不到玩家或虚拟IP:', playerId);
        return;
      }
      
      // 添加到远程共享列表
      const newShare: SimpleRemoteShare = {
        share: {
          id: shareId,
          name: shareName,
          has_password: Boolean(hasPassword),
          expire_time: undefined,
          compress_before_send: false,
          owner_id: playerId,
          created_at: Date.now() / 1000,
        },
        ownerName: playerName,
        ownerIp: player.virtualIp,
      };
      
      setRemoteShares(prev => {
        // 检查是否已存在
        const exists = prev.some(s => s.share.id === shareId && s.ownerIp === player.virtualIp);
        if (exists) {
          console.log('📁 [FileShareManager] 共享已存在，跳过添加');
          return prev;
        }
        console.log('✅ [FileShareManager] 添加新共享到列表');
        return [...prev, newShare];
      });
    };
    
    // 文件共享删除事件
    const handleFileShareRemoved = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const input = detail as Record<string, unknown>;
      const shareId = isSafeResourceId(input.shareId) ? input.shareId : '';
      const playerId = isSafeIdentifier(input.playerId) ? input.playerId : '';
      if (!shareId || !playerId) return;
      
      // 查找玩家的虚拟IP
      const player = players.find(p => p.id === playerId);
      if (!player || !player.virtualIp || !isSafeVirtualIp(player.virtualIp)) {
        console.warn('⚠️ [FileShareManager] 找不到玩家或虚拟IP:', playerId);
        return;
      }
      
      setRemoteShares(prev => {
        const filtered = prev.filter(s => !(s.share.id === shareId && s.ownerIp === player.virtualIp));
        console.log(`✅ [FileShareManager] 从列表移除共享，剩余 ${filtered.length} 个`);
        return filtered;
      });
      
      // 【修复】如果正在浏览被删除的共享，立即退出浏览
      if (selectedShare && selectedShare.share.id === shareId && selectedShare.ownerIp === player.virtualIp) {
        console.log('⚠️ [FileShareManager] 正在浏览的共享被删除，立即退出浏览');
        setSelectedShare(null);
        setCurrentPath('');
        setFiles([]);
        setSelectedFiles(new Set());
        message.warning(tl('该共享文件夹已被删除', 'This shared folder has been deleted'));
      }
    };
    
    // 添加事件监听
    window.addEventListener('file-share-added', handleFileShareAdded);
    window.addEventListener('file-share-removed', handleFileShareRemoved);
    
    console.log('✅ [FileShareManager] 文件共享事件监听器已设置');
    
    // 清理函数
    return () => {
      console.log('🧹 [FileShareManager] 移除文件共享事件监听器');
      window.removeEventListener('file-share-added', handleFileShareAdded);
      window.removeEventListener('file-share-removed', handleFileShareRemoved);
    };
  }, [players, selectedShare]);

  // 切换到远程共享时加载数据（只加载一次，不轮询）
  useEffect(() => {
    if (activeTab === 'remote') {
      loadRemoteShares();
      
      // 【修复】添加定时检查过期共享（每秒检查一次）
      const expiryCheckInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        setRemoteShares(prev => {
          const filtered = prev.filter(s => !s.share.expire_time || s.share.expire_time > now);
          
          // 如果有共享被过滤掉，说明有过期的
          if (filtered.length < prev.length) {
            console.log(`⏰ [FileShareManager] 检测到 ${prev.length - filtered.length} 个过期共享，已自动移除`);
            
            // 如果正在浏览的共享过期了，退出浏览
            if (selectedShare) {
              const stillExists = filtered.some(
                s => s.ownerIp === selectedShare.ownerIp && s.share.id === selectedShare.share.id
              );
              if (!stillExists) {
                console.log('⚠️ [FileShareManager] 正在浏览的共享已过期，自动退出浏览');
                setSelectedShare(null);
                setCurrentPath('');
                setFiles([]);
                setSelectedFiles(new Set());
                message.warning(tl('该共享文件夹已过期', 'This shared folder has expired'));
              }
            }
          }
          
          return filtered;
        });
      }, 1000); // 每秒检查一次
      
      return () => clearInterval(expiryCheckInterval);
    }
  }, [activeTab, lobby?.virtualIp, players.length, selectedShare]);

  // 切换到传输列表时，默认显示正在下载分页
  useEffect(() => {
    if (activeTab === 'transfers') {
      setTransferSubTab('downloading');
    }
  }, [activeTab]);

  // 删除共享
  const handleDeleteShare = async (shareId: string) => {
    try {
      await invoke('remove_shared_folder', { shareId });
      
      // 【事件驱动】通过信令服务器广播文件共享删除事件
      try {
        const { webrtcClient } = await import('../../services/webrtc');
        const { currentPlayerId } = useAppStore.getState();
        if (webrtcClient && currentPlayerId) {
          console.log('📡 [FileShareManager] 广播文件共享删除事件');
          webrtcClient.sendWebSocketMessage({
            type: 'file-share-removed',
            from: currentPlayerId,
            shareId: shareId,
          });
        }
      } catch (error) {
        console.error('❌ [FileShareManager] 广播文件共享删除事件失败:', error);
        // 不影响主流程
      }
      
      message.success(tl('删除共享成功', 'Share deleted'));
      loadLocalShares();
    } catch (error) {
      message.error(tl('删除共享失败', 'Failed to delete share'));
    }
  };

  // 浏览共享
  const handleBrowseShare = async (remoteShare: SimpleRemoteShare) => {
    pendingBrowsePathRef.current = '';

    if (remoteShare.share.has_password) {
      setPendingShare(remoteShare);
      setShowPasswordModal(true);
      return;
    }
    await openShare(remoteShare);
  };

  // 打开共享
  const openShare = async (remoteShare: SimpleRemoteShare, password?: string) => {
    try {
      const targetPath = pendingBrowsePathRef.current || '';
      let verifiedPassword: string | undefined;

      if (remoteShare.share.has_password) {
        const passwordToVerify = password ?? sharePasswordMap[getShareKey(remoteShare.ownerIp, remoteShare.share.id)] ?? '';
        const valid = await invoke<boolean>('verify_share_password', {
          peerIp: remoteShare.ownerIp,
          shareId: remoteShare.share.id,
          password: passwordToVerify,
        });
        if (!valid) {
          message.error(tl('密码错误', 'Wrong password'));
          return;
        }

        verifiedPassword = passwordToVerify;
        setSharePasswordMap(prev => ({
          ...prev,
          [getShareKey(remoteShare.ownerIp, remoteShare.share.id)]: passwordToVerify,
        }));
      }

      setSelectedShare(remoteShare);
      setSelectedFiles(new Set());
      const loaded = await loadFiles(remoteShare, targetPath, verifiedPassword);
      if (!loaded) return;
      const retryDownload = pendingDownloadRetryRef.current;
      pendingDownloadRetryRef.current = null;
      setShowPasswordModal(false);
      setPasswordInput('');
      setPendingShare(null);
      pendingBrowsePathRef.current = '';
      retryDownload?.(verifiedPassword ?? password ?? '');
    } catch (error) {
      const errorText = String(error);
      if (errorText.includes('410') || errorText.includes('共享已过期')) {
        forgetRemoteShare(remoteShare, true);
        return;
      }
      message.error(tl('打开共享失败', 'Failed to open share'));
    }
  };

  // 加载文件列表
  const forgetRemoteShare = (remoteShare: SimpleRemoteShare, expired: boolean) => {
    setRemoteShares(prev => prev.filter(s =>
      !(s.ownerIp === remoteShare.ownerIp && s.share.id === remoteShare.share.id)
    ));
    setSelectedShare(prev => {
      if (!prev || prev.ownerIp !== remoteShare.ownerIp || prev.share.id !== remoteShare.share.id) {
        return prev;
      }
      return null;
    });
    setCurrentPath('');
    setFiles([]);
    setSelectedFiles(new Set());
    pendingDownloadRetryRef.current = null;
    message.warning(expired
      ? tl('该共享文件夹已过期', 'This shared folder has expired')
      : tl('该共享文件夹已被删除', 'This shared folder has been deleted'));
  };

  const loadFiles = async (remoteShare: SimpleRemoteShare, path: string, passwordOverride?: string): Promise<boolean> => {
    if (
      !isSafeVirtualIp(remoteShare.ownerIp) ||
      !isSafeResourceId(remoteShare.share.id) ||
      !isSafeRelativePath(path)
    ) {
      message.error(tl('共享路径无效', 'Invalid shared path'));
      return false;
    }
    setLoadingFiles(true);
    try {
      const password = passwordOverride
        ?? sharePasswordMap[getShareKey(remoteShare.ownerIp, remoteShare.share.id)]
        ?? null;
      try {
        const payload = await invoke<unknown>('get_remote_files', {
          peerIp: remoteShare.ownerIp,
          shareId: remoteShare.share.id,
          path: path || null,
          password,
        });
        const fileList = Array.isArray(payload)
          ? payload.flatMap((item: unknown) => {
              const file = normalizeFileInfo(item);
              return file ? [file] : [];
            })
          : [];
        setFiles(fileList);
        setCurrentPath(path);
        setSelectedFiles(new Set());
        return true;
      } catch (error) {
        const detail = String(error);
        if (detail.includes('401') || detail.includes('密码错误') || detail.includes('访问被拒绝')) {
          const retryPath = path;
          message.error(tl('访问被拒绝，请重新输入密码', 'Access denied, please re-enter the password'));
          setSharePasswordMap(prev => {
            const next = { ...prev };
            delete next[getShareKey(remoteShare.ownerIp, remoteShare.share.id)];
            return next;
          });

          pendingBrowsePathRef.current = retryPath;
          setPendingShare(remoteShare);
          setShowPasswordModal(true);
          setPasswordInput('');
          return false;
        }
        if (detail.includes('410') || detail.includes('共享已过期')) {
          forgetRemoteShare(remoteShare, true);
          return false;
        }
        if (detail.includes('404') || detail.includes('共享不存在')) {
          forgetRemoteShare(remoteShare, false);
          return false;
        }
        throw error;
      }
    } catch (error) {
      const errorMessage = String(error);
      if (!errorMessage.includes('HTTP 401')) {
        message.error(tl('加载文件列表失败', 'Failed to load file list'));
      }
      return false;
    } finally {
      setLoadingFiles(false);
    }
  };

  // 监听后端下载进度事件，更新对应任务的进度与速度
  useEffect(() => {
    const unlistenPromise = listen<{ taskId: string; downloaded: number; total: number }>(
      'download-progress',
      (event) => {
        const { taskId, downloaded, total } = event.payload;
        setDownloads(prev => prev.map(task => {
          if (task.id !== taskId) return task;
          const now = Date.now();
          const lastTime = task.lastUpdateTime || now;
          const lastBytes = task.lastDownloaded || 0;
          const dt = (now - lastTime) / 1000;
          const speed = dt > 0 ? Math.max(0, (downloaded - lastBytes) / dt) : (task.speed || 0);
          return {
            ...task,
            downloaded,
            fileSize: total && total > 0 ? total : task.fileSize,
            speed,
            lastUpdateTime: now,
            lastDownloaded: downloaded,
          };
        }));
      }
    );
    return () => {
      unlistenPromise.then(unlisten => unlisten()).catch(() => {});
    };
  }, []);

  // 下载单个文件
  const handleDownloadFile = async (file: FileInfo) => {
    if (!selectedShare) return;
    
    try {
      if (
        file.is_dir ||
        !isSafeRelativePath(file.path) ||
        !isSafeVirtualIp(selectedShare.ownerIp) ||
        !isSafeResourceId(selectedShare.share.id)
      ) {
        throw new Error(tl('文件路径无效', 'Invalid file path'));
      }
      const safeName = safeDownloadFileName(file.name);
      const savePath = await invoke<string>('get_file_share_download_path', { fileName: safeName });
      
      const downloadUrl = buildDownloadUrl(selectedShare.ownerIp, selectedShare.share.id, file.path);
      if (!downloadUrl) throw new Error(tl('下载地址无效', 'Invalid download URL'));
      const downloadHeaders = getSharePasswordHeader(selectedShare.ownerIp, selectedShare.share.id);
      
      // 创建下载任务
      const taskId = `download_${Date.now()}_${Math.random()}`;
      const newTask: DownloadTask = {
        id: taskId,
        fileName: safeName,
        fileSize: file.size,
        downloaded: 0,
        status: 'downloading',
        url: downloadUrl,
        headers: downloadHeaders,
        savePath
      };
      
      setDownloads(prev => [...prev, newTask]);
      // 不自动跳转到传输列表，让用户继续浏览
      
      // 开始下载
      startDownload(taskId, downloadUrl, savePath, file.size, downloadHeaders);
      
      message.success(tl('开始下载文件', 'Download started'));
    } catch (error) {
      message.error(`${tl('下载失败', 'Download failed')}: ${error}`);
    }
  };

  // 实际执行下载（流式：由后端边下边写盘，避免大文件占满内存导致卡死/崩溃）
  const startDownload = async (taskId: string, url: string, savePath: string, fileSize: number, headers?: HeadersInit) => {
    try {
      const parsedDownload = parseDownloadUrl(url);
      if (!parsedDownload) throw new Error('下载地址无效');
      const { peerIp, shareId, filePath } = parsedDownload;

      // 从 headers 取共享密码
      let password: string | null = null;
      if (headers && typeof headers === 'object') {
        const h = headers as Record<string, string>;
        password = h['x-share-password'] ?? null;
      }

      // 记录开始时间用于兜底显示
      setDownloads(prev => prev.map(task =>
        task.id === taskId ? { ...task, lastUpdateTime: Date.now(), lastDownloaded: 0 } : task
      ));

      // 调用后端流式下载命令（边下边写盘 + 进度事件 + 可取消）
      await invoke('download_remote_file', {
        taskId,
        peerIp,
        shareId,
        filePath,
        savePath,
        password,
        expectedSize: fileSize,
      });

      // 完成
      setDownloads(prev => prev.map(task =>
        task.id === taskId ? { ...task, status: 'completed' as const, downloaded: fileSize || task.downloaded, speed: 0 } : task
      ));
      message.success(tl('下载完成', 'Download complete'));
    } catch (error: any) {
      const errStr = String(error);
      // 用户主动取消不视为失败
      if (errStr.includes('已取消')) {
        console.log('❌ [FileShareManager] 下载被取消:', taskId);
        return;
      }
      if (errStr.includes('410') || errStr.includes('共享已过期')) {
        if (selectedShare) forgetRemoteShare(selectedShare, true);
      }
      if (isUnauthorizedDownloadError(error) && selectedShare) {
        setDownloads(prev => prev.map(task =>
          task.id === taskId ? { ...task, status: 'failed' as const, error: tl('等待重新输入密码', 'Waiting for password'), speed: 0 } : task
        ));
        requestDownloadPassword(selectedShare, (password) => {
          const retryHeaders: HeadersInit = { 'x-share-password': password };
          setDownloads(prev => prev.map(task =>
            task.id === taskId ? { ...task, status: 'downloading' as const, error: undefined, downloaded: 0 } : task
          ));
          void startDownload(taskId, url, savePath, fileSize, retryHeaders);
        });
        return;
      }
      setDownloads(prev => prev.map(task =>
        task.id === taskId ? { ...task, status: 'failed' as const, error: errStr, speed: 0 } : task
      ));
      message.error(`${tl('下载失败', 'Download failed')}: ${errStr}`);
    }
  }



  // 批量下载选中的文件
  const handleBatchDownload = async () => {
    if (!selectedShare || selectedFiles.size === 0) {
      message.warning(tl('请先选择要下载的文件', 'Select files to download first'));
      return;
    }

    const selectedFileList = files.filter(f => !f.is_dir && selectedFiles.has(f.path) && isSafeRelativePath(f.path));
    
    if (selectedFileList.length === 0) {
      message.warning(tl('没有选中任何文件', 'No files selected'));
      return;
    }

    const saveDir = await invoke<string>('get_file_share_download_dir');

    // 检查是否启用了"先压后发"
    if (selectedShare.share.compress_before_send && selectedFileList.length > 1) {
      try {
        // 创建一个下载任务用于显示进度
        const taskId = `batch_download_${Date.now()}`;
        const zipFileName = `batch_download_${Date.now()}.zip`;
        const tempZipPath = await invoke<string>('get_file_share_download_path', { fileName: zipFileName });
        const newTask: DownloadTask = {
          id: taskId,
          fileName: tl(`批量下载 (${selectedFileList.length} 个文件)`, `Batch download (${selectedFileList.length} files)`),
          fileSize: 0, // 未知大小
          downloaded: 0,
          status: 'downloading',
          url: '',
          savePath: tempZipPath,
          isBatchDownload: true // 标记为批量下载
        };
        
        setDownloads(prev => [...prev, newTask]);
        message.info(`${tl('正在打包', 'Packing')} ${selectedFileList.length} ${tl('个文件，请稍候...', 'file(s), please wait...')}`);
        
        // 异步下载，不阻塞UI
        (async () => {
          let zipCommitted = false;
          try {
            // 【流式】调用后端批量打包下载命令，边收边写盘到临时ZIP，避免大包占满内存
            const filePaths = selectedFileList.map(f => f.path).filter((path) => isSafeRelativePath(path));
            const batchPassword = sharePasswordMap[getShareKey(selectedShare.ownerIp, selectedShare.share.id)] ?? null;
            console.log('📦 [FileShareManager] 请求批量打包(流式):', selectedShare.ownerIp, selectedShare.share.id);
            console.log('📦 [FileShareManager] 文件列表:', filePaths);

            if (filePaths.length !== selectedFileList.length || !isSafeVirtualIp(selectedShare.ownerIp) || !isSafeResourceId(selectedShare.share.id)) {
              throw new Error('文件路径无效');
            }
            await invoke('download_remote_batch', {
              taskId,
              peerIp: selectedShare.ownerIp,
              shareId: selectedShare.share.id,
              filePaths,
              savePath: tempZipPath,
              password: batchPassword,
            });
            zipCommitted = true;

            console.log('✅ [FileShareManager] 压缩包已保存:', tempZipPath);
            
            // 【新增】自动解压ZIP文件
            message.loading({ content: tl('正在解压文件...', 'Extracting files...'), key: 'extracting', duration: 0 });
            console.log('📦 [FileShareManager] 开始解压ZIP文件到:', saveDir);
            
            const extractedFiles = await invoke<string[]>('extract_zip', {
              zipPath: tempZipPath,
              extractDir: saveDir,
              maxTotalBytes: selectedFileList.reduce((total, item) => total + Math.max(0, item.size), 0),
            });
            
            message.destroy('extracting');
            console.log('✅ [FileShareManager] 文件解压完成，共', extractedFiles.length, '个文件');
            
            // 【新增】删除临时ZIP文件
            console.log('🗑️ [FileShareManager] 删除临时ZIP文件:', tempZipPath);
            await invoke('delete_file', { path: tempZipPath });
            console.log('✅ [FileShareManager] 临时ZIP文件已删除');
            
            // 更新任务状态为完成，并更新savePath为实际的解压目录
            setDownloads(prev => prev.map(task =>
              task.id === taskId ? { 
                ...task, 
                status: 'completed' as const, 
                speed: 0,
                fileName: tl(`${selectedFileList.length} 个文件`, `${selectedFileList.length} files`), // 更新显示名称
                savePath: saveDir // 【修复】更新为实际的解压目录，而不是临时ZIP路径
              } : task
            ));
            
            message.success(`${tl('下载完成', 'Download complete')} (${selectedFileList.length} ${tl('个文件', 'file(s)')})`);
            
            // 清空选中状态
            setSelectedFiles(new Set());
          } catch (error) {
            console.error('❌ [FileShareManager] 批量下载失败:', error);

            if (zipCommitted) {
              await invoke('delete_file', { path: tempZipPath }).catch(() => {});
            }
            if (String(error).includes('410') || String(error).includes('共享已过期')) {
              forgetRemoteShare(selectedShare, true);
            }
            
            // 更新任务状态为失败
            setDownloads(prev => prev.map(task =>
              task.id === taskId ? { ...task, status: 'failed' as const, error: String(error), speed: 0 } : task
            ));
            message.error(`${tl('下载失败', 'Download failed')}: ${error}`);
          }
        })();
      } catch (error) {
        console.error('❌ [FileShareManager] 批量下载失败:', error);
        message.error(`${tl('批量下载失败', 'Batch download failed')}: ${error}`);
      }
    } else if (!selectedShare.share.compress_before_send && selectedFileList.length > 1) {
      // 【修复】如果没有启用"先压后发"，提示用户
      message.warning(tl('该共享未启用"先压后发"功能，将逐个下载文件', 'This share does not have "compress before sending" enabled; files will be downloaded individually'));
      
      // 逐个下载
      for (const file of selectedFileList) {
        const safeName = safeDownloadFileName(file.name);
        const savePath = await invoke<string>('get_file_share_download_path', { fileName: safeName });
        const downloadUrl = buildDownloadUrl(selectedShare.ownerIp, selectedShare.share.id, file.path);
        if (!downloadUrl) {
          message.error(tl('下载路径无效', 'Invalid download path'));
          continue;
        }
        const downloadHeaders = getSharePasswordHeader(selectedShare.ownerIp, selectedShare.share.id);
        
        const taskId = `download_${Date.now()}_${Math.random()}`;
        const newTask: DownloadTask = {
          id: taskId,
          fileName: safeName,
          fileSize: file.size,
          downloaded: 0,
          status: 'downloading',
          url: downloadUrl,
          headers: downloadHeaders,
          savePath
        };
        
        setDownloads(prev => [...prev, newTask]);
        startDownload(taskId, downloadUrl, savePath, file.size, downloadHeaders);
      }
      
      message.success(`${tl('开始下载', 'Started downloading')} ${selectedFileList.length} ${tl('个文件', 'file(s)')}`);
      
      // 清空选中状态
      setSelectedFiles(new Set());
    } else {
      // 只选中了一个文件，直接下载
      const file = selectedFileList[0];
      const safeName = safeDownloadFileName(file.name);
      const savePath = await invoke<string>('get_file_share_download_path', { fileName: safeName });
      const downloadUrl = buildDownloadUrl(selectedShare.ownerIp, selectedShare.share.id, file.path);
      if (!downloadUrl) {
        message.error(tl('下载路径无效', 'Invalid download path'));
        return;
      }
      const downloadHeaders = getSharePasswordHeader(selectedShare.ownerIp, selectedShare.share.id);
      
      const taskId = `download_${Date.now()}_${Math.random()}`;
      const newTask: DownloadTask = {
        id: taskId,
        fileName: safeName,
        fileSize: file.size,
        downloaded: 0,
        status: 'downloading',
        url: downloadUrl,
        headers: downloadHeaders,
        savePath
      };
      
      setDownloads(prev => [...prev, newTask]);
      startDownload(taskId, downloadUrl, savePath, file.size, downloadHeaders);
      
      message.success(tl('开始下载', 'Download started'));
      
      // 清空选中状态
      setSelectedFiles(new Set());
    }
  };

  // 进入文件夹（修复路径拼接问题）
  const handleEnterFolder = async (folder: FileInfo) => {
    if (!selectedShare || !folder.is_dir) return;
    // 修复：folder.name 是文件夹名称，需要拼接到当前路径
    const newPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
    await loadFiles(selectedShare, newPath);
  };

  // 返回上级
  const handleGoBack = async () => {
    if (!selectedShare || !currentPath) return;
    const parts = currentPath.split('/').filter(p => p);
    parts.pop();
    const newPath = parts.join('/');
    await loadFiles(selectedShare, newPath);
  };

  // 返回根目录
  const handleGoToRoot = async () => {
    if (!selectedShare) return;
    await loadFiles(selectedShare, '');
  };

  const handleExitShareBrowser = () => {
    if (!selectedShare) return;

    const shareKey = getShareKey(selectedShare.ownerIp, selectedShare.share.id);
    setSharePasswordMap(prev => {
      const next = { ...prev };
      delete next[shareKey];
      return next;
    });

    setSelectedShare(null);
    setCurrentPath('');
    setFiles([]);
    setSelectedFiles(new Set());
    pendingBrowsePathRef.current = '';
  };
  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  // 全选当前文件夹中的所有文件（不包括文件夹）
  const handleSelectAll = () => {
    const fileOnly = files.filter(f => !f.is_dir);
    if (selectedFiles.size === fileOnly.length) {
      // 已全选，取消全选
      setSelectedFiles(new Set());
    } else {
      // 全选
      setSelectedFiles(new Set(fileOnly.map(f => f.path)));
    }
  };



  // 取消下载
  const handleCancelDownload = async (taskId: string) => {
    const task = downloads.find(t => t.id === taskId);
    // 流式下载：通知后端取消（后端会停止写盘并删除残留文件）
    try {
      await invoke('cancel_remote_download', { taskId });
    } catch (error) {
      console.warn('通知后端取消下载失败（忽略）:', error);
    }
    // 兼容旧的 fetch 式下载（批量打包仍走 fetch）
    if (task?.abortController) {
      console.log('❌ [FileShareManager] 取消下载任务:', taskId);
      task.abortController.abort();
    }

    // 标记任务为失败/取消状态
    setDownloads(prev => prev.map(t =>
      t.id === taskId && t.status === 'downloading'
        ? { ...t, status: 'failed' as const, error: tl('已取消', 'Cancelled'), speed: 0 }
        : t
    ));
    
    // The backend owns the random .part file and removes it on cancellation.
    // Never delete savePath here: it may be an existing user file that the
    // no-replace backend deliberately preserved.
    setDownloads(prev => prev.filter(t => t.id !== taskId));
    message.success(tl('已取消下载', 'Download canceled'));
  };

  // 打开文件所在文件夹
  const handleOpenFileLocation = async (task: DownloadTask) => {
    try {
      if (task.isBatchDownload) {
        // 批量下载：直接打开文件夹
        await invoke('open_folder', { path: task.savePath });
      } else {
        // 单文件下载：打开文件所在位置并选中文件
        await invoke('open_file_location', { path: task.savePath });
      }
    } catch (error) {
      message.error(`${tl('打开文件夹失败', 'Failed to open folder')}: ${error}`);
    }
  };

  // 格式化大小
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  // 格式化时间
  const formatTime = (timestamp: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = timestamp - now;
    if (remaining <= 0) return tl('已过期', 'Expired');
    const days = Math.floor(remaining / (24 * 60 * 60));
    const hours = Math.floor((remaining % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((remaining % (60 * 60)) / 60);
    if (days > 0) return `${days}${tl('天', 'd')}${hours}${tl('时', 'h')}`;
    else if (hours > 0) return `${hours}${tl('时', 'h')}${minutes}${tl('分', 'm')}`;
    else return `${minutes}${tl('分钟', 'min')}`;
  };

  // 格式化速度
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return `${(bytesPerSecond / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div className="file-share-container">
      <div className="file-share-content">
        <div className="sidebar-tabs">
          <motion.div 
            className={`sidebar-tab ${activeTab === 'local' ? 'active' : ''}`} 
            onClick={() => setActiveTab('local')} 
            title={tl('我的共享', 'My Shares')}
          >
            <FolderIcon size={20} />
          </motion.div>
          <motion.div 
            className={`sidebar-tab ${activeTab === 'remote' ? 'active' : ''}`} 
            onClick={() => setActiveTab('remote')} 
            title={tl('远程共享', 'Remote Shares')}
          >
            <ShareIcon size={20} />
          </motion.div>
          <motion.div 
            className={`sidebar-tab ${activeTab === 'transfers' ? 'active' : ''}`} 
            onClick={() => setActiveTab('transfers')} 
            title={tl('传输列表', 'Transfers')}
          >
            <DownloadIcon size={20} />
            {downloads.filter(t => t.status === 'downloading').length > 0 && (
              <span className="transfer-badge">
                {downloads.filter(t => t.status === 'downloading').length}
              </span>
            )}
          </motion.div>
        </div>
        <div className="content-area">
          <AnimatePresence mode="wait">
            {activeTab === 'local' && (
              <motion.div key="local" className="tab-content" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}>
                <div className="share-list">
                  <Button className="file-share-primary-btn" type="primary" icon={<FolderIcon size={16} />} onClick={() => setShowAddShare(true)} style={{ marginBottom: 16 }}>{tl('添加共享文件夹', 'Add shared folder')}</Button>
                  <AnimatePresence>
                    {localShares.map((share) => (
                      <motion.div key={share.id} className="share-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                        <FolderIcon size={24} className="share-icon" />
                        <div className="share-info">
                          <div className="share-name">{share.name}</div>
                          <div className="share-meta">{share.password && '🔒 '}{share.compress_before_send && '📦 '}{share.expire_time && `⏰ ${formatTime(share.expire_time)}`}</div>
                        </div>
                        <button className="delete-share-btn" onClick={() => handleDeleteShare(share.id)} title={tl('删除共享', 'Delete share')}><TrashIcon size={16} /></button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {localShares.length === 0 && <div className="empty-state"><ShareIcon size={48} /><p>{tl('还没有共享文件夹', 'No shared folders yet')}</p></div>}
                </div>
              </motion.div>
            )}
            {activeTab === 'remote' && (
              <motion.div key="remote" className="tab-content" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}>
                {!selectedShare ? (
                  <div className="share-list">
                    <AnimatePresence>
                      {remoteShares.map((remoteShare, index) => (
                        <motion.div key={`${remoteShare.ownerIp}_${remoteShare.share.id}_${index}`} className="share-item remote-share-item clickable" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} onClick={() => handleBrowseShare(remoteShare)}>
                          <FolderIcon size={24} className="share-icon" />
                          <div className="share-info">
                            <div className="share-name">{remoteShare.share.name}</div>
                            <div className="share-meta">{remoteShare.ownerName}</div>
                          </div>
                          {/* 右上角状态图标 */}
                          <div className="share-status-icons">
                            {remoteShare.share.has_password && (
                              <div className="status-icon lock-icon" title={tl('需要密码', 'Password required')}>🔒</div>
                            )}
                            {remoteShare.share.compress_before_send && (
                              <div className="status-icon compress-icon" title={tl('先压后发', 'Compress before send')}>📦</div>
                            )}
                            {remoteShare.share.expire_time && (
                              <div className="status-icon expiry-icon" title={tl(`有效期至 ${new Date(remoteShare.share.expire_time * 1000).toLocaleString()}`, `Expires at ${new Date(remoteShare.share.expire_time * 1000).toLocaleString()}`)}>⏰</div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {remoteShares.length === 0 && <div className="empty-state"><ShareIcon size={48} /><p>{tl('暂无可用的共享文件夹', 'No shared folders available')}</p></div>}
                  </div>
                ) : (
                  <div className="file-browser">
                    <div className="browser-header">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                        <Button className="file-share-neutral-btn" size="small" onClick={handleGoBack} disabled={!currentPath} icon={<BackIcon size={16} />} title={tl('返回上级', 'Up')} />
                        <Button className="file-share-neutral-btn" size="small" onClick={handleGoToRoot} disabled={!currentPath} title={tl('返回根目录', 'Root')}>{tl('根目录', 'Root')}</Button>
                        <Button className="file-share-neutral-btn" size="small" onClick={handleSelectAll} title={selectedFiles.size === files.filter(f => !f.is_dir).length ? tl('取消全选', 'Deselect all') : tl('全选文件', 'Select all files')}>
                          {selectedFiles.size === files.filter(f => !f.is_dir).length && files.filter(f => !f.is_dir).length > 0 ? tl('取消全选', 'Deselect all') : tl('全选', 'Select all')}
                        </Button>
                      </div>
                      <Button className="file-share-neutral-btn" size="small" onClick={handleExitShareBrowser} icon={<CloseIcon size={16} />} title={tl('关闭', 'Close')} style={{ marginLeft: 'auto' }} />
                    </div>
                    <div className="file-list">
                      {loadingFiles ? <div className="loading-state">{tl('加载中...', 'Loading...')}</div> : (
                        <AnimatePresence>
                          {files.map((file) => (
                            <motion.div 
                              key={file.path} 
                              className={`file-item ${file.is_dir ? 'clickable' : ''}`} 
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }} 
                              exit={{ opacity: 0 }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                            >
                              {!file.is_dir && (
                                <Checkbox 
                                  checked={selectedFiles.has(file.path)}
                                  onChange={() => toggleFileSelection(file.path)}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ flexShrink: 0 }}
                                />
                              )}
                              {file.is_dir && <div style={{ width: 16, flexShrink: 0 }} />}
                              <div 
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  flex: 1, 
                                  cursor: file.is_dir ? 'pointer' : 'default',
                                  minWidth: 0,
                                  gap: 8
                                }}
                                onClick={() => file.is_dir && handleEnterFolder(file)}
                              >
                                {file.is_dir && <FolderIcon size={20} />}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="file-name" style={{ 
                                    overflow: 'hidden', 
                                    textOverflow: 'ellipsis', 
                                    whiteSpace: 'nowrap' 
                                  }} title={file.name}>{file.name}</div>
                                  <div className="file-meta">{!file.is_dir && formatSize(file.size)}</div>
                                </div>
                              </div>
                              {!file.is_dir && (
                                <Button 
                                  className="file-share-neutral-btn"
                                  size="small" 
                                  icon={<DownloadIcon size={14} />} 
                                  onClick={(e) => { e.stopPropagation(); handleDownloadFile(file); }} 
                                  title={tl('下载', 'Download')}
                                  style={{ flexShrink: 0 }}
                                />
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      )}
                      {!loadingFiles && files.length === 0 && <div className="empty-state"><FolderIcon size={48} /><p>{tl('文件夹为空', 'Folder is empty')}</p></div>}
                    </div>
                    {/* 悬浮批量下载按钮 */}
                    {selectedFiles.size > 0 && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        style={{
                          position: 'fixed',
                          bottom: 24,
                          right: 24,
                          zIndex: 1000
                        }}
                      >
                        <Button
                          className="file-share-primary-btn file-share-batch-download"
                          type="primary"
                          shape="circle"
                          size="large"
                          icon={<DownloadIcon size={18} />}
                          onClick={handleBatchDownload}
                          title={tl(`下载选中 (${selectedFiles.size})`, `Download selected (${selectedFiles.size})`)}
                          style={{
                            width: 48,
                            height: 48,
                            backgroundColor: '#52c41a',
                            borderColor: '#52c41a',
                            boxShadow: '0 4px 12px rgba(82, 196, 26, 0.4)'
                          }}
                        />
                        <div style={{
                          position: 'absolute',
                          top: -8,
                          right: -8,
                          backgroundColor: '#ff4d4f',
                          color: 'white',
                          borderRadius: '50%',
                          width: 20,
                          height: 20,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 'bold'
                        }}>
                          {selectedFiles.size}
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
            {activeTab === 'transfers' && (
              <motion.div key="transfers" className="tab-content" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}>
                {/* 子标签 */}
                <div className="transfers-subtabs">
                  <div 
                    className={`subtab ${transferSubTab === 'downloading' ? 'active' : ''}`}
                    onClick={() => setTransferSubTab('downloading')}
                  >
                    {tl('正在下载', 'Downloading')}
                    {downloads.filter(d => d.status === 'downloading').length > 0 && (
                      <span className="subtab-badge">
                        {downloads.filter(d => d.status === 'downloading').length}
                      </span>
                    )}
                  </div>
                  <div 
                    className={`subtab ${transferSubTab === 'completed' ? 'active' : ''}`}
                    onClick={() => setTransferSubTab('completed')}
                  >
                    {tl('已完成', 'Completed')}
                    {downloads.filter(d => d.status === 'completed').length > 0 && (
                      <span className="subtab-badge">
                        {downloads.filter(d => d.status === 'completed').length}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="transfer-list">
                  {(() => {
                    const filteredDownloads = transferSubTab === 'downloading'
                      ? downloads.filter(d => d.status === 'downloading' || d.status === 'failed')
                      : downloads.filter(d => d.status === 'completed');
                    
                    if (filteredDownloads.length === 0) {
                      return (
                        <div className="empty-state">
                          <DownloadIcon size={48} />
                          <p>{transferSubTab === 'downloading' ? tl('暂无正在下载的任务', 'No active downloads') : tl('暂无已完成的任务', 'No completed downloads')}</p>
                        </div>
                      );
                    }
                    
                    return (
                      <AnimatePresence>
                        {filteredDownloads.map((task) => (
                          <motion.div 
                            key={task.id} 
                            className={`transfer-item ${task.status === 'completed' ? 'clickable' : ''}`}
                            initial={{ opacity: 0, y: 20 }} 
                            animate={{ opacity: 1, y: 0 }} 
                            exit={{ opacity: 0, y: -20 }}
                            onClick={() => task.status === 'completed' && handleOpenFileLocation(task)}
                            style={{ position: 'relative' }}
                          >
                            {/* 取消按钮 - 右上角 */}
                            {task.status !== 'completed' && (
                              <button
                                className="transfer-cancel-btn"
                                onClick={(e) => { e.stopPropagation(); handleCancelDownload(task.id); }}
                                title={tl('取消下载', 'Cancel download')}
                              >
                                <CloseIcon size={12} />
                              </button>
                            )}
                            
                            <div className="transfer-info">
                              <div className="transfer-name" title={task.fileName}>{task.fileName}</div>
                              <div className="transfer-progress">
                                <Progress 
                                  percent={Math.round((task.downloaded / task.fileSize) * 100)} 
                                  size="small" 
                                  status={task.status === 'failed' ? 'exception' : task.status === 'completed' ? 'success' : 'active'}
                                  strokeColor={task.status === 'completed' ? '#52c41a' : undefined}
                                />
                              </div>
                              <div className="transfer-meta">
                                {formatSize(task.downloaded)} / {formatSize(task.fileSize)}
                                {task.status === 'downloading' && task.speed && ` - ${formatSpeed(task.speed)}`}
                                {task.status === 'downloading' && !task.speed && tl(' - 下载中', ' - Downloading')}
                                {task.status === 'completed' && tl(' - 已完成', ' - Completed')}
                                {task.status === 'failed' && `${tl(' - 失败', ' - Failed')}: ${task.error}`}
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    );
                  })()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {showAddShare && <AddShareDialog visible={showAddShare} onClose={() => setShowAddShare(false)} onSuccess={() => { setShowAddShare(false); loadLocalShares(); }} />}
      <Modal className="file-share-modal" rootClassName="file-share-modal-root" title={tl('输入密码', 'Enter Password')} open={showPasswordModal} onOk={() => pendingShare && openShare(pendingShare, passwordInput)} onCancel={() => { setShowPasswordModal(false); setPasswordInput(''); setPendingShare(null); pendingBrowsePathRef.current = ''; }} okText={tl('确定', 'OK')} cancelText={tl('取消', 'Cancel')} centered width={400}>
        <div style={{ marginTop: 16 }}><Input.Password autoFocus value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} onPressEnter={() => pendingShare && openShare(pendingShare, passwordInput)} placeholder={tl('请输入共享密码', 'Enter the share password')} /></div>
      </Modal>
    </div>
  );
};

// 添加共享对话框
interface AddShareDialogProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddShareDialog: React.FC<AddShareDialogProps> = ({ visible, onClose, onSuccess }) => {
  useTranslation();
  const [folderPath, setFolderPath] = useState('');
  const [folderName, setFolderName] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  
  // 从Store获取玩家信息
  const { currentPlayerId, config } = useAppStore();
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDays, setExpiryDays] = useState(0);
  const [expiryHours, setExpiryHours] = useState(0);
  const [expiryMinutes, setExpiryMinutes] = useState(0);
  const [compressBeforeSend, setCompressBeforeSend] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSelectFolder = async () => {
    try {
      const path = await invoke<string | null>('select_folder');
      if (path) {
        setFolderPath(path);
        const name = await invoke<string>('get_folder_name', { path });
        setFolderName(name || tl('未命名文件夹', 'Unnamed folder'));
      }
    } catch (error) {
      message.error(`${tl('选择文件夹失败', 'Failed to select folder')}: ${error}`);
    }
  };

  const handleSubmit = async () => {
    if (!folderPath) {
      message.error(tl('请选择要共享的文件夹', 'Please select a folder to share'));
      return;
    }
    if (hasPassword && !password.trim()) {
      message.error(tl('请输入密码', 'Please enter a password'));
      return;
    }
    if (hasExpiry && expiryDays === 0 && expiryHours === 0 && expiryMinutes === 0) {
      message.error(tl('请设置有效期时长', 'Please set an expiry duration'));
      return;
    }
    try {
      setLoading(true);
      let expiryTimestamp: number | undefined;
      if (hasExpiry) {
        const totalSeconds = expiryDays * 24 * 60 * 60 + expiryHours * 60 * 60 + expiryMinutes * 60;
        expiryTimestamp = Math.floor(Date.now() / 1000) + totalSeconds;
      }
      const share: SharedFolder = {
        id: `share_${Date.now()}`,
        name: folderName,
        path: folderPath,
        password: hasPassword ? password : undefined,
        expire_time: expiryTimestamp,
        compress_before_send: compressBeforeSend,
        owner_id: 'local',
        created_at: Math.floor(Date.now() / 1000),
      };
      await invoke('add_shared_folder', { share });
      
      // 【事件驱动】通过信令服务器广播文件共享添加事件
      try {
        const { webrtcClient } = await import('../../services/webrtc');
        if (webrtcClient && currentPlayerId) {
          console.log('📡 [FileShareManager] 广播文件共享添加事件');
          webrtcClient.sendWebSocketMessage({
            type: 'file-share-added',
            from: currentPlayerId,
            shareId: share.id,
            shareName: share.name,
            playerName: config.playerName || tl('未知玩家', 'Unknown Player'),
            hasPassword: Boolean(share.password?.trim()),
          });
        }
      } catch (error) {
        console.error('❌ [FileShareManager] 广播文件共享添加事件失败:', error);
        // 不影响主流程
      }
      
      message.success(tl('共享文件夹已添加', 'Shared folder added'));
      onSuccess();
    } catch (error) {
      message.error(`${tl('添加共享失败', 'Failed to add share')}: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal className="file-share-modal" rootClassName="file-share-modal-root" title={tl('添加共享文件夹', 'Add Shared Folder')} open={visible} onCancel={onClose} onOk={handleSubmit} confirmLoading={loading} okText={tl('确定', 'OK')} cancelText={tl('取消', 'Cancel')} width={500}>
      <div className="add-share-form">
        <div className="form-item">
          <label>{tl('选择文件夹', 'Select Folder')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={folderPath} placeholder={tl('点击选择文件夹', 'Click to select a folder')} readOnly />
            <Button onClick={handleSelectFolder}>{tl('选择', 'Select')}</Button>
          </div>
        </div>
        <div className="form-item">
          <label><Switch checked={hasPassword} onChange={setHasPassword} /><span style={{ marginLeft: 8 }}>{tl('密码保护', 'Password Protection')}</span></label>
          {hasPassword && <Input.Password value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tl('输入密码', 'Enter password')} style={{ marginTop: 8 }} />}
        </div>
        <div className="form-item">
          <label><Switch checked={hasExpiry} onChange={setHasExpiry} /><span style={{ marginLeft: 8 }}>{tl('设置有效期', 'Set Expiry')}</span></label>
          {hasExpiry && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input type="number" min={0} value={expiryDays} onChange={(e) => setExpiryDays(Math.max(0, parseInt(e.target.value) || 0))} placeholder="0" style={{ width: '80px' }} />
                <span>{tl('天', 'd')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input type="number" min={0} max={23} value={expiryHours} onChange={(e) => setExpiryHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))} placeholder="0" style={{ width: '80px' }} />
                <span>{tl('时', 'h')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input type="number" min={0} max={59} value={expiryMinutes} onChange={(e) => setExpiryMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} placeholder="0" style={{ width: '80px' }} />
                <span>{tl('分', 'm')}</span>
              </div>
            </div>
          )}
        </div>
        <div className="form-item">
          <label>
            <Switch checked={compressBeforeSend} onChange={setCompressBeforeSend} />
            <span style={{ marginLeft: 8 }}>{tl('先压后发', 'Compress Before Sending')}</span>
          </label>
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
            {tl('开启后，其他玩家批量下载多个文件时，会先自动打包成ZIP压缩包再下载', 'When enabled, batch downloads of multiple files are packed into a ZIP archive first')}
          </div>
        </div>
      </div>
    </Modal>
  );
};




