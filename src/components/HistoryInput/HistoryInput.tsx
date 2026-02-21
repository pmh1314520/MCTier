import React, { useState, useEffect, useRef } from 'react';
import { Input } from 'antd';
import type { InputProps, InputRef } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import './HistoryInput.css';

interface HistoryInputProps extends Omit<InputProps, 'onChange'> {
  value?: string;
  onChange?: (value: string) => void;
  historyKey: string;
  maxHistory?: number;
}

/**
 * 带历史记录的输入框组件
 * 支持保存和显示输入历史
 */
export const HistoryInput: React.FC<HistoryInputProps> = ({
  value,
  onChange,
  historyKey,
  maxHistory = 10,
  ...inputProps
}) => {
  const [showHistory, setShowHistory] = useState(false);
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

  return (
    <div className="history-input-container" ref={containerRef}>
      <Input
        {...inputProps}
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        autoComplete="off"
      />
      
      <AnimatePresence>
        {showHistory && filteredHistory.length > 0 && (
          <motion.div
            className="history-dropdown"
            initial={{ y: -10 }}
            animate={{ y: 0 }}
            exit={{ y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* 真实的不透明背景层 */}
            <div className="history-dropdown-bg"></div>
            
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
                <div
                  key={index}
                  className="history-item"
                  onClick={() => handleSelectHistory(item)}
                >
                  {item}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
