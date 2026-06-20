/**
 * Emoji表情选择器组件
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

// 常用 Emoji 分类（id 稳定，label 随语言翻译）
const EMOJI_CATEGORIES: { id: string; label: () => string; emojis: string[] }[] = [
  { id: 'smileys', label: () => tl('笑脸', 'Smileys'), emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙'] },
  { id: 'gestures', label: () => tl('手势', 'Gestures'), emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏'] },
  { id: 'emotions', label: () => tl('表情', 'Emotions'), emojis: ['🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑'] },
  { id: 'symbols', label: () => tl('符号', 'Symbols'), emojis: ['❤️', '💔', '💕', '💖', '💗', '💙', '💚', '💛', '🧡', '💜', '🖤', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💬', '👁️'] },
  { id: 'others', label: () => tl('其他', 'Others'), emojis: ['🎮', '🎯', '🎲', '🎰', '🎳', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓'] },
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>('smileys');

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    onClose();
  };

  const activeCat = EMOJI_CATEGORIES.find((c) => c.id === activeCategory) || EMOJI_CATEGORIES[0];

  return (
    <motion.div
      className="emoji-picker-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="emoji-picker"
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="emoji-picker-header">
          <div className="emoji-categories">
            {EMOJI_CATEGORIES.map((category) => (
              <button
                key={category.id}
                className={`emoji-category-btn ${activeCategory === category.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.label()}
              </button>
            ))}
          </div>
          <button className="emoji-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="emoji-grid">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              className="emoji-grid-content"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              {activeCat.emojis.map((emoji, index) => (
                <motion.button
                  key={`${emoji}-${index}`}
                  className="emoji-btn"
                  onClick={() => handleEmojiClick(emoji)}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                >
                  {emoji}
                </motion.button>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
};
