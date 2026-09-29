// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// WinccoaOpcUaBrowsePort — the runtime implementation of the core's
// `OpcUaBrowsePort`, i.e. ONE browse level of a live OPC UA server.
// -----------------------------------------------------------------------------
// The request/response protocol is PORTED from the proven tag importer
// (`tagImporterController.browseLevel`, itself a port of the ETM WinCC OA MCP
// server's OpcUaConnection): write `[requestId, startNode, depth, 0]` to
// `_<conn>.Browse.GetBranch`, and read the six parallel result arrays once
// `_<conn>.Browse.RequestId` echoes our own id. Kept byte-for-byte compatible on
// purpose — this is the one part of an online browse that cannot be verified
// offline, so it must not be re-invented.
//
// What this file adds over the tag importer's copy:
//
//   * a per-connection QUEUE. Every browse of a connection goes through the same
//     `Browse.GetBranch` element, so a second request overwrites the first before
//     its answer arrives and the first caller waits for a reply that will never
//     come. The studio walks a whole address space (hundreds of levels) and two
//     operators may browse at once, so serialisation is not optional here.
//   * `hasChildren` is dropped: the core walker decides what to recurse into from
//     the node class, and a driver-reported "has children" flag adds nothing.
//   * `AccessLevel` is READ when the driver has it. The element name is discovered
//     by introspecting the `_OPCUAServer` DP type (the tag importer documents that
//     a browse does not expose it; whether a given driver version does is a
//     property of the installation, so this asks rather than assumes). When absent,
//     the walker marks the access `assumed` and the role decides the direction.
//
// The walk itself (paths, caps, cycles, warnings) lives in the pure core
// (`@visuelconcept/wui-eng-core` → `opcua/browse.ts`) and is unit-tested with a
// fake port and no runtime.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import type { OpcUaBrowseNode, OpcUaBrowsePort } from '@visuelconcept/wui-eng-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
function win(): any {
  return WsjServerGlobal.winccoa as any;
}

/** One browse must not hang the walk forever (a large branch is still slow). */
const BROWSE_TIMEOUT_MS = 60000;

let requestCounter = 0;

/**
 * Split/normalise a connection identifier to the DP base used for browsing.
 * Accepts the full DP (`System1:_Srv`, `_Srv`) as-is and prepends `_` to a bare
 * server name (`Srv` → `_Srv`) — `dpNames` returns either form.
 */
export function resolveConnDp(connection: string): string {
  const c = connection.replace(/\.$/, '');
  return c.includes(':') || c.startsWith('_') ? c : `_${c}`;
}

/** One OPC UA server connection as the studio offers it for browsing. */
export interface OpcUaConnectionInfo {
  /** Reference name (no leading `_`) — what an `_address.._reference` uses. */
  name: string;
  /** Full datapoint path. */
  dp: string;
  connected: boolean;
}

/**
 * List the project's OPC UA connections (`_OPCUAServer` datapoints).
 * Ported from `tagImporterController.connections`.
 */
export async function listOpcUaConnections(): Promise<OpcUaConnectionInfo[]> {
  const w = win();
  const dps: string[] = w.dpNames('*', '_OPCUAServer') ?? [];
  return Promise.all(
    dps.map(async (dpName: string) => {
      const full = dpName.replace(/\.$/, '');
      const afterSystem = full.includes(':') ? full.slice(full.indexOf(':') + 1) : full;
      let connected = false;
      try {
        const state = await w.dpGet(`${full}.State.ConnState`);
        const value = Array.isArray(state) ? state[0] : state;
        connected = Number(value) > 0;
      } catch {
        connected = false; // an unreachable connection is reported, not fatal
      }
      return { name: afterSystem.replace(/^_/, ''), dp: full, connected };
    })
  );
}

/**
 * Element of `_OPCUAServer.Browse` carrying the nodes' `AccessLevel`, DISCOVERED by
 * introspecting the DP type rather than guessed — the same technique
 * appSecurityGuard uses for the `_Users` schema.
 *
 * The tag importer's verified caveat is that a browse does not expose the access
 * level; whether a given driver version does is a property of the installation, so
 * this asks instead of assuming. `null` = the type has no such element (cached, so
 * the introspection happens once per process).
 *
 * Adding a non-existent DPE to the browse `dpConnect` would make the whole browse
 * fail, hence the up-front discovery.
 */
let accessLevelElement: string | null | undefined;

function discoverAccessLevelElement(): string | null {
  if (accessLevelElement !== undefined) return accessLevelElement;
  accessLevelElement = null;
  try {
    const browse = (win().dpTypeGet('_OPCUAServer')?.children ?? []).find(
      (child: any) => String(child?.name ?? '').toLowerCase() === 'browse'
    );
    const hit = (browse?.children ?? []).find((child: any) => /access/i.test(String(child?.name ?? '')));
    if (hit?.name) accessLevelElement = String(hit.name);
  } catch (error) {
    console.warn('engOpcuaBrowse: dpTypeGet(_OPCUAServer) failed:', (error as Error)?.message ?? error);
  }
  console.info(
    accessLevelElement === null
      ? 'engOpcuaBrowse: this OPC UA driver does not expose AccessLevel in Browse — browsed signals are catalogued read-only with an "assumed" access.'
      : `engOpcuaBrowse: AccessLevel read from Browse.${accessLevelElement}.`
  );
  return accessLevelElement;
}

