import React, { useState, useEffect, useRef } from 'react';
import { Input } from 'antd';
import type { InputRef } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import './HistoryInput.css';
import './HistoryPasswordInput.css';

interface HistoryPasswordInputProps {
  value?: string;
  onChange?: (value: string) => void;
  historyKey: string;
  maxHistory?: number;
  placeholder?: string;
  size?: 'large' | 'middle' | 'small';
  disabled?: boolean;
}

/**
 * 带历史记录的密码输入框组件
 * 支持保存和显示输入历史，眼睛图标在输入框内部
 */
export const HistoryPasswordInput: React.FC<HistoryPasswordInputProps> = ({
  value,
  onChange,
  historyKey,
  maxHistory = 10,
  placeholder,
  size = 'large',
  disabled = false,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [filteredHistory, setFilteredHistory] = useState<string[]>([]);
  const inputRef = useRef<InputRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载历史记录
  useEffect(() => {
    const savedHistory = localStorage.getItem(`mctier_history_${historyKey}`);
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        console.error('加载历史记录失败:', e);
      }
    }
  }, [historyKey]);

  // 根据当前输入值过滤历史记录
  useEffect(() => {
    if (!value || value.trim() === '') {
      setFilteredHistory(history);
    } else {
      const filtered = history.filter(item =>
        item.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredHistory(filtered);
    }
  }, [value, history]);

  // 点击外部关闭历史记录
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };

    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHistory]);

  const handleFocus = () => {
    setShowHistory(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange?.(newValue);
  };

  const handleSelectHistory = (item: string) => {
    onChange?.(item);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const currentValue = e.target.value?.trim();
    
    // 保存到历史记录
    if (currentValue && currentValue.length > 0) {
      const newHistory = [
        currentValue,
        ...history.filter(item => item !== currentValue)
      ].slice(0, maxHistory);
      
      setHistory(newHistory);
      localStorage.setItem(`mctier_history_${historyKey}`, JSON.stringify(newHistory));
    }

    // 延迟关闭，以便点击历史记录项时能够触发
    setTimeout(() => {
      setShowHistory(false);
    }, 200);
  };

  const handleClearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory([]);
    localStorage.removeItem(`mctier_history_${historyKey}`);
    setShowHistory(false);
  };

  const togglePasswordVisibility = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPassword(!showPassword);
  };

  return (
    <div className="history-input-container" ref={containerRef}>
      <div className="password-input-wrapper">
        <Input
          ref={inputRef}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          size={size}
          disabled={disabled}
          autoComplete="off"
          className="password-input-field"
        />
        <button
          type="button"
          className="password-toggle-btn"
          onClick={togglePasswordVisibility}
          tabIndex={-1}
        >
          {showPassword ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      
      <AnimatePresence>
        {showHistory && filteredHistory.length > 0 && (
          <motion.div
            className="history-dropdown"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div className="history-header">
              <span className="history-title">历史记录</span>
              <button
                className="history-clear-btn"
                onClick={handleClearHistory}
                type="button"
              >
                清空
              </button>
            </div>
            <div className="history-list">
              {filteredHistory.map((item, index) => (
                <motion.div
                  key={index}
                  className="history-item"
                  onClick={() => handleSelectHistory(item)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  whileHover={{ backgroundColor: 'rgba(90, 148, 40, 0.15)' }}
                >
                  {'•'.repeat(Math.min(item.length, 20))}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
