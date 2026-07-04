import type { ReactNode } from 'react';
import { PLATFORM_META, type AspectRatio, type SocialPlatform } from '@truecode/shared';

/** Pastel chart palette matched to the design tokens. */
export const CHART_COLORS = ['#E6DDF8', '#D9E7F7', '#D2ECDB', '#FCEBCB', '#F9DCDC', '#F4EEE7'];
export const INK = '#1A1A1A';
export const INK_SOFT = '#6B6B6B';

/** Shared borderless rounded Recharts tooltip. */
export const TOOLTIP_STYLE = {
  borderRadius: 16,
  border: 'none',
  boxShadow: '0 8px 24px rgba(0,0,0,.08)',
  fontFamily: 'Poppins',
  fontSize: 12,
} as const;

// ── API response shapes ──────────────────────────────────────────────────────
export interface PostResult {
  platform: string;
  status: string;
  externalId?: string;
  permalink?: string;
  error?: string;
}
export interface PostRow {
  _id: string;
  platforms?: string[];
  channel?: string;
  type: string;
  format?: string;
  title?: string;
  caption: string;
  firstComment?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  scheduledAt: string;
  status: string;
  results?: PostResult[];
}
export interface MediaAssetRow {
  _id: string;
  name: string;
  kind: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  aspect: string;
  width?: number;
  height?: number;
  durationSec?: number;
  tags: string[];
  source: string;
  stub: boolean;
  createdAt: string;
}
export interface ConnectionRow {
  platform: SocialPlatform;
  label: string;
  color: string;
  status: 'connected' | 'pending' | 'disconnected' | 'error';
  live: boolean;
  reason?: string;
  displayName?: string;
  connectedAt?: string;
  stub: boolean;
}
export interface CampaignRow {
  _id: string;
  name: string;
  objective: string;
  platform: string;
  status: string;
  budgetDaily: number;
  durationDays: number;
  currency: string;
  creative?: { headline?: string; primaryText?: string; cta?: string; imageUrl?: string };
  targeting?: Record<string, unknown>;
  externalId?: string;
  stub: boolean;
  error?: string;
  metrics?: {
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number;
    spend: number;
    leads: number;
    cpl: number;
    daily?: { date: string; impressions: number; clicks: number; spend: number; leads: number }[];
  };
  createdAt: string;
}
export interface ResearchRun {
  _id: string;
  query: string;
  region: string;
  platform: string;
  count: number;
  stub: boolean;
  provider?: { name: string; live: boolean; reason?: string };
  createdAt: string;
}
export interface CompetitorAdRow {
  _id: string;
  researchId: string;
  advertiser: string;
  page: string;
  platform: string;
  headline: string;
  primaryText: string;
  cta: string;
  mediaType: 'image' | 'video' | 'carousel';
  thumbnailUrl: string;
  startedRunning: string;
  daysRunning: number;
  estimatedSpend: string;
  impressionsRange: string;
  angle: string;
  sourceUrl: string;
  watched: boolean;
}
export interface ProviderInfo {
  name: string;
  live: boolean;
  reason?: string;
}
export interface Overview {
  stats: {
    scheduled: number;
    published: number;
    activeCampaigns: number;
    mediaCount: number;
    connections: number;
    totalSpend: number;
    totalLeads: number;
    watchedCount: number;
  };
  cadence: { day: string; posts: number }[];
  mix: { platform: SocialPlatform; label: string; count: number }[];
  bestTimes: { platform: SocialPlatform; day: string; hour: number; label: string }[];
}

// ── Small UI atoms ───────────────────────────────────────────────────────────
const RATIO: Record<AspectRatio | 'other', string> = {
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '9:16': '9 / 16',
  '16:9': '16 / 9',
  other: '1 / 1',
};

/** A framed preview box that holds its platform aspect ratio. */
export function AspectFrame({
  aspect,
  children,
  className = '',
}: {
  aspect: AspectRatio | 'other';
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-surface-2 ${className}`}
      style={{ aspectRatio: RATIO[aspect] }}
    >
      {children}
    </div>
  );
}

/** A platform glyph chip (letter avatar in the platform's pastel). */
export function PlatformDot({ platform, size = 'md' }: { platform: SocialPlatform; size?: 'sm' | 'md' }) {
  const meta = PLATFORM_META[platform];
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <span
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full font-semibold text-ink`}
      style={{ background: meta.color }}
      title={meta.label}
    >
      {meta.label.slice(0, 2)}
    </span>
  );
}

export function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  const color = ok ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-black/20';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
