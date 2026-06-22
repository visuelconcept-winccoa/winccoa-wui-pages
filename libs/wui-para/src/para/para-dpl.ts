/**
 * DPL (WinCC OA ASCII) client helpers for the PARA page.
 *
 * Talk to the PARA backend's DPL bridge (same origin), which forwards to the
 * "DplAscii" MSA manager driving WCCOAasciiSQLite:
 *   export -> POST /api/para/dpl/export { dps?, dpts? } -> { contentBase64, fileName, … }
 *   import -> POST /api/para/dpl/import { fileName, contentBase64 } -> { ok, message }
 *
 * Export streams the returned .dpl straight to a browser download; import reads
 * the chosen file as base64 and posts it. The manager performs the actual ASCII
 * export/import on the server.
 */

const EXPORT_URL = '/api/para/dpl/export';
const IMPORT_URL = '/api/para/dpl/import';

/** DPs and datapoint types selected for export. */
export interface DplSelection {
  dps: string[];
  dpts: string[];
  /**
   * Optional record-kind filter — a subset of WCCOAasciiSQLite's TDACOPH letters
   * (T types, D datapoints, A aliases&comments, C cns, O original values,
   * P parametrization/configs, H config timestamps). Omitted -> full export.
   */
  filter?: string;
}

/** Normalized result of a DPL operation. */
export interface DplResult {
  ok: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
  fileName?: string;
  count?: number;
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Decode base64 to bytes without blowing the call stack on large payloads. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}

/** Encode bytes to base64 in chunks (avoids String.fromCodePoint arg-count limits). */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 32_768;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function triggerDownload(fileName: string, base64: string): void {
  const buffer = base64ToBytes(base64).buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Export the selected DPs/DPTs to a .dpl and download it. Returns the backend result. */
export async function exportDpl(selection: DplSelection): Promise<DplResult> {
  const response = await fetch(EXPORT_URL, jsonPost(selection));
  const data = (await response
    .json()
    .catch(() => ({ ok: false, error: `HTTP ${response.status}` }))) as DplResult & { contentBase64?: string };
  if (response.ok && data.ok && data.contentBase64) {
    triggerDownload(data.fileName ?? 'export.dpl', data.contentBase64);
  } else if (data.error == null) {
    data.error = `Export refusé (HTTP ${response.status})`;
  }
  return data;
}

/** Read a chosen .dpl file and import it through the backend. */
export async function importDpl(file: File): Promise<DplResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentBase64 = bytesToBase64(bytes);
  const response = await fetch(IMPORT_URL, jsonPost({ fileName: file.name, contentBase64 }));
  const data = (await response
    .json()
    .catch(() => ({ ok: false, error: `HTTP ${response.status}` }))) as DplResult;
  if (!response.ok && data.error == null) {
    data.error = `Import refusé (HTTP ${response.status})`;
  }
  return data;
}

/** Open a native file picker for a single .dpl and resolve the chosen file (or null). */
export function pickDplFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dpl';
    input.addEventListener('change', () => resolve(input.files && input.files.length > 0 ? input.files[0] : null));
    input.click();
  });
}
