import React from 'react';

interface PauseIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const PauseIcon: React.FC<PauseIconProps> = ({ 
  size = 24, 
  color = 'currentColor',
  className 
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
      <rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
      <rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
    </svg>
  );
};
