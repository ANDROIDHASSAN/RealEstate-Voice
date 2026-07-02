import { formatMoney, type QuoteLineItem, type QuoteTotals } from '@truecode/shared';
import { CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : '/api';

interface PortalDoc {
  number: string; title: string; client: { name: string; email?: string; address?: string };
  propertyAddress?: string; lineItems?: QuoteLineItem[]; currency?: string; taxRatePct?: number;
  totals?: QuoteTotals; amountPaid?: number; balance?: number; dueDate?: string; validUntil?: string;
  notes?: string; terms?: string; body?: string; status: string; signature?: { name: string; signedAt: string };
}
interface PortalResp { kind: 'quote' | 'invoice' | 'document'; brand: { name: string; owner?: string }; doc: PortalDoc; }

export default function PublicPortal() {
  const { kind, token } = useParams<{ kind: string; token: string }>();
  const [data, setData] = useState<PortalResp | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [signName, setSignName] = useState('');

  const load = () => {
    fetch(`${BASE}/portal/${kind}/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PortalResp) => setData(d))
      .catch(() => setError(true));
  };
  useEffect(load, [kind, token]);

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/portal/${kind}/${token}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json()) as { status?: string; error?: string };
      if (r.ok) setDone(j.status ?? 'done');
    } finally { setBusy(false); }
  };

  if (error) return <Centered><p className="text-ink-soft">This link is invalid or has expired.</p></Centered>;
  if (!data) return <Centered><div className="cf-working h-10 w-10 rounded-full bg-card-purple" /></Centered>;

  const { brand, doc } = data;
  const cur = doc.currency ?? 'USD';
  const m = (n: number) => formatMoney(n, cur);

  return (
    <div className="min-h-screen bg-app py-10">
      <div className="mx-auto max-w-2xl px-4">
        <div className="rounded-card bg-surface p-8 shadow-soft">
          <div className="mb-6 flex items-center justify-between border-b border-black/10 pb-4">
            <div>
              <p className="text-lg font-bold">{brand.name}</p>
              {brand.owner && <p className="text-xs text-ink-soft">{brand.owner}</p>}
            </div>
            <div className="text-right text-xs text-ink-soft">
              <p className="text-sm font-semibold text-ink">{doc.number}</p>
              <span className="rounded-pill bg-surface-2 px-2 py-0.5 capitalize">{doc.status}</span>
            </div>
          </div>

          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <p className="mt-1 text-sm text-ink-soft">{data.kind === 'invoice' ? 'Billed to' : 'Prepared for'} {doc.client.name}{doc.propertyAddress ? ` · ${doc.propertyAddress}` : ''}</p>

          {/* Line items for quote/invoice */}
          {doc.lineItems && doc.totals && (
            <>
              <table className="mt-6 w-full text-sm">
                <thead><tr className="text-left text-xs text-ink-soft"><th className="pb-2">Description</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-black/5">
                  {doc.lineItems.map((li, i) => (<tr key={i}><td className="py-2">{li.description}</td><td className="py-2 text-right tabular-nums">{li.quantity}</td><td className="py-2 text-right font-medium tabular-nums">{m(li.quantity * li.unitPrice)}</td></tr>))}
                </tbody>
              </table>
              <div className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span className="tabular-nums">{m(doc.totals.subtotal)}</span></div>
                {doc.totals.taxAmount > 0 && <div className="flex justify-between"><span className="text-ink-soft">Tax</span><span className="tabular-nums">{m(doc.totals.taxAmount)}</span></div>}
                <div className="flex justify-between border-t border-black/10 pt-1 text-lg font-bold"><span>Total</span><span className="tabular-nums">{m(doc.totals.total)}</span></div>
                {typeof doc.balance === 'number' && data.kind === 'invoice' && <div className="flex justify-between font-semibold text-emerald-600"><span>Balance due</span><span className="tabular-nums">{m(doc.balance)}</span></div>}
              </div>
            </>
          )}

          {/* Document body */}
          {doc.body && <pre className="mt-6 whitespace-pre-wrap rounded-2xl bg-surface-2 p-5 font-sans text-sm leading-relaxed">{doc.body}</pre>}
          {(doc.notes || doc.terms) && <div className="mt-4 space-y-1 text-xs text-ink-soft">{doc.notes && <p><strong>Notes:</strong> {doc.notes}</p>}{doc.terms && <p><strong>Terms:</strong> {doc.terms}</p>}</div>}

          {/* Actions */}
          <div className="mt-8 border-t border-black/10 pt-6">
            {done ? (
              <div className="flex items-center gap-2 rounded-2xl bg-card-green p-4 text-sm font-medium"><CheckCircle2 className="h-5 w-5" /> {done === 'accepted' ? 'Accepted — thank you!' : done === 'signed' ? 'Signed — thank you!' : done === 'declined' ? 'Response recorded.' : 'Done.'}</div>
            ) : data.kind === 'quote' && (doc.status === 'sent' || doc.status === 'viewed') ? (
              <div className="flex gap-3">
                <button disabled={busy} onClick={() => post('/respond', { accept: true })} className="flex-1 rounded-pill bg-accent py-3 font-medium text-accent-on disabled:opacity-50">Accept proposal</button>
                <button disabled={busy} onClick={() => post('/respond', { accept: false })} className="rounded-pill bg-surface-2 px-6 py-3 font-medium disabled:opacity-50">Decline</button>
              </div>
            ) : data.kind === 'document' && (doc.status === 'sent' || doc.status === 'viewed') ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-ink-soft"><ShieldCheck className="h-4 w-4" /> Type your full legal name to sign electronically.</div>
                <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Full name" className="h-12 w-full rounded-2xl border border-black/10 bg-surface px-4 outline-none focus:ring-2 focus:ring-ink/10" />
                <div className="flex gap-3">
                  <button disabled={busy || signName.trim().length < 2} onClick={() => post('/sign', { signerName: signName.trim(), accept: true })} className="flex-1 rounded-pill bg-accent py-3 font-medium text-accent-on disabled:opacity-50">Sign document</button>
                  <button disabled={busy} onClick={() => post('/sign', { signerName: signName.trim() || 'Client', accept: false })} className="rounded-pill bg-surface-2 px-6 py-3 font-medium disabled:opacity-50">Decline</button>
                </div>
              </div>
            ) : doc.signature?.name ? (
              <div className="flex items-center gap-2 rounded-2xl bg-card-green p-4 text-sm"><CheckCircle2 className="h-5 w-5" /> Signed by {doc.signature.name} on {new Date(doc.signature.signedAt).toLocaleString()}</div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-soft"><FileText className="h-4 w-4" /> This {data.kind} is {doc.status}.</p>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-ink-soft">Secured by CloseFlow</p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-app">{children}</div>;
}
