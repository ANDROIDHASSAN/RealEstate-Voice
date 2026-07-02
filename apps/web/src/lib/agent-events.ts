import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/auth';

const BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : '/api';

export interface AgentEvent {
  id: string;
  type: string;
  agentKey: string;
  title: string;
  detail?: string;
  status?: 'running' | 'done' | 'error' | 'blocked';
  ts: string;
}

const MAX_EVENTS = 80;

/**
 * Live agent activity: SSE stream with automatic reconnect, seeded from
 * /events/recent so the feed is never empty on first paint. EventSource can't
 * send headers, so the (short-lived) access token rides as a query param —
 * same verification path as requireAuth on the server.
 */
export function useAgentEvents(): { events: AgentEvent[]; live: boolean } {
  const token = useAuthStore((s) => s.accessToken);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [live, setLive] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const push = (incoming: AgentEvent[]) => {
      const fresh = incoming.filter((e) => !seen.current.has(e.id));
      if (!fresh.length) return;
      fresh.forEach((e) => seen.current.add(e.id));
      setEvents((prev) => [...fresh, ...prev].slice(0, MAX_EVENTS));
    };

    void fetch(`${BASE}/events/recent?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: AgentEvent[] }) => {
        if (!disposed && d.items) push(d.items);
      })
      .catch(() => undefined);

    const connect = () => {
      if (disposed) return;
      source = new EventSource(`${BASE}/events/stream?token=${encodeURIComponent(token)}`);
      source.addEventListener('hello', () => setLive(true));
      source.addEventListener('agent', (e) => {
        try {
          push([JSON.parse((e as MessageEvent).data) as AgentEvent]);
        } catch {
          // malformed frame — skip
        }
      });
      source.onerror = () => {
        setLive(false);
        source?.close();
        retry = setTimeout(connect, 4000);
      };
    };
    connect();

    return () => {
      disposed = true;
      source?.close();
      if (retry) clearTimeout(retry);
      setLive(false);
    };
  }, [token]);

  return { events, live };
}
