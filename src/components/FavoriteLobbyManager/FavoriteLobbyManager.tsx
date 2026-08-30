import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Input, Space, App, Switch } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { isSafeServerNode, isSafeSignalingServer, sanitizeUntrustedText } from '../../security/trustBoundary';
import './FavoriteLobbyManager.css';

export interface FavoriteLobby {
  id: string;
  name: string;
  playerName?: string;
  useDomain?: boolean;
  serverNode?: string;
  signalingServer?: string;
  createdAt: number;
  /** 使用次数（每次一键填入/加入 +1） */
  useCount?: number;
  /** 上次使用时间戳 */
  lastUsedAt?: number;
}

interface FavoriteLobbyManagerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (lobby: FavoriteLobby) => void;
  defaultServerNode?: string;
  defaultSignalingServer?: string;
}

const STORAGE_KEY = 'mctier_favorite_lobbies';

function normalizeFavorite(value: unknown): FavoriteLobby | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = sanitizeUntrustedText(item.name, 64).trim();
  const id = sanitizeUntrustedText(item.id, 128).trim();
  if (!name || !id) return null;
  const playerName = sanitizeUntrustedText(item.playerName, 64).trim();
  const serverNode = typeof item.serverNode === 'string' && isSafeServerNode(item.serverNode) && item.serverNode !== 'custom'
    ? item.serverNode.trim()
    : undefined;
  const signalingServer = typeof item.signalingServer === 'string' && isSafeSignalingServer(item.signalingServer)
    ? item.signalingServer.trim()
    : undefined;
  const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.createdAt)))
    : Date.now();
  const useCount = typeof item.useCount === 'number' && Number.isFinite(item.useCount)
    ? Math.max(0, Math.min(1_000_000, Math.trunc(item.useCount)))
    : 0;
  const lastUsedAt = typeof item.lastUsedAt === 'number' && Number.isFinite(item.lastUsedAt)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.lastUsedAt)))
    : undefined;
  return {
    id,
    name,
    ...(playerName ? { playerName } : {}),
    ...(item.useDomain === true ? { useDomain: true } : {}),
    ...(serverNode ? { serverNode } : {}),
    ...(signalingServer ? { signalingServer } : {}),
    createdAt,
    useCount,
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
  };
}

/**
 * 常用大厅信息管理组件
 */
