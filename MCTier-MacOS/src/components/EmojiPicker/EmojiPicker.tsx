import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  LoadingOutlined,
  MoreOutlined,
  PictureOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { tl } from '../../i18n';
import { showFeedback } from '../../services/ui/feedback';
import {
  createEmojiCategory,
  deleteCustomEmoji,
  deleteEmojiCategory,
  getEmojiCategories,
  getCustomEmojiItems,
  getEmojiDestinationCategories,
  getRecentEmojiIds,
  importEmojiFiles,
  isCustomEmoji,
  renameEmojiCategory,
  rememberRecentEmoji,
  syncBuiltinEmojiItems,
  updateCustomEmoji,
  type EmojiCategory,
  type EmojiItem,
  type BuiltinEmojiProgress,
} from '../../services/emoji/emojiLibrary';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onSelect: (emoji: EmojiItem) => void | Promise<void>;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect }) => {
  const [categories, setCategories] = useState<EmojiCategory[]>(() => getEmojiCategories());
  const [items, setItems] = useState<EmojiItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('recent');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [builtinSyncing, setBuiltinSyncing] = useState(false);
  const [builtinError, setBuiltinError] = useState<string | null>(null);
  const [builtinProgress, setBuiltinProgress] = useState<BuiltinEmojiProgress>({
    downloaded: 0,
    total: 0,
  });
  const [managedEmoji, setManagedEmoji] = useState<EmojiItem | null>(null);
  const [managedEmojiName, setManagedEmojiName] = useState('');
  const [managedEmojiCategory, setManagedEmojiCategory] = useState('custom');
  const [confirmEmojiDelete, setConfirmEmojiDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshCustom = async () => {
    const custom = await getCustomEmojiItems();
    setItems((current) => [...current.filter((item) => item.builtin), ...custom]);
  };
  const loadBuiltin = async (retry = false, signal?: AbortSignal) => {
    setBuiltinSyncing(true);
    setBuiltinError(null);
    try {
      const builtin = await syncBuiltinEmojiItems(retry, setBuiltinProgress, signal);
      if (signal?.aborted) return;
      setItems((current) => [...builtin, ...current.filter((item) => !item.builtin)]);
    } catch (error) {
      if (!signal?.aborted) setBuiltinError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal?.aborted) setBuiltinSyncing(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    void refreshCustom();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (activeCategory !== 'builtin') return;
    const controller = new AbortController();
    void loadBuiltin(false, controller.signal);
    return () => controller.abort();
  }, [activeCategory]);

  const visibleItems = useMemo(() => {
    if (activeCategory !== 'recent')
      return items.filter((item) => item.categoryId === activeCategory);
    return getRecentEmojiIds()
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is EmojiItem => !!item);
  }, [activeCategory, items]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const category =
      activeCategory === 'recent' || activeCategory === 'builtin' ? 'custom' : activeCategory;
    const selected = Array.from(files);
    try {
      const imported = await importEmojiFiles(selected, category);
      await refreshCustom();
      setActiveCategory(category);
      const skipped = selected.length - imported;
      if (imported === selected.length) {
        showFeedback('success', tl(`已导入 ${imported} 个表情`, `Imported ${imported} emoji`));
      } else if (imported > 0) {
        showFeedback(
          'warning',
          tl(
            `已导入 ${imported} 个，${skipped} 个因格式、大小或容量限制被跳过`,
            `Imported ${imported}; ${skipped} skipped due to format, size, or capacity limits`
          )
        );
      } else {
        showFeedback(
          'error',
          tl(
            '没有可导入的图片，请检查格式、大小或表情库容量',
            'No images were imported. Check their format, size, or library capacity'
          )
        );
      }
    } catch {
      showFeedback('error', tl('导入失败，请重试', 'Import failed. Please try again'));
    } finally {
      setBusy(false);
    }
  };

  const categoryErrorText = (error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    if (code === 'CATEGORY_DUPLICATE')
      return tl('已有同名分类', 'A category with this name already exists');
    return tl('请输入有效的分类名称', 'Enter a valid category name');
  };

  const addCategory = () => {
    try {
      const category = createEmojiCategory(categoryName);
      setCategories(getEmojiCategories());
      setActiveCategory(category.id);
      setCategoryName('');
      setCreating(false);
      showFeedback('success', tl('分类已创建', 'Category created'));
    } catch (error) {
      showFeedback('error', categoryErrorText(error));
    }
  };

  const active = categories.find((category) => category.id === activeCategory);
  const beginEdit = () => {
    if (!active || active.builtin) return;
    setCategoryName(active.name);
    setCreating(false);
    setEditing(true);
  };
  const renameCategory = () => {
    try {
      renameEmojiCategory(activeCategory, categoryName);
      setCategories(getEmojiCategories());
      setEditing(false);
      setCategoryName('');
      showFeedback('success', tl('分类已重命名', 'Category renamed'));
    } catch (error) {
      showFeedback('error', categoryErrorText(error));
    }
  };
  const removeCategory = async () => {
    try {
      await deleteEmojiCategory(activeCategory);
      await refreshCustom();
      setCategories(getEmojiCategories());
      setActiveCategory('custom');
      setEditing(false);
      setCategoryName('');
      showFeedback(
        'success',
        tl('分类已删除，其中的表情已移至自定义', 'Category deleted; its emoji were moved to Custom')
      );
    } catch {
      showFeedback(
        'error',
        tl('删除分类失败，请重试', 'Failed to delete category. Please try again')
      );
    }
  };

  const beginEmojiManagement = (emoji: EmojiItem) => {
    if (!isCustomEmoji(emoji)) return;
    setManagedEmoji(emoji);
    setManagedEmojiName(emoji.name);
    setManagedEmojiCategory(emoji.categoryId);
    setConfirmEmojiDelete(false);
  };
  const closeEmojiManagement = () => {
    setManagedEmoji(null);
    setConfirmEmojiDelete(false);
  };
  const saveManagedEmoji = async () => {
    if (!managedEmoji) return;
    try {
      await updateCustomEmoji(managedEmoji.id, managedEmojiName, managedEmojiCategory);
      await refreshCustom();
      closeEmojiManagement();
      showFeedback('success', tl('表情信息已保存', 'Emoji changes saved'));
    } catch {
      showFeedback(
        'error',
        tl('保存失败，请检查名称和目标分类', 'Save failed. Check the name and destination category')
      );
    }
  };
  const removeManagedEmoji = async () => {
    if (!managedEmoji) return;
    if (!confirmEmojiDelete) {
      setConfirmEmojiDelete(true);
      return;
    }
    try {
      await deleteCustomEmoji(managedEmoji.id);
      await refreshCustom();
      closeEmojiManagement();
      showFeedback('success', tl('表情已删除', 'Emoji deleted'));
    } catch {
      showFeedback('error', tl('删除表情失败，请重试', 'Failed to delete emoji. Please try again'));
    }
  };

  return (
    <motion.section
      className="emoji-picker"
      role="region"
      aria-label={tl('表情库', 'Emoji library')}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="emoji-category-bar">
        <nav
          className="emoji-categories"
          aria-label={tl('表情分类', 'Emoji categories')}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.currentTarget.scrollLeft += event.deltaY;
            event.preventDefault();
          }}
        >
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activeCategory === category.id ? 'active' : ''}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
        </nav>
        <div className="emoji-category-actions">
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            accept="image/gif,image/png,image/jpeg,image/webp"
            onChange={(event) => {
              void upload(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            className="emoji-category-add"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            title={tl('批量导入', 'Import images')}
            aria-label={tl('批量导入', 'Import images')}
          >
            {busy ? <LoadingOutlined /> : <UploadOutlined />}
          </button>
          <button
            type="button"
            className="emoji-category-add"
            onClick={() => setCreating(true)}
            aria-label={tl('新建分类', 'New category')}
          >
            <FolderAddOutlined />
          </button>
          {active && !active.builtin && (
            <button
              type="button"
              className="emoji-category-add"
              onClick={beginEdit}
              aria-label={tl('管理当前分类', 'Manage category')}
            >
              <EditOutlined />
            </button>
          )}
        </div>
      </div>
      {creating && (
        <div className="emoji-category-editor">
          <input
            autoFocus
            value={categoryName}
            maxLength={20}
            placeholder={tl('分类名称', 'Category name')}
            onChange={(event) => setCategoryName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addCategory();
              if (event.key === 'Escape') setCreating(false);
            }}
          />
          <button type="button" onClick={addCategory}>
            {tl('创建', 'Create')}
          </button>
          <button type="button" onClick={() => setCreating(false)}>
            <CloseOutlined />
          </button>
        </div>
      )}
      {editing && (
        <div className="emoji-category-editor">
          <input
            autoFocus
            value={categoryName}
            maxLength={20}
            placeholder={tl('分类名称', 'Category name')}
            onChange={(event) => setCategoryName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') renameCategory();
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" onClick={renameCategory}>
            {tl('重命名', 'Rename')}
          </button>
          <button
            type="button"
            className="emoji-category-delete"
            onClick={() => void removeCategory()}
            aria-label={tl('删除分类', 'Delete category')}
          >
            <DeleteOutlined />
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            <CloseOutlined />
          </button>
        </div>
      )}
      <div className="emoji-grid">
        {visibleItems.map((emoji) => (
          <div
            key={emoji.id}
            className="emoji-tile"
            onContextMenu={(event) => {
              if (!isCustomEmoji(emoji)) return;
              event.preventDefault();
              beginEmojiManagement(emoji);
            }}
          >
            <button
              className="emoji-btn"
              type="button"
              title={emoji.name}
              onClick={async () => {
                try {
                  await onSelect(emoji);
                  rememberRecentEmoji(emoji.id);
                  // Keep the panel open for consecutive sends and refresh Recent.
                  setItems((current) => [...current]);
                } catch {
                  // The caller owns the user-facing send error so it can include chat context.
                }
              }}
            >
              <img src={emoji.dataUrl} alt={emoji.name} loading="lazy" draggable={false} />
            </button>
            {isCustomEmoji(emoji) && (
              <button
                className="emoji-manage-button"
                type="button"
                aria-label={tl(`管理 ${emoji.name}`, `Manage ${emoji.name}`)}
                onClick={(event) => {
                  event.stopPropagation();
                  beginEmojiManagement(emoji);
                }}
              >
                <MoreOutlined />
              </button>
            )}
          </div>
        ))}
        {!visibleItems.length && activeCategory === 'builtin' && builtinSyncing && (
          <div className="emoji-empty">
            <LoadingOutlined className="emoji-sync-spinner" />
            <strong>{tl('正在解压内置表情...', 'Extracting built-in emoji...')}</strong>
            {builtinProgress.total > 0 && (
              <>
                <div
                  className="emoji-download-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={builtinProgress.total}
                  aria-valuenow={builtinProgress.downloaded}
                >
                  <i
                    style={{
                      width: `${Math.min(100, (builtinProgress.downloaded / builtinProgress.total) * 100)}%`,
                    }}
                  />
                </div>
                <span>
                  {tl(
                    `已准备 ${builtinProgress.downloaded} / ${builtinProgress.total}`,
                    `${builtinProgress.downloaded} / ${builtinProgress.total} extracted`
                  )}
                </span>
              </>
            )}
            <span>
              {tl(
                '首次使用时解压到本地，之后无需重复解压',
                'Extracted locally on first use and reused afterwards'
              )}
            </span>
          </div>
        )}
        {!visibleItems.length &&
          activeCategory === 'builtin' &&
          !builtinSyncing &&
          builtinError && (
            <div className="emoji-empty">
              <PictureOutlined />
              <strong>{tl('内置表情准备失败', 'Built-in emoji preparation failed')}</strong>
              <span>{builtinError}</span>
              <button
                className="emoji-retry-button"
                type="button"
                onClick={() => void loadBuiltin(true)}
              >
                <ReloadOutlined />
                {tl('重试', 'Retry')}
              </button>
            </div>
          )}
        {!visibleItems.length &&
          (activeCategory !== 'builtin' || (!builtinSyncing && !builtinError)) && (
            <div className="emoji-empty">
              <PictureOutlined />
              <strong>
                {activeCategory === 'builtin'
                  ? tl('内置表情资源尚未安装', 'Built-in emoji are not installed')
                  : tl('这里还没有表情', 'No emoji here yet')}
              </strong>
              <span>
                {activeCategory !== 'builtin' &&
                  tl(
                    '上传图片，或在图片消息菜单中添加',
                    'Upload images or add one from an image message'
                  )}
              </span>
            </div>
          )}
      </div>
      {managedEmoji && (
        <div className="emoji-item-manager-backdrop" onClick={closeEmojiManagement}>
          <section
            className="emoji-item-manager"
            role="dialog"
            aria-label={tl('管理表情', 'Manage emoji')}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{tl('管理表情', 'Manage emoji')}</strong>
              <button
                className="emoji-icon-button"
                type="button"
                onClick={closeEmojiManagement}
                aria-label={tl('关闭', 'Close')}
              >
                <CloseOutlined />
              </button>
            </header>
            <div className="emoji-item-manager-content">
              <img src={managedEmoji.dataUrl} alt={managedEmoji.name} />
              <label>
                <span>{tl('名称', 'Name')}</span>
                <input
                  value={managedEmojiName}
                  maxLength={80}
                  onChange={(event) => setManagedEmojiName(event.target.value)}
                />
              </label>
              <div className="emoji-destination">
                <span>{tl('移动到', 'Move to')}</span>
                <div>
                  {getEmojiDestinationCategories().map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={managedEmojiCategory === category.id ? 'active' : ''}
                      onClick={() => setManagedEmojiCategory(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <footer>
              <button
                type="button"
                className={`emoji-item-delete${confirmEmojiDelete ? ' confirming' : ''}`}
                onClick={() => void removeManagedEmoji()}
              >
                <DeleteOutlined />
                {confirmEmojiDelete
                  ? tl('再次点击确认删除', 'Click again to delete')
                  : tl('删除表情', 'Delete emoji')}
              </button>
              <button
                type="button"
                className="emoji-item-save"
                disabled={!managedEmojiName.trim()}
                onClick={() => void saveManagedEmoji()}
              >
                {tl('保存', 'Save')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </motion.section>
  );
};
