import { formatMoney, type QuoteDTO } from '@truecode/shared';

/**
 * Renders a branded, print-ready quote/proposal and opens the print dialog
 * (→ "Save as PDF"). Zero dependencies; the quote is already in memory.
 * Line items are grouped into category "sections"; optional add-ons, per-line
 * discounts, deposit terms and the quote's accent colour are all honoured.
 */
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function downloadQuotePdf(quote: QuoteDTO, brand: { name: string; owner?: string; email?: string }): void {
  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) return;
  const m = (n: number) => formatMoney(n, quote.currency);
  const accent = quote.accentColor && /^#[0-9a-fA-F]{6}$/.test(quote.accentColor) ? quote.accentColor : '#111111';
  const valid = quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : '';
  const net = (li: QuoteDTO['lineItems'][number]) => {
    const gross = li.quantity * li.unitPrice;
    return gross - (li.discountPct ? (gross * li.discountPct) / 100 : 0);
  };

  const included = quote.lineItems.filter((li) => !li.optional);
  const optional = quote.lineItems.filter((li) => li.optional);

  // Group included items by category, preserving first-seen order.
  const groups: [string, typeof included][] = [];
  for (const li of included) {
    const cat = li.category || 'Services';
    const g = groups.find(([c]) => c === cat);
    if (g) g[1].push(li);
    else groups.push([cat, [li]]);
  }
  const row = (li: QuoteDTO['lineItems'][number]) =>
    `<tr><td>${esc(li.description)}${li.discountPct ? `<span class="disc"> −${li.discountPct}%</span>` : ''}${li.taxable === false ? '<span class="cat"> (no tax)</span>' : ''}</td><td class="num">${li.quantity}${li.unit ? ` ${esc(li.unit)}` : ''}</td><td class="num">${m(li.unitPrice)}</td><td class="num">${m(net(li))}</td></tr>`;

  const sections = groups
    .map(([cat, items]) => `<tr class="section"><td colspan="4">${esc(cat)}</td></tr>${items.map(row).join('')}`)
    .join('');

  const optionalBlock = optional.length
    ? `<div class="opt"><div class="opt-h">Optional add-ons</div>${optional
        .map((li) => `<div class="opt-row"><span>${esc(li.description)}</span><span class="num">+ ${m(net(li))}</span></div>`)
        .join('')}</div>`
    : '';

  const t = quote.totals;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(quote.number)} — ${esc(quote.title)}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1A1A1A; margin:0; }
  .accent { color:${accent}; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${accent}; padding-bottom:16px; margin-bottom:24px; }
  .brand { font-size:22px; font-weight:800; display:flex; align-items:center; gap:12px; }
  .brand img { max-height:44px; max-width:160px; object-fit:contain; }
  .brand .sub { font-size:12px; color:#6B6B6B; font-weight:400; margin-top:2px; }
  .meta { text-align:right; font-size:12px; color:#6B6B6B; }
  .meta .num { font-size:16px; font-weight:700; color:${accent}; }
  h1 { font-size:20px; margin:0 0 12px; }
  .summary { font-size:13px; color:#444; background:#F7F5F2; border-radius:12px; padding:12px 14px; margin-bottom:18px; }
  .parties { display:flex; gap:40px; margin-bottom:22px; font-size:13px; }
  .parties .label { font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:#9a9a9a; margin-bottom:4px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#6B6B6B; border-bottom:2px solid #eee; padding:8px 6px; }
  th.num, td.num { text-align:right; }
  td { padding:10px 6px; border-bottom:1px solid #f2f2f2; }
  tr.section td { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:${accent}; font-weight:700; padding:14px 6px 4px; border:none; }
  .disc { color:#E06B6B; font-size:11px; }
  td .cat { font-size:10px; color:#9a9a9a; }
  .opt { margin-top:16px; border:1px dashed #ccc; border-radius:12px; padding:10px 14px; font-size:12px; }
  .opt-h { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#6B6B6B; margin-bottom:6px; }
  .opt-row { display:flex; justify-content:space-between; padding:3px 0; color:#555; }
  .totals { margin-left:auto; width:300px; margin-top:16px; font-size:13px; }
  .totals tr td { border:none; padding:5px 6px; }
  .totals .grand td { border-top:2px solid ${accent}; font-size:16px; font-weight:800; padding-top:10px; }
  .totals .grand td.num { color:${accent}; }
  .totals .deposit td { border-top:1px solid #eee; padding-top:8px; }
  .totals .deposit td.num { color:#1F9D6B; font-weight:700; }
  .note { margin-top:22px; font-size:12px; color:#444; }
  .note .label { font-weight:700; }
  .foot { margin-top:36px; padding-top:12px; border-top:1px solid #eee; font-size:10px; color:#9a9a9a; text-align:center; }
  .pill { display:inline-block; background:${accent}18; color:${accent}; border-radius:999px; padding:2px 10px; font-size:11px; text-transform:capitalize; }
</style></head><body>
  <div class="head">
    <div class="brand">${brand.name && !quote.logoUrl ? esc(brand.name) : ''}${quote.logoUrl ? `<img src="${esc(quote.logoUrl)}" alt="${esc(brand.name)}"/>` : ''}<div class="sub">${esc(brand.owner ?? '')}${brand.email ? ` · ${esc(brand.email)}` : ''}</div></div>
    <div class="meta"><div class="num">${esc(quote.number)}</div><div>Issued ${new Date(quote.createdAt).toLocaleDateString()}</div>${valid ? `<div>Valid until ${esc(valid)}</div>` : ''}<div class="pill">${esc(quote.status)}</div></div>
  </div>
  <h1>${esc(quote.title)}</h1>
  ${quote.summary ? `<div class="summary">${esc(quote.summary)}</div>` : ''}
  <div class="parties">
    <div><div class="label">Prepared for</div><strong>${esc(quote.client.name)}</strong>${quote.client.company ? `<div>${esc(quote.client.company)}</div>` : ''}${quote.client.email ? `<div>${esc(quote.client.email)}</div>` : ''}${quote.client.phone ? `<div>${esc(quote.client.phone)}</div>` : ''}${quote.client.address ? `<div>${esc(quote.client.address)}</div>` : ''}</div>
    ${quote.propertyAddress ? `<div><div class="label">Property</div><strong>${esc(quote.propertyAddress)}</strong></div>` : ''}
  </div>
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
    <tbody>${sections}</tbody>
  </table>
  ${optionalBlock}
  <table class="totals">
    <tr><td>Subtotal</td><td class="num">${m(t.subtotal)}</td></tr>
    ${t.discountAmount > 0 ? `<tr><td>Discount</td><td class="num">− ${m(t.discountAmount)}</td></tr>` : ''}
    ${t.taxAmount > 0 ? `<tr><td>${esc(quote.taxLabel || 'Tax')} (${quote.taxRatePct}%)</td><td class="num">${m(t.taxAmount)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="num">${m(t.total)}</td></tr>
    ${t.depositAmount > 0 ? `<tr class="deposit"><td>Deposit due now</td><td class="num">${m(t.depositAmount)}</td></tr><tr><td>Balance at completion</td><td class="num">${m(t.balanceDue)}</td></tr>` : ''}
  </table>
  ${quote.notes ? `<div class="note"><span class="label">Notes:</span> ${esc(quote.notes)}</div>` : ''}
  ${quote.terms ? `<div class="note"><span class="label">Terms:</span> ${esc(quote.terms)}</div>` : ''}
  <div class="foot">${esc(brand.name)} · ${esc(quote.number)} · Generated by CloseFlow Quotations</div>
  <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`);
  win.document.close();
}
