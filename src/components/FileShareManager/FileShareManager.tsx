/**
 * 文件共享管理器组件
 * 管理本地共享和浏览远程共享
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Button, Input, Switch, message, Progress } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { fileShareService, fileTransferService } from '../../services';
import type { SharedFolder, FileInfo, FileTransferProgress } from '../../types';
import { FolderIcon, FileIcon, DownloadIcon, ShareIcon, TrashIcon, CloseIcon, BackIcon } from '../icons';
import './FileShareManager.css';

export const FileShareManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'local' | 'remote' | 'transfers'>('local');
  
  // 本地共享
  const [localShares, setLocalShares] = useState<SharedFolder[]>([]);
  const [showAddShare, setShowAddShare] = useState(false);
  
  // 远程共享
  const [remoteShares, setRemoteShares] = useState<SharedFolder[]>([]);
  const [selectedShare, setSelectedShare] = useState<SharedFolder | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  
  // 传输进度
  const [transfers, setTransfers] = useState<FileTransferProgress[]>([]);
  const [transfersTab, setTransfersTab] = useState<'downloading' | 'completed'>('downloading');
  
  // 删除确认对话框
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteShareId, setDeleteShareId] = useState<string | null>(null);
  
  // 密码输入对话框
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingShare, setPendingShare] = useState<SharedFolder | null>(null);

  useEffect(() => {
    loadLocalShares();
    loadRemoteShares();
    loadTransfers();
    
    // 监听远程共享变化
    fileShareService.onRemoteSharesChanged((shares) => {
      console.log('📥 远程共享列表已更新:', shares.length);
      setRemoteShares(shares);
      
      // 检查当前正在浏览的共享是否还存在
      if (selectedShare) {
        const stillExists = shares.some(s => s.id === selectedShare.id);
        if (!stillExists) {
          console.log('⚠️ 正在浏览的共享已被删除，强制退出浏览界面');
          setSelectedShare(null);
          setCurrentPath('/');
          setFiles([]);
          message.warning('该共享已被删除');
        }
      }
    });
    
    // 监听本地共享变化
    fileShareService.onShareAdded((share) => {
      console.log('📁 本地共享已添加:', share.folderName);
      loadLocalShares();
    });
    
    fileShareService.onShareRemoved((shareId) => {
      console.log('🗑️ 本地共享已移除:', shareId);
      loadLocalShares();
    });
    
    fileShareService.onShareUpdated((share) => {
      console.log('✏️ 本地共享已更新:', share.folderName);
      loadLocalShares();
    });
    
    // 监听传输进度变化（实时更新）
    fileTransferService.onTransferProgress((progress) => {
      console.log('📊 传输进度更新:', progress.fileName, progress.progress.toFixed(1) + '%');
      loadTransfers();
    });
    
    // 监听传输完成
    fileTransferService.onTransferComplete((requestId, filePath) => {
      console.log('✅ 传输完成:', requestId, filePath);
      loadTransfers();
    });
    
    // 监听传输错误
    fileTransferService.onTransferError((requestId, error) => {
      console.error('❌ 传输错误:', requestId, error);
      loadTransfers();
    });
    
    // 清理函数
    return () => {
      // 这里可以添加清理逻辑，如果需要的话
    };
  }, [selectedShare]); // 添加selectedShare作为依赖

  // 加载本地共享
  const loadLocalShares = () => {
    const shares = fileShareService.getLocalShares();
    setLocalShares(shares);
  };

  // 加载远程共享
  const loadRemoteShares = () => {
    const shares = fileShareService.getRemoteShares();
    setRemoteShares(shares);
  };

  // 加载传输列表
  const loadTransfers = () => {
    const allTransfers = fileTransferService.getAllTransfers();
    setTransfers(allTransfers);
  };

  // 添加共享
  const handleAddShare = async () => {
    setShowAddShare(true);
  };

  // 移除共享
  const handleRemoveShare = (shareId: string) => {
    console.log('🗑️ 点击删除按钮，shareId:', shareId);
    setDeleteShareId(shareId);
    setShowDeleteConfirm(true);
  };

  // 确认删除
  const confirmDelete = () => {
    if (!deleteShareId) return;
    
    console.log('✅ 用户确认删除');
    try {
      fileShareService.removeSharedFolder(deleteShareId);
      loadLocalShares();
      message.success('共享已删除');
    } catch (error) {
      console.error('❌ 删除失败:', error);
      message.error('删除失败');
    }
    
    setShowDeleteConfirm(false);
    setDeleteShareId(null);
  };

  // 取消删除
  const cancelDelete = () => {
    console.log('❌ 用户取消删除');
    setShowDeleteConfirm(false);
    setDeleteShareId(null);
  };

  // 浏览远程共享
  const handleBrowseShare = async (share: SharedFolder) => {
    console.log('🔍 点击浏览共享:', share.folderName, 'hasPassword:', share.hasPassword);
    
    // 如果需要密码，显示密码输入框
    if (share.hasPassword) {
      console.log('🔒 需要密码，显示密码输入对话框');
      console.log('📋 设置pendingShare:', share.id);
      setPendingShare(share);
      setPasswordInput('');
      
      // 使用setTimeout确保状态更新后再显示Modal
      setTimeout(() => {
        console.log('� 显示密码输入Modal');
        setShowPasswordModal(true);
      }, 50);
      return;
    }
    
    console.log('📂 设置选中的共享并加载文件列表');
    setSelectedShare(share);
    setCurrentPath('/');
    await loadFiles(share, '/');
  };
  
  // 处理密码确认
  const handlePasswordConfirm = async () => {
    if (!pendingShare) return;
    
    console.log('✅ 用户确认密码:', passwordInput ? '已输入' : '未输入');
    
    if (!passwordInput) {
      message.error('请输入密码');
      return;
    }
    
    // 先尝试验证密码
    try {
      console.log('🔐 验证密码中...');
      
      // 临时保存密码用于验证
      const tempShare = { ...pendingShare, password: passwordInput };
      
      // 尝试获取文件列表来验证密码
      const fileList = await fileShareService.getFileList(tempShare.id, '/', passwordInput);
      
      console.log('✅ 密码验证成功，文件数量:', fileList.length);
      
      // 密码正确，关闭对话框
      setShowPasswordModal(false);
      
      // 设置选中的共享并显示文件列表
      tempShare.password = passwordInput; // 保存密码
      setSelectedShare(tempShare);
      setCurrentPath('/');
      setFiles(fileList);
      
      // 清理状态
      setPendingShare(null);
      setPasswordInput('');
      
    } catch (error) {
      console.error('❌ 密码验证失败:', error);
      message.error('密码错误，请重新输入');
      // 不关闭对话框，让用户重新输入
      setPasswordInput('');
    }
  };
  
  // 处理密码取消
  const handlePasswordCancel = () => {
    console.log('❌ 用户取消输入密码');
    setShowPasswordModal(false);
    setPendingShare(null);
    setPasswordInput('');
  };

  // 加载文件列表
  const loadFiles = async (share: SharedFolder, path: string) => {
    try {
      console.log('📋 开始加载文件列表:', { shareId: share.id, path, hasPassword: share.hasPassword });
      setLoadingFiles(true);
      
      // 使用已保存的密码（如果有）
      const password = share.password;
      console.log('🔑 使用密码:', password ? '有密码' : '无密码');
      
      const fileList = await fileShareService.getFileList(share.id, path, password);
      console.log('✅ 文件列表加载成功:', fileList.length, '个项目');
      fileList.forEach(file => {
        const isDir = file.isDirectory !== undefined ? file.isDirectory : file.is_directory;
        console.log(`  - ${isDir ? '📁' : '📄'} ${file.name} (isDirectory: ${file.isDirectory}, is_directory: ${file.is_directory})`);
      });
      
      setFiles(fileList);
    } catch (error) {
      console.error('❌ 加载文件列表失败:', error);
      message.error(`加载文件列表失败: ${error}`);
    } finally {
      setLoadingFiles(false);
    }
  };

  // 下载文件
  const handleDownloadFile = async (file: FileInfo) => {
    if (!selectedShare) return;
    
    try {
      // 选择保存位置
      const savePath = await invoke<string | null>('select_save_location', {
        defaultName: file.name,
      });
      
      if (!savePath) return;
      
      // 构建相对于共享文件夹的文件路径
      const relativePath = currentPath === '/' 
        ? file.path
        : `${currentPath.substring(1)}/${file.path}`; // 去掉开头的斜杠
      
      console.log('📥 请求下载文件:', file.name, '相对路径:', relativePath);
      
      // 请求下载
      await fileTransferService.requestDownload(
        selectedShare.id,
        selectedShare.ownerId,
        relativePath,
        file.name,
        file.size,
        savePath
      );
      
      message.success('开始下载文件');
      loadTransfers();
    } catch (error) {
      message.error(`下载失败: ${error}`);
    }
  };
  
  // 批量下载文件夹中的所有文件
  const handleBatchDownload = async () => {
    if (!selectedShare) return;
    
    try {
      // 选择保存文件夹
      const saveFolder = await invoke<string | null>('select_folder');
      
      if (!saveFolder) return;
      
      // 过滤出所有文件（排除文件夹）
      const filesToDownload = files.filter(f => !(f.isDirectory || f.is_directory));
      
      if (filesToDownload.length === 0) {
        message.info('当前文件夹中没有文件');
        return;
      }
      
      console.log(`📥 批量下载 ${filesToDownload.length} 个文件`);
      
      // 逐个下载文件（添加小延迟避免requestId冲突）
      for (let i = 0; i < filesToDownload.length; i++) {
        const file = filesToDownload[i];
        const relativePath = currentPath === '/' 
          ? file.path
          : `${currentPath.substring(1)}/${file.path}`;
        
        const savePath = `${saveFolder}\\${file.name}`;
        
        // 添加小延迟确保每个文件有唯一的requestId
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        await fileTransferService.requestDownload(
          selectedShare.id,
          selectedShare.ownerId,
          relativePath,
          file.name,
          file.size,
          savePath
        );
      }
      
      message.success(`开始下载 ${filesToDownload.length} 个文件`);
      loadTransfers();
    } catch (error) {
      message.error(`批量下载失败: ${error}`);
    }
  };
  
  // 打开文件所在文件夹
  const handleOpenFileLocation = async (transfer: FileTransferProgress) => {
    try {
      const savePath = (transfer as any).savePath;
      if (!savePath) {
        message.error('无法找到文件路径');
        return;
      }
      
      // 使用 shell 命令打开文件所在文件夹并选中文件
      await invoke('open_file_location', { path: savePath });
    } catch (error) {
      console.error('❌ 打开文件位置失败:', error);
      message.error('打开文件位置失败');
    }
  };

  // 进入文件夹
  const handleEnterFolder = async (folder: FileInfo) => {
    if (!selectedShare) return;
    
    const isDir = folder.isDirectory || folder.is_directory;
    console.log('🚪 尝试进入文件夹:', folder.name, 'isDirectory:', folder.isDirectory, 'is_directory:', folder.is_directory, '判断结果:', isDir);
    
    if (!isDir) {
      console.log('⚠️ 不是文件夹，跳过');
      return;
    }
    
    const newPath = currentPath === '/' 
      ? `/${folder.path}`
      : `${currentPath}/${folder.path}`;
    
    console.log('📂 新路径:', newPath);
    setCurrentPath(newPath);
    await loadFiles(selectedShare, newPath);
  };

  // 返回上级目录
  const handleGoBack = async () => {
    if (!selectedShare || currentPath === '/') return;
    
    const parts = currentPath.split('/').filter(p => p);
    parts.pop();
    const newPath = parts.length === 0 ? '/' : `/${parts.join('/')}`;
    
    setCurrentPath(newPath);
    await loadFiles(selectedShare, newPath);
  };

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  // 格式化时间（将时间戳转换为剩余时间）
  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const remaining = timestamp - now;
    
    if (remaining <= 0) {
      return '已过期';
    }
    
    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    
    if (days > 0) {
      return `${days}天${hours}时`;
    } else if (hours > 0) {
      return `${hours}时${minutes}分`;
    } else {
      return `${minutes}分钟`;
    }
  };

  return (
    <div className="file-share-container">
      <div className="file-share-content">
        {/* 左侧垂直选择栏 - 只显示图标 */}
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
            {transfers.filter(t => t.status === 'transferring' || t.status === 'pending').length > 0 && (
              <span className="transfer-badge">{transfers.filter(t => t.status === 'transferring' || t.status === 'pending').length}</span>
            )}
          </motion.div>
        </div>

        {/* 右侧内容区域 */}
        <div className="content-area">
          <AnimatePresence mode="wait">
            {activeTab === 'local' && (
              <motion.div
                key="local"
                className="tab-content"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.2 }}
              >
                <div className="share-list">
                  <Button
                    type="primary"
                    icon={<FolderIcon size={16} />}
                    onClick={handleAddShare}
                    style={{ marginBottom: 16 }}
                  >
                    添加共享文件夹
                  </Button>

                  <AnimatePresence>
                    {localShares.map((share) => (
                      <motion.div
                        key={share.id}
                        className="share-item"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        title={`${share.folderName}\n大小: ${formatSize(share.totalSize)}${share.hasPassword ? `\n密码: ${share.password}` : ''}${share.hasExpiry ? `\n剩余: ${formatTime(share.expiryTime!)}` : ''}`}
                      >
                        <FolderIcon size={24} className="share-icon" />
                        <div className="share-info">
                          <div className="share-name">{share.folderName}</div>
                          <div className="share-meta">
                            {formatSize(share.totalSize)}
                            {share.hasPassword && ' · 🔒'}
                            {share.hasExpiry && ' · ⏰'}
                          </div>
                        </div>
                        <button
                          className="delete-share-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log('🗑️ 删除按钮被点击！shareId:', share.id);
                            handleRemoveShare(share.id);
                          }}
                          title="删除共享"
                        >
                          <TrashIcon size={16} />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {localShares.length === 0 && (
                    <div className="empty-state">
                      <ShareIcon size={48} />
                      <p>还没有共享文件夹</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'remote' && (
              <motion.div
                key="remote"
                className="tab-content"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.2 }}
              >
                {!selectedShare ? (
                  <div className="share-list">
                    <AnimatePresence>
                      {remoteShares.map((share) => (
                        <motion.div
                          key={share.id}
                          className="share-item remote-share-item clickable"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          onClick={() => handleBrowseShare(share)}
                        >
                          <FolderIcon size={24} className="share-icon" />
                          <div className="share-info">
                            <div className="share-name">{share.folderName}</div>
                            <div className="share-meta">
                              {formatSize(share.totalSize)}
                            </div>
                          </div>
                          {/* 右上角状态图标 */}
                          <div className="share-status-icons">
                            {share.hasPassword && (
                              <span className="status-icon lock-icon" title="需要密码">🔒</span>
                            )}
                            {share.hasExpiry && (
                              <span className="status-icon expiry-icon" title={`剩余: ${formatTime(share.expiryTime!)}`}>⏰</span>
                            )}
                          </div>
                          {/* 右下角用户名 */}
                          <div className="share-owner">{share.ownerName}</div>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {remoteShares.length === 0 && (
                      <div className="empty-state">
                        <ShareIcon size={48} />
                        <p>暂无可用的共享文件夹</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="file-browser">
                    <div className="browser-header">
                      <Button 
                        size="small" 
                        onClick={handleGoBack} 
                        disabled={currentPath === '/'}
                        icon={<BackIcon size={16} />}
                        title="返回上级"
                        style={{ 
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      />
                      <span className="current-path">{currentPath}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {files.filter(f => !(f.isDirectory || f.is_directory)).length > 0 && (
                          <Button 
                            size="small" 
                            icon={<DownloadIcon size={14} />}
                            onClick={handleBatchDownload}
                            title="批量下载"
                            style={{ 
                              padding: '4px 8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          />
                        )}
                        <Button 
                          size="small" 
                          onClick={() => setSelectedShare(null)}
                          icon={<CloseIcon size={16} />}
                          title="关闭"
                          style={{ 
                            padding: '4px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        />
                      </div>
                    </div>

                    <div className="file-list">
                      {loadingFiles ? (
                        <div className="loading-state">加载中...</div>
                      ) : (
                        <AnimatePresence>
                          {files.map((file) => (
                            <motion.div
                              key={file.path}
                              className={`file-item ${file.isDirectory ? 'clickable' : ''}`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              onClick={() => {
                                if (file.isDirectory || file.is_directory) {
                                  console.log('📁 点击文件夹:', file.name, 'isDirectory:', file.isDirectory, 'is_directory:', file.is_directory);
                                  handleEnterFolder(file);
                                }
                              }}
                            >
                              {(file.isDirectory || file.is_directory) ? (
                                <FolderIcon size={20} className="file-icon" />
                              ) : (
                                <FileIcon size={20} className="file-icon" />
                              )}
                              <div className="file-info">
                                <div className="file-name">{file.name}</div>
                                <div className="file-meta">
                                  {!(file.isDirectory || file.is_directory) && formatSize(file.size)}
                                </div>
                              </div>
                              {!(file.isDirectory || file.is_directory) && (
                                <Button
                                  size="small"
                                  icon={<DownloadIcon size={14} />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadFile(file);
                                  }}
                                  title="下载"
                                />
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'transfers' && (
              <motion.div
                key="transfers"
                className="tab-content"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.2 }}
              >
                {/* 传输子标签 */}
                <div className="transfers-subtabs">
                  <motion.div
                    className={`subtab ${transfersTab === 'downloading' ? 'active' : ''}`}
                    onClick={() => setTransfersTab('downloading')}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    正在下载
                    {transfers.filter(t => t.status === 'transferring' || t.status === 'pending').length > 0 && (
                      <span className="subtab-badge">
                        {transfers.filter(t => t.status === 'transferring' || t.status === 'pending').length}
                      </span>
                    )}
                  </motion.div>
                  <motion.div
                    className={`subtab ${transfersTab === 'completed' ? 'active' : ''}`}
                    onClick={() => setTransfersTab('completed')}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    已完成
                    {transfers.filter(t => t.status === 'completed').length > 0 && (
                      <span className="subtab-badge">
                        {transfers.filter(t => t.status === 'completed').length}
                      </span>
                    )}
                  </motion.div>
                </div>

                <div className="transfer-list">
                  <AnimatePresence mode="wait">
                    {transfersTab === 'downloading' && (
                      <motion.div
                        key="downloading"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2 }}
                      >
                        {transfers
                          .filter(t => t.status === 'transferring' || t.status === 'pending')
                          .map((transfer) => (
                            <motion.div
                              key={transfer.requestId}
                              className="transfer-item"
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -20 }}
                            >
                              <FileIcon size={20} className="transfer-icon" />
                              <div className="transfer-info">
                                <div className="transfer-name">{transfer.fileName}</div>
                                <Progress
                                  percent={Math.round(transfer.progress)}
                                  size="small"
                                  status="active"
                                />
                                <div className="transfer-meta">
                                  <span className="transfer-size">
                                    {formatSize(transfer.transferredSize)} / {formatSize(transfer.totalSize)}
                                  </span>
                                  {transfer.status === 'transferring' && (
                                    <span className="transfer-speed">
                                      {transfer.speed > 0 ? `${formatSize(transfer.speed)}/s` : '计算中...'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          ))}

                        {transfers.filter(t => t.status === 'transferring' || t.status === 'pending').length === 0 && (
                          <div className="empty-state">
                            <DownloadIcon size={48} />
                            <p>暂无正在下载的任务</p>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {transfersTab === 'completed' && (
                      <motion.div
                        key="completed"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.2 }}
                      >
                        {transfers
                          .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
                          .map((transfer) => (
                            <motion.div
                              key={transfer.requestId}
                              className={`transfer-item ${transfer.status === 'completed' ? 'clickable' : ''}`}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -20 }}
                              onClick={() => {
                                if (transfer.status === 'completed') {
                                  handleOpenFileLocation(transfer);
                                }
                              }}
                              title={transfer.status === 'completed' ? '点击打开文件位置' : ''}
                            >
                              <FileIcon size={20} className="transfer-icon" />
                              <div className="transfer-info">
                                <div className="transfer-name">{transfer.fileName}</div>
                                <Progress
                                  percent={Math.round(transfer.progress)}
                                  size="small"
                                  status={
                                    transfer.status === 'completed' ? 'success' :
                                    transfer.status === 'failed' ? 'exception' :
                                    'normal'
                                  }
                                />
                                <div className="transfer-meta">
                                  {transfer.status === 'completed' && `${formatSize(transfer.totalSize)} · 已完成`}
                                  {transfer.status === 'failed' && `失败: ${transfer.error || '未知错误'}`}
                                  {transfer.status === 'cancelled' && '已取消'}
                                </div>
                              </div>
                            </motion.div>
                          ))}

                        {transfers.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled').length === 0 && (
                          <div className="empty-state">
                            <DownloadIcon size={48} />
                            <p>暂无已完成的下载</p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {showAddShare && (
        <AddShareDialog
          visible={showAddShare}
          onClose={() => setShowAddShare(false)}
          onSuccess={() => {
            setShowAddShare(false);
            loadLocalShares();
          }}
        />
      )}

      {/* 密码输入对话框 */}
      <Modal
        title="输入密码"
        open={showPasswordModal}
        onOk={handlePasswordConfirm}
        onCancel={handlePasswordCancel}
        okText="确定"
        cancelText="取消"
        centered
        width={400}
        zIndex={99999}
        maskClosable={false}
        destroyOnClose={true}
        getContainer={false}
        afterOpenChange={(open) => {
          console.log('📋 Modal afterOpenChange:', open);
          if (open) {
            console.log('📋 密码输入框已打开，pendingShare:', pendingShare?.folderName);
          }
        }}
      >
        <div style={{ marginTop: 16 }}>
          <Input.Password
            autoFocus
            value={passwordInput}
            onChange={(e) => {
              console.log('📝 密码输入变化:', e.target.value ? '有内容' : '空');
              setPasswordInput(e.target.value);
            }}
            onPressEnter={handlePasswordConfirm}
            placeholder="请输入共享密码"
          />
        </div>
      </Modal>

      {/* 自定义删除确认对话框 */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            className="custom-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={cancelDelete}
          >
            <motion.div
              className="custom-confirm-dialog"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="confirm-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </div>
              <h3 className="confirm-title">确认删除</h3>
              <p className="confirm-message">确定要删除这个共享吗？删除后其他玩家将无法访问。</p>
              <div className="confirm-actions">
                <button className="confirm-btn cancel-btn" onClick={cancelDelete}>
                  取消
                </button>
                <button className="confirm-btn delete-btn" onClick={confirmDelete}>
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// 添加共享对话框组件
interface AddShareDialogProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddShareDialog: React.FC<AddShareDialogProps> = ({ visible, onClose, onSuccess }) => {
  const [folderPath, setFolderPath] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDays, setExpiryDays] = useState(0);
  const [expiryHours, setExpiryHours] = useState(0);
  const [expiryMinutes, setExpiryMinutes] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSelectFolder = async () => {
    try {
      const path = await invoke<string | null>('select_folder');
      if (path) {
        setFolderPath(path);
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
      
      // 计算过期时间戳
      let expiryTimestamp: number | undefined;
      if (hasExpiry) {
        const totalMilliseconds = 
          (expiryDays * 24 * 60 * 60 + 
           expiryHours * 60 * 60 + 
           expiryMinutes * 60) * 1000;
        expiryTimestamp = Date.now() + totalMilliseconds;
      }
      
      await fileShareService.addSharedFolder(
        folderPath,
        hasPassword,
        hasPassword ? password : undefined,
        hasExpiry,
        expiryTimestamp
      );
      
      message.success('共享文件夹已添加');
      onSuccess();
    } catch (error) {
      message.error(`添加共享失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="添加共享文件夹"
      open={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
    >
      <div className="add-share-form">
        <div className="form-item">
          <label>选择文件夹</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              value={folderPath}
              placeholder="点击选择文件夹"
              readOnly
            />
            <Button onClick={handleSelectFolder}>选择</Button>
          </div>
        </div>

        <div className="form-item">
          <label>
            <Switch
              checked={hasPassword}
              onChange={setHasPassword}
            />
            <span style={{ marginLeft: 8 }}>密码保护</span>
          </label>
          {hasPassword && (
            <Input.Password
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              style={{ marginTop: 8 }}
              iconRender={(visible) => (
                visible ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                )
              )}
            />
          )}
        </div>

        <div className="form-item">
          <label>
            <Switch
              checked={hasExpiry}
              onChange={setHasExpiry}
            />
            <span style={{ marginLeft: 8 }}>设置有效期</span>
          </label>
          {hasExpiry && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input
                  type="number"
                  min={0}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0"
                  style={{ width: '80px' }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px', whiteSpace: 'nowrap' }}>天</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                  placeholder="0"
                  style={{ width: '80px' }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px', whiteSpace: 'nowrap' }}>时</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={expiryMinutes}
                  onChange={(e) => setExpiryMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  placeholder="0"
                  style={{ width: '80px' }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px', whiteSpace: 'nowrap' }}>分</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
