/**
 * Extract plain text from an uploaded document for the knowledge base.
 * Supports PDF, DOCX, and any UTF-8 text format (txt/md/csv/json/html).
 * Heavy parsers are imported lazily so they never load unless needed.
 */
export async function extractText(buffer: Buffer, filename: string, mimetype?: string): Promise<string> {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();

  if (ext === 'pdf' || mimetype === 'application/pdf') {
    // Import the parser directly (its index.js runs a debug harness on load).
    const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as {
      default: (b: Buffer) => Promise<{ text: string }>;
    };
    const pdf = mod.default ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
    const data = await pdf(buffer);
    return data.text;
  }

  if (ext === 'docx' || mimetype?.includes('officedocument.wordprocessingml')) {
    const mammoth = (await import('mammoth')) as unknown as {
      extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const res = await mammoth.extractRawText({ buffer });
    return res.value;
  }

  if (ext === 'html' || ext === 'htm' || mimetype === 'text/html') {
    return stripHtml(buffer.toString('utf8'));
  }

  // txt, md, csv, json, vtt, and any other text — read as UTF-8.
  return buffer.toString('utf8');
}

/** Strip a URL's HTML down to readable text (used by URL import). */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull a human title from an HTML document, falling back to the URL host. */
export function titleFromHtml(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return (m?.[1]?.trim() || fallback).slice(0, 180);
}
