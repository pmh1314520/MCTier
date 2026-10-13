import React from 'react';

interface ChevronIconProps {
  direction?: 'up' | 'down' | 'left' | 'right';
  size?: number;
  className?: string;
}

/**
 * 箭头图标组件（用于收起/展开）
 * @param direction - 箭头方向
 * @param size - 图标大小（默认 24）
 * @param className - 自定义类名
 */
export const ChevronIcon: React.FC<ChevronIconProps> = ({
  direction = 'down',
  size = 24,
  className = '',
}) => {
  const rotations = {
    up: 180,
    down: 0,
    left: 90,
    right: -90,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: `rotate(${rotations[direction]}deg)` }}
    >
      <path
        d="M7 10L12 15L17 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
