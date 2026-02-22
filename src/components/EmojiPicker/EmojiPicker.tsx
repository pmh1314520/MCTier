/**
 * Emoji表情选择器组件
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

// 常用Emoji分类
const EMOJI_CATEGORIES = {
  '笑脸': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙'],
  '手势': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏'],
  '表情': ['🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑'],
  '符号': ['❤️', '💔', '💕', '💖', '💗', '💙', '💚', '💛', '🧡', '💜', '🖤', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💬', '👁️'],
  '其他': ['🎮', '🎯', '🎲', '🎰', '🎳', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓'],
};

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState<string>('笑脸');

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    onClose();
  };

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
            {Object.keys(EMOJI_CATEGORIES).map((category) => (
              <button
                key={category}
                className={`emoji-category-btn ${activeCategory === category ? 'active' : ''}`}
                onClick={() => setActiveCategory(category)}
              >
                {category}
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
              {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, index) => (
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
