import React from 'react';

interface WarningIconProps {
  size?: number;
  className?: string;
}

/**
 * 警告图标组件
 */
export const WarningIcon: React.FC<WarningIconProps> = ({ 
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
        d="M12 2L2 20h20L12 2z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M12 2L2 20h20L12 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle
        cx="12"
        cy="17"
        r="1"
        fill="currentColor"
      />
    </svg>
  );
};
