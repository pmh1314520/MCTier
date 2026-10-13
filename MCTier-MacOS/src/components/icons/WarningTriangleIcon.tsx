import React from 'react';

interface WarningTriangleIconProps {
  size?: number;
  className?: string;
}

export const WarningTriangleIcon: React.FC<WarningTriangleIconProps> = ({ 
  size = 64, 
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
    >
      <path
        d="M12 2L2 20h20L12 2z"
        fill="url(#warningGradient)"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v4"
        stroke="#1a1a2e"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="12"
        cy="17"
        r="1"
        fill="#1a1a2e"
      />
      <defs>
        <linearGradient id="warningGradient" x1="12" y1="2" x2="12" y2="20">
          <stop offset="0%" stopColor="#ffc107" />
          <stop offset="100%" stopColor="#ff9800" />
        </linearGradient>
      </defs>
    </svg>
  );
};
