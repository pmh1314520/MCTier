import React from 'react';

interface VolumeIconProps {
  muted?: boolean;
  size?: number;
  className?: string;
}

/**
 * 音量图标组件
 * @param muted - 是否静音
 * @param size - 图标大小（默认 24）
 * @param className - 自定义类名
 */
export const VolumeIcon: React.FC<VolumeIconProps> = ({
  muted = false,
  size = 24,
  className = '',
}) => {
  if (muted) {
    // 静音状态
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
          d="M3 9V15H7L12 20V4L7 9H3Z"
          fill="currentColor"
          opacity="0.4"
        />
        <line
          x1="16"
          y1="9"
          x2="22"
          y2="15"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="22"
          y1="9"
          x2="16"
          y2="15"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  } else {
    // 正常音量状态
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
          d="M3 9V15H7L12 20V4L7 9H3Z"
          fill="currentColor"
        />
        <path
          d="M16.5 12C16.5 10.23 15.48 8.71 14 7.97V16.02C15.48 15.29 16.5 13.77 16.5 12Z"
          fill="currentColor"
        />
        <path
          d="M14 3.23V5.29C16.89 6.15 19 8.83 19 12C19 15.17 16.89 17.85 14 18.71V20.77C18.01 19.86 21 16.28 21 12C21 7.72 18.01 4.14 14 3.23Z"
          fill="currentColor"
        />
      </svg>
    );
  }
};
