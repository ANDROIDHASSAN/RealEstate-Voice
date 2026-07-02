import { useMutation } from '@tanstack/react-query';
import type { AnalysisReport } from '@truecode/shared';
import {
  Building2, Download, FileText, MessageCircle, Send, ShieldAlert, Sparkles, Star, TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area, AreaChart, Bar, BarChart, Cell, PolarAngleAxis, PolarGrid, Radar, RadarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { downloadCmaPdf, downloadReportPdf } from '../../lib/reportPdf';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../store/auth';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { ScoreRing, scoreColor } from './ScoreRing';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const TOOLTIP = { borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)', fontFamily: 'Poppins' } as const;

const RECO_TONE: Record<string, 'green' | 'blue' | 'yellow' | 'pink' | 'purple'> = {
  'Strong Buy': 'green', Buy: 'blue', Hold: 'yellow', Negotiate: 'purple', Wait: 'yellow', Avoid: 'pink',
};
const RISK_TONE = { Low: 'green', Medium: 'yellow', High: 'pink' } as const;

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'pink' | 'neutral' }) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'green' && 'text-emerald-600', tone === 'pink' && 'text-rose-500')}>{value}</p>
      {sub && <p className="text-[11px] text-ink-soft">{sub}</p>}
    </div>
  );
}

