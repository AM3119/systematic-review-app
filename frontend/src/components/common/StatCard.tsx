interface StatCardProps {
  label: string;
  value: number | string;
  icon?: string;
  sub?: string;
  color?: string;
}

export default function StatCard({ label, value, icon, sub, color = 'text-brand-700 bg-brand-50 border-brand-100' }: StatCardProps) {
  return (
    <div className={`card border p-5 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">{label}</span>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <p className="text-3xl font-bold">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
