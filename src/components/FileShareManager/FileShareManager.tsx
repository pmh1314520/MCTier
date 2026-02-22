/**
 * 文件共享管理器组件
 * 基于 HTTP over WireGuard 的文件传输
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Button, Input, Switch, message, Progress } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { fileShareService, fileTransferService } from '../../services';
import type { SharedFolder, FileInfo, DownloadTask, RemoteShare } from '../../types/fileShare';
import { FolderIcon, FileIcon, DownloadIcon, ShareIcon, CloseIcon, BackIcon, TrashIcon } from '../icons';
import './FileShareManager.css';

interface Player {
  id: string;
  name: string;
  virtual_ip: string;
}

export const FileShareManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'local' | 'remote' | 'transfers'>('local');
  const [localShares, setLocalShares] = useState<SharedFolder[]>([]);
  const [showAddShare, setShowAddShare] = useState(false);
  const [remoteShares, setRemoteShares] = useState<RemoteShare[]>([]);
  const [selectedShare, setSelectedShare] = useState<RemoteShare | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [transfersTab, setTransfersTab] = useState<'downloading' | 'completed'>('downloading');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingShare, setPendingShare] = useState<RemoteShare | null>(null);

  const loadLocalShares = async () => {
    try {
      const shares = await fileShareService.getLocalShares();
      setLocalShares(shares);
    } catch (error) {
      console.error('加载本地共享失败:', error);
    }
  };

  const loadRemoteShares = async () => {
    try {
      const playerList = await invoke<Player[]>('get_players');
      const allShares: RemoteShare[] = [];
      for (const player of playerList) {
        if (player.virtual_ip) {
          try {
            const shares = await fileShareService.getRemoteShares(player.virtual_ip);
            shares.forEach(share => {
              allShares.push({ share, owner_name: player.name, owner_ip: player.virtual_ip });
            });
          } catch (error) {
            console.error(`获取 ${player.name} 的共享失败:`, error);
          }
        }
      }
      setRemoteShares(allShares);
    } catch (error) {
      console.error('加载远程共享失败:', error);
    }
  };

  const loadDownloads = () => {
    const allDownloads = fileTransferService.getAllTasks();
    setDownloads(allDownloads);
  };

  useEffect(() => {
    loadLocalShares();
    loadRemoteShares();
    loadDownloads();
    const interval = setInterval(() => {
      loadRemoteShares();
      loadDownloads();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteShare = async (shareId: string) => {
    try {
      await fileShareService.removeShare(shareId);
      message.success('删除共享成功');
      loadLocalShares();
    } catch (error) {
      message.error('删除共享失败');
    }
  };

  const handleBrowseShare = async (remoteShare: RemoteShare) => {
    if (remoteShare.share.password) {
      setPendingShare(remoteShare);
      setShowPasswordModal(true);
      return;
    }
    await openShare(remoteShare);
  };

  const openShare = async (remoteShare: RemoteShare, password?: string) => {
    try {
      if (remoteShare.share.password && password) {
        const valid = await fileShareService.verifyPassword(remoteShare.owner_ip, remoteShare.share.id, password);
        if (!valid) {
          message.error('密码错误');
          return;
        }
      }
      setSelectedShare(remoteShare);
      setCurrentPath('');
      await loadFiles(remoteShare, '');
      setShowPasswordModal(false);
      setPasswordInput('');
    } catch (error) {
      message.error('打开共享失败');
    }
  };

  const loadFiles = async (remoteShare: RemoteShare, path: string) => {
    setLoadingFiles(true);
    try {
      const fileList = await fileShareService.getRemoteFiles(remoteShare.owner_ip, remoteShare.share.id, path || undefined);
      setFiles(fileList);
      setCurrentPath(path);
    } catch (error) {
      message.error('加载文件列表失败');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleDownloadFile = async (file: FileInfo) => {
    if (!selectedShare) return;
    try {
      const downloadUrl = await fileShareService.getDownloadUrl(selectedShare.owner_ip, selectedShare.share.id, file.path);
      const taskId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await fileTransferService.startDownload(taskId, downloadUrl, file.name, file.size, selectedShare.owner_ip, selectedShare.share.id, file.path);
      message.success('开始下载文件');
      setActiveTab('transfers');
      loadDownloads();
    } catch (error) {
      if (error instanceof Error && error.message.includes('取消')) return;
      message.error(`下载失败: ${error}`);
    }
  };

  const handleCancelDownload = (taskId: string) => {
    fileTransferService.cancelDownload(taskId);
    message.info('已取消下载');
    loadDownloads();
  };

  const handleRemoveTask = (taskId: string) => {
    fileTransferService.removeTask(taskId);
    loadDownloads();
  };

  const handleOpenFileLocation = async (task: DownloadTask) => {
    try {
      await invoke('open_file_location', { path: task.save_path });
    } catch (error) {
      message.error('打开文件位置失败');
    }
  };

  const handleEnterFolder = async (folder: FileInfo) => {
    if (!selectedShare || !folder.is_dir) return;
    const newPath = currentPath ? `${currentPath}/${folder.path}` : folder.path;
    await loadFiles(selectedShare, newPath);
  };

  const handleGoBack = async () => {
    if (!selectedShare || !currentPath) return;
    const parts = currentPath.split('/').filter(p => p);
    parts.pop();
    const newPath = parts.join('/');
    await loadFiles(selectedShare, newPath);
  };

  const handlePasswordConfirm = async () => {
    if (!pendingShare) return;
    if (!passwordInput) {
      message.error('请输入密码');
      return;
    }
    await openShare(pendingShare, passwordInput);
  };

  const handlePasswordCancel = () => {
    setShowPasswordModal(false);
    setPasswordInput('');
    setPendingShare(null);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatSize(bytesPerSecond)}/s`;
  };

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

  return (
    <div className="file-share-container">
      <div className="file-share-content">
        <div className="sidebar-tabs">
          <motion.div className={`sidebar-tab ${activeTab === 'local' ? 'active' : ''}`} onClick={() => setActiveTab('local')} whileHover={{ x: 4 }} whileTap={{ scale: 0.95 }} title="我的共享"><FolderIcon size={20} /></motion.div>
          <motion.div className={`sidebar-tab ${activeTab === 'remote' ? 'active' : ''}`} onClick={() => setActiveTab('remote')} whileHover={{ x: 4 }} whileTap={{ scale: 0.95 }} title="远程共享"><ShareIcon size={20} /></motion.div>
          <motion.div className={`sidebar-tab ${activeTab === 'transfers' ? 'active' : ''}`} onClick={() => setActiveTab('transfers')} whileHover={{ x: 4 }} whileTap={{ scale: 0.95 }} title="传输列表"><DownloadIcon size={20} />{downloads.filter(t => t.status === 'downloading' || t.status === 'pending').length > 0 && <span className="transfer-badge">{downloads.filter(t => t.status === 'downloading' || t.status === 'pending').length}</span>}</motion.div>
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
                          <div className="share-meta">{share.password && '🔒 '}{share.expire_time && `⏰ ${formatTime(share.expire_time)}`}</div>
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
                      {remoteShares.map((remoteShare) => (
                        <motion.div key={`${remoteShare.owner_ip}_${remoteShare.share.id}`} className="share-item remote-share-item clickable" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} onClick={() => handleBrowseShare(remoteShare)}>
                          <FolderIcon size={24} className="share-icon" />
                          <div className="share-info">
                            <div className="share-name">{remoteShare.share.name}</div>
                            <div className="share-meta">{remoteShare.owner_name}{remoteShare.share.password && ' · 🔒'}{remoteShare.share.expire_time && ` · ⏰ ${formatTime(remoteShare.share.expire_time)}`}</div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {remoteShares.length === 0 && <div className="empty-state"><ShareIcon size={48} /><p>暂无可用的共享文件夹</p></div>}
                  </div>
                ) : (
                  <div className="file-browser">
                    <div className="browser-header">
                      <Button size="small" onClick={handleGoBack} disabled={!currentPath} icon={<BackIcon size={16} />} title="返回上级" />
                      <span className="current-path">{selectedShare.share.name}/{currentPath || ''}</span>
                      <Button size="small" onClick={() => setSelectedShare(null)} icon={<CloseIcon size={16} />} title="关闭" />
                    </div>
                    <div className="file-list">
                      {loadingFiles ? <div className="loading-state">加载中...</div> : (
                        <AnimatePresence>
                          {files.map((file) => (
                            <motion.div key={file.path} className={`file-item ${file.is_dir ? 'clickable' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => file.is_dir && handleEnterFolder(file)}>
                              {file.is_dir ? <FolderIcon size={20} className="file-icon" /> : <FileIcon size={20} className="file-icon" />}
                              <div className="file-info">
                                <div className="file-name">{file.name}</div>
                                <div className="file-meta">{!file.is_dir && formatSize(file.size)}</div>
                              </div>
                              {!file.is_dir && <Button size="small" icon={<DownloadIcon size={14} />} onClick={(e) => { e.stopPropagation(); handleDownloadFile(file); }} title="下载" />}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      )}
                      {!loadingFiles && files.length === 0 && <div className="empty-state"><FolderIcon size={48} /><p>文件夹为空</p></div>}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
            {activeTab === 'transfers' && (
              <motion.div key="transfers" className="tab-content" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}>
                <div className="transfers-subtabs">
                  <motion.div className={`subtab ${transfersTab === 'downloading' ? 'active' : ''}`} onClick={() => setTransfersTab('downloading')} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }}>正在下载{downloads.filter(t => t.status === 'downloading' || t.status === 'pending').length > 0 && <span className="subtab-badge">{downloads.filter(t => t.status === 'downloading' || t.status === 'pending').length}</span>}</motion.div>
                  <motion.div className={`subtab ${transfersTab === 'completed' ? 'active' : ''}`} onClick={() => setTransfersTab('completed')} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }}>已完成{downloads.filter(t => t.status === 'completed').length > 0 && <span className="subtab-badge">{downloads.filter(t => t.status === 'completed').length}</span>}</motion.div>
                </div>
                <div className="transfer-list">
                  <AnimatePresence mode="wait">
                    {transfersTab === 'downloading' && (
                      <motion.div key="downloading" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
                        {downloads.filter(t => t.status === 'downloading' || t.status === 'pending').map((task) => (
                          <motion.div key={task.id} className="transfer-item" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            <FileIcon size={20} className="transfer-icon" />
                            <div className="transfer-info">
                              <div className="transfer-name">{task.file_name}</div>
                              <Progress percent={Math.round(task.progress)} size="small" status="active" />
                              <div className="transfer-meta">
                                <span className="transfer-size">{formatSize(task.downloaded)} / {formatSize(task.file_size)}</span>
                                {task.status === 'downloading' && task.speed > 0 && <span className="transfer-speed">{formatSpeed(task.speed)}</span>}
                              </div>
                            </div>
                            <Button size="small" danger onClick={() => handleCancelDownload(task.id)} title="取消下载">取消</Button>
                          </motion.div>
                        ))}
                        {downloads.filter(t => t.status === 'downloading' || t.status === 'pending').length === 0 && <div className="empty-state"><DownloadIcon size={48} /><p>暂无正在下载的任务</p></div>}
                      </motion.div>
                    )}
                    {transfersTab === 'completed' && (
                      <motion.div key="completed" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
                        {downloads.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled').map((task) => (
                          <motion.div key={task.id} className={`transfer-item ${task.status === 'completed' ? 'clickable' : ''}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} onClick={() => task.status === 'completed' && handleOpenFileLocation(task)} title={task.status === 'completed' ? '点击打开文件位置' : ''}>
                            <FileIcon size={20} className="transfer-icon" />
                            <div className="transfer-info">
                              <div className="transfer-name">{task.file_name}</div>
                              <Progress percent={Math.round(task.progress)} size="small" status={task.status === 'completed' ? 'success' : task.status === 'failed' ? 'exception' : 'normal'} />
                              <div className="transfer-meta">
                                {task.status === 'completed' && `${formatSize(task.file_size)} · 已完成`}
                                {task.status === 'failed' && `失败: ${task.error || '未知错误'}`}
                                {task.status === 'cancelled' && '已取消'}
                              </div>
                            </div>
                            <Button size="small" onClick={(e) => { e.stopPropagation(); handleRemoveTask(task.id); }} title="删除记录">删除</Button>
                          </motion.div>
                        ))}
                        {downloads.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled').length === 0 && <div className="empty-state"><DownloadIcon size={48} /><p>暂无已完成的下载</p></div>}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {showAddShare && <AddShareDialog visible={showAddShare} onClose={() => setShowAddShare(false)} onSuccess={() => { setShowAddShare(false); loadLocalShares(); }} />}
      <Modal title="输入密码" open={showPasswordModal} onOk={handlePasswordConfirm} onCancel={handlePasswordCancel} okText="确定" cancelText="取消" centered width={400} maskClosable={false} destroyOnClose={true}>
        <div style={{ marginTop: 16 }}><Input.Password autoFocus value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} onPressEnter={handlePasswordConfirm} placeholder="请输入共享密码" /></div>
      </Modal>
    </div>
  );
};

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
        owner_id: 'local',
        created_at: Math.floor(Date.now() / 1000),
      };
      await fileShareService.addShare(share);
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
      </div>
    </Modal>
  );
};
