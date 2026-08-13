import React from 'react';

interface CheckIconProps {
  size?: number;
  className?: string;
}

export const CheckIcon: React.FC<CheckIconProps> = ({ size = 24, className = '' }) => (
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
    <path d="m5 12 4 4L19 6" />
  </svg>
);
