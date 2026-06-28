// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence for the Process Monitor page:
 *  - **Audit trail** (GxP): a `_AuditTrail` datapoint `AuditTrail_ProcessMonitor`
 *    (shared {@link AuditTrailWriter}) — created at page init, one row per
 *    project import / manager restart (time · user · host filled by the writer).
 *  - **Operations history**: a single-JSON datapoint `ProcessMonitor_History`
 *    (list of {@link HistoryEntry}) for the History tab — the `_AuditTrail` DP is
 *    archived value-by-value, so a plain JSON list is what the tab reads back.
 *
 * Both are ensured on page init and written together by {@link traceOperation}.
 */
import { AuditTrailWriter, type AuditRecord, currentAuditUser } from '@visuelconcept/wui-kit/data/audit-trail.js';
import { DpSingleJsonStore } from '@visuelconcept/wui-kit/data/dp-single-json-store.js';
import type { HistoryEntry } from '../types.js';

const HISTORY_CAP = 200;

class HistoryStore extends DpSingleJsonStore<HistoryEntry[]> {
  constructor() {
    super('ProcessMonitor_History', 'ProcessMonitor_History', () => [], { isArray: true });
  }
}

const historyStore = new HistoryStore();
const auditWriter = new AuditTrailWriter({ dpName: 'AuditTrail_ProcessMonitor', itemType: 'ProcessMonitor' });

/** Ensure both backing datapoints exist (called once at page init). */
export async function ensureStores(): Promise<void> {
  await Promise.allSettled([auditWriter.ensure(), historyStore.load()]);
}

/** Read the operations history (newest first). */
export function loadHistory(): Promise<HistoryEntry[]> {
  return historyStore.load();
}

/**
 * Record one operation into BOTH the GxP audit DP and the JSON history list.
 * Best-effort — never throws (must not break the operation it traces).
 */
export async function traceOperation(entry: HistoryEntry, audit: AuditRecord): Promise<void> {
  try {
    await auditWriter.write(audit);
  } catch {
    // best-effort
  }
  try {
    // Stamp the same connected user as the GxP audit row into the JSON history.
    if (!entry.user) {
      const actor = await currentAuditUser();
      entry.user = actor.name;
    }
    const list = await historyStore.load();
    list.unshift(entry);
    await historyStore.save(list.slice(0, HISTORY_CAP));
  } catch {
    // best-effort
  }
}
