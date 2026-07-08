// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// TagImporterController
// -----------------------------------------------------------------------------
// Backend for the Tag Importer page (/api/tag-importer). Everything runs in the
// webserver against the shared WinCC OA API instance (WsjServerGlobal.winccoa) —
// there is NO dedicated manager. Three operations:
//
//   GET  /connections            list the OPC UA server connections (_OPCUAServer)
//   POST /browse   {connection,nodeId?,depth?}   one browse level of a live server
//   POST /apply    {plan,dryRun}                 create the datapoint types,
//                                                 datapoints and (online) OPC UA
//                                                 address configs of an ImportPlan
//
// The OPC UA browse + peripheral-address logic is ported from the proven ETM
// WinCC OA MCP server (OpcUaConnection/BaseConnection): browse writes a request
// id to `_<conn>.Browse.GetBranch` and correlates the echoed id on the response
// DPEs; the address config writes `_distrib` + `_address` atomically in ONE
// dpSetWait, reference `<Conn>$$1$1$<NodeId>`, _drv_ident "OPCUA".
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';
import { WinccoaDpTypeNode } from 'winccoa-manager';

// The winccoa-manager dynamic API (dpConnect/dpDisconnect/dpSetWait/…) is not
// fully described by the published types; treat the handle loosely, like the
// shared app-security guard does for the same reason.
/* eslint-disable @typescript-eslint/no-explicit-any */
function win(): any {
  return WsjServerGlobal.winccoa as any;
}

// --- element-type map (mirrors backend paraTypeNode / the ETM reference) ------
const ELEMENT_TYPE_MAP: Record<string, number> = {
  Struct: 1,
  Int: 21,
  Float: 22,
  Bool: 23,
  Bit32: 24,
  String: 25,
  Time: 26,
  Dpid: 27,
  Char: 19,
  UInt: 20,
  Typeref: 41,
  LangString: 42,
  Blob: 46,
  Long: 54,
  ULong: 58,
  Bit64: 50,
  DynChar: 3,
  DynUInt: 4,
  DynInt: 5,
  DynFloat: 6,
  DynBool: 7,
  DynBit32: 8,
  DynString: 9,
  DynTime: 10,
  DynDpid: 29,
  DynLangString: 44,
  DynBlob: 48,
  DynBit64: 51,
  DynLong: 55,
  DynULong: 59
};

// --- WinCC OA config constants (verified against the ETM reference) -----------
const DPCONFIG_PERIPH_ADDR_MAIN = 16;
const DPCONFIG_DISTRIBUTION_INFO = 56;
const BROWSE_TIMEOUT_MS = 120000;
const OBJECTS_FOLDER = 'ns=0;i=85';

/** The DPType-structure JSON shape (identical to the front-end ImportPlan). */
interface DpTypeStructure {
  name: string;
  type: string;
  refName?: string;
  children?: DpTypeStructure[];
}
interface PlanType {
  typeName: string;
  structure: DpTypeStructure;
}
interface PlanDp {
  dpName: string;
  dpType: string;
}
interface PlanAddress {
  dpe: string;
  reference: string;
  direction: number;
  datatype: number;
  pollGroup: string;
}
interface ImportPlan {
  types: PlanType[];
  dps: PlanDp[];
  addresses: PlanAddress[];
  connection?: string;
}
interface ApplyItemResult {
  kind: 'type' | 'dp' | 'address';
  name: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
}

/** One node returned by a browse level. */
interface BrowseNode {
  displayName: string;
  nodeId: string;
  browsePath: string;
  nodeClass: string;
  dataType: string;
  valueRank: number;
  hasChildren: boolean;
}

let requestCounter = 0;

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('already exist')) return 'already exists';
  if (message.includes('refName')) return 'referenced type does not exist or is invalid';
  return message;
}

/** Recursively build a WinccoaDpTypeNode from an ImportPlan DpTypeStructure. */
function buildTypeNode(node: DpTypeStructure): WinccoaDpTypeNode {
  const elementType = ELEMENT_TYPE_MAP[node.type];
  if (elementType === undefined) {
    throw new Error(`Invalid element type '${node.type}' for node '${node.name}'`);
  }
  const children = (node.children ?? []).map((c) => buildTypeNode(c));
  return new WinccoaDpTypeNode(node.name, elementType, node.refName ?? '', children);
}

