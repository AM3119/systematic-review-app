interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

export default function ProgressBar({ value, max = 100, color = 'bg-brand-600', showLabel = true, size = 'md', animated = false }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0;
  const heights = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' };

  return (
    <div className="w-full">
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${heights[size]}`}>
        <div
          className={`${heights[size]} rounded-full transition-all duration-700 ease-out ${color} ${animated ? 'animate-pulse-slow' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-500">{value} / {max}</span>
          <span className="text-xs font-medium text-gray-700">{pct}%</span>
        </div>
      )}
    </div>
  );
}
