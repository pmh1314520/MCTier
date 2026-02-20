import React from 'react';

interface MicIconProps {
  enabled?: boolean;
  size?: number;
  className?: string;
}

export const MicIcon: React.FC<MicIconProps> = ({ 
  enabled = false, 
  size = 24,
  className = '' 
}) => {
  if (enabled) {
    // 麦克风开启图标
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
          d="M17 11C17 14.76 13.76 18 10 18V20C14.97 20 19 15.97 19 11H17Z"
          fill="currentColor"
        />
        <path
          d="M7 11H5C5 15.97 9.03 20 14 20V18C10.24 18 7 14.76 7 11Z"
          fill="currentColor"
        />
        <path
          d="M11 22H13V18H11V22Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  // 麦克风关闭图标（简洁的斜线设计）
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 麦克风主体 */}
      <path
        d="M12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14Z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M17 11C17 14.76 13.76 18 10 18V20C14.97 20 19 15.97 19 11H17Z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M7 11H5C5 15.97 9.03 20 14 20V18C10.24 18 7 14.76 7 11Z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M11 22H13V18H11V22Z"
        fill="currentColor"
        opacity="0.5"
      />
      {/* 斜线 */}
      <line
        x1="4"
        y1="4"
        x2="20"
        y2="20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
};
