import React from 'react';

interface LightbulbIconProps {
  size?: number;
  className?: string;
}

/**
 * 灯泡图标组件（提示/想法）
 */
export const LightbulbIcon: React.FC<LightbulbIconProps> = ({ 
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
        d="M9 21h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 18h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 2a7 7 0 0 1 4.95 11.95c-.5.5-.95 1.05-1.45 1.55-.5.5-.5 1-.5 1.5v1h-6v-1c0-.5 0-1-.5-1.5-.5-.5-.95-1.05-1.45-1.55A7 7 0 0 1 12 2z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M12 2a7 7 0 0 1 4.95 11.95c-.5.5-.95 1.05-1.45 1.55-.5.5-.5 1-.5 1.5v1h-6v-1c0-.5 0-1-.5-1.5-.5-.5-.95-1.05-1.45-1.55A7 7 0 0 1 12 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 6v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
};
