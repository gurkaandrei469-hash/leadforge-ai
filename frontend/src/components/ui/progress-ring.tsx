interface ProgressRingProps {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  trackClassName?: string;
  label?: React.ReactNode;
}

export function ProgressRing({
  value,
  size = 96,
  stroke = 8,
  className = 'text-primary',
  trackClassName = 'text-muted',
  label,
}: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className={trackClassName}
          opacity="0.2"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${className} transition-[stroke-dashoffset] duration-500 ease-out`}
        />
      </svg>
      {label && (
        <div className="absolute inset-0 flex items-center justify-center text-center">
          {label}
        </div>
      )}
    </div>
  );
}
