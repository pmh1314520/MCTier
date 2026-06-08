import React from 'react';

interface CrownIconProps {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 房主皇冠图标 - 简洁现代的线面结合设计
 * 三峰冠体 + 独立底座，圆角收边，单色，契合 MCTier 暗色 UI 主题。
 * color 默认金色用于"房主"标识；传入 currentColor 可用于按钮等场景。
 */
export const CrownIcon: React.FC<CrownIconProps> = ({
  size = 14,
  color = '#ffce5c',
  className,
  style,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      className={className}
      style={style}
      aria-label="房主"
    >
      <title>房主</title>
      {/* 冠体：三峰两谷，圆角 */}
      <path
        d="M3.4 8.1c.5-.36 1.2-.06 1.32.55l.86 4.2c.08.4.5.62.87.46l4.02-1.78c.31-.14.5-.46.5-.8V5.6c0-.78.86-1.2 1.46-.7l.06.06 3.32 4.04c.25.3.69.36 1 .12l2.1-1.6c.55-.42 1.33.02 1.27.71l-.66 7.06a1.4 1.4 0 0 1-1.4 1.27H6.04a1.4 1.4 0 0 1-1.39-1.2L3.38 8.86a.8.8 0 0 1 .02-.76z"
        stroke={color}
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
      {/* 底座 */}
      <rect x="5.6" y="18.4" width="12.8" height="2.2" rx="1.1" />
    </svg>
  );
};
