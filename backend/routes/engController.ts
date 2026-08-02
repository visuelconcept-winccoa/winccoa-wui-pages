// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// EngController — backend for the Engineering Studio page (/api/eng).
// -----------------------------------------------------------------------------
// SKELETON. The engineering LOGIC (diff, plan, atomic config builders, apply)
// lives in the pure `@visuelconcept/wui-eng-core` library — unit-tested with no
// runtime. This controller is only the THIN runtime seam: it implements the
// core's `EngPort` over the shared WinCC OA API (WsjServerGlobal.winccoa) and
// wires the HTTP endpoints the studio's HttpEngGateway calls.
//
// The core is bundled next to these srcFiles at deploy time (see
// docs/wui-eng-studio/INTEGRATION.md — vendored like page kits). No dedicated
// manager: everything runs against WsjServerGlobal.winccoa, as paraController
// and tagImporterController already do.
//
// Deliberately DECOUPLED and partial: `checkout`/`liveSnapshot` config reading
// and the address/poll-group resolution are marked TODO — the studio already
// runs end-to-end against the in-memory DemoEngGateway, so this backend can be
// completed and verified against a live project incrementally.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';
import { WinccoaDpTypeNode } from 'winccoa-manager';
import {
  applyPlan,
  baselineOf,
  diffWorkspace,
  type AddressConfig,
  type DpTypeStructure,
  type EngPlan,
  type EngPort,
  type LiveSnapshot,
  type Workspace
} from '@visuelconcept/wui-eng-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
function win(): any {
  return WsjServerGlobal.winccoa as any;
}

/** Element-type map (mirrors paraTypeNode / tagImporterController). */
const ELEMENT_TYPE_MAP: Record<string, number> = {
  Struct: 1, Int: 21, Float: 22, Bool: 23, Bit32: 24, String: 25, Time: 26, Dpid: 27,
  Char: 19, UInt: 20, Typeref: 41, LangString: 42, Blob: 46, Long: 54, ULong: 58, Bit64: 50,
  DynChar: 3, DynUInt: 4, DynInt: 5, DynFloat: 6, DynBool: 7, DynBit32: 8, DynString: 9,
  DynTime: 10, DynDpid: 29, DynLangString: 44, DynBlob: 48, DynBit64: 51, DynLong: 55, DynULong: 59
};

function buildTypeNode(node: DpTypeStructure): WinccoaDpTypeNode {
  const elementType = ELEMENT_TYPE_MAP[node.type];
  if (elementType === undefined) throw new Error(`Invalid element type '${node.type}' for '${node.name}'`);
  const children = (node.children ?? []).map((c) => buildTypeNode(c));
  return new WinccoaDpTypeNode(node.name, elementType, node.refName ?? '', children);
}

/** Poll-group DP the studio ensures for its bound addresses. */
const DEFAULT_POLL_GROUP = '_EngStudio_Poll';

/**
 * The core's {@link EngPort}, realised over WsjServerGlobal.winccoa. This is the
 * ONLY place the studio's engineering logic touches the runtime.
 */
class WinccoaEngPort implements EngPort {
  async typeExists(typeName: string): Promise<boolean> {
    try {
      win().dpTypeGet(typeName);
      return true;
    } catch {
      return false;
    }
  }
  async dpTypeCreate(structure: DpTypeStructure): Promise<void> {
    const ok = await win().dpTypeCreate(buildTypeNode(structure));
    if (!ok) throw new Error(`dpTypeCreate('${structure.name}') returned false`);
  }
  async dpTypeChange(structure: DpTypeStructure): Promise<void> {
    const ok = await win().dpTypeChange(buildTypeNode(structure));
    if (!ok) throw new Error(`dpTypeChange('${structure.name}') returned false`);
  }
  async dpTypeDelete(typeName: string): Promise<void> {
    const ok = await win().dpTypeDelete(typeName);
    if (!ok) throw new Error(`dpTypeDelete('${typeName}') returned false`);
  }
  async dpExists(dpName: string): Promise<boolean> {
    const w = win();
    return Boolean(w.dpExists(dpName)) || Boolean(w.dpExists(`${dpName}.`));
  }
  async dpCreate(dpName: string, dpType: string): Promise<void> {
    const ok = await win().dpCreate(dpName, dpType);
    if (!ok) throw new Error(`dpCreate('${dpName}','${dpType}') returned false`);
  }
  async dpDelete(dpName: string): Promise<void> {
    const ok = await win().dpDelete(dpName);
    if (!ok) throw new Error(`dpDelete('${dpName}') returned false`);
  }
  async dpSetWait(dpes: string[], values: unknown[]): Promise<void> {
    const ok = dpes.length === 1 ? await win().dpSetWait(dpes[0], values[0]) : await win().dpSetWait(dpes, values);
    if (!ok) throw new Error(`dpSetWait failed for ${dpes[0]}${dpes.length > 1 ? ` (+${dpes.length - 1})` : ''}`);
  }
  async resolveAddressContext(config: AddressConfig): Promise<{ driverNumber: number; pollGroupDp: string }> {
    // TODO(phase-backend): resolve the driver manager number from the device
    // (mirror tagImporterController.managerNumberForConnection) and ensure the
    // poll-group DP exists. Static values keep the skeleton runnable.
    return { driverNumber: config.deviceId === 'opcua' ? 4 : 3, pollGroupDp: DEFAULT_POLL_GROUP };
  }
}

