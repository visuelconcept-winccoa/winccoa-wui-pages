// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// engS7PlusBrowse — the webserver's client to the **s7plusBrowse JS manager**,
// and the runtime implementation of the core's `S7PlusBrowsePort`.
// -----------------------------------------------------------------------------
// Unlike the OPC UA browse (which the webserver performs itself, see
// `engOpcuaBrowse.ts`), the S7Plus browse dialogue is owned by a dedicated
// JavaScript manager — `libs/wui-eng-studio/managers/s7plusBrowse/index.js`, MSA vRPC service
// `S7PlusBrowse`. The reasons live in that file's header; the one that decides the
// architecture is that `_<conn>.Browse.GetBranch` is a SINGLE request slot per
// connection, so the requests of a walk must be serialised by one long-lived
// owner — which a webserver (restarted on every deploy, possibly several
// instances) cannot be.
//
// So this module decides nothing and drives nothing: it ships a level request
// across, normalises the answer into the core's `S7PlusBrowseNode`, and reports
// whether the manager is there. The walk itself (item grammar, paths, caps,
// datatypes, warnings) is the pure core's `s7plus/browse.ts`, unit-tested with a
// fake port and no runtime.
//
// `winccoa-manager` (the MSA `Vrpc` namespace) is provided by the WinCC OA node
// bootstrap at runtime and loaded through a guarded require: with MSA absent the
// S7Plus routes answer "manager unreachable" instead of breaking the whole
// dashboard webserver at load. There is NO direct-API fallback here, on purpose —
// browsing from the webserver is precisely what the manager exists to prevent.
// -----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { S7PlusBrowseNode, S7PlusBrowsePort } from '@visuelconcept-winccoa/wui-eng-core';

