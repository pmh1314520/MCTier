import React from 'react';

interface LockIconProps {
  open?: boolean;
  size?: number;
  className?: string;
}

export const LockIcon: React.FC<LockIconProps> = ({ open = false, size = 24, className = '' }) => (
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
    {open ? <path d="M7 10V7a5 5 0 0 1 9.9-1" /> : <path d="M7 10V7a5 5 0 0 1 10 0v3" />}
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <circle cx="12" cy="15.5" r="1" />
    <path d="M12 16.5v2" />
  </svg>
);
