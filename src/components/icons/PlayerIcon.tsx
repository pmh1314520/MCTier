import React from 'react';

interface PlayerIconProps {
  online?: boolean;
  size?: number;
  className?: string;
}

/**
 * 玩家状态图标组件
 * @param online - 是否在线
 * @param size - 图标大小（默认 24）
 * @param className - 自定义类名
 */
export const PlayerIcon: React.FC<PlayerIconProps> = ({
  online = true,
  size = 24,
  className = '',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 玩家头像 */}
      <circle
        cx="12"
        cy="8"
        r="4"
        fill="currentColor"
        opacity={online ? 1 : 0.4}
      />
      <path
        d="M12 14C8.13 14 5 16.13 5 18.75V20H19V18.75C19 16.13 15.87 14 12 14Z"
        fill="currentColor"
        opacity={online ? 1 : 0.4}
      />
      {/* 在线状态指示器 */}
      {online && (
        <circle
          cx="18"
          cy="18"
          r="3"
          fill="#52c41a"
          stroke="#fff"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
};
