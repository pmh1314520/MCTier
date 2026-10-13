import React from 'react';

interface CoffeeIconProps {
  size?: number;
  className?: string;
}

export const CoffeeIcon: React.FC<CoffeeIconProps> = ({ size = 24, className = '' }) => (
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
    <path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
    <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M7 4v2M11 4v2M15 4v2M3 21h16" />
  </svg>
);
