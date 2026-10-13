import React from 'react';

interface DiceIconProps {
  size?: number;
  className?: string;
}

export const DiceIcon: React.FC<DiceIconProps> = ({ size = 24, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1" fill="#FFFFFF" />
      <circle cx="15.5" cy="8.5" r="1" fill="#FFFFFF" />
      <circle cx="12" cy="12" r="1" fill="#FFFFFF" />
      <circle cx="8.5" cy="15.5" r="1" fill="#FFFFFF" />
      <circle cx="15.5" cy="15.5" r="1" fill="#FFFFFF" />
    </svg>
  );
};
