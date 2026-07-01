import type { LucideIcon } from 'lucide-react';
import { Card } from './ui/card';

const toneMap = { pink: 'pink', yellow: 'yellow', purple: 'purple', green: 'green', blue: 'blue' } as const;

/** Pastel stat card matching the reference "Most popular" tiles. */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'green',
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  tone?: keyof typeof toneMap;
}) {
  return (
    <Card tone={toneMap[tone]} className="min-h-[132px]">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface/70">
          <Icon className="h-5 w-5 text-ink" strokeWidth={2} />
        </div>
        {sub && <span className="rounded-pill bg-surface/70 px-2.5 py-1 text-xs font-medium">{sub}</span>}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
    </Card>
  );
}