export class WinccoaOpcUaBrowsePort implements OpcUaBrowsePort {
  /** Tail of the pending browse chain, per connection DP (the serialisation). */
  private readonly queues = new Map<string, Promise<unknown>>();

  /** Direct children of `nodeId`; queued behind any browse already running. */
  public async browseLevel(connection: string, nodeId: string): Promise<OpcUaBrowseNode[]> {
    const connDp = resolveConnDp(connection);
    const previous = this.queues.get(connDp) ?? Promise.resolve();
    // Chain on settle, not on success: one failed browse must not poison the queue.
    const run = previous.then(
      () => this.browseOnce(connDp, nodeId),
      () => this.browseOnce(connDp, nodeId)
    );
    this.queues.set(
      connDp,
      run.catch(() => undefined)
    );
    return run;
  }

  /** The ported single request/response with request-id correlation. */
  private browseOnce(connDp: string, startNode: string): Promise<OpcUaBrowseNode[]> {
    const w = win();
    requestCounter += 1;
    const requestId = `engstudio_${Date.now()}_${requestCounter}`;
    const accessElement = discoverAccessLevelElement();
    const resultDpes = [
      `${connDp}.Browse.DisplayNames`,
      `${connDp}.Browse.BrowsePaths`,
      `${connDp}.Browse.NodeIds`,
      `${connDp}.Browse.DataTypes`,
      `${connDp}.Browse.ValueRanks`,
      `${connDp}.Browse.NodeClasses`,
      `${connDp}.Browse.RequestId`
    ];
    return new Promise<OpcUaBrowseNode[]>((resolve, reject) => {
      let connId: number | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const cleanup = (): void => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (connId !== null) {
          try {
            w.dpDisconnect(connId);
          } catch {
            /* the connection may already be gone */
          }
          connId = null;
        }
      };
      timer = setTimeout(() => {
        if (done) return;
        cleanup();
        reject(new Error(`browse of '${startNode}' timed out after ${BROWSE_TIMEOUT_MS / 1000}s (large branch or connectivity issue)`));
      }, BROWSE_TIMEOUT_MS);

      const callback = async (): Promise<void> => {
        if (done) return;
        try {
          const readPaths = [
            `${connDp}.Browse.RequestId`,
            `${connDp}.Browse.DisplayNames`,
            `${connDp}.Browse.NodeIds`,
            `${connDp}.Browse.DataTypes`,
            `${connDp}.Browse.ValueRanks`,
            `${connDp}.Browse.NodeClasses`,
            `${connDp}.Browse.BrowsePaths`
          ];
          if (accessElement !== null) readPaths.push(`${connDp}.Browse.${accessElement}`);
          const v = (await w.dpGet(readPaths)) as unknown[];
          if (v[0] !== requestId) return; // another request's response
          const displayNames = (v[1] as unknown[]) ?? [];
          const nodeIds = (v[2] as unknown[]) ?? [];
          const dataTypes = (v[3] as unknown[]) ?? [];
          const valueRanks = (v[4] as unknown[]) ?? [];
          const nodeClasses = (v[5] as unknown[]) ?? [];
          const browsePaths = (v[6] as unknown[]) ?? [];
          const accessLevels = accessElement === null ? [] : ((v[7] as unknown[]) ?? []);
          const nodes: OpcUaBrowseNode[] = [];
          for (let i = 0; i < displayNames.length; i += 1) {
            const displayName = String(displayNames[i] ?? '');
            if (displayName.length === 0) continue;
            // Leave `accessLevel` UNDEFINED unless a real number came back: the
            // walker distinguishes "read the access" from "assumed read-only", and
            // a 0 coerced from an empty slot would read as "no read, no write".
            const rawAccess = accessLevels[i];
            const access = rawAccess === undefined || rawAccess === null || rawAccess === '' ? Number.NaN : Number(rawAccess);
            nodes.push({
              displayName,
              nodeId: String(nodeIds[i] ?? ''),
              browsePath: String(browsePaths[i] ?? ''),
              nodeClass: String(nodeClasses[i] ?? ''),
              dataType: String(dataTypes[i] ?? ''),
              valueRank: Number(valueRanks[i] ?? -1),
              ...(Number.isFinite(access) ? { accessLevel: access } : {})
            });
          }
          cleanup();
          resolve(nodes);
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      try {
        connId = w.dpConnect(callback, resultDpes, false) as number;
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      // depth 1: the response carries no parent link, so the core walker recurses
      // itself — that is the only way to know each node's path (see its header).
      w.dpSetWait(`${connDp}.Browse.GetBranch:_original.._value`, [requestId, startNode, 1, 0]).catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}
