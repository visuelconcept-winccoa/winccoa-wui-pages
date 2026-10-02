// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// engVrpc — the webserver's client to the Engineering Studio CTRL manager.
// -----------------------------------------------------------------------------
// The studio's project mutations (OPC UA connection creation, its security and
// password, datapoints, DP types, configs, poll groups) are performed by a CTRL
// manager hosting the MSA vRPC service "EngStudio"
// (`backend/project-scripts/wui/engStudioService.ctl`). This module is the stub
// side: one JSON string in, one JSON string out — the same convention as this
// project's JS managers, so the transport here looks exactly like aiController's.
//
// Two reasons the manager exists rather than doing everything from Node:
//   * the password can only be encrypted by the vendor's CTRL library
//     (drvsSecSetPassword -> secureEncode with the project's driver certificate);
//     it used to cost a spawned WCCOActrl process per save;
//   * putting every project write of the page behind ONE service ends the "two
//     code paths that must agree" problem.
//
// What this module deliberately does NOT do: decide anything. The pure core
// (`@visuelconcept/wui-eng-core`) builds every dpe/value pair and flattens every
// DP type; this only ships them across and reports what came back.
//
// `winccoa-manager` (the MSA `Vrpc` namespace) is provided by the WinCC OA node
// bootstrap at runtime, and is loaded through a guarded require: if MSA is
// unavailable the studio degrades to its direct-API fallback (see
// `engController`) instead of breaking the whole dashboard webserver at load.
// -----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn('engVrpc: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

/** Service base name — must match the CTRL side's `VrpcServiceBase("EngStudio")`. */
const ENG_SERVICE_NAME = 'EngStudio';

/** Cached stub. Dropped on any failure so the next call reconnects (service restart). */
let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (stubPromise === null) {
    stubPromise = Vrpc.Stub.createAndInitialize(ENG_SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

/** Every answer of the service carries at least this. */
export interface EngVrpcResult {
  [key: string]: unknown;
  ok: boolean;
  error?: string;
}

/** Raised when the manager could not be reached or refused the call. */
export class EngVrpcError extends Error {}

/**
 * Call one method of the EngStudio service.
 *
 * Throws {@link EngVrpcError} when the transport fails or the service answers a
 * non-OK status; an answer of `{ok:false,error}` is returned as-is, because that
 * is an ENGINEERING refusal the caller must show rather than an exception (the
 * same distinction the HTTP routes make between 502 and a reported problem).
 */
export async function callEng(method: string, request: unknown = {}): Promise<EngVrpcResult> {
  if (Vrpc === null) throw new EngVrpcError('MSA vRPC unavailable (winccoa-manager)');
  try {
    const stub = await getStub();
    const ctx = new Vrpc.ClientContext();
    const payload = Vrpc.Variant.createString(JSON.stringify(request ?? {}));
    const response = await stub.callFunction(method, payload, ctx);
    if (response.status.statusCode !== Vrpc.StatusCode.OK) {
      throw new EngVrpcError(`EngStudio.${method}: ${String(response.status.text ?? response.status)}`);
    }
    return JSON.parse(String(response.response.value ?? '{}')) as EngVrpcResult;
  } catch (error) {
    // A stale stub (the manager was restarted) must not poison every later call.
    stubPromise = null;
    if (error instanceof EngVrpcError) throw error;
    const status = (error as { status?: { text?: string } })?.status;
    throw new EngVrpcError(status?.text ?? (error instanceof Error ? error.message : String(error)));
  }
}

/** Same as {@link callEng}, turning an `{ok:false}` answer into a throw. */
export async function callEngOrThrow(method: string, request: unknown = {}): Promise<EngVrpcResult> {
  const result = await callEng(method, request);
  if (!result.ok) throw new EngVrpcError(result.error ?? `EngStudio.${method} refused the call`);
  return result;
}

/** Health of the manager, or `null` when it cannot be reached at all. */
export async function engManagerHealth(): Promise<EngVrpcResult | null> {
  try {
    return await callEng('Health');
  } catch (error) {
    console.warn('engVrpc: EngStudio manager unreachable:', (error as Error).message);
    return null;
  }
}

/**
 * Whether the manager is available, remembered for a short while.
 *
 * Probing on every request would put a vRPC round-trip in front of every read;
 * never probing again would strand the page on the fallback path until the
 * webserver restarts (the manager is deployed and started AFTER it, in practice).
 * So the answer is cached for {@link AVAILABILITY_TTL_MS} — long enough to cost
 * nothing on a burst of requests, short enough that starting the manager takes
 * effect while an operator is still on the page.
 */
const AVAILABILITY_TTL_MS = 30_000;
let available: { at: number; value: boolean } | null = null;

export async function engManagerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (available !== null && now - available.at < AVAILABILITY_TTL_MS) return available.value;
  const health = await engManagerHealth();
  available = { at: now, value: health !== null && health.ok === true };
  return available.value;
}

/** Forget the cached availability — used after a failure, so the next call re-probes. */
export function forgetEngManager(): void {
  available = null;
  stubPromise = null;
}

export { ENG_SERVICE_NAME };
