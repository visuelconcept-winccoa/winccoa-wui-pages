// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client for the Process Monitor backend (`/api/process-monitor`, bridged over
 * MSA vRPC to the processMonitor manager). Manager list/control + chunked ZIP
 * upload & deploy. DPL import is handled by another module, not here.
 */
import type { DeployResult, Instance } from '../types.js';

const BASE = '/api/process-monitor';
/** Raw bytes per upload chunk (base64-expanded ~1.33× on the wire). */
const CHUNK_BYTES = 256 * 1024;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
