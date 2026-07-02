import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { setLocale } from './i18n';

export interface AssistantStep {
  agentKey: string;
  title: string;
  detail?: string;
  status: 'done' | 'error' | 'blocked';
}

export interface ClientAction {
  type: string;
  path?: string;
  locale?: string;
  entity?: string;
  leadId?: string;
  goal?: string;
}

export interface AssistantResponse {
  plan: string[];
  reply: string;
  steps: AssistantStep[];
  clientAction?: ClientAction;
  clientActions?: ClientAction[];
  llm: { name: string; live: boolean };
}

/**
 * Runs the executable side of a planned command: navigation, cache refresh,
 * language switch and orchestration — the same client actions the API returns
 * to the chat panel. Business effects (calls, messages, scrapes, lead creation)
 * already happened server-side through the Queue + ComplianceGuard.
 */
function runClientActions(
  d: AssistantResponse,
  navigate: (path: string) => void,
  qc: ReturnType<typeof useQueryClient>,
) {
  const actions = d.clientActions?.length ? d.clientActions : d.clientAction ? [d.clientAction] : [];
  let navigated = false;
  for (const ca of actions) {
    if (ca.type === 'set_language' && ca.locale) setLocale(ca.locale);
    if (ca.type === 'refresh') void qc.invalidateQueries();
    if (ca.type === 'orchestrate' && ca.leadId) {
      navigate('/agents');
      navigated = true;
      void api('/orchestrator/run', {
        method: 'POST',
        body: { leadId: ca.leadId, goal: ca.goal ?? 'move this lead forward' },
      })
        .then(() => qc.invalidateQueries({ queryKey: ['agent-runs'] }))
        .catch(() => undefined);
    }
  }
  // A single navigate wins last so the user lands where the work happened.
  const nav = actions.find((a) => a.type === 'navigate' && a.path);
  if (nav?.path && !navigated) navigate(nav.path);
}

/**
 * Shared command pipeline for every natural-language control surface (typed
 * chat + hands-free Voice Mode). POSTs to `/assistant/command`, executes the
 * returned client actions, then hands the reply back to the caller so it can
 * render and/or speak it however it likes.
 */
export function useAssistantCommand(opts?: {
  onReply?: (d: AssistantResponse) => void;
  onError?: () => void;
}) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (text: string) =>
      api<AssistantResponse>('/assistant/command', {
        method: 'POST',
        body: { text, page: location.pathname, locale: i18n.language },
      }),
    onSuccess: (d) => {
      runClientActions(d, navigate, qc);
      opts?.onReply?.(d);
    },
    onError: () => opts?.onError?.(),
  });
}