export const FavoriteLobbyManager: React.FC<FavoriteLobbyManagerProps> = ({
  visible,
  onClose,
  onSelect,
  defaultServerNode,
  defaultSignalingServer,
}) => {
  useTranslation();
  // hook 版 message/modal：确认弹层置顶可点击，避免内嵌 Popconfirm 在 Modal 内被遮挡而点击无反应。
  const { message, modal } = App.useApp();
  const [favorites, setFavorites] = useState<FavoriteLobby[]>([]);
  const [editingFavorite, setEditingFavorite] = useState<FavoriteLobby | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form] = Form.useForm<{ name: string; playerName?: string; useDomain?: boolean }>();

  // 从 localStorage 加载常用大厅列表
  useEffect(() => {
    const loadFavorites = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          const normalized = Array.isArray(parsed)
            ? parsed.flatMap((item: unknown) => {
                const favorite = normalizeFavorite(item);
                return favorite ? [favorite] : [];
              })
            : [];
          setFavorites(normalized);
          // Rewrite legacy entries to remove persisted passwords and malformed
          // fields immediately, even if the user never edits a favorite.
          localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }
      } catch (error) {
        console.error('加载常用大厅列表失败:', error);
      }
    };

    if (visible) {
      loadFavorites();
    }
  }, [visible]);

  // 保存常用大厅列表到 localStorage
  const saveFavorites = (newFavorites: FavoriteLobby[]) => {
    try {
      const normalized = newFavorites.flatMap((item) => {
        const favorite = normalizeFavorite(item);
        return favorite ? [favorite] : [];
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      setFavorites(normalized);
    } catch (error) {
      console.error('保存常用大厅列表失败:', error);
      message.error(tl('保存失败', 'Save failed'));
    }
  };

  // 添加或编辑常用大厅
  const handleSaveFavorite = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingFavorite) {
        // 编辑现有项
        const updated = favorites.map(fav =>
          fav.id === editingFavorite.id
          ? {
                ...fav, 
                name: values.name, 
                playerName: values.playerName,
                useDomain: values.useDomain ?? false
              }
            : fav
        );
        saveFavorites(updated);
        message.success(tl('修改成功', 'Saved'));
      } else {
        // 添加新项
        const newFavorite: FavoriteLobby = {
          id: `fav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: values.name,
          playerName: values.playerName,
          useDomain: values.useDomain ?? false,
          serverNode: defaultServerNode,
          signalingServer: defaultSignalingServer,
          createdAt: Date.now(),
        };
        saveFavorites([...favorites, newFavorite]);
        message.success(tl('添加成功', 'Added'));
      }
      
      form.resetFields();
      setEditingFavorite(null);
      setShowAddForm(false);
    } catch (error) {
      console.error('保存常用大厅失败:', error);
    }
  };

  // 删除常用大厅
  const handleDeleteFavorite = (id: string) => {
    const updated = favorites.filter(fav => fav.id !== id);
    saveFavorites(updated);
    message.success(tl('删除成功', 'Deleted'));
  };

  // 选择常用大厅（记录使用次数与时间，便于按最近使用排序）
  const handleSelectFavorite = (lobby: FavoriteLobby) => {
    const updated = favorites.map(fav =>
      fav.id === lobby.id
        ? { ...fav, useCount: (fav.useCount ?? 0) + 1, lastUsedAt: Date.now() }
        : fav
    );
    saveFavorites(updated);
    onSelect(lobby);
    onClose();
    message.success(tl('已填入大厅信息', 'Lobby info filled'));
  };

  // 展示排序：最近使用优先，其次按创建时间
  const sortedFavorites = [...favorites].sort((a, b) => {
    const la = a.lastUsedAt ?? 0;
    const lb = b.lastUsedAt ?? 0;
    if (lb !== la) return lb - la;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });

  const fmtLastUsed = (ts?: number): string => {
    if (!ts) return tl('从未使用', 'Never used');
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return tl('刚刚使用', 'Just now');
    if (min < 60) return tl(`${min} 分钟前`, `${min}m ago`);
    const h = Math.floor(min / 60);
    if (h < 24) return tl(`${h} 小时前`, `${h}h ago`);
    const d = Math.floor(h / 24);
    return tl(`${d} 天前`, `${d}d ago`);
  };

  // 开始编辑
  const handleStartEdit = (lobby: FavoriteLobby) => {
    setEditingFavorite(lobby);
    form.setFieldsValue({
      name: lobby.name,
      playerName: lobby.playerName,
      useDomain: lobby.useDomain ?? false,
    });
    setShowAddForm(true);
  };

  // 取消编辑
  const handleCancelEdit = () => {
    form.resetFields();
    setEditingFavorite(null);
    setShowAddForm(false);
  };

  return (
    <Modal
      title={tl('常用大厅信息', 'Favorite Lobbies')}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={500}
      centered
      className="favorite-lobby-modal"
    >
      <div className="favorite-lobby-container">
        {/* 添加/编辑表单 */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              className="favorite-form-container"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Form form={form} layout="vertical">
                <Form.Item
                  label={tl('大厅名称', 'Lobby Name')}
                  name="name"
                  rules={[
                    { required: true, message: tl('请输入大厅名称', 'Enter a lobby name') },
                    { min: 4, max: 32, message: tl('大厅名称长度为 4-32 个字符', 'Lobby name must be 4-32 characters') },
                    {
                      pattern: /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/,
                      message: tl('大厅名称只能包含中文、字母、数字、下划线、连字符和空格', 'Lobby name may only contain letters, digits, underscore, hyphen and spaces'),
                    },
                  ]}
                >
                  <Input 
                    placeholder={tl('输入大厅名称', 'Enter lobby name')} 
                    onChange={(e) => {
                      const value = e.target.value;
                      const filtered = value.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-\s]/g, '');
                      if (filtered !== value) {
                        form.setFieldsValue({ name: filtered });
                      }
                    }}
                  />
                </Form.Item>
                <Form.Item
                  label={tl('玩家名称', 'Player Name')}
                  name="playerName"
                  rules={[
                    { required: true, message: tl('请输入玩家名称', 'Enter a player name') },
                    { whitespace: true, message: tl('玩家名称不能为空白字符', 'Player name cannot be blank') },
                    { min: 1, max: 8, message: tl('玩家名称长度为 1-8 个字', 'Player name must be 1-8 characters') },
                  ]}
                >
                  <Input placeholder={tl('输入玩家名称', 'Enter player name')} maxLength={8} />
                </Form.Item>
                <Form.Item
                  label={tl('开启虚拟域名', 'Enable virtual domain')}
                  name="useDomain"
                  valuePropName="checked"
                  initialValue={false}
                  rules={[{ required: true }]}
                >
                  <Switch />
                </Form.Item>
                <Form.Item>
                  <Space>
                    <Button type="primary" onClick={handleSaveFavorite}>
                      {editingFavorite ? tl('保存修改', 'Save') : tl('添加', 'Add')}
                    </Button>
                    <Button onClick={handleCancelEdit}>{tl('取消', 'Cancel')}</Button>
                  </Space>
                </Form.Item>
              </Form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 添加按钮 */}
        {!showAddForm && (
          <Button
            type="dashed"
            className="favorite-add-button"
            block
            onClick={() => setShowAddForm(true)}
            style={{ marginBottom: '16px' }}
          >
            {tl('+ 添加常用大厅', '+ Add favorite lobby')}
          </Button>
        )}

        {/* 常用大厅列表 */}
        {favorites.length === 0 && !showAddForm ? (
          <div className="empty-state">
            <p>{tl('暂无常用大厅', 'No favorite lobbies')}</p>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              {tl('点击上方按钮添加常用的大厅信息', 'Click the button above to add a favorite lobby')}
            </p>
          </div>
        ) : (
          <div className="favorites-list">
            {sortedFavorites.map((item) => (
              <div
                key={item.id}
                className="favorite-card"
                onClick={() => handleSelectFavorite(item)}
              >
                  <div className="favorite-card-content">
                    <div className="favorite-card-header">
                      <div className="favorite-card-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                          <polyline points="9 22 9 12 15 12 15 22"></polyline>
                        </svg>
                      </div>
                      <div className="favorite-card-title">{item.name}</div>
                    </div>
                    <div className="favorite-card-password">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                      <span>{tl('加入时需要重新输入密码', 'Password required when joining')}</span>
                    </div>
                    <div className="favorite-card-meta" style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4, display: 'flex', gap: 12 }}>
                      <span>{tl('使用', 'Used')} {item.useCount ?? 0} {tl('次', 'x')}</span>
                      <span>{fmtLastUsed(item.lastUsedAt)}</span>
                    </div>
                  </div>
                  <div className="favorite-card-actions" onClick={(e) => e.stopPropagation()}>
                    <motion.button
                      className="favorite-action-btn edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(item);
                      }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      title={tl('编辑', 'Edit')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </motion.button>
                    <motion.button
                      className="favorite-action-btn delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        modal.confirm({
                          title: tl('确定删除这个常用大厅吗？', 'Delete this favorite lobby?'),
                          okText: tl('确定', 'OK'),
                          cancelText: tl('取消', 'Cancel'),
                          okButtonProps: { danger: true },
                          centered: true,
                          onOk: () => handleDeleteFavorite(item.id),
                        });
                      }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      title={tl('删除', 'Delete')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </motion.button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