export function PropertyReport({ id, report }: { id: string; report: AnalysisReport }) {
  const { t } = useTranslation();
  const account = useAuthStore((s) => s.account);
  const r = report;
  const cf = r.agents.rental.cashFlow;

  const radarData = r.weightedBreakdown.map((b) => ({ agent: b.label.split(' ')[0], score: b.score }));
  const contribData = r.weightedBreakdown.map((b) => ({ name: b.label, contribution: b.contribution, score: b.score }));
  const expenseData = [
    { name: 'Mortgage', v: cf.mortgage }, { name: 'Tax', v: cf.propertyTax }, { name: 'Insurance', v: cf.insurance },
    { name: 'HOA', v: cf.hoa }, { name: 'Maint', v: cf.maintenance }, { name: 'Vacancy', v: cf.vacancy }, { name: 'Mgmt', v: cf.management },
  ].filter((e) => e.v > 0);
  const years = Array.from({ length: 11 }, (_, y) => {
    const value = r.input.askingPrice * (1 + r.agents.strategy.expectedAppreciationPct / 100) ** y;
    return { year: `Y${y}`, value: Math.round(value), cash: Math.round(cf.netMonthly * 12 * y) };
  });

  // --- Report AI chat ---
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [q, setQ] = useState('');
  const ask = useMutation({
    mutationFn: (question: string) => api<{ answer: string; live: boolean }>(`/property-analysis/${id}/chat`, { method: 'POST', body: { question } }),
    onMutate: (question) => setChat((c) => [...c, { role: 'user', text: question }]),
    onSuccess: (res) => setChat((c) => [...c, { role: 'assistant', text: res.answer }]),
  });
  const submit = (question: string) => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    setQ('');
    ask.mutate(text);
  };
  const suggestions = [t('propertyIntel.q1'), t('propertyIntel.q2'), t('propertyIntel.q3'), t('propertyIntel.q4')];

  return (
    <div className="space-y-6">
      {/* Hero: score + recommendation + valuation */}
      <Card className="cf-step-in overflow-hidden">
        <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-stretch">
          <div className="flex flex-col items-center justify-center gap-3">
            <ScoreRing value={r.investmentScore} grade={r.grade} tier={r.tier} />
            <Badge tone={RECO_TONE[r.recommendation] ?? 'neutral'} className="text-sm">{r.recommendation}</Badge>
          </div>
          <div className="flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Building2 className="h-5 w-5 text-ink-soft" />
              <h2 className="text-lg font-semibold">{r.input.address}, {r.input.city}</h2>
              <Badge tone="neutral" className="capitalize">{r.input.propertyType.replace('-', ' ')}</Badge>
            </div>
            <p className="text-sm leading-relaxed text-ink-soft">{r.narrative.executiveSummary}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label={t('propertyIntel.fairValue')} value={money(r.fairMarketValue.estimated)} sub={`${r.fairMarketValue.verdict} · ${Math.abs(r.fairMarketValue.diffPct)}%`} tone={r.fairMarketValue.verdict === 'Undervalued' ? 'green' : r.fairMarketValue.verdict === 'Overpriced' ? 'pink' : 'neutral'} />
              <Metric label={t('propertyIntel.suggestedOffer')} value={money(r.offer.suggestedOffer)} sub={`${money(r.offer.offerRangeLow)}–${money(r.offer.offerRangeHigh)}`} />
              <Metric label={t('propertyIntel.capRate')} value={`${cf.capRatePct}%`} sub={`CoC ${cf.cashOnCashPct}%`} tone={cf.capRatePct >= 6 ? 'green' : 'neutral'} />
              <Metric label={t('propertyIntel.cashFlow')} value={`${money(cf.netMonthly)}/mo`} tone={cf.netMonthly >= 0 ? 'green' : 'pink'} />
            </div>
          </div>
          <div className="flex flex-row gap-2 lg:flex-col">
            <Button variant="secondary" size="sm" onClick={() => downloadReportPdf(r, { name: account?.name ?? 'CloseFlow', owner: account?.ownerName })}>
              <Download className="h-4 w-4" /> {t('propertyIntel.exportPdf')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadCmaPdf(r, { name: account?.name ?? 'CloseFlow', owner: account?.ownerName, email: account?.email })}>
              <FileText className="h-4 w-4" /> {t('propertyIntel.exportCma')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Agent breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">{t('propertyIntel.agentScores')}</CardTitle>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} outerRadius={90}>
              <PolarGrid stroke="#E7E0D8" />
              <PolarAngleAxis dataKey="agent" tick={{ fontSize: 11, fill: '#6B6B6B' }} />
              <Radar dataKey="score" stroke={scoreColor(r.investmentScore)} fill={scoreColor(r.investmentScore)} fillOpacity={0.28} />
              <Tooltip contentStyle={TOOLTIP} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="lg:col-span-3">
          <CardTitle className="mb-4">{t('propertyIntel.weightedScore')}</CardTitle>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={contribData} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6B6B6B' }} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v: number, _n, p) => [`${(p.payload as { score: number }).score}/100 → +${v} pts`, 'Contribution']} />
              <Bar dataKey="contribution" radius={[8, 8, 8, 8]} barSize={20}>
                {contribData.map((d, i) => <Cell key={i} fill={scoreColor(d.score)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Cash flow + equity projection */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-4">{t('propertyIntel.monthlyExpenses')}</CardTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={expenseData} barSize={22}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B6B6B' }} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v: number) => [money(v), 'Monthly']} />
              <Bar dataKey="v" radius={[8, 8, 8, 8]}>
                {expenseData.map((_, i) => <Cell key={i} fill={['#E06B6B', '#E0A500', '#3E8BD1', '#8A6BE0', '#1F9D6B', '#E27A3F', '#6B6B6B'][i % 7]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-center text-xs text-ink-soft">{t('propertyIntel.breakEven')}: {money(cf.breakEvenRent)}/mo · DSCR {cf.dscr} · GRM {cf.grm}</p>
        </Card>
        <Card>
          <CardTitle className="mb-1">{t('propertyIntel.equityGrowth')}</CardTitle>
          <p className="mb-3 text-xs text-ink-soft">{r.agents.strategy.recommended} · {r.agents.strategy.expectedAppreciationPct}%/yr · 5yr ROI {r.agents.strategy.fiveYearRoiPct}%</p>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={years}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F9D6B" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#1F9D6B" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B6B6B' }} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v: number) => [money(v), 'Value']} />
              <Area type="monotone" dataKey="value" stroke="#1F9D6B" strokeWidth={2} fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Neighborhood + Market + Risk */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card tone="blue">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>{t('propertyIntel.neighborhood')}</CardTitle>
            <Badge tone="ink">{r.agents.neighborhood.score}/100</Badge>
          </div>
          <p className="text-xs font-medium text-ink-soft">{t('propertyIntel.growth')}: {r.agents.neighborhood.growthPotential}</p>
          <div className="mt-3 space-y-1.5">
            {Object.entries(r.agents.neighborhood.subScores).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] capitalize text-ink-soft">{k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                  <div className="h-full rounded-full" style={{ width: `${v}%`, background: scoreColor(v) }} />
                </div>
                <span className="w-7 text-right text-[11px] font-semibold tabular-nums">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {r.agents.neighborhood.pros.slice(0, 3).map((p) => <span key={p} className="rounded-pill bg-surface px-2 py-0.5 text-[10px]">✓ {p}</span>)}
          </div>
        </Card>

        <Card tone="yellow">
          <div className="mb-3 flex items-center justify-between">
            <CardTitle>{t('propertyIntel.market')}</CardTitle>
            <Badge tone="ink"><TrendingUp className="h-3 w-3" /> {r.agents.market.trend}</Badge>
          </div>
          <p className="text-sm font-semibold">{r.agents.market.marketType}</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-soft">
            <li>Inventory: {r.agents.market.inventoryMonths} months</li>
            <li>Median DOM: {r.agents.market.medianDom} days</li>
            <li>Price trend: {r.agents.market.priceTrendYoYPct >= 0 ? '+' : ''}{r.agents.market.priceTrendYoYPct}% YoY</li>
            <li>Mortgage rate: {r.agents.market.mortgageRatePct}%</li>
            <li>12-mo forecast: {r.agents.market.forecast12moPct >= 0 ? '+' : ''}{r.agents.market.forecast12moPct}%</li>
          </ul>
        </Card>

        <Card tone={r.risk.level === 'High' ? 'pink' : r.risk.level === 'Medium' ? 'yellow' : 'green'}>
          <div className="mb-3 flex items-center justify-between">
            <CardTitle className="flex items-center gap-1"><ShieldAlert className="h-4 w-4" /> {t('propertyIntel.risk')}</CardTitle>
            <Badge tone={RISK_TONE[r.risk.level]}>{r.risk.level} · {r.risk.score}</Badge>
          </div>
          <div className="space-y-1">
            {r.risk.factors.map((f) => (
              <div key={f.key} className="flex items-center justify-between text-xs">
                <span className="text-ink-soft">{f.label}</span>
                <Badge tone={RISK_TONE[f.level]} className="px-2 py-0">{f.level}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Opportunities + SWOT */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t('propertyIntel.opportunities')}</CardTitle>
          <ul className="space-y-2">
            {r.opportunities.map((o) => (
              <li key={o.key} className="rounded-2xl bg-surface p-3">
                <p className="text-sm font-semibold">{o.label}</p>
                <p className="text-xs text-ink-soft">{o.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle className="mb-3">{t('propertyIntel.strengthsRisks')}</CardTitle>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-xs font-semibold text-emerald-600">{t('propertyIntel.strengths')}</p>
              <ul className="space-y-1 text-xs text-ink-soft">{r.narrative.strengths.map((s, i) => <li key={i}>+ {s}</li>)}</ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-rose-500">{t('propertyIntel.weaknesses')}</p>
              <ul className="space-y-1 text-xs text-ink-soft">{r.narrative.weaknesses.map((s, i) => <li key={i}>− {s}</li>)}</ul>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-surface-2 p-3">
            <p className="text-xs font-semibold">{t('propertyIntel.exitStrategy')}</p>
            <p className="text-xs text-ink-soft">{r.narrative.exitStrategy}</p>
          </div>
        </Card>
      </div>

      {/* Comps table */}
      <Card>
        <CardTitle className="mb-3">{t('propertyIntel.comps')} · ${r.agents.comps.pricePerSqft}/ft²</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft">
                <th className="pb-2 pr-4">Address</th><th className="pb-2 pr-4">Dist</th><th className="pb-2 pr-4">Beds</th>
                <th className="pb-2 pr-4">Sqft</th><th className="pb-2 pr-4">Sold</th><th className="pb-2 pr-4">$/ft²</th><th className="pb-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {r.agents.comps.comps.map((c, i) => (
                <tr key={i}>
                  <td className="py-2 pr-4 font-medium">{c.address}</td>
                  <td className="py-2 pr-4 text-ink-soft">{c.distanceMi} mi</td>
                  <td className="py-2 pr-4 text-ink-soft">{c.bedrooms}bd/{c.bathrooms}ba</td>
                  <td className="py-2 pr-4 text-ink-soft">{c.sqft.toLocaleString()}</td>
                  <td className="py-2 pr-4 font-semibold">{money(c.soldPrice)}</td>
                  <td className="py-2 pr-4 text-ink-soft">${c.pricePerSqft}</td>
                  <td className="py-2 text-ink-soft">{c.soldDaysAgo}d ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Negotiation + AI chat */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card tone="purple">
          <CardTitle className="mb-2">{t('propertyIntel.negotiation')}</CardTitle>
          <p className="rounded-2xl bg-surface/70 p-3 text-sm italic">“{r.narrative.negotiationScript}”</p>
          <ul className="mt-3 space-y-1 text-xs text-ink-soft">
            {r.narrative.talkingPoints.map((p, i) => <li key={i}>• {p}</li>)}
          </ul>
        </Card>

        <Card>
          <CardTitle className="mb-3 flex items-center gap-2"><MessageCircle className="h-4 w-4" /> {t('propertyIntel.askAnalyst')}</CardTitle>
          <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
            {chat.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => submit(s)} className="rounded-pill bg-surface-2 px-3 py-1.5 text-xs transition-colors hover:bg-card-purple">{s}</button>
                ))}
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'ml-auto bg-accent text-accent-on' : 'bg-surface-2')}>{m.text}</div>
            ))}
            {ask.isPending && <div className="w-16 rounded-2xl bg-surface-2 px-3 py-2"><span className="cf-typing-dot">•</span><span className="cf-typing-dot">•</span><span className="cf-typing-dot">•</span></div>}
          </div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('propertyIntel.askPlaceholder')} className="h-11 flex-1 rounded-pill border border-black/5 bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-ink/10" />
            <Button type="submit" size="icon" disabled={ask.isPending}><Send className="h-4 w-4" /></Button>
          </form>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-soft"><Star className="h-3 w-3" /> {t('propertyIntel.grounded')}</p>
        </Card>
      </div>
    </div>
  );
}
