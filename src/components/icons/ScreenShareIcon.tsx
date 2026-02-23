import React from 'react';

interface ScreenShareIconProps {
  size?: number;
  className?: string;
}

export const ScreenShareIcon: React.FC<ScreenShareIconProps> = ({ 
  size = 24, 
  className = '' 
}) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* 显示器外框 */}
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      {/* 显示器底座 */}
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
};
