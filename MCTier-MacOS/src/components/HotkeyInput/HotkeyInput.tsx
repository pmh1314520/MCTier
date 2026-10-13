import React, { useState, useEffect, useRef } from 'react';
import { Input } from 'antd';
import { tl } from '../../i18n';
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
  placeholder = tl('点击录制快捷键', 'Click to record hotkey'),
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
    if (e.altKey) keys.push(/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Option' : 'Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push(/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Command' : 'Meta');

    // 主键：优先用物理键位 e.code，避免 macOS 上 Option+字母 组合出带音标的字符
    // （例如 Option+A 的 e.key 是 'å'），否则归一化后 Tauri 无法解析、注册失败。
    let key = e.key;
    const codeLetter = /^Key([A-Z])$/.exec(e.code);
    const codeDigit = /^Digit([0-9])$/.exec(e.code);
    if (codeLetter) {
      key = codeLetter[1];
    } else if (codeDigit) {
      key = codeDigit[1];
    }
    
    // 排除单独的修饰键
    if (!['Control', 'Alt', 'Shift', 'Meta', 'Command', 'Option'].includes(key)) {
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
    if (keys.length > 0 && !['Ctrl', 'Alt', 'Shift', 'Meta', 'Command', 'Option'].includes(keys[keys.length - 1])) {
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
    setDisplayValue(tl('按下快捷键...', 'Press keys...'));
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
