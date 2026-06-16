import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Input, Space, message, Popconfirm, Switch } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import './FavoriteLobbyManager.css';

export interface FavoriteLobby {
  id: string;
  name: string;
  password: string;
  playerName?: string;
  useDomain?: boolean;
  createdAt: number;
}

interface FavoriteLobbyManagerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (lobby: FavoriteLobby) => void;
}

const STORAGE_KEY = 'mctier_favorite_lobbies';

/**
 * 常用大厅信息管理组件
 */
export const FavoriteLobbyManager: React.FC<FavoriteLobbyManagerProps> = ({
  visible,
  onClose,
  onSelect,
}) => {
  useTranslation();
  const [favorites, setFavorites] = useState<FavoriteLobby[]>([]);
  const [editingFavorite, setEditingFavorite] = useState<FavoriteLobby | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form] = Form.useForm<{ name: string; password: string; playerName?: string; useDomain?: boolean }>();
  const [showPassword, setShowPassword] = useState(false);

  // 从 localStorage 加载常用大厅列表
  useEffect(() => {
    const loadFavorites = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          setFavorites(Array.isArray(parsed) ? parsed : []);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
      setFavorites(newFavorites);
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
                password: values.password,
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
          password: values.password,
          playerName: values.playerName,
          useDomain: values.useDomain ?? false,
          createdAt: Date.now(),
        };
        saveFavorites([...favorites, newFavorite]);
        message.success(tl('添加成功', 'Added'));
      }
      
      form.resetFields();
      setEditingFavorite(null);
      setShowAddForm(false);
      setShowPassword(false);
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

  // 选择常用大厅
  const handleSelectFavorite = (lobby: FavoriteLobby) => {
    onSelect(lobby);
    onClose();
    message.success(tl('已填入大厅信息', 'Lobby info filled'));
  };

  // 开始编辑
  const handleStartEdit = (lobby: FavoriteLobby) => {
    setEditingFavorite(lobby);
    form.setFieldsValue({
      name: lobby.name,
      password: lobby.password,
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
    setShowPassword(false);
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
                  label={tl('密码', 'Password')}
                  name="password"
                  rules={[
                    { required: true, message: tl('请输入密码', 'Enter a password') },
                    { min: 8, max: 32, message: tl('密码长度为 8-32 个字符', 'Password must be 8-32 characters') },
                    {
                      validator: (_, value) => {
                        if (!value) return Promise.resolve();
                        const hasLetter = /[a-zA-Z]/.test(value);
                        const hasDigit = /[0-9]/.test(value);
                        if (!hasLetter) {
                          return Promise.reject(new Error(tl('密码必须包含至少一个字母', 'Password must contain at least one letter')));
                        }
                        if (!hasDigit) {
                          return Promise.reject(new Error(tl('密码必须包含至少一个数字', 'Password must contain at least one digit')));
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <div style={{ position: 'relative' }}>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder={tl('输入密码（至少8个字符，包含字母和数字）', 'Password (min 8 chars, letters and digits)')}
                      style={{ paddingRight: '40px' }}
                      className="custom-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'rgba(255, 255, 255, 0.6)',
                        transition: 'color 0.2s',
                        zIndex: 10,
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)'}
                    >
                      {showPassword ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                      )}
                    </button>
                  </div>
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
            {favorites.map((item) => (
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
                      <span>{item.password.replace(/./g, '●')}</span>
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
                    <Popconfirm
                      title={tl('确定删除这个常用大厅吗？', 'Delete this favorite lobby?')}
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDeleteFavorite(item.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                      okText="确定"
                      cancelText="取消"
                    >
                      <motion.button
                        className="favorite-action-btn delete-btn"
                        onClick={(e) => e.stopPropagation()}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        title={tl('删除', 'Delete')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </motion.button>
                    </Popconfirm>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
