import { z } from 'zod';

/**
 * CMS — a full, self-service website content system per account.
 *
 * Everything the public marketing site renders is editable here:
 *  - Site settings (brand, theme/colors, contact, social, SEO, navigation, footer)
 *  - Pages built from a block registry (hero, rich text, image, gallery, features,
 *    stats, testimonial, CTA, contact form, HTML embed, divider…)
 *  - Blog posts
 *
 * Blocks are stored as `{ id, type, data }` where `data` is a free-form record.
 * The BLOCK_TYPES registry below describes each block's editable fields — the
 * web editor renders that generically and the public renderer switches on type,
 * so adding a new block is one registry entry + one render case (no schema churn).
 */

// ---------------------------------------------------------------------------
// Block registry — the single source of truth for the editor + renderer
// ---------------------------------------------------------------------------

export type BlockFieldKind = 'text' | 'textarea' | 'url' | 'lines' | 'color' | 'select';

export interface BlockField {
  key: string;
  label: string;
  kind: BlockFieldKind;
  placeholder?: string;
  help?: string;
  options?: string[]; // for kind: 'select'
}

export interface BlockTypeDef {
  type: string;
  label: string;
  /** lucide icon name (frontend maps it). */
  icon: string;
  description: string;
  fields: BlockField[];
}

export const BLOCK_TYPES: BlockTypeDef[] = [
  {
    type: 'hero', label: 'Hero', icon: 'Sparkles', description: 'Big headline banner with a call to action.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', placeholder: 'Find your dream home in Miami' },
      { key: 'subheading', label: 'Subheading', kind: 'textarea', placeholder: 'Luxury listings, expert guidance.' },
      { key: 'imageUrl', label: 'Background image URL', kind: 'url' },
      { key: 'ctaLabel', label: 'Button label', kind: 'text', placeholder: 'Book a consultation' },
      { key: 'ctaHref', label: 'Button link', kind: 'text', placeholder: '#contact' },
      { key: 'align', label: 'Alignment', kind: 'select', options: ['left', 'center'] },
    ],
  },
  {
    type: 'richtext', label: 'Rich Text', icon: 'AlignLeft', description: 'A heading and paragraphs of copy.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'body', label: 'Body', kind: 'textarea', help: 'Plain text; blank lines start new paragraphs.' },
    ],
  },
  {
    type: 'image', label: 'Image', icon: 'Image', description: 'A single image with optional caption.',
    fields: [
      { key: 'url', label: 'Image URL', kind: 'url' },
      { key: 'alt', label: 'Alt text', kind: 'text' },
      { key: 'caption', label: 'Caption', kind: 'text' },
    ],
  },
  {
    type: 'gallery', label: 'Gallery', icon: 'Images', description: 'A grid of images.',
    fields: [{ key: 'images', label: 'Image URLs (one per line)', kind: 'lines' }],
  },
  {
    type: 'features', label: 'Features', icon: 'LayoutGrid', description: 'A grid of feature cards.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'items', label: 'Items (one per line: Title | Description)', kind: 'lines', help: 'e.g. "Fast closings | We close in under 30 days"' },
    ],
  },
  {
    type: 'stats', label: 'Stats', icon: 'BarChart3', description: 'A row of big numbers.',
    fields: [{ key: 'items', label: 'Stats (one per line: Value | Label)', kind: 'lines', help: 'e.g. "$250M | Sold in 2025"' }],
  },
  {
    type: 'testimonial', label: 'Testimonial', icon: 'Quote', description: 'A client quote.',
    fields: [
      { key: 'quote', label: 'Quote', kind: 'textarea' },
      { key: 'author', label: 'Author', kind: 'text' },
      { key: 'role', label: 'Author role/location', kind: 'text' },
    ],
  },
  {
    type: 'cta', label: 'Call to Action', icon: 'MousePointerClick', description: 'A prompt with a button.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'body', label: 'Body', kind: 'textarea' },
      { key: 'buttonLabel', label: 'Button label', kind: 'text' },
      { key: 'buttonHref', label: 'Button link', kind: 'text' },
    ],
  },
  {
    type: 'contact', label: 'Contact Form', icon: 'Mail', description: 'A lead-capture form wired to your CRM.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', placeholder: 'Get in touch' },
      { key: 'note', label: 'Note', kind: 'textarea' },
    ],
  },
  {
    type: 'html', label: 'HTML Embed', icon: 'Code', description: 'Raw HTML (maps, forms, widgets).',
    fields: [{ key: 'code', label: 'HTML', kind: 'textarea' }],
  },
  {
    type: 'divider', label: 'Divider', icon: 'Minus', description: 'A horizontal separator.',
    fields: [],
  },
];

