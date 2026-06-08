import React from 'react';

interface CrownIconProps {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 房主皇冠图标 - 精致渐变版
 * 用于标识大厅房主
 */
export const CrownIcon: React.FC<CrownIconProps> = ({
  size = 14,
  color = '#ffd666',
  className,
  style,
}) => {
  const gradId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-label="房主"
    >
      <title>房主</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>
      {/* 冠体 */}
      <path
        d="M3 8.5l3.2 2.6L9.4 6l2.6 4.2L14.6 6l3.2 5.1L21 8.5l-1.4 8.1a1 1 0 0 1-.99.84H5.39a1 1 0 0 1-.99-.84L3 8.5z"
        fill={`url(#${gradId})`}
        stroke={color}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* 底座 */}
      <rect x="5.2" y="18.2" width="13.6" height="2.2" rx="1" fill={`url(#${gradId})`} />
      {/* 三颗宝石点缀 */}
      <circle cx="6.4" cy="8" r="1.1" fill="#fff3c4" />
      <circle cx="12" cy="5.4" r="1.2" fill="#fff3c4" />
      <circle cx="17.6" cy="8" r="1.1" fill="#fff3c4" />
    </svg>
  );
};
