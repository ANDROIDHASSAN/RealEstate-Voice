import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Plus, Save, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input, Label, Select, Textarea } from '../ui/input';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface Choice { value: string; label: string }
interface ToolDef { value: string; label: string; description: string }

export interface StudioAgent {
  key: string;
  custom: boolean;
  enabled: boolean;
  name: string;
  language: string;
  purpose: string;
  firstMessage: string;
  systemPrompt: string;
  transcriberProvider: string;
  transcriberModel: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  voiceProvider: string;
  voiceId: string;
  tools: string[];
  knowledgeDocIds: string[];
  status: 'live' | 'ready';
}

interface Catalog {
  transcriberProviders: Choice[];
  transcriberModels: Record<string, Choice[]>;
  modelProviders: Choice[];
  models: Record<string, Choice[]>;
  voiceProviders: Choice[];
  voices: Record<string, Choice[]>;
  tools: ToolDef[];
  languages: Choice[];
}

interface StudioResponse {
  agents: StudioAgent[];
  catalog: Catalog;
  knowledgeDocs: { _id: string; title: string; chunkCount: number }[];
}

const SAMPLE_PROMPT = `## Identity & Purpose
You are Riley, a friendly, professional real-estate voice assistant. Your goal is to qualify the lead and book a consultation.

## Voice & Persona
Warm, concise, confident. Never pushy. Mirror the caller's pace.

## Conversation flow
1. Greet and confirm you're speaking with the right person.
2. Discover: buying/selling, area, budget, timeline, financing.
3. Handle objections with empathy; offer value (market snapshot).
4. Book a consult; confirm by text.

## Guardrails
- Only use facts from the knowledge base; never invent listings or prices.
- If asked something you don't know, offer to have a human follow up.
- Respect Do-Not-Call and quiet hours.`;

