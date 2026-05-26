'use client';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({ data, width = 80, height = 24, className = '', ariaLabel }: SparklineProps) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });

  const pathD = points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ');
  const areaD = `${pathD} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-label={ariaLabel ?? 'trend sparkline'}
      role="img"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#spark-fill)" />
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={points[points.length - 1]![0]}
        cy={points[points.length - 1]![1]}
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}
