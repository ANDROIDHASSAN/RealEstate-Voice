import { cosineSimilarity, getEmbeddings } from '@closeflow/integrations';
import { logger } from '../logger.js';
import { KnowledgeDoc } from '../models.js';

/**
 * RAG service. Documents are chunked, embedded (when a key is set) and stored;
 * retrieval returns the most relevant chunks for a query — by cosine similarity
 * over embeddings, or a keyword-overlap score when running keyless. Used by the
 * voice agent (grounded answers), the assistant, and auto-replies.
 */

const CHUNK_TARGET = 700; // ~chars per chunk — a couple of sentences of context
const CHUNK_OVERLAP = 100;

/** Split text into overlapping chunks on sentence/paragraph boundaries. */
export function chunkText(content: string): string[] {
  const clean = content.replace(/\r\n/g, '\n').trim();
  if (clean.length <= CHUNK_TARGET) return clean ? [clean] : [];
  // Prefer to break on blank lines, then sentence ends.
  const units = clean.split(/\n\s*\n/).flatMap((p) => p.match(/[^.!?]+[.!?]*\s*/g) ?? [p]);
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if ((current + unit).length > CHUNK_TARGET && current) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - CHUNK_OVERLAP));
    }
    current += unit;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export interface IngestResult {
  docId: string;
  chunkCount: number;
  embedded: boolean;
}

/** Chunk + embed a document and persist it for the account. */
export async function ingestDocument(accountId: string, title: string, content: string, source = 'manual'): Promise<IngestResult> {
  const texts = chunkText(content);
  if (!texts.length) throw new Error('empty_document');

  let vectors: number[][] | null = null;
  try {
    vectors = await getEmbeddings().embed(texts);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'embedding failed — storing chunks for keyword retrieval');
    vectors = null;
  }

  const chunks = texts.map((text, i) => ({
    text,
    embedding: vectors && vectors[i]?.length ? vectors[i] : undefined,
  }));

  const doc = await KnowledgeDoc.create({
    accountId,
    title,
    source,
    chunkCount: chunks.length,
    embedded: Boolean(vectors),
    chunks,
  });
  return { docId: String(doc._id), chunkCount: chunks.length, embedded: Boolean(vectors) };
}

export interface RetrievedChunk {
  text: string;
  score: number;
  title: string;
}

/** Return the top-K most relevant chunks for a query across the account's KB. */
export async function retrieve(accountId: string, query: string, k = 4): Promise<RetrievedChunk[]> {
  const docs = await KnowledgeDoc.find({ accountId }).lean();
  if (!docs.length) return [];

  const allChunks = docs.flatMap((d) =>
    (d.chunks ?? []).map((c) => ({ text: c.text ?? '', embedding: c.embedding as number[] | undefined, title: d.title })),
  );
  if (!allChunks.length) return [];

  const haveVectors = allChunks.some((c) => c.embedding && c.embedding.length);
  let scored: RetrievedChunk[];

  if (haveVectors) {
    let qVec: number[][] | null = null;
    try {
      qVec = await getEmbeddings().embed([query]);
    } catch {
      qVec = null;
    }
    if (qVec && qVec[0]?.length) {
      const q = qVec[0];
      scored = allChunks.map((c) => ({
        text: c.text,
        title: c.title,
        score: c.embedding && c.embedding.length ? cosineSimilarity(q, c.embedding) : 0,
      }));
    } else {
      scored = keywordScore(allChunks, query);
    }
  } else {
    scored = keywordScore(allChunks, query);
  }

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Keyword-overlap fallback: fraction of the query's significant tokens present. */
function keywordScore(chunks: { text: string; title: string }[], query: string): RetrievedChunk[] {
  const stop = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'and', 'or', 'is', 'are', 'for', 'do', 'you', 'i', 'we', 'what', 'how', 'my', 'your']);
  const qTokens = tokenize(query).filter((t) => !stop.has(t));
  if (!qTokens.length) return [];
  const qSet = new Set(qTokens);
  return chunks.map((c) => {
    const cTokens = new Set(tokenize(c.text));
    let hits = 0;
    for (const t of qSet) if (cTokens.has(t)) hits += 1;
    return { text: c.text, title: c.title, score: hits / qSet.size };
  });
}

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9À-ɏ؀-ۿ]+/g) ?? [];
}

/** Build a compact context block to inject into a prompt (bounded length). */
export function toContextBlock(chunks: RetrievedChunk[], maxChars = 1500): string {
  let out = '';
  for (const c of chunks) {
    const piece = `- (${c.title}) ${c.text}\n`;
    if (out.length + piece.length > maxChars) break;
    out += piece;
  }
  return out.trim();
}
