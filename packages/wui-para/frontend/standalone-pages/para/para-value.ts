/**
 * Value <-> string conversion for the PARA detail editor.
 *
 * Scalars convert one string to a WinCC OA value; `dyn_*` types convert a
 * multi-line draft (one item per line) to an array of such values.
 */

/** WinCC OA scalar types editable as numbers. */
export const NUMERIC_TYPES = new Set(['float', 'int', 'uint', 'long', 'ulong', 'char']);

/** WinCC OA scalar types editable as free text. */
export const STRING_TYPES = new Set(['string', 'langString', 'time']);

/** Whether a scalar (or `dyn_*` item) type can be edited inline. */
export function isEditableType(baseType: string): boolean {
  return NUMERIC_TYPES.has(baseType) || baseType === 'bool' || STRING_TYPES.has(baseType);
}

/**
 * Convert one scalar value to its WinCC OA value, or undefined if invalid.
 * `raw` may be a string (text inputs, list lines) or already a number/boolean
 * (e.g. ix-number-input / ix-toggle emit typed values).
 */
export function convertItem(baseType: string, raw: unknown): unknown {
  const text = typeof raw === 'string' ? raw : String(raw);
  if (baseType === 'bool') {
    return typeof raw === 'boolean' ? raw : text.trim().toLowerCase() === 'true';
  }
  if (NUMERIC_TYPES.has(baseType)) {
    const num = Number(text);
    return text.trim() === '' || Number.isNaN(num) ? undefined : num;
  }
  return text;
}

/** Parse a multi-line draft into an array (one item per line), or undefined if a line is invalid. */
export function convertDynList(baseType: string, draft: string): unknown[] | undefined {
  const lines = draft === '' ? [] : draft.split('\n').map((line) => line.replace(/\r$/, ''));
  // A trailing newline yields an empty last line - drop it rather than emit a blank item.
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const items: unknown[] = [];
  for (const line of lines) {
    const item = convertItem(baseType, line);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

/** Render one array item for display in the multi-line editor. */
export function formatDynItem(item: unknown): string {
  return typeof item === 'object' && item != null ? JSON.stringify(item) : String(item);
}

/** Format a WinCC OA source time as a compact local-timezone string (empty if unset). */
export function formatStime(raw: unknown): string {
  if (raw == null || raw === '') {
    return '';
  }
  const date = raw instanceof Date ? raw : new Date(raw as string | number);
  if (Number.isNaN(date.getTime())) {
    return String(raw);
  }
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}
