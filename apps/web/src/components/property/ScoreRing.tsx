import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/** Score → deep accent color (data-viz shades, aligned to the pastel palette). */
export function scoreColor(score: number): string {
  if (score >= 85) return '#1F9D6B'; // green
  if (score >= 70) return '#3E8BD1'; // blue
  if (score >= 55) return '#E0A500'; // amber
  if (score >= 40) return '#E27A3F'; // orange
  return '#E06B6B'; // red
}

/**
 * Animated circular investment score. SVG ring that sweeps to `value` with a
 * synchronized count-up in the center. Respects prefers-reduced-motion.
 */
export function ScoreRing({
  value,
  grade,
  tier,
  size = 220,
  stroke = 16,
}: {
  value: number;
  grade?: string;
  tier?: string;
  size?: number;
  stroke?: number;
}) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = scoreColor(value);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3; // easeOutCubic
      setDisplay(Math.round(value * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value]);

  const offset = circumference - (display / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F0E9E1" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 60ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold tracking-tight tabular-nums" style={{ color }}>
          {display}
        </span>
        <span className="text-xs font-medium text-ink-soft">/ 100</span>
        {grade && (
          <span className={cn('mt-1 rounded-pill px-3 py-0.5 text-sm font-semibold text-white')} style={{ backgroundColor: color }}>
            {grade}
          </span>
        )}
        {tier && <span className="mt-1 text-[11px] font-medium text-ink-soft">{tier}</span>}
      </div>
    </div>
  );
}
