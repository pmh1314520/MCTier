import React from 'react';

interface LightningIconProps {
  size?: number;
  className?: string;
}

export const LightningIcon: React.FC<LightningIconProps> = ({ size = 24, className = '' }) => (
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
    <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z" />
  </svg>
);
