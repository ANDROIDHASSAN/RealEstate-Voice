import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Globe, Loader2, Plus, Search, Trash2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input, Label, Textarea } from '../ui/input';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

const API_BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : '/api';
const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.html,.htm,.json,.vtt';

interface KbDoc { _id: string; title: string; chunkCount: number; embedded: boolean; createdAt: string }
interface KbResponse {
  docs: KbDoc[];
  embeddings: { name: string; live: boolean; reason?: string };
  systemPrompt: string;
}
interface SearchChunk { text: string; score: number; title: string }

export function KnowledgeBase() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const kb = useQuery({ queryKey: ['knowledge'], queryFn: () => api<KbResponse>('/knowledge') });

  const token = useAuthStore((s) => s.accessToken);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchChunk[] | null>(null);
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['knowledge'] });
    void qc.invalidateQueries({ queryKey: ['voice-studio'] });
  };

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setUploadErr(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API_BASE}/knowledge/upload`, {
          method: 'POST',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? 'upload_failed');
        }
      }
      refresh();
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const importUrl = useMutation({
    mutationFn: () => api('/knowledge/url', { method: 'POST', body: { url } }),
    onSuccess: () => {
      setUrl('');
      refresh();
    },
  });

  const add = useMutation({
    mutationFn: () => api('/knowledge', { method: 'POST', body: { title, content } }),
    onSuccess: () => {
      setTitle('');
      setContent('');
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
      void qc.invalidateQueries({ queryKey: ['voice-studio'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/knowledge/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
      void qc.invalidateQueries({ queryKey: ['voice-studio'] });
    },
  });
  const savePrompt = useMutation({
    mutationFn: (p: string) => api('/knowledge/prompt', { method: 'PUT', body: { systemPrompt: p } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['knowledge'] }),
  });
  const search = useMutation({
    mutationFn: () => api<{ chunks: SearchChunk[] }>('/knowledge/search', { method: 'POST', body: { query } }),
    onSuccess: (d) => setResults(d.chunks),
  });

  const promptValue = prompt ?? kb.data?.systemPrompt ?? '';

  return (
    <Card tone="purple">
      <div className="mb-1 flex items-center gap-2">
        <BookOpen className="h-5 w-5" />
        <CardTitle>{t('kb.title')}</CardTitle>
        {kb.data && (
          <Badge tone={kb.data.embeddings.live ? 'green' : 'yellow'} className="ms-auto" title={kb.data.embeddings.reason}>
            {kb.data.embeddings.live ? `RAG: ${kb.data.embeddings.name}` : t('kb.keyword')}
          </Badge>
        )}
      </div>
      <CardDescription className="mb-4">{t('kb.hint')}</CardDescription>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Add + list */}
        <div className="space-y-4">
          {/* Upload documents (NotebookLM-style sources) */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
            className={`flex flex-col items-center rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${dragOver ? 'border-ink bg-card-blue' : 'border-black/10 bg-surface'}`}
          >
            {uploading ? <Loader2 className="h-6 w-6 animate-spin text-ink-soft" /> : <UploadCloud className="h-6 w-6 text-ink-soft" />}
            <p className="mt-2 text-sm font-medium">{t('kb.uploadTitle')}</p>
            <p className="text-xs text-ink-soft">{t('kb.uploadFormats')}</p>
            <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
            <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <UploadCloud className="h-4 w-4" /> {uploading ? t('kb.uploading') : t('kb.chooseFiles')}
            </Button>
            {uploadErr && <p className="mt-2 text-xs text-red-600">{t('kb.uploadFailed')}: {uploadErr}</p>}
          </div>

          {/* Import from a web page */}
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (url.trim()) importUrl.mutate(); }}
          >
            <Input type="url" placeholder={t('kb.urlPh')} value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" size="md" variant="secondary" disabled={importUrl.isPending || !url.trim()} title={t('kb.importUrl')}>
              <Globe className="h-4 w-4" />
            </Button>
          </form>

          <form
            className="space-y-2 rounded-2xl bg-surface p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim() && content.trim()) add.mutate();
            }}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{t('kb.orPaste')}</p>
            <Label>{t('kb.docTitle')}</Label>
            <Input placeholder={t('kb.docTitlePh')} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Label className="mt-2">{t('kb.docContent')}</Label>
            <Textarea rows={5} placeholder={t('kb.docContentPh')} value={content} onChange={(e) => setContent(e.target.value)} />
            <Button type="submit" size="sm" disabled={add.isPending || !title.trim() || !content.trim()}>
              <Plus className="h-4 w-4" /> {add.isPending ? '…' : t('kb.add')}
            </Button>
          </form>

          <ul className="space-y-1.5">
            {(kb.data?.docs ?? []).map((d) => (
              <li key={d._id} className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-2 text-sm">
                <BookOpen className="h-4 w-4 shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <Badge tone={d.embedded ? 'green' : 'neutral'}>{d.chunkCount} {t('kb.chunks')}</Badge>
                <button onClick={() => remove.mutate(d._id)} className="text-ink-soft hover:text-ink" title={t('studio.delete')}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {(kb.data?.docs.length ?? 0) === 0 && <p className="px-1 text-sm text-ink-soft">{t('kb.empty')}</p>}
          </ul>
        </div>

        {/* Account instructions + test retrieval */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface p-4">
            <Label>{t('kb.globalPrompt')}</Label>
            <Textarea rows={4} placeholder={t('kb.globalPromptPh')} value={promptValue} onChange={(e) => setPrompt(e.target.value)} />
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => savePrompt.mutate(promptValue)} disabled={savePrompt.isPending}>
              {savePrompt.isSuccess && prompt === null ? t('studio.saved') : t('common.save')}
            </Button>
          </div>

          <div className="rounded-2xl bg-surface p-4">
            <Label>{t('kb.test')}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) search.mutate();
              }}
            >
              <Input placeholder={t('kb.testPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button type="submit" size="md" variant="secondary" disabled={search.isPending || !query.trim()}>
                <Search className="h-4 w-4" />
              </Button>
            </form>
            {results && (
              <div className="mt-3 space-y-2">
                {results.length === 0 ? (
                  <p className="text-sm text-ink-soft">{t('kb.noResults')}</p>
                ) : (
                  results.map((r, i) => (
                    <div key={i} className="rounded-xl bg-surface-2 p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone="blue">{Math.round(r.score * 100)}%</Badge>
                        <span className="text-xs font-medium text-ink-soft">{r.title}</span>
                      </div>
                      <p className="text-ink-soft">{r.text.slice(0, 240)}{r.text.length > 240 ? '…' : ''}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