export function blockTypeDef(type: string): BlockTypeDef | undefined {
  return BLOCK_TYPES.find((b) => b.type === type);
}

/** Parse a "lines" field into rows; "A | B" becomes ['A','B']. */
export function parseLines(value: unknown): string[][] {
  if (typeof value !== 'string') return [];
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('|').map((p) => p.trim()));
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const blockSchema = z.object({
  id: z.string().max(40).optional(),
  type: z.enum(BLOCK_TYPES.map((b) => b.type) as [string, ...string[]]),
  data: z.record(z.unknown()).default({}),
});
export type Block = z.infer<typeof blockSchema>;

export const CONTENT_TYPES = ['page', 'post'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_STATUSES = ['draft', 'published'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const seoSchema = z.object({
  metaTitle: z.string().max(200).optional(),
  metaDescription: z.string().max(400).optional(),
  ogImage: z.string().max(600).optional(),
  noindex: z.boolean().optional(),
});

export const cmsContentInputSchema = z.object({
  type: z.enum(CONTENT_TYPES).default('page'),
  title: z.string().min(1).max(200),
  slug: z.string().max(80).regex(/^[a-z0-9-]*$/, 'lowercase letters, numbers, hyphens').optional(),
  status: z.enum(CONTENT_STATUSES).default('draft'),
  excerpt: z.string().max(500).optional(),
  coverImageUrl: z.string().max(600).optional(),
  blocks: z.array(blockSchema).max(100).default([]),
  seo: seoSchema.optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  showInNav: z.boolean().optional(),
  navOrder: z.number().min(0).max(999).optional(),
  isHome: z.boolean().optional(),
});
export type CmsContentInput = z.infer<typeof cmsContentInputSchema>;

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

export const navItemSchema = z.object({
  label: z.string().min(1).max(60),
  href: z.string().min(1).max(300),
});

export const siteConfigSchema = z.object({
  brandName: z.string().max(120).optional(),
  tagline: z.string().max(200).optional(),
  logoUrl: z.string().max(600).optional(),
  theme: z
    .object({
      primaryColor: z.string().max(20).optional(),
      accentColor: z.string().max(20).optional(),
      bgColor: z.string().max(20).optional(),
      font: z.enum(['sans', 'serif']).optional(),
    })
    .optional(),
  contact: z
    .object({
      phone: z.string().max(40).optional(),
      email: z.string().max(160).optional(),
      address: z.string().max(300).optional(),
    })
    .optional(),
  social: z
    .object({
      facebook: z.string().max(300).optional(),
      instagram: z.string().max(300).optional(),
      linkedin: z.string().max(300).optional(),
      youtube: z.string().max(300).optional(),
      x: z.string().max(300).optional(),
    })
    .optional(),
  seo: seoSchema.optional(),
  nav: z.array(navItemSchema).max(12).optional(),
  footerText: z.string().max(500).optional(),
  published: z.boolean().optional(),
});
export type SiteConfigInput = z.infer<typeof siteConfigSchema>;

export const DEFAULT_THEME = { primaryColor: '#111111', accentColor: '#1F9D6B', bgColor: '#FBF8F4', font: 'sans' as const };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
