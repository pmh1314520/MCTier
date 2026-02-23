/**
 * 文件共享管理器 - 全新重构版本
 * 专门为HTTP over WireGuard设计
 * 支持多选批量下载、断点续传、先压后发
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Button, Input, Switch, message, Checkbox, Progress } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/appStore';
import type { SharedFolder, FileInfo } from '../../types/fileShare';
import { FolderIcon, DownloadIcon, ShareIcon, CloseIcon, BackIcon, TrashIcon } from '../icons';
import './FileShareManager.css';

// 简化的远程共享类型
interface SimpleRemoteShare {
  share: SharedFolder;
  ownerName: string;
  ownerIp: string;
}

// 下载任务状态
interface DownloadTask {
  id: string;
  fileName: string;
  fileSize: number;
  downloaded: number;
  status: 'downloading' | 'completed' | 'failed';
  url: string;
  savePath: string;
  error?: string;
  abortController?: AbortController; // 用于取消下载
  speed?: number; // 下载速度（bytes/s）
  lastUpdateTime?: number; // 上次更新时间
  lastDownloaded?: number; // 上次下载的字节数
}

export const FileShareManagerNew: React.FC = () => {
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
  
  // 下载状态
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [transferSubTab, setTransferSubTab] = useState<'downloading' | 'completed'>('downloading');
  
  // 密码验证
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingShare, setPendingShare] = useState<SimpleRemoteShare | null>(null);

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

  // 加载远程共享 - 简化版本
  const loadRemoteShares = async () => {
    
    const allShares: SimpleRemoteShare[] = [];
    const now = Math.floor(Date.now() / 1000);
    
    // 1. 加载自己的共享
    if (lobby?.virtualIp) {
      try {
        const shares = await invoke<SharedFolder[]>('get_remote_shares', { peerIp: lobby.virtualIp });
        
        shares.forEach(share => {
          // 过滤掉过期的共享
          if (!share.expire_time || share.expire_time > now) {
            allShares.push({
              share,
              ownerName: `${config.playerName || '我'} (我)`,
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
      if (player.virtualIp) {
        try {
          const shares = await invoke<SharedFolder[]>('get_remote_shares', { peerIp: player.virtualIp });
          
          shares.forEach(share => {
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
        message.warning('该共享文件夹已被删除');
      }
    }
    
    setRemoteShares(allShares);
  };

  // 组件挂载时加载本地共享
  useEffect(() => {
    loadLocalShares();
  }, []);

  // 切换到远程共享时加载数据
  useEffect(() => {
    if (activeTab === 'remote') {
      loadRemoteShares();
      const interval = setInterval(loadRemoteShares, 3000);
      return () => clearInterval(interval);
    }
  }, [activeTab, lobby?.virtualIp, players.length]);

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
      message.success('删除共享成功');
      loadLocalShares();
    } catch (error) {
      message.error('删除共享失败');
    }
  };

  // 浏览共享
  const handleBrowseShare = async (remoteShare: SimpleRemoteShare) => {
    if (remoteShare.share.password) {
      setPendingShare(remoteShare);
      setShowPasswordModal(true);
      return;
    }
    await openShare(remoteShare);
  };

  // 打开共享
  const openShare = async (remoteShare: SimpleRemoteShare, password?: string) => {
    try {
      if (remoteShare.share.password && password) {
        const valid = await invoke<boolean>('verify_share_password', {
          peerIp: remoteShare.ownerIp,
          shareId: remoteShare.share.id,
          password
        });
        if (!valid) {
          message.error('密码错误');
          return;
        }
      }
      setSelectedShare(remoteShare);
      setCurrentPath('');
      setSelectedFiles(new Set());
      await loadFiles(remoteShare, '');
      setShowPasswordModal(false);
      setPasswordInput('');
    } catch (error) {
      message.error('打开共享失败');
    }
  };

  // 加载文件列表
  const loadFiles = async (remoteShare: SimpleRemoteShare, path: string) => {
    setLoadingFiles(true);
    try {
      const fileList = await invoke<FileInfo[]>('get_remote_files', {
        peerIp: remoteShare.ownerIp,
        shareId: remoteShare.share.id,
        path: path || null
      });
      setFiles(fileList);
      setCurrentPath(path);
      setSelectedFiles(new Set());
    } catch (error) {
      message.error('加载文件列表失败');
    } finally {
      setLoadingFiles(false);
    }
  };

  // 下载单个文件
  const handleDownloadFile = async (file: FileInfo) => {
    if (!selectedShare) return;
    
    try {
      // 选择保存位置
      const savePath = await invoke<string | null>('select_save_location', {
        defaultName: file.name
      });
      
      if (!savePath) {
        return; // 用户取消
      }
      
      const downloadUrl = `http://${selectedShare.ownerIp}:14539/api/shares/${selectedShare.share.id}/download/${file.path}`;
      
      // 创建下载任务
      const taskId = `download_${Date.now()}_${Math.random()}`;
      const newTask: DownloadTask = {
        id: taskId,
        fileName: file.name,
        fileSize: file.size,
        downloaded: 0,
        status: 'downloading',
        url: downloadUrl,
        savePath
      };
      
      setDownloads(prev => [...prev, newTask]);
      // 不自动跳转到传输列表，让用户继续浏览
      
      // 开始下载
      startDownload(taskId, downloadUrl, savePath, file.size);
      
      message.success('开始下载文件');
    } catch (error) {
      message.error(`下载失败: ${error}`);
    }
  };

  // 实际执行下载
  const startDownload = async (taskId: string, url: string, savePath: string, fileSize: number) => {
      const abortController = new AbortController();
      const startTime = Date.now();
      let lastUpdateTime = startTime;
      let lastDownloaded = 0;

      // 更新任务，添加abortController
      setDownloads(prev => prev.map(task =>
        task.id === taskId ? { ...task, abortController, lastUpdateTime, lastDownloaded } : task
      ));

      try {
        const response = await fetch(url, {
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('无法读取响应');
        }

        const chunks: Uint8Array[] = [];
        let downloaded = 0;

        while (true) {
          try {
            const { done, value } = await reader.read();

            if (done) break;

            chunks.push(value);
            downloaded += value.length;

            // 计算速度（每500ms更新一次）
            const now = Date.now();
            const timeDiff = now - lastUpdateTime;
            
            if (timeDiff >= 500) {
              const byteDiff = downloaded - lastDownloaded;
              const speed = (byteDiff / timeDiff) * 1000; // bytes/s
              
              // 更新进度和速度
              setDownloads(prev => prev.map(task =>
                task.id === taskId ? { 
                  ...task, 
                  downloaded, 
                  speed,
                  lastUpdateTime: now,
                  lastDownloaded: downloaded
                } : task
              ));
              
              lastUpdateTime = now;
              lastDownloaded = downloaded;
            } else {
              // 【修复】减少状态更新频率，避免过度渲染
              // 只在下载量变化超过1MB时才更新UI
              if (downloaded - (lastDownloaded || 0) > 1024 * 1024) {
                setDownloads(prev => prev.map(task =>
                  task.id === taskId ? { ...task, downloaded } : task
                ));
              }
            }
          } catch (error: any) {
            // 如果是用户主动取消
            if (error.name === 'AbortError') {
              console.log(`❌ [FileShareManager] 下载被取消`);
              return;
            }
            throw error;
          }
        }

        // 合并所有chunks
        const blob = new Blob(chunks as BlobPart[]);
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        await invoke('save_file', {
          path: savePath,
          data: Array.from(uint8Array)
        });

        // 标记为完成
        setDownloads(prev => prev.map(task =>
          task.id === taskId ? { ...task, status: 'completed' as const, downloaded: fileSize, speed: 0 } : task
        ));

        message.success('下载完成');
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setDownloads(prev => prev.map(task =>
            task.id === taskId ? { ...task, status: 'failed' as const, error: String(error), speed: 0 } : task
          ));
          message.error(`下载失败: ${error}`);
        }
      }
    }



  // 批量下载选中的文件
  const handleBatchDownload = async () => {
    if (!selectedShare || selectedFiles.size === 0) {
      message.warning('请先选择要下载的文件');
      return;
    }

    const selectedFileList = files.filter(f => !f.is_dir && selectedFiles.has(f.path));
    
    if (selectedFileList.length === 0) {
      message.warning('没有选中任何文件');
      return;
    }

    // 选择保存位置
    const saveDir = await invoke<string | null>('select_folder');
    if (!saveDir) {
      return; // 用户取消
    }

    // 检查是否启用了"先压后发"
    if (selectedShare.share.compress_before_send && selectedFileList.length > 1) {
      try {
        // 创建一个下载任务用于显示进度
        const taskId = `batch_download_${Date.now()}`;
        const zipFileName = `batch_download_${Date.now()}.zip`;
        const newTask: DownloadTask = {
          id: taskId,
          fileName: zipFileName,
          fileSize: 0, // 未知大小
          downloaded: 0,
          status: 'downloading',
          url: '',
          savePath: `${saveDir}/${zipFileName}`
        };
        
        setDownloads(prev => [...prev, newTask]);
        message.info(`正在打包 ${selectedFileList.length} 个文件，请稍候...`);
        
        // 异步下载，不阻塞UI
        (async () => {
          try {
            // 直接调用HTTP API打包文件
            const url = `http://${selectedShare.ownerIp}:14539/api/shares/${selectedShare.share.id}/batch-download`;
            console.log('📦 [FileShareManager] 请求批量打包:', url);
            console.log('📦 [FileShareManager] 文件列表:', selectedFileList.map(f => f.path));
            
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                file_paths: selectedFileList.map(f => f.path)
              })
            });
            
            if (!response.ok) {
              const errorText = await response.text();
              console.error('❌ [FileShareManager] 批量打包失败:', response.status, errorText);
              throw new Error(`HTTP ${response.status}: ${errorText || '打包失败'}`);
            }
            
            console.log('✅ [FileShareManager] 开始下载压缩包');
            
            // 获取ZIP文件
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            console.log('📦 [FileShareManager] 压缩包大小:', uint8Array.length, 'bytes');
            
            // 保存文件
            await invoke('save_file', {
              path: newTask.savePath,
              data: Array.from(uint8Array)
            });
            
            console.log('✅ [FileShareManager] 压缩包已保存:', newTask.savePath);
            
            // 更新任务状态为完成
            setDownloads(prev => prev.map(task =>
              task.id === taskId ? { ...task, status: 'completed' as const, downloaded: uint8Array.length, fileSize: uint8Array.length } : task
            ));
            
            message.success(`压缩包下载完成 (${selectedFileList.length} 个文件)`);
            
            // 清空选中状态
            setSelectedFiles(new Set());
          } catch (error) {
            console.error('❌ [FileShareManager] 批量打包失败:', error);
            
            // 更新任务状态为失败
            setDownloads(prev => prev.map(task =>
              task.id === taskId ? { ...task, status: 'failed' as const, error: String(error) } : task
            ));
            message.error(`打包失败: ${error}`);
          }
        })();
      } catch (error) {
        console.error('❌ [FileShareManager] 批量下载失败:', error);
        message.error(`批量下载失败: ${error}`);
      }
    } else if (!selectedShare.share.compress_before_send && selectedFileList.length > 1) {
      // 【修复】如果没有启用"先压后发"，提示用户
      message.warning('该共享未启用"先压后发"功能，将逐个下载文件');
      
      // 逐个下载
      for (const file of selectedFileList) {
        const savePath = `${saveDir}/${file.name}`;
        const downloadUrl = `http://${selectedShare.ownerIp}:14539/api/shares/${selectedShare.share.id}/download/${file.path}`;
        
        const taskId = `download_${Date.now()}_${Math.random()}`;
        const newTask: DownloadTask = {
          id: taskId,
          fileName: file.name,
          fileSize: file.size,
          downloaded: 0,
          status: 'downloading',
          url: downloadUrl,
          savePath
        };
        
        setDownloads(prev => [...prev, newTask]);
        startDownload(taskId, downloadUrl, savePath, file.size);
      }
      
      message.success(`开始下载 ${selectedFileList.length} 个文件`);
      
      // 清空选中状态
      setSelectedFiles(new Set());
    } else {
      // 只选中了一个文件，直接下载
      const file = selectedFileList[0];
      const savePath = `${saveDir}/${file.name}`;
      const downloadUrl = `http://${selectedShare.ownerIp}:14539/api/shares/${selectedShare.share.id}/download/${file.path}`;
      
      const taskId = `download_${Date.now()}_${Math.random()}`;
      const newTask: DownloadTask = {
        id: taskId,
        fileName: file.name,
        fileSize: file.size,
        downloaded: 0,
        status: 'downloading',
        url: downloadUrl,
        savePath
      };
      
      setDownloads(prev => [...prev, newTask]);
      startDownload(taskId, downloadUrl, savePath, file.size);
      
      message.success('开始下载');
      
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

  // 切换文件选中状态
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
    if (task?.abortController) {
      console.log('❌ [FileShareManager] 取消下载任务:', taskId);
      task.abortController.abort();
    }
    
    // 删除已下载的残留文件
    if (task?.savePath) {
      try {
        console.log('🗑️ [FileShareManager] 删除残留文件:', task.savePath);
        await invoke('delete_file', { path: task.savePath });
        console.log('✅ [FileShareManager] 残留文件已删除');
      } catch (error) {
        console.error('❌ [FileShareManager] 删除残留文件失败:', error);
      }
      
      // 删除临时文件
      try {
        await invoke('delete_file', { path: `${task.savePath}.part` });
        console.log('✅ [FileShareManager] 临时文件已删除');
      } catch (error) {
        // 临时文件可能不存在，忽略错误
      }
    }
    
    setDownloads(prev => prev.filter(t => t.id !== taskId));
    message.success('已取消下载');
  };

  // 打开文件所在文件夹
  const handleOpenFileLocation = async (savePath: string) => {
    try {
      await invoke('open_file_location', { path: savePath });
    } catch (error) {
      message.error(`打开文件夹失败: ${error}`);
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
    if (remaining <= 0) return '已过期';
    const days = Math.floor(remaining / (24 * 60 * 60));
    const hours = Math.floor((remaining % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((remaining % (60 * 60)) / 60);
    if (days > 0) return `${days}天${hours}时`;
    else if (hours > 0) return `${hours}时${minutes}分`;
    else return `${minutes}分钟`;
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
            whileHover={{ x: 4 }} 
            whileTap={{ scale: 0.95 }} 
            title="我的共享"
          >
            <FolderIcon size={20} />
          </motion.div>
          <motion.div 
            className={`sidebar-tab ${activeTab === 'remote' ? 'active' : ''}`} 
            onClick={() => setActiveTab('remote')} 
            whileHover={{ x: 4 }} 
            whileTap={{ scale: 0.95 }} 
            title="远程共享"
          >
            <ShareIcon size={20} />
          </motion.div>
          <motion.div 
            className={`sidebar-tab ${activeTab === 'transfers' ? 'active' : ''}`} 
            onClick={() => setActiveTab('transfers')} 
            whileHover={{ x: 4 }} 
            whileTap={{ scale: 0.95 }} 
            title="传输列表"
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
                  <Button type="primary" icon={<FolderIcon size={16} />} onClick={() => setShowAddShare(true)} style={{ marginBottom: 16 }}>添加共享文件夹</Button>
                  <AnimatePresence>
                    {localShares.map((share) => (
                      <motion.div key={share.id} className="share-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                        <FolderIcon size={24} className="share-icon" />
                        <div className="share-info">
                          <div className="share-name">{share.name}</div>
                          <div className="share-meta">{share.password && '🔒 '}{share.compress_before_send && '📦 '}{share.expire_time && `⏰ ${formatTime(share.expire_time)}`}</div>
                        </div>
                        <button className="delete-share-btn" onClick={() => handleDeleteShare(share.id)} title="删除共享"><TrashIcon size={16} /></button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {localShares.length === 0 && <div className="empty-state"><ShareIcon size={48} /><p>还没有共享文件夹</p></div>}
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
                            {remoteShare.share.password && (
                              <div className="status-icon lock-icon" title="需要密码">🔒</div>
                            )}
                            {remoteShare.share.compress_before_send && (
                              <div className="status-icon compress-icon" title="先压后发">📦</div>
                            )}
                            {remoteShare.share.expire_time && (
                              <div className="status-icon expiry-icon" title={`有效期至 ${new Date(remoteShare.share.expire_time * 1000).toLocaleString()}`}>⏰</div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {remoteShares.length === 0 && <div className="empty-state"><ShareIcon size={48} /><p>暂无可用的共享文件夹</p></div>}
                  </div>
                ) : (
                  <div className="file-browser">
                    <div className="browser-header">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                        <Button size="small" onClick={handleGoBack} disabled={!currentPath} icon={<BackIcon size={16} />} title="返回上级" />
                        <Button size="small" onClick={handleGoToRoot} disabled={!currentPath} title="返回根目录">根目录</Button>
                        <Button size="small" onClick={handleSelectAll} title={selectedFiles.size === files.filter(f => !f.is_dir).length ? '取消全选' : '全选文件'}>
                          {selectedFiles.size === files.filter(f => !f.is_dir).length && files.filter(f => !f.is_dir).length > 0 ? '取消全选' : '全选'}
                        </Button>
                      </div>
                      <Button size="small" onClick={() => setSelectedShare(null)} icon={<CloseIcon size={16} />} title="关闭" style={{ marginLeft: 'auto' }} />
                    </div>
                    <div className="file-list">
                      {loadingFiles ? <div className="loading-state">加载中...</div> : (
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
                                  size="small" 
                                  icon={<DownloadIcon size={14} />} 
                                  onClick={(e) => { e.stopPropagation(); handleDownloadFile(file); }} 
                                  title="下载"
                                  style={{ flexShrink: 0 }}
                                />
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      )}
                      {!loadingFiles && files.length === 0 && <div className="empty-state"><FolderIcon size={48} /><p>文件夹为空</p></div>}
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
                          type="primary"
                          shape="circle"
                          size="large"
                          icon={<DownloadIcon size={18} />}
                          onClick={handleBatchDownload}
                          title={`下载选中 (${selectedFiles.size})`}
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
                    正在下载
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
                    已完成
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
                          <p>{transferSubTab === 'downloading' ? '暂无正在下载的任务' : '暂无已完成的任务'}</p>
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
                            onClick={() => task.status === 'completed' && handleOpenFileLocation(task.savePath)}
                            style={{ position: 'relative' }}
                          >
                            {/* 取消按钮 - 右上角 */}
                            {task.status !== 'completed' && (
                              <button
                                className="transfer-cancel-btn"
                                onClick={(e) => { e.stopPropagation(); handleCancelDownload(task.id); }}
                                title="取消下载"
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
                                {task.status === 'downloading' && !task.speed && ' - 下载中'}
                                {task.status === 'completed' && ' - 已完成'}
                                {task.status === 'failed' && ` - 失败: ${task.error}`}
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
      <Modal title="输入密码" open={showPasswordModal} onOk={() => pendingShare && openShare(pendingShare, passwordInput)} onCancel={() => { setShowPasswordModal(false); setPasswordInput(''); setPendingShare(null); }} okText="确定" cancelText="取消" centered width={400}>
        <div style={{ marginTop: 16 }}><Input.Password autoFocus value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} onPressEnter={() => pendingShare && openShare(pendingShare, passwordInput)} placeholder="请输入共享密码" /></div>
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
  const [folderPath, setFolderPath] = useState('');
  const [folderName, setFolderName] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
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
        setFolderName(name || '未命名文件夹');
      }
    } catch (error) {
      message.error(`选择文件夹失败: ${error}`);
    }
  };

  const handleSubmit = async () => {
    if (!folderPath) {
      message.error('请选择要共享的文件夹');
      return;
    }
    if (hasPassword && !password) {
      message.error('请输入密码');
      return;
    }
    if (hasExpiry && expiryDays === 0 && expiryHours === 0 && expiryMinutes === 0) {
      message.error('请设置有效期时长');
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
      message.success('共享文件夹已添加');
      onSuccess();
    } catch (error) {
      message.error(`添加共享失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="添加共享文件夹" open={visible} onCancel={onClose} onOk={handleSubmit} confirmLoading={loading} okText="确定" cancelText="取消" width={500}>
      <div className="add-share-form">
        <div className="form-item">
          <label>选择文件夹</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={folderPath} placeholder="点击选择文件夹" readOnly />
            <Button onClick={handleSelectFolder}>选择</Button>
          </div>
        </div>
        <div className="form-item">
          <label><Switch checked={hasPassword} onChange={setHasPassword} /><span style={{ marginLeft: 8 }}>密码保护</span></label>
          {hasPassword && <Input.Password value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入密码" style={{ marginTop: 8 }} />}
        </div>
        <div className="form-item">
          <label><Switch checked={hasExpiry} onChange={setHasExpiry} /><span style={{ marginLeft: 8 }}>设置有效期</span></label>
          {hasExpiry && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input type="number" min={0} value={expiryDays} onChange={(e) => setExpiryDays(Math.max(0, parseInt(e.target.value) || 0))} placeholder="0" style={{ width: '80px' }} />
                <span>天</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input type="number" min={0} max={23} value={expiryHours} onChange={(e) => setExpiryHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))} placeholder="0" style={{ width: '80px' }} />
                <span>时</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input type="number" min={0} max={59} value={expiryMinutes} onChange={(e) => setExpiryMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} placeholder="0" style={{ width: '80px' }} />
                <span>分</span>
              </div>
            </div>
          )}
        </div>
        <div className="form-item">
          <label>
            <Switch checked={compressBeforeSend} onChange={setCompressBeforeSend} />
            <span style={{ marginLeft: 8 }}>先压后发</span>
          </label>
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
            开启后，其他玩家批量下载多个文件时，会先自动打包成ZIP压缩包再下载
          </div>
        </div>
      </div>
    </Modal>
  );
};
