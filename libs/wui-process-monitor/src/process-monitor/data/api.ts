// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client for the Process Monitor backend (`/api/process-monitor`, bridged over
 * MSA vRPC to the processMonitor manager). Manager list/control + chunked ZIP
 * upload & deploy. DPL import is handled by another module, not here.
 */
import type { DeployResult, Instance, ManagerSpec } from '../types.js';

const BASE = '/api/process-monitor';
/** Raw bytes per upload chunk (base64-expanded ~1.33× on the wire). */
const CHUNK_BYTES = 256 * 1024;

/**
 * A backend failure, carrying the HTTP status so the UI can tell WHERE it broke:
 * 403 is a refused permission, 502/503 mean the webserver answered but its bridge
 * to the `processMonitor` manager is down (see `isBridgeError`).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * True for the failures that are NOT about the request: the manager hosting the
 * MSA vRPC service is stopped, or still running the code it loaded before the last
 * backend deploy. The operator has to restart it — no retry will help.
 */
export function isBridgeError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 502 || error.status === 503);
}

/** One JSON request; every non-OK answer becomes an `ApiError` carrying its status. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  // A non-JSON body (e.g. an HTML error/login page) must not surface as a
  // JSON.parse SyntaxError — the status is what the caller needs.
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || data === null || data.ok === false) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  return data;
}

function getJson<T>(url: string): Promise<T> {
  return request<T>(url);
}

function postJson<T>(url: string, body: object): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/** One instance per connected server (a single instance on a standalone system). */
export async function listInstances(): Promise<Instance[]> {
  const data = await getJson<{ instances: Instance[] }>(`${BASE}/managers`);
  return data.instances ?? [];
}

/** `node` is the target node DP name (one per computer); '' / 'all' for the local/only one. */
export function controlManager(node: string, action: 'start' | 'stop' | 'restart', index: number): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/manager`, { node, action, index });
}

export function restartAll(node: string): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/restart`, { node });
}

/** Add a manager to the target node's pmon configuration (appended when `spec.index` is omitted). */
export function addManager(node: string, spec: ManagerSpec): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/manager/add`, { node, ...spec });
}

/** Remove a STOPPED manager from the target node's pmon configuration (index ≥ 1). */
export function removeManager(node: string, index: number): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/manager/remove`, { node, index });
}

/** Sub-batch size for stack-safe base64 (each byte 0–255 maps 1:1 to a code point). */
const B64_SUB = 32_768;

/** Base64-encode a byte array without blowing the call stack on large chunks. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_SUB) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + B64_SUB));
  }
  return btoa(binary);
}

/** Upload a ZIP in chunks then deploy it (optional folder purge + restart). */
export async function deployZip(
  file: File,
  opts: { clearFolders: string[]; restart: boolean; target?: string; onProgress?: (fraction: number) => void }
): Promise<DeployResult> {
  const { uploadId } = await postJson<{ uploadId: string }>(`${BASE}/upload/init`, { fileName: file.name });
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_BYTES);
    const bytes = new Uint8Array(await slice.arrayBuffer());
    await postJson(`${BASE}/upload/chunk`, { uploadId, data: toBase64(bytes) });
    offset += bytes.length;
    opts.onProgress?.(file.size > 0 ? offset / file.size : 1);
  }
  return postJson<DeployResult>(`${BASE}/upload/finalize`, {
    uploadId,
    clearFolders: opts.clearFolders,
    restart: opts.restart,
    target: opts.target ?? 'all'
  });
}
