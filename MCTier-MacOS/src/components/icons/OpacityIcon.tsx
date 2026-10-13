import React from 'react';

interface OpacityIconProps {
  size?: number;
  className?: string;
}

export const OpacityIcon: React.FC<OpacityIconProps> = ({ 
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
    >
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.3"
      />
      <circle
        cx="12"
        cy="12"
        r="5"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.6"
      />
      <circle
        cx="12"
        cy="12"
        r="2"
        fill="currentColor"
        opacity="1"
      />
    </svg>
  );
};