export class TagImporterController {
  /** GET /api/tag-importer/health */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'tag-importer' });
  };

  /**
   * GET /api/tag-importer/connections
   * List the OPC UA server connections (_OPCUAServer datapoints). `name` is the
   * connection name without its leading underscore (as used in a reference).
   */
  public connections = async (_req: Request, res: Response): Promise<void> => {
    try {
      const w = win();
      const dps: string[] = w.dpNames('*', '_OPCUAServer') ?? [];
      const connections = await Promise.all(
        dps.map(async (dp) => {
          const name = dp.replace(/^_/, '').replace(/\.$/, '');
          let connected = false;
          try {
            const state = await w.dpGet(`${dp.replace(/\.$/, '')}.State.ConnState`);
            const v = Array.isArray(state) ? state[0] : state;
            connected = Number(v) > 0;
          } catch {
            connected = false;
          }
          return { name, connected };
        })
      );
      res.status(200).json({ ok: true, connections });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/tag-importer/browse   body { connection, nodeId?, depth? }
   * One browse level of a live server. Returns the direct children (or the
   * `depth` levels) of `nodeId` (defaults to the Objects folder).
   */
  public browse = async (req: Request, res: Response): Promise<void> => {
    const { connection, nodeId, depth } = (req.body ?? {}) as { connection?: string; nodeId?: string; depth?: number };
    if (!connection) {
      res.status(400).json({ ok: false, error: 'connection is required' });
      return;
    }
    const level = Math.min(Math.max(depth ?? 1, 1), 3);
    try {
      const nodes = await this.browseLevel(connection, nodeId ?? OBJECTS_FOLDER, level);
      res.status(200).json({ ok: true, nodes });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/tag-importer/apply   body { plan, dryRun }
   * Create the plan's datapoint types (in order), datapoints and address configs.
   * With `dryRun`, nothing is written — items report `skipped` (already exists)
   * or `created` (would be created).
   */
  public apply = async (req: Request, res: Response): Promise<void> => {
    const { plan, dryRun } = (req.body ?? {}) as { plan?: ImportPlan; dryRun?: boolean };
    if (!plan || !Array.isArray(plan.types) || !Array.isArray(plan.dps)) {
      res.status(400).json({ ok: false, error: 'a plan with types[] and dps[] is required' });
      return;
    }
    const dry = dryRun === true;
    const results: ApplyItemResult[] = [];
    try {
      await this.applyTypes(plan.types, dry, results);
      await this.applyDps(plan.dps, dry, results);
      await this.applyAddresses(plan, dry, results);
      const ok = results.every((r) => r.status !== 'failed');
      res.status(200).json({ ok, dryRun: dry, results });
    } catch (error) {
      res.status(500).json({ ok: false, dryRun: dry, results, error: describeError(error) });
    }
  };

  // --- apply helpers ----------------------------------------------------------

  private async applyTypes(types: PlanType[], dry: boolean, results: ApplyItemResult[]): Promise<void> {
    const w = win();
    for (const t of types) {
      if (this.typeExists(t.typeName)) {
        results.push({ kind: 'type', name: t.typeName, status: 'skipped' });
        continue;
      }
      if (dry) {
        results.push({ kind: 'type', name: t.typeName, status: 'created' });
        continue;
      }
      try {
        const node = buildTypeNode({ ...t.structure, name: t.typeName });
        const created = await w.dpTypeCreate(node);
        results.push({ kind: 'type', name: t.typeName, status: created ? 'created' : 'failed', error: created ? undefined : 'dpTypeCreate returned false' });
      } catch (error) {
        results.push({ kind: 'type', name: t.typeName, status: 'failed', error: describeError(error) });
      }
    }
  }

  private async applyDps(dps: PlanDp[], dry: boolean, results: ApplyItemResult[]): Promise<void> {
    const w = win();
    for (const d of dps) {
      if (this.dpInstanceExists(d.dpName)) {
        results.push({ kind: 'dp', name: d.dpName, status: 'skipped' });
        continue;
      }
      if (dry) {
        results.push({ kind: 'dp', name: d.dpName, status: 'created' });
        continue;
      }
      try {
        const created = await w.dpCreate(d.dpName, d.dpType);
        results.push({ kind: 'dp', name: d.dpName, status: created ? 'created' : 'failed', error: created ? undefined : 'dpCreate returned false' });
      } catch (error) {
        results.push({ kind: 'dp', name: d.dpName, status: 'failed', error: describeError(error) });
      }
    }
  }

  private async applyAddresses(plan: ImportPlan, dry: boolean, results: ApplyItemResult[]): Promise<void> {
    if (!plan.addresses || plan.addresses.length === 0) return;
    if (dry) {
      for (const a of plan.addresses) results.push({ kind: 'address', name: a.dpe, status: 'created' });
      return;
    }
    if (!plan.connection) {
      for (const a of plan.addresses) results.push({ kind: 'address', name: a.dpe, status: 'failed', error: 'no connection for address binding' });
      return;
    }
    let driver: number;
    try {
      driver = await this.managerNumberForConnection(plan.connection);
    } catch (error) {
      for (const a of plan.addresses) results.push({ kind: 'address', name: a.dpe, status: 'failed', error: describeError(error) });
      return;
    }
    const pollGroups = new Map<string, string>();
    for (const a of plan.addresses) {
      try {
        let pg = pollGroups.get(a.pollGroup);
        if (pg === undefined) {
          pg = await this.ensurePollGroup(a.pollGroup);
          pollGroups.set(a.pollGroup, pg);
        }
        await this.writeAddress(a, driver, pg);
        results.push({ kind: 'address', name: a.dpe, status: 'created' });
      } catch (error) {
        results.push({ kind: 'address', name: a.dpe, status: 'failed', error: describeError(error) });
      }
    }
  }

  /** Atomic `_distrib` + `_address` write for one DPE (ported from the ETM reference). */
  private async writeAddress(a: PlanAddress, driver: number, pollGroup: string): Promise<void> {
    const w = win();
    const dpes = [
      `${a.dpe}:_distrib.._type`,
      `${a.dpe}:_distrib.._driver`,
      `${a.dpe}:_address.._type`,
      `${a.dpe}:_address.._drv_ident`,
      `${a.dpe}:_address.._reference`,
      `${a.dpe}:_address.._direction`,
      `${a.dpe}:_address.._datatype`,
      `${a.dpe}:_address.._subindex`,
      `${a.dpe}:_address.._internal`,
      `${a.dpe}:_address.._lowlevel`,
      `${a.dpe}:_address.._offset`,
      `${a.dpe}:_address.._poll_group`,
      `${a.dpe}:_address.._active`
    ];
    const values = [
      DPCONFIG_DISTRIBUTION_INFO,
      driver,
      DPCONFIG_PERIPH_ADDR_MAIN,
      'OPCUA',
      a.reference,
      a.direction,
      a.datatype,
      0,
      false,
      true,
      0,
      pollGroup,
      true
    ];
    await w.dpSetWait(dpes, values);
  }

  // --- existence probes -------------------------------------------------------

  private typeExists(typeName: string): boolean {
    try {
      win().dpTypeGet(typeName);
      return true;
    } catch {
      return false;
    }
  }

  private dpInstanceExists(name: string): boolean {
    const w = win();
    try {
      return Boolean(w.dpExists(name)) || Boolean(w.dpExists(`${name}.`));
    } catch {
      return false;
    }
  }

  // --- OPC UA manager number + poll group (ported) ----------------------------

  private async managerNumberForConnection(connectionName: string): Promise<number> {
    const w = win();
    const normalized = connectionName.startsWith('_') ? connectionName.slice(1) : connectionName;
    const managers: string[] = w.dpNames('_OPCUA*', '_OPCUA') ?? [];
    for (const managerDp of managers) {
      try {
        const servers = await w.dpGet(`${managerDp.replace(/\.$/, '')}.Config.Servers`);
        if (Array.isArray(servers) && servers.includes(normalized)) {
          const match = /_OPCUA(\d+)/.exec(managerDp);
          if (match) return Number.parseInt(match[1], 10);
        }
      } catch {
        continue;
      }
    }
    const drivers: string[] = w.dpNames('_Driver*', '_DriverCommon') ?? [];
    for (const driverDp of drivers) {
      try {
        const dt = await w.dpGet(`${driverDp.replace(/\.$/, '')}.DT`);
        const v = Array.isArray(dt) ? dt[0] : dt;
        if (v === 'OPCUAC') {
          const match = /_Driver(\d+)/.exec(driverDp);
          if (match) return Number.parseInt(match[1], 10);
        }
      } catch {
        continue;
      }
    }
    throw new Error(`no OPC UA manager found for connection '${connectionName}' (register it with _OPCUA<n>.Config.Servers or start an OPC UA driver)`);
  }

  /** Ensure the poll-group DP exists (type `_PollGroup`, Active, 1000 ms); returns its normalised name. */
  private async ensurePollGroup(pollGroup: string): Promise<string> {
    const w = win();
    const normalized = pollGroup.startsWith('_') ? pollGroup : `_${pollGroup}`;
    if (this.dpInstanceExists(normalized)) return normalized;
    const created = await w.dpCreate(normalized, '_PollGroup');
    if (!created) throw new Error(`failed to create poll group ${normalized}`);
    await w.dpSetWait([`${normalized}.Active`, `${normalized}.PollInterval`], [1, 1000]);
    return normalized;
  }

  // --- browse (ported, single request/response with id correlation) -----------

  private browseLevel(connectionName: string, startNode: string, depth: number): Promise<BrowseNode[]> {
    const w = win();
    const connDp = connectionName.startsWith('_') ? connectionName : `_${connectionName}`;
    const start = startNode || OBJECTS_FOLDER;
    requestCounter += 1;
    const requestId = `tagimp_${Date.now()}_${requestCounter}`;
    const dpeList = [
      `${connDp}.Browse.DisplayNames`,
      `${connDp}.Browse.BrowsePaths`,
      `${connDp}.Browse.NodeIds`,
      `${connDp}.Browse.DataTypes`,
      `${connDp}.Browse.ValueRanks`,
      `${connDp}.Browse.NodeClasses`,
      `${connDp}.Browse.RequestId`
    ];
    return new Promise<BrowseNode[]>((resolve, reject) => {
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
            /* ignore */
          }
          connId = null;
        }
      };
      timer = setTimeout(() => {
        if (done) return;
        cleanup();
        reject(new Error(`browse timed out after ${BROWSE_TIMEOUT_MS / 1000}s (large address space or connectivity issue)`));
      }, BROWSE_TIMEOUT_MS);

      const callback = async (): Promise<void> => {
        if (done) return;
        try {
          const v = (await w.dpGet([
            `${connDp}.Browse.RequestId`,
            `${connDp}.Browse.DisplayNames`,
            `${connDp}.Browse.BrowsePaths`,
            `${connDp}.Browse.NodeIds`,
            `${connDp}.Browse.DataTypes`,
            `${connDp}.Browse.ValueRanks`,
            `${connDp}.Browse.NodeClasses`
          ])) as unknown[];
          if (v[0] !== requestId) return; // not our response
          const displayNames = (v[1] as unknown[]) ?? [];
          const browsePaths = (v[2] as unknown[]) ?? [];
          const nodeIds = (v[3] as unknown[]) ?? [];
          const dataTypes = (v[4] as unknown[]) ?? [];
          const valueRanks = (v[5] as unknown[]) ?? [];
          const nodeClasses = (v[6] as unknown[]) ?? [];
          const nodes: BrowseNode[] = [];
          for (let i = 0; i < displayNames.length; i += 1) {
            const displayName = String(displayNames[i] ?? '');
            if (displayName.length === 0) continue;
            const nodeClass = String(nodeClasses[i] ?? '');
            nodes.push({
              displayName,
              nodeId: String(nodeIds[i] ?? ''),
              browsePath: String(browsePaths[i] ?? ''),
              nodeClass,
              dataType: String(dataTypes[i] ?? ''),
              valueRank: Number(valueRanks[i] ?? -1),
              hasChildren: nodeClass.includes('Object') || nodeClass.includes('Folder')
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
        connId = w.dpConnect(callback, dpeList, false) as number;
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      w.dpSetWait(`${connDp}.Browse.GetBranch:_original.._value`, [requestId, start, depth, 0]).catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}
