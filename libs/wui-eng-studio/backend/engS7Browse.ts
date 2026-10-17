// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// engS7Browse — the webserver's client to the **s7Browse JS manager**.
// -----------------------------------------------------------------------------
// Classic S7 (S7-300/400) has no symbolic browse: the CPU answers a BLOCK
// DIRECTORY — which blocks exist, how big they are, when they were compiled —
// and never a name, a type or an offset. Those live in the STEP 7 project and
// reach the studio through its exports (`s7/symbols.ts`, `s7/awl.ts`).
//
// So this is not a generator client. It fetches an INVENTORY, and the pure core
// (`s7/inventory.ts`, unit-tested with no runtime) turns it into verdicts about
// a catalog: a data block the catalog addresses that the CPU does not hold, a
// block the catalog reads past the end of, blocks the export left behind.
//
// Why a manager rather than a socket opened here — the same reason as
// `engS7PlusBrowse`, plus one specific to this protocol: an inventory holds a TCP
// session to OT equipment for as long as it takes to describe every block, and
// the webserver serves the whole suite. One switched-off PLC must not become
// everybody's latency. The manager also enforces the guarantee that matters most:
// its protocol client implements the block-directory subset ONLY — no read, no
// write — so this feature cannot disturb a production PLC however it is called.
//
// `winccoa-manager` (the MSA `Vrpc` namespace) is provided by the WinCC OA node
// bootstrap at runtime and loaded through a guarded require: with MSA absent the
// S7 routes answer "manager unreachable" instead of breaking the whole dashboard
// webserver at load. There is deliberately NO fallback — speaking a raw
// industrial protocol from the webserver is exactly what the manager prevents.
// -----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Device, S7Inventory } from '@visuelconcept-winccoa/wui-eng-core';

let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn('engS7Browse: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

/** Service base name — must match the manager's `super(SERVICE_NAME)`. */
const S7_SERVICE_NAME = 'S7Browse';

/** Cached stub. Dropped on any failure so the next call reconnects (manager restart). */
let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (stubPromise === null) {
    stubPromise = Vrpc.Stub.createAndInitialize(S7_SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

/** Raised when the manager could not be reached or refused the call. */
export class S7BrowseError extends Error {}

interface S7Result {
  [key: string]: unknown;
  ok: boolean;
  error?: string;
}

/**
 * Call one method of the S7Browse service.
 *
 * A `{ok:false, error}` answer is returned as-is: "no route to host", "the rack
 * is wrong", "the block is protected" are ENGINEERING answers the operator must
 * read, not exceptions. Only a transport failure throws.
 */
export async function callS7(method: string, request: unknown = {}): Promise<S7Result> {
  if (Vrpc === null) throw new S7BrowseError('MSA vRPC unavailable (winccoa-manager)');
  try {
    const stub = await getStub();
    const ctx = new Vrpc.ClientContext();
    const payload = Vrpc.Variant.createString(JSON.stringify(request ?? {}));
    const response = await stub.callFunction(method, payload, ctx);
    if (response.status.statusCode !== Vrpc.StatusCode.OK) {
      throw new S7BrowseError(`S7Browse.${method}: ${String(response.status.text ?? response.status)}`);
    }
    return JSON.parse(String(response.response.value ?? '{}')) as S7Result;
  } catch (error) {
    // A stale stub (the manager was restarted) must not poison every later call.
    stubPromise = null;
    if (error instanceof S7BrowseError) throw error;
    const status = (error as { status?: { text?: string } })?.status;
    throw new S7BrowseError(status?.text ?? (error instanceof Error ? error.message : String(error)));
  }
}

/** `Health`, or `null` when the manager is not reachable. */
export async function s7ManagerHealth(): Promise<S7Result | null> {
  try {
    return await callS7('Health');
  } catch {
    return null;
  }
}

/**
 * The connection parameters of an S7 equipment, as the manager needs them.
 *
 * `null` when the device is not an S7 one or carries no address: the caller turns
 * that into a refusal naming what is missing, rather than dialling a default that
 * would reach some other machine on the network.
 */
export function s7EndpointOf(device: Device | undefined): { host: string; rack: number; slot: number } | null {
  if (device === undefined) return null;
  if (device.protocol !== 's7') return null;
  const parameters = (device.connection ?? {}) as Record<string, unknown>;
  const host = String(parameters['ip'] ?? '').trim();
  if (host === '') return null;
  const rack = Number(parameters['rack'] ?? 0);
  const slot = Number(parameters['slot'] ?? 2);
  return {
    host,
    rack: Number.isInteger(rack) && rack >= 0 ? rack : 0,
    // An S7-300 CPU sits at slot 2; the studio records what the device declared
    // and falls back to that rather than to 0, which reaches no CPU at all.
    slot: Number.isInteger(slot) && slot >= 0 ? slot : 2
  };
}

/** Ask the CPU who it is — one connect, no block walk. */
export async function probeS7(endpoint: { host: string; rack: number; slot: number; timeoutMs?: number }): Promise<S7Result> {
  return callS7('Probe', endpoint);
}

/**
 * Read the whole block directory of one CPU.
 *
 * The manager's answer is already the core's {@link S7Inventory} shape minus the
 * connection name, which only the caller knows — it is stamped on here so a
 * stored or displayed inventory says which declared connection it came from.
 */
export async function inventoryS7(
  endpoint: { host: string; rack: number; slot: number; timeoutMs?: number; maxBlocks?: number; withBlockInfo?: boolean },
  connection?: string
): Promise<{ inventory?: S7Inventory; error?: string }> {
  const result = await callS7('Inventory', endpoint);
  if (result.ok !== true) return { error: result.error ?? 'the S7 inventory failed' };
  const inventory = result['inventory'] as S7Inventory | undefined;
  if (inventory === undefined) return { error: 'the manager answered no inventory' };
  return { inventory: connection === undefined ? inventory : { ...inventory, connection } };
}