let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn('engS7PlusBrowse: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

/** Service base name — must match the manager's `super(SERVICE_NAME)`. */
const S7PLUS_SERVICE_NAME = 'S7PlusBrowse';

/** Cached stub. Dropped on any failure so the next call reconnects (manager restart). */
let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (stubPromise === null) {
    stubPromise = Vrpc.Stub.createAndInitialize(S7PLUS_SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

/** Raised when the manager could not be reached or refused the call. */
export class S7PlusBrowseError extends Error {}

interface S7PlusResult {
  [key: string]: unknown;
  ok: boolean;
  error?: string;
}

/**
 * Call one method of the `S7PlusBrowse` service.
 *
 * Throws {@link S7PlusBrowseError} when the transport fails; an answer of
 * `{ok:false,error}` comes back as-is, because that is a *browse* problem (driver
 * stopped, PLC unreachable, unknown item) the operator must read — not an
 * exception. Same distinction the HTTP routes make between 502 and a reported
 * problem.
 */
export async function callS7Plus(method: string, request: unknown = {}): Promise<S7PlusResult> {
  if (Vrpc === null) throw new S7PlusBrowseError('MSA vRPC unavailable (winccoa-manager)');
  try {
    const stub = await getStub();
    const ctx = new Vrpc.ClientContext();
    const payload = Vrpc.Variant.createString(JSON.stringify(request ?? {}));
    const response = await stub.callFunction(method, payload, ctx);
    if (response.status.statusCode !== Vrpc.StatusCode.OK) {
      throw new S7PlusBrowseError(`S7PlusBrowse.${method}: ${String(response.status.text ?? response.status)}`);
    }
    return JSON.parse(String(response.response.value ?? '{}')) as S7PlusResult;
  } catch (error) {
    // A stale stub (the manager was restarted) must not poison every later call.
    stubPromise = null;
    if (error instanceof S7PlusBrowseError) throw error;
    const status = (error as { status?: { text?: string } })?.status;
    throw new S7PlusBrowseError(status?.text ?? (error instanceof Error ? error.message : String(error)));
  }
}

/** Same, turning an `{ok:false}` answer into a throw (for the walk). */
async function callS7PlusOrThrow(method: string, request: unknown = {}): Promise<S7PlusResult> {
  const result = await callS7Plus(method, request);
  if (!result.ok) throw new S7PlusBrowseError(result.error ?? `S7PlusBrowse.${method} refused the call`);
  return result;
}

/** Health of the manager, or `null` when it cannot be reached at all. */
export async function s7plusManagerHealth(): Promise<S7PlusResult | null> {
  try {
    return await callS7Plus('Health');
  } catch (error) {
    console.warn('engS7PlusBrowse: the s7plusBrowse manager is unreachable:', (error as Error).message);
    return null;
  }
}

/**
 * Whether the manager is available, remembered for a short while — same reasoning
 * as `engVrpc`: probing on every request would put a vRPC round-trip in front of
 * every read, never probing again would strand the page until the webserver
 * restarts (the manager is deployed and started AFTER it, in practice).
 */
const AVAILABILITY_TTL_MS = 30_000;
let available: { at: number; value: boolean } | null = null;

export async function s7plusManagerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (available !== null && now - available.at < AVAILABILITY_TTL_MS) return available.value;
  const health = await s7plusManagerHealth();
  available = { at: now, value: health !== null && health.ok === true };
  return available.value;
}

/** One S7Plus connection of the project, as the studio offers it for browsing. */
export interface S7PlusConnectionInfo {
  /** Reference name (no leading `_`). */
  name: string;
  /** Full datapoint path. */
  dp: string;
  connected: boolean;
  /** Raw `Common.State.ConnState`, when it was read. */
  connState?: number;
  /**
   * `Config.StationName` — the `project|station` the connection is configured
   * for, or the reserved online marker. Offered as the default browse source, so
   * an engineer does not retype what the WinCC OA side already knows.
   */
  station?: string;
  driverNumber?: number;
  address?: string;
  /** Why this connection could not be fully read (never fatal). */
  error?: string;
}

/**
 * The project's S7Plus connections. Answers an empty list rather than throwing
 * when the manager is absent: "nothing to browse" and "the studio is broken" must
 * look different, and the caller reports the reason separately.
 */
export async function listS7PlusConnections(): Promise<{ connections: S7PlusConnectionInfo[]; warning?: string }> {
  try {
    const result = await callS7Plus('Connections');
    if (!result.ok) return { connections: [], warning: result.error ?? 'the S7PlusBrowse manager refused the call' };
    return { connections: (result.connections as S7PlusConnectionInfo[]) ?? [] };
  } catch (error) {
    return { connections: [], warning: (error as Error).message };
  }
}

/** The browsable sources of a connection: the TIA exports + the online marker. */
export async function listS7PlusProjects(connection: string): Promise<S7PlusResult> {
  return callS7Plus('Projects', { connection });
}

/** The stations of one TIA project. */
export async function listS7PlusStations(connection: string, project: string): Promise<S7PlusResult> {
  return callS7Plus('Stations', { connection, project });
}

/**
 * The core's `S7PlusBrowsePort`, over the manager.
 *
 * Stateless on purpose: the per-connection serialisation lives in the manager (it
 * is the only place that can enforce it across callers), so nothing here has to be
 * shared between requests.
 */
export class ManagerS7PlusBrowsePort implements S7PlusBrowsePort {
  public async browseLevel(connection: string, item: string, hmiVisibleOnly: boolean): Promise<S7PlusBrowseNode[]> {
    const result = await callS7PlusOrThrow('Level', { connection, item, hmiVisibleOnly });
    const nodes = (result.nodes as Record<string, unknown>[]) ?? [];
    return nodes.map((node) => {
      const itemLength = Number(node.itemLength ?? -1);
      const comment = String(node.comment ?? '');
      return {
        nodePath: String(node.nodePath ?? ''),
        systemType: String(node.systemType ?? ''),
        valueType: String(node.valueType ?? ''),
        // -1 is the driver's "not applicable"; a NaN from a malformed answer must
        // not become a length of 0, which reads as a real (empty) string.
        itemLength: Number.isFinite(itemLength) ? itemLength : -1,
        ...(comment === '' ? {} : { comment })
      };
    });
  }
}
