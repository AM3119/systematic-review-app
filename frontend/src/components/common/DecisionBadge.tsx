interface DecisionBadgeProps {
  decision: string | null | undefined;
  size?: 'sm' | 'md';
}

const labels: Record<string, string> = {
  include: 'Include',
  exclude: 'Exclude',
  maybe: 'Maybe',
};

const classes: Record<string, string> = {
  include: 'decision-include',
  exclude: 'decision-exclude',
  maybe: 'decision-maybe',
};

const icons: Record<string, string> = {
  include: '✓',
  exclude: '✗',
  maybe: '?',
};

export default function DecisionBadge({ decision, size = 'md' }: DecisionBadgeProps) {
  if (!decision) return <span className={`badge decision-unscreened ${size === 'sm' ? 'text-xs' : ''}`}>Unscreened</span>;
  return (
    <span className={`badge ${classes[decision] || 'decision-unscreened'} ${size === 'sm' ? 'text-xs' : ''}`}>
      <span className="mr-1">{icons[decision]}</span>
      {labels[decision] || decision}
    </span>
  );
}
