import React, { useState, useEffect, useRef } from 'react';
import { Input } from 'antd';
import './HotkeyInput.css';

interface HotkeyInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * 快捷键输入组件
 * 支持录制键盘快捷键
 */
export const HotkeyInput: React.FC<HotkeyInputProps> = ({
  value = '',
  onChange,
  placeholder = '点击录制快捷键',
  disabled = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  // 处理键盘按下事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecording || disabled) return;

    e.preventDefault();
    e.stopPropagation();

    const keys: string[] = [];

    // 修饰键
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Meta');

    // 主键
    const key = e.key;
    
    // 排除单独的修饰键
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      // 特殊键处理
      if (key === ' ') {
        keys.push('Space');
      } else if (key.length === 1) {
        keys.push(key.toUpperCase());
      } else {
        keys.push(key);
      }
    }

    // 至少需要一个非修饰键
    if (keys.length > 0 && !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(keys[keys.length - 1])) {
      const hotkey = keys.join('+');
      setDisplayValue(hotkey);
      setIsRecording(false);
      
      if (onChange) {
        onChange(hotkey);
      }
      
      // 失去焦点
      if (inputRef.current) {
        inputRef.current.blur();
      }
    }
  };

  // 处理焦点
  const handleFocus = () => {
    if (disabled) return;
    setIsRecording(true);
    setDisplayValue('按下快捷键...');
  };

  // 处理失焦
  const handleBlur = () => {
    setIsRecording(false);
    setDisplayValue(value);
  };

  // 清除快捷键
  const handleClear = () => {
    if (disabled) return;
    setDisplayValue('');
    if (onChange) {
      onChange('');
    }
  };

  return (
    <div className="hotkey-input-wrapper">
      <Input
        ref={inputRef}
        value={displayValue}
        placeholder={placeholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        readOnly
        disabled={disabled}
        className={`hotkey-input ${isRecording ? 'recording' : ''}`}
        suffix={
          displayValue && !disabled ? (
            <span
              className="hotkey-clear"
              onClick={handleClear}
              style={{ cursor: 'pointer', color: '#999' }}
            >
              ✕
            </span>
          ) : null
        }
      />
    </div>
  );
};
