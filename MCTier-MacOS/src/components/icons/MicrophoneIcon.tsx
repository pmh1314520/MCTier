import React from 'react';

interface MicrophoneIconProps {
  enabled?: boolean;
  size?: number;
  className?: string;
}

/**
 * 麦克风图标组件
 * @param enabled - 麦克风是否开启
 * @param size - 图标大小（默认 24）
 * @param className - 自定义类名
 */
export const MicrophoneIcon: React.FC<MicrophoneIconProps> = ({
  enabled = true,
  size = 24,
  className = '',
}) => {
  if (enabled) {
    // 麦克风开启状态
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path
          d="M12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14Z"
          fill="currentColor"
        />
        <path
          d="M17 11C17 13.76 14.76 16 12 16C9.24 16 7 13.76 7 11H5C5 14.53 7.61 17.43 11 17.92V21H13V17.92C16.39 17.43 19 14.53 19 11H17Z"
          fill="currentColor"
        />
      </svg>
    );
  } else {
    // 麦克风关闭状态（带斜线）
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path
          d="M12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14Z"
          fill="currentColor"
          opacity="0.4"
        />
        <path
          d="M17 11C17 13.76 14.76 16 12 16C9.24 16 7 13.76 7 11H5C5 14.53 7.61 17.43 11 17.92V21H13V17.92C16.39 17.43 19 14.53 19 11H17Z"
          fill="currentColor"
          opacity="0.4"
        />
        <line
          x1="4"
          y1="4"
          x2="20"
          y2="20"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
};
