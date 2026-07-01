/** Resolve {{merge.fields}} against a flat context object. Unknown fields become ''. */
export function mergeFields(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const val = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, ctx);
    return val === undefined || val === null ? '' : String(val);
  });
}
