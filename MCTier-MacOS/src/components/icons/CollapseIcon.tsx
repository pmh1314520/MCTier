import React from 'react';

interface CollapseIconProps {
  collapsed?: boolean;
  size?: number;
  className?: string;
}

export const CollapseIcon: React.FC<CollapseIconProps> = ({ 
  collapsed = false, 
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
      style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}
    >
      <path
        d="M7 14L12 9L17 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
