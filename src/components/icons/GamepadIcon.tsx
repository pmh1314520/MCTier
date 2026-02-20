import React from 'react';

interface GamepadIconProps {
  size?: number;
  className?: string;
}

/**
 * 游戏手柄图标组件
 */
export const GamepadIcon: React.FC<GamepadIconProps> = ({ 
  size = 24, 
  className = '' 
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
      <path
        d="M6 11h4m-2-2v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="15.5"
        cy="11"
        r="1"
        fill="currentColor"
      />
      <circle
        cx="18.5"
        cy="11"
        r="1"
        fill="currentColor"
      />
      <path
        d="M6 5h12a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-2.5l-2 3-2-3H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M6 5h12a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-2.5l-2 3-2-3H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