/** Handlers for /api/eng/* (arrow functions keep their binding for the router). */
export class EngController {
  private readonly port = new WinccoaEngPort();

  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'eng' });
  };

  /**
   * POST /api/eng/checkin  body { plan, dryRun }
   * Apply an EngPlan through the shared core applier over the WinccoaEngPort.
   */
  public checkin = async (req: Request, res: Response): Promise<void> => {
    const { plan, dryRun } = (req.body ?? {}) as { plan?: EngPlan; dryRun?: boolean };
    if (!plan || !Array.isArray(plan.items)) {
      res.status(400).json({ ok: false, error: 'a plan with items[] is required' });
      return;
    }
    try {
      const report = await applyPlan(plan, this.port, { dryRun: dryRun === true });
      res.status(200).json(report);
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  /**
   * GET /api/eng/live -> { snapshot }
   * Read the live project into the core's LiveSnapshot shape (for check-out /
   * diff). SKELETON: reads types + their datapoints; config reading is TODO.
   */
  public live = async (_req: Request, res: Response): Promise<void> => {
    try {
      const snapshot = await this.readSnapshot();
      res.status(200).json({ ok: true, snapshot });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  /**
   * POST /api/eng/test-read  body { dpes: string[] }
   * Read current values via dpGet (pre-check-in validation).
   */
  public testRead = async (req: Request, res: Response): Promise<void> => {
    const dpes = ((req.body ?? {}) as { dpes?: string[] }).dpes ?? [];
    try {
      const raw = dpes.length > 0 ? await win().dpGet(dpes.map((d) => `${d}:_original.._value`)) : [];
      const values = Array.isArray(raw) ? raw : [raw];
      res.status(200).json({
        ok: true,
        results: dpes.map((dpe, i) => ({ dpe, value: values[i] ?? null, ok: values[i] != null }))
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  /**
   * POST /api/eng/addressbook/ingest  body { deviceId, documents:[{fileName,xml}] }
   * Ingest a SimaticML bundle → an AddressBook (parsed by the core). The parsed
   * book is persisted server-side (TODO: store) and returned.
   */
  public ingestBook = async (_req: Request, res: Response): Promise<void> => {
    // TODO(phase-backend): buildBookFromSimaticMl(bundle) + persist; a watched
    // folder feeds the same path. Skeleton returns 501 so the contract is clear.
    res.status(501).json({ ok: false, error: 'address-book ingestion not yet implemented on this backend' });
  };

  // --- helpers ----------------------------------------------------------------

  /** Diff helper reused by a future /checkout endpoint. */
  public planFor(workspace: Workspace, snapshot: LiveSnapshot): EngPlan {
    return diffWorkspace(workspace, snapshot);
  }

  /** Baseline helper for a fresh check-out. */
  public baseline(snapshot: LiveSnapshot): Record<string, string> {
    return baselineOf(snapshot);
  }

  private async readSnapshot(): Promise<LiveSnapshot> {
    // SKELETON: enumerate non-internal types + their datapoints; configs are not
    // read yet (returned empty) — enough for type/DP diffing. Config read-back
    // is the next backend increment (dpGet over the config attribute set).
    const w = win();
    const typeNames: string[] = (w.dpTypes('*') ?? []).filter((n: string) => n && !n.startsWith('_'));
    const types: LiveSnapshot['types'] = [];
    const dps: LiveSnapshot['dps'] = [];
    for (const typeName of typeNames) {
      try {
        types.push({ typeName, structure: structureOf(w.dpTypeGet(typeName)) });
      } catch {
        continue;
      }
      for (const dp of (w.dpNames('*', typeName) ?? []) as string[]) {
        dps.push({ dpName: String(dp).replace(/\.$/, ''), dpType: typeName });
      }
    }
    return { types, dps, configs: {} };
  }
}

/** WinccoaDpTypeNode → DpTypeStructure (reverse of buildTypeNode). */
function structureOf(node: any): DpTypeStructure {
  const nameByValue: Record<number, string> = Object.fromEntries(
    Object.entries(ELEMENT_TYPE_MAP).map(([k, v]) => [v, k])
  );
  const out: DpTypeStructure = { name: node.name, type: nameByValue[node.type] ?? String(node.type) };
  if (node.refName) out.refName = node.refName;
  if (node.children && node.children.length > 0) out.children = node.children.map((c: any) => structureOf(c));
  return out;
}
