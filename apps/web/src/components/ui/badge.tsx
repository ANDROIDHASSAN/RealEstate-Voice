import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'green' | 'yellow' | 'pink' | 'purple' | 'blue' | 'neutral' | 'ink';

const tones: Record<Tone, string> = {
  green: 'bg-card-green text-ink',
  yellow: 'bg-card-yellow text-ink',
  pink: 'bg-card-pink text-ink',
  purple: 'bg-card-purple text-ink',
  blue: 'bg-card-blue text-ink',
  neutral: 'bg-surface-2 text-ink-soft',
  ink: 'bg-accent text-accent-on',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-3 py-1 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
