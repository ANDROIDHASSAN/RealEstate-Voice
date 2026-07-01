import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'surface' | 'pink' | 'yellow' | 'purple' | 'green' | 'blue';

const tones: Record<Tone, string> = {
  surface: 'bg-surface',
  pink: 'bg-card-pink',
  yellow: 'bg-card-yellow',
  purple: 'bg-card-purple',
  green: 'bg-card-green',
  blue: 'bg-card-blue',
};

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { tone?: Tone }>(
  ({ className, tone = 'surface', ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card shadow-soft p-6', tones[tone], className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-ink-soft', className)} {...props} />;
}
