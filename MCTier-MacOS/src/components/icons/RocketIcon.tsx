import React from 'react';

interface RocketIconProps {
  size?: number;
  className?: string;
}

export const RocketIcon: React.FC<RocketIconProps> = ({ size = 24, className = '' }) => (
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
    <path d="M14.5 4.5C17 2 20.5 2 22 2c0 1.5 0 5-2.5 7.5L14 15l-5-5 5.5-5.5Z" />
    <path d="m9 10-5 1 4 4 1-5ZM14 15l-1 5-4-4 5-1Z" />
    <path d="M6 18c-1.5.5-2.5 1.5-3 3 1.5-.5 2.5-1.5 3-3ZM16.5 7.5h.01" />
  </svg>
);
