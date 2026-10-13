import React from 'react';

interface PlayIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const PlayIcon: React.FC<PlayIconProps> = ({ 
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
      <path
        d="M8 5.14v13.72L19 12L8 5.14z"
        fill={color}
      />
    </svg>
  );
};
