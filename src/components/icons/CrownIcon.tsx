import React from 'react';
import { tl } from '../../i18n';

interface CrownIconProps {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 房主皇冠图标 - 经典三峰皇冠造型
 * 采用通用、稳定的皇冠路径（尖角分明），底部加冠带。
 * color 默认金色；传入 currentColor 可用于按钮等场景。
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
      aria-label={tl('房主', 'Host')}
    >
      <title>{tl('房主', 'Host')}</title>
      {/* 冠体：左峰-谷-中峰-谷-右峰，底部平 */}
      <path
        d="M5 16.5L2.7 6.2l5.6 3.9L12 3.8l3.7 6.3 5.6-3.9L19 16.5z"
        strokeLinejoin="round"
        strokeWidth="0.6"
        stroke={color}
      />
      {/* 冠带（底座） */}
      <rect x="4.6" y="17.8" width="14.8" height="2.6" rx="1.1" />
    </svg>
  );
};
