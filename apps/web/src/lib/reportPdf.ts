import type { AnalysisReport } from '@truecode/shared';
import { scoreColor } from '../components/property/ScoreRing';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${n}%`;

/**
 * Renders a self-contained, print-ready HTML investment report and opens the
 * browser print dialog (→ "Save as PDF"). Zero dependencies, works offline; the
 * report data is already in memory so no authenticated round-trip is needed.
 */
export function downloadReportPdf(report: AnalysisReport, brand: { name: string; owner?: string }): void {
  const r = report;
  const color = scoreColor(r.investmentScore);
  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) return;

  const row = (k: string, v: string) =>
    `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;
  const compsRows = r.agents.comps.comps
    .map(
      (c) =>
        `<tr><td>${c.address}</td><td>${c.distanceMi} mi</td><td>${c.bedrooms}bd/${c.bathrooms}ba</td><td>${c.sqft.toLocaleString()}</td><td>${money(c.soldPrice)}</td><td>$${c.pricePerSqft}/ft²</td><td>${c.soldDaysAgo}d ago</td></tr>`,
    )
    .join('');
  const list = (items: string[]) => items.map((i) => `<li>${i}</li>`).join('');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
<title>Investment Report — ${r.input.address}</title>
<style>
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1A1A; margin: 0; }
  .cover { padding: 40px; border-radius: 20px; background: linear-gradient(135deg, #111 0%, #2b2b2b 100%); color: #fff; margin-bottom: 28px; }
  .cover .kicker { letter-spacing: .18em; text-transform: uppercase; font-size: 11px; opacity: .7; }
  .cover h1 { font-size: 30px; margin: 8px 0 4px; }
  .cover .addr { opacity: .85; font-size: 14px; }
  .scorebox { display:flex; align-items:center; gap: 24px; margin-top: 24px; }
  .score { width: 120px; height: 120px; border-radius: 50%; border: 10px solid ${color}; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .score .n { font-size: 40px; font-weight: 800; color: ${color}; line-height: 1; }
  .score .s { font-size: 10px; opacity:.7; }
  .verdict { font-size: 22px; font-weight: 700; }
  .verdict .grade { display:inline-block; background:${color}; color:#fff; border-radius: 999px; padding: 2px 12px; font-size:14px; margin-left:8px; vertical-align: middle;}
  h2 { font-size: 16px; border-bottom: 2px solid #eee; padding-bottom: 6px; margin: 26px 0 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .kpi { background:#FBF8F4; border-radius: 12px; padding: 14px; }
  .kpi .label { font-size: 11px; color:#6B6B6B; } .kpi .val { font-size: 20px; font-weight: 700; }
  table { width:100%; border-collapse: collapse; font-size: 12px; }
  td.k { color:#6B6B6B; padding: 4px 8px; } td.v { font-weight:600; text-align:right; padding: 4px 8px; }
  .comps th { text-align:left; font-size:10px; color:#6B6B6B; border-bottom:1px solid #eee; padding:6px; }
  .comps td { padding:6px; border-bottom:1px solid #f4f4f4; }
  ul { margin: 6px 0; padding-left: 18px; font-size: 13px; } li { margin: 3px 0; }
  .muted { color:#6B6B6B; font-size: 12px; }
  .foot { margin-top: 30px; padding-top: 12px; border-top:1px solid #eee; font-size: 10px; color:#9a9a9a; }
  .pill { display:inline-block; background:#F4EEE7; border-radius:999px; padding:2px 10px; font-size:11px; margin:2px; }
</style></head><body>
  <div class="cover">
    <div class="kicker">${brand.name} · Property Intelligence</div>
    <h1>Investment Analysis Report</h1>
    <div class="addr">${r.input.address}, ${r.input.city}, ${r.input.state} · ${r.input.bedrooms}bd / ${r.input.bathrooms}ba · ${r.input.sqft.toLocaleString()} ft²</div>
    <div class="scorebox">
      <div class="score"><span class="n">${r.investmentScore}</span><span class="s">/ 100</span></div>
      <div>
        <div class="verdict">${r.recommendation}<span class="grade">${r.grade} · ${r.tier}</span></div>
        <div class="muted" style="margin-top:6px; max-width:420px;">${r.narrative.executiveSummary}</div>
      </div>
    </div>
  </div>

  <h2>Valuation & Offer</h2>
  <div class="grid">
    <div class="kpi"><div class="label">Fair Market Value</div><div class="val">${money(r.fairMarketValue.estimated)}</div><div class="muted">${r.fairMarketValue.verdict} · ${Math.abs(r.fairMarketValue.diffPct)}% vs asking</div></div>
    <div class="kpi"><div class="label">Asking Price</div><div class="val">${money(r.fairMarketValue.askingPrice)}</div></div>
    <div class="kpi"><div class="label">Suggested Offer</div><div class="val">${money(r.offer.suggestedOffer)}</div><div class="muted">Range ${money(r.offer.offerRangeLow)}–${money(r.offer.offerRangeHigh)}</div></div>
    <div class="kpi"><div class="label">Walk Away Above</div><div class="val">${money(r.offer.walkAwayAbove)}</div></div>
  </div>

  <h2>Cash Flow & Returns</h2>
  <div class="grid">
    <div class="kpi"><div class="label">Net Monthly Cash Flow</div><div class="val">${money(r.agents.rental.cashFlow.netMonthly)}</div></div>
    <div class="kpi"><div class="label">Cap Rate</div><div class="val">${pct(r.agents.rental.cashFlow.capRatePct)}</div></div>
    <div class="kpi"><div class="label">Cash-on-Cash</div><div class="val">${pct(r.agents.rental.cashFlow.cashOnCashPct)}</div></div>
    <div class="kpi"><div class="label">5-Year ROI</div><div class="val">${pct(r.agents.strategy.fiveYearRoiPct)}</div></div>
  </div>
  <table style="margin-top:12px">
    ${row('Monthly Rent', money(r.agents.rental.cashFlow.monthlyRent))}
    ${row('Mortgage (P&I)', money(r.agents.rental.cashFlow.mortgage))}
    ${row('Taxes + Insurance + HOA', money(r.agents.rental.cashFlow.propertyTax + r.agents.rental.cashFlow.insurance + r.agents.rental.cashFlow.hoa))}
    ${row('NOI (annual)', money(r.agents.rental.cashFlow.annualNoi))}
    ${row('DSCR', String(r.agents.rental.cashFlow.dscr))}
    ${row('Cash Invested', money(r.agents.rental.cashFlow.cashInvested))}
  </table>

  <h2>Comparable Sales</h2>
  <table class="comps">
    <tr><th>Address</th><th>Dist</th><th>Beds</th><th>Sqft</th><th>Sold</th><th>$/ft²</th><th>When</th></tr>
    ${compsRows}
  </table>

  <h2>Neighborhood & Market</h2>
  <div class="grid">
    <div class="kpi"><div class="label">Neighborhood Score</div><div class="val">${r.agents.neighborhood.score}/100</div><div class="muted">Growth: ${r.agents.neighborhood.growthPotential}</div></div>
    <div class="kpi"><div class="label">Market</div><div class="val">${r.agents.market.marketType}</div><div class="muted">${r.agents.market.inventoryMonths}mo inventory · ${r.agents.market.medianDom}d DOM</div></div>
  </div>

  <h2>Strengths & Risks</h2>
  <div class="grid">
    <div><strong>Strengths</strong><ul>${list(r.narrative.strengths)}</ul></div>
    <div><strong>Risks (${r.risk.level})</strong><ul>${list(r.narrative.threats.length ? r.narrative.threats : ['No material risks detected'])}</ul></div>
  </div>

  <h2>Recommendation</h2>
  <p style="font-size:13px">${r.narrative.finalRecommendation}</p>
  <p class="muted"><strong>Negotiation:</strong> ${r.narrative.negotiationScript}</p>

  <div class="foot">
    Generated by ${brand.name}${brand.owner ? ` · ${brand.owner}` : ''} · Property Intelligence engine ${r.modelVersion}.
    Figures are modeled estimates for decision support, not an appraisal or financial advice.
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`);
  win.document.close();
}

/**
 * Client-facing CMA (Comparative Market Analysis) one-pager — a clean,
 * jargon-free price recommendation to hand a seller. Reuses the same computed
 * report (comps + fair value + offer); no investor scoring language.
 */
export function downloadCmaPdf(report: AnalysisReport, brand: { name: string; owner?: string; email?: string }): void {
  const r = report;
  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) return;
  const comps = r.agents.comps.comps
    .map((c) => `<tr><td>${c.address}</td><td>${c.bedrooms}bd/${c.bathrooms}ba</td><td>${c.sqft.toLocaleString()}</td><td>${money(c.soldPrice)}</td><td>$${c.pricePerSqft}/ft²</td><td>${c.soldDaysAgo}d ago</td></tr>`)
    .join('');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>CMA — ${r.input.address}</title>
<style>
  @page{margin:18mm}*{box-sizing:border-box}
  body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1A;margin:0}
  .head{border-bottom:3px solid #111;padding-bottom:14px;margin-bottom:22px}
  .kicker{letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#6B6B6B}
  h1{font-size:26px;margin:6px 0}
  .rec{background:#111;color:#fff;border-radius:16px;padding:22px;margin:18px 0;text-align:center}
  .rec .price{font-size:34px;font-weight:800}
  .rec .range{opacity:.8;font-size:13px;margin-top:4px}
  h2{font-size:15px;border-bottom:2px solid #eee;padding-bottom:6px;margin:22px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;font-size:10px;color:#6B6B6B;border-bottom:1px solid #eee;padding:6px}
  td{padding:7px 6px;border-bottom:1px solid #f4f4f4}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .kpi{background:#FBF8F4;border-radius:12px;padding:14px}.kpi .l{font-size:11px;color:#6B6B6B}.kpi .v{font-size:20px;font-weight:700}
  .foot{margin-top:30px;padding-top:12px;border-top:1px solid #eee;font-size:10px;color:#9a9a9a}
</style></head><body>
  <div class="head"><div class="kicker">${brand.name} · Comparative Market Analysis</div><h1>${r.input.address}, ${r.input.city}</h1>
  <div class="kicker">${r.input.bedrooms}bd · ${r.input.bathrooms}ba · ${r.input.sqft.toLocaleString()} ft²${r.input.yearBuilt ? ` · built ${r.input.yearBuilt}` : ''}</div></div>
  <div class="rec"><div style="font-size:12px;opacity:.7;text-transform:uppercase;letter-spacing:.1em">Recommended list price</div><div class="price">${money(r.fairMarketValue.estimated)}</div><div class="range">Competitive range ${money(r.offer.offerRangeLow)} – ${money(r.offer.walkAwayAbove)}</div></div>
  <div class="grid">
    <div class="kpi"><div class="l">Price per ft²</div><div class="v">$${r.agents.comps.pricePerSqft}</div></div>
    <div class="kpi"><div class="l">Local market</div><div class="v">${r.agents.market.marketType}</div></div>
    <div class="kpi"><div class="l">Median days on market</div><div class="v">${r.agents.market.medianDom} days</div></div>
    <div class="kpi"><div class="l">Price trend (YoY)</div><div class="v">${r.agents.market.priceTrendYoYPct >= 0 ? '+' : ''}${pct(r.agents.market.priceTrendYoYPct)}</div></div>
  </div>
  <h2>Recent comparable sales</h2>
  <table><tr><th>Address</th><th>Beds</th><th>Sqft</th><th>Sold</th><th>$/ft²</th><th>When</th></tr>${comps}</table>
  <h2>Summary</h2>
  <p style="font-size:13px;line-height:1.5">${r.narrative.executiveSummary}</p>
  <div class="foot">Prepared by ${brand.name}${brand.owner ? ` · ${brand.owner}` : ''}${brand.email ? ` · ${brand.email}` : ''}. A comparative market analysis is an estimate of value, not a formal appraisal.</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
</body></html>`);
  win.document.close();
}