export function AgentStudio({ onSelectForTest, onDemo }: { onSelectForTest?: (key: string) => void; onDemo?: (key: string, name: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const studio = useQuery({ queryKey: ['voice-studio'], queryFn: () => api<StudioResponse>('/voice-agents') });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudioAgent | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Pick the first agent by default; sync the editable draft when selection changes.
  useEffect(() => {
    if (!studio.data) return;
    const key = selectedKey ?? studio.data.agents[0]?.key ?? null;
    if (key !== selectedKey) setSelectedKey(key);
    const agent = studio.data.agents.find((a) => a.key === key) ?? null;
    setDraft(agent ? { ...agent } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.data, selectedKey]);

  const save = useMutation({
    mutationFn: (a: StudioAgent) =>
      api<{ agent: StudioAgent }>(`/voice-agents/${a.key}`, {
        method: 'PUT',
        body: {
          name: a.name, language: a.language, purpose: a.purpose, firstMessage: a.firstMessage,
          systemPrompt: a.systemPrompt, transcriberProvider: a.transcriberProvider, transcriberModel: a.transcriberModel,
          modelProvider: a.modelProvider, modelName: a.modelName, temperature: a.temperature,
          voiceProvider: a.voiceProvider, voiceId: a.voiceId, tools: a.tools, knowledgeDocIds: a.knowledgeDocIds,
        },
      }),
    onSuccess: () => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      void qc.invalidateQueries({ queryKey: ['voice-studio'] });
      void qc.invalidateQueries({ queryKey: ['voice-agents'] });
    },
  });

  const create = useMutation({
    mutationFn: () => api<{ agent: StudioAgent }>('/voice-agents', { method: 'POST', body: { name: 'New Agent', firstMessage: 'Hi, thanks for taking my call!' } }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['voice-studio'] });
      setSelectedKey(d.agent.key);
    },
  });

  const remove = useMutation({
    mutationFn: (key: string) => api(`/voice-agents/${key}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedKey(null);
      void qc.invalidateQueries({ queryKey: ['voice-studio'] });
      void qc.invalidateQueries({ queryKey: ['voice-agents'] });
    },
  });

  if (studio.isLoading) return <Card><CardDescription>{t('common.loading')}</CardDescription></Card>;
  const cat = studio.data!.catalog;
  const docs = studio.data!.knowledgeDocs;
  const set = (patch: Partial<StudioAgent>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleTool = (tool: string) =>
    setDraft((d) => (d ? { ...d, tools: d.tools.includes(tool) ? d.tools.filter((x) => x !== tool) : [...d.tools, tool] } : d));
  const toggleDoc = (id: string) =>
    setDraft((d) => (d ? { ...d, knowledgeDocIds: d.knowledgeDocIds.includes(id) ? d.knowledgeDocIds.filter((x) => x !== id) : [...d.knowledgeDocIds, id] } : d));

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Bot className="h-5 w-5" />
        <CardTitle>{t('studio.title')}</CardTitle>
        <Badge tone="purple" className="ms-2">{studio.data!.agents.length}</Badge>
        <Button size="sm" variant="secondary" className="ms-auto" onClick={() => create.mutate()} disabled={create.isPending}>
          <Plus className="h-4 w-4" /> {t('studio.newAgent')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px,1fr]">
        {/* Agent list */}
        <ul className="max-h-[560px] space-y-1.5 overflow-y-auto pe-1">
          {studio.data!.agents.map((a) => (
            <li key={a.key}>
              <button
                onClick={() => setSelectedKey(a.key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-start text-sm transition-colors',
                  a.key === selectedKey ? 'bg-accent text-accent-on' : 'bg-surface-2 hover:bg-card-blue',
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card-purple text-xs font-bold text-ink">
                  {a.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className={cn('block truncate text-xs', a.key === selectedKey ? 'text-accent-on/70' : 'text-ink-soft')}>
                    {a.modelProvider} · {a.voiceProvider}
                  </span>
                </span>
                {a.custom && <Badge tone={a.key === selectedKey ? 'neutral' : 'yellow'}>{t('studio.custom')}</Badge>}
              </button>
            </li>
          ))}
        </ul>

        {/* Editor */}
        {draft && (
          <div className="space-y-5">
            {/* Identity */}
            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{t('studio.name')}</Label>
                <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div>
                <Label>{t('studio.language')}</Label>
                <Select value={draft.language} onChange={(e) => set({ language: e.target.value })}>
                  {cat.languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>{t('studio.firstMessage')}</Label>
                <Input value={draft.firstMessage} onChange={(e) => set({ firstMessage: e.target.value })} />
              </div>
            </section>

            {/* Pipeline: transcriber / model / voice — the Vapi trio */}
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl bg-card-yellow/40 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('studio.transcriber')}</p>
                <Label>{t('studio.provider')}</Label>
                <Select value={draft.transcriberProvider} onChange={(e) => set({ transcriberProvider: e.target.value, transcriberModel: cat.transcriberModels[e.target.value]?.[0]?.value ?? '' })}>
                  {cat.transcriberProviders.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
                <Label className="mt-3">{t('studio.model')}</Label>
                <Select value={draft.transcriberModel} onChange={(e) => set({ transcriberModel: e.target.value })}>
                  {(cat.transcriberModels[draft.transcriberProvider] ?? []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </div>

              <div className="rounded-2xl bg-card-blue/40 p-4">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  <Sparkles className="h-3 w-3" /> {t('studio.brain')}
                </p>
                <Label>{t('studio.provider')}</Label>
                <Select value={draft.modelProvider} onChange={(e) => set({ modelProvider: e.target.value, modelName: cat.models[e.target.value]?.[0]?.value ?? '' })}>
                  {cat.modelProviders.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
                <Label className="mt-3">{t('studio.model')}</Label>
                <Select value={draft.modelName} onChange={(e) => set({ modelName: e.target.value })}>
                  {(cat.models[draft.modelProvider] ?? []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
                <Label className="mt-3">{t('studio.temperature')}: {draft.temperature.toFixed(1)}</Label>
                <input type="range" min={0} max={1} step={0.1} value={draft.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} className="w-full accent-black" />
              </div>

              <div className="rounded-2xl bg-card-green/40 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('studio.voice')}</p>
                <Label>{t('studio.provider')}</Label>
                <Select value={draft.voiceProvider} onChange={(e) => set({ voiceProvider: e.target.value, voiceId: cat.voices[e.target.value]?.[0]?.value ?? '' })}>
                  {cat.voiceProviders.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
                <Label className="mt-3">{t('studio.voiceName')}</Label>
                <Select value={draft.voiceId} onChange={(e) => set({ voiceId: e.target.value })}>
                  {(cat.voices[draft.voiceProvider] ?? [{ value: draft.voiceId, label: draft.voiceId }]).map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </Select>
              </div>
            </section>

            {/* System prompt */}
            <section>
              <div className="mb-1 flex items-center justify-between">
                <Label className="mb-0">{t('studio.systemPrompt')}</Label>
                <button type="button" onClick={() => set({ systemPrompt: SAMPLE_PROMPT })} className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
                  <Wand2 className="h-3.5 w-3.5" /> {t('studio.usePrompt')}
                </button>
              </div>
              <Textarea rows={10} className="min-h-[220px] font-mono text-xs leading-relaxed" value={draft.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} placeholder={SAMPLE_PROMPT} />
            </section>

            {/* Tools */}
            <section>
              <Label>{t('studio.tools')}</Label>
              <div className="flex flex-wrap gap-2">
                {cat.tools.map((tool) => {
                  const on = draft.tools.includes(tool.value);
                  return (
                    <button key={tool.value} type="button" onClick={() => toggleTool(tool.value)} title={tool.description}
                      className={cn('flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors', on ? 'bg-accent text-accent-on' : 'bg-surface-2 text-ink-soft hover:bg-card-blue')}>
                      {on && <Check className="h-3 w-3" />} {tool.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Knowledge attach */}
            <section>
              <Label>{t('studio.knowledge')}</Label>
              {docs.length === 0 ? (
                <p className="text-sm text-ink-soft">{t('studio.noKnowledge')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {docs.map((d) => {
                    const on = draft.knowledgeDocIds.includes(d._id);
                    return (
                      <button key={d._id} type="button" onClick={() => toggleDoc(d._id)}
                        className={cn('flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors', on ? 'bg-card-green text-ink' : 'bg-surface-2 text-ink-soft hover:bg-card-green/60')}>
                        {on && <Check className="h-3 w-3" />} {d.title} <span className="opacity-60">· {d.chunkCount}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-4">
              <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
                <Save className="h-4 w-4" /> {savedFlash ? t('studio.saved') : save.isPending ? '…' : t('studio.save')}
              </Button>
              {onDemo && (
                <Button variant="pastel" onClick={() => onDemo(draft.key, draft.name)}>{t('voice.tryInBrowser')}</Button>
              )}
              {onSelectForTest && (
                <Button variant="secondary" onClick={() => onSelectForTest(draft.key)}>{t('studio.testThis')}</Button>
              )}
              {draft.custom && (
                <Button variant="danger" className="ms-auto" onClick={() => remove.mutate(draft.key)} disabled={remove.isPending}>
                  <Trash2 className="h-4 w-4" /> {t('studio.delete')}
                </Button>
              )}
              {!draft.custom && (
                <button onClick={() => remove.mutate(draft.key)} className="ms-auto text-xs text-ink-soft underline decoration-dotted hover:text-ink">
                  {t('studio.reset')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
