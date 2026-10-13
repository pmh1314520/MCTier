import React from 'react';

interface ChatIconProps {
  size?: number;
  className?: string;
}

export const ChatIcon: React.FC<ChatIconProps> = ({ size = 24, className = '' }) => (
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
    <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 3v-5.5A7.5 7.5 0 1 1 20 11.5Z" />
    <path d="M8 11h.01M12 11h.01M16 11h.01" />
  </svg>
);
