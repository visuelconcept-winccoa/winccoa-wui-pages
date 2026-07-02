// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Operator logbook ("main courante") — the timestamped operations journal of
 * one tunnel, and the incident lifecycle on top of it.
 *
 * The journal is auto-fed by the tunnel view: equipment alarm TRANSITIONS
 * (edge-detected by the live binding), every confirmed field command, every
 * mode engagement, plus free operator notes. An operator can OPEN an incident
 * (title/severity/PK); subsequent entries attach to it until it is CLOSED —
 * giving the chronological record the safety officer needs for the feedback
 * process (retour d'expérience) and the periodic safety file.
 *
 * Persistence: one `Hades_Logbook_<tunnelId>` datapoint (JSON blob) via the
 * shared single-DP store, trimmed to the newest {@link MAX_ENTRIES} entries
 * so the DP never grows unbounded. Exercise entries are flagged so drills are
 * distinguishable from real operations everywhere (UI, safety report).
 */
import { DpSingleJsonStore } from '@visuelconcept/wui-kit/data/dp-single-json-store.js';
import { currentAuditUser } from '@visuelconcept/wui-kit/data/audit-trail.js';

const LOGBOOK_TYPE = 'Hades_Logbook';
const LOGBOOK_PREFIX = 'Hades_Logbook_';
/** Newest entries kept in the DP (older ones are trimmed on write). */
export const MAX_ENTRIES = 500;

export type LogEntryKind = 'alarm' | 'command' | 'mode' | 'note' | 'incident' | 'exercise';

export interface LogEntry {
  id: string;
  /** Epoch ms. */
  ts: number;
  kind: LogEntryKind;
  text: string;
  /** Operator (WinCC OA user) recorded with the entry. */
  user: string;
  /** Attached incident, when one was active at write time. */
  incidentId?: string;
  equipmentId?: string;
  pkM?: number;
  /** True when the entry was produced during an exercise (drill). */
  exercise?: boolean;
}

export interface Incident {
  id: string;
  title: string;
  severity: 'minor' | 'major' | 'critical';
  openedTs: number;
  closedTs?: number;
  openedBy: string;
  pkM?: number;
  tubeId?: string;
}

export interface LogbookData {
  entries: LogEntry[];
  incidents: Incident[];
}

let entryCounter = 0;

function freshId(prefix: string): string {
  entryCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${entryCounter.toString(36)}`;
}

/** Journal of ONE tunnel (instantiate per opened tunnel workspace). */
export class LogbookStore {
  private readonly store: DpSingleJsonStore<LogbookData>;
  private data: LogbookData = { entries: [], incidents: [] };
  private loaded = false;

  constructor(tunnelId: string) {
    this.store = new DpSingleJsonStore<LogbookData>(
      LOGBOOK_TYPE,
      `${LOGBOOK_PREFIX}${tunnelId}`,
      () => ({ entries: [], incidents: [] })
    );
  }

  get offline(): boolean {
    return this.store.offline;
  }

  async load(): Promise<LogbookData> {
    this.data = await this.store.load();
    this.data.entries ??= [];
    this.data.incidents ??= [];
    this.loaded = true;
    return this.data;
  }

  /** Current in-memory snapshot (load() first). */
  get current(): LogbookData {
    return this.data;
  }

  /** The incident currently open, if any (one at a time by design). */
  get activeIncident(): Incident | undefined {
    return this.data.incidents.find((i) => i.closedTs === undefined);
  }

  /** Append one entry (attaches to the active incident) and persist. */
  async addEntry(
    kind: LogEntryKind,
    text: string,
    extra: Partial<Pick<LogEntry, 'equipmentId' | 'pkM' | 'exercise' | 'incidentId'>> = {}
  ): Promise<LogEntry> {
    if (!this.loaded) await this.load();
    const user = await this.userName();
    const entry: LogEntry = {
      id: freshId('log'),
      ts: Date.now(),
      kind,
      text,
      user,
      incidentId: extra.incidentId ?? this.activeIncident?.id,
      ...(extra.equipmentId !== undefined && { equipmentId: extra.equipmentId }),
      ...(extra.pkM !== undefined && { pkM: extra.pkM }),
      ...(extra.exercise !== undefined && { exercise: extra.exercise })
    };
    this.data.entries = [entry, ...this.data.entries].slice(0, MAX_ENTRIES);
    await this.store.save(this.data);
    return entry;
  }

  /** Open an incident (closes nothing: refuse when one is already active). */
  async openIncident(
    title: string,
    severity: Incident['severity'],
    opts: { pkM?: number; tubeId?: string } = {}
  ): Promise<Incident | undefined> {
    if (!this.loaded) await this.load();
    if (this.activeIncident) return undefined;
    const incident: Incident = {
      id: freshId('inc'),
      title,
      severity,
      openedTs: Date.now(),
      openedBy: await this.userName(),
      ...(opts.pkM !== undefined && { pkM: opts.pkM }),
      ...(opts.tubeId !== undefined && { tubeId: opts.tubeId })
    };
    this.data.incidents = [incident, ...this.data.incidents];
    await this.store.save(this.data);
    await this.addEntry('incident', title, { incidentId: incident.id, pkM: opts.pkM });
    return incident;
  }

  /** Close the active incident with a closing note. */
  async closeIncident(closingNote: string): Promise<void> {
    const active = this.activeIncident;
    if (!active) return;
    await this.addEntry('incident', closingNote, { incidentId: active.id });
    active.closedTs = Date.now();
    this.data.incidents = [...this.data.incidents];
    await this.store.save(this.data);
  }

  private async userName(): Promise<string> {
    try {
      return (await currentAuditUser()).name || '—';
    } catch {
      return '—';
    }
  }
}
