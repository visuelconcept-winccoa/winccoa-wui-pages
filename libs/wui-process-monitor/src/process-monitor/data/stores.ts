// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The trace of the Process Monitor page (issue 53): the processMonitor manager writes it —
 * the one that performs each operation and knows its real outcome:
 *  - **Audit trail** (GxP): the `_AuditTrail` datapoint `AuditTrail_ProcessMonitor`;
 *  - **Operations history**: the JSON list `ProcessMonitor_History`, read by the History
 *    tab through `GET /api/process-monitor/history`.
 * The page no longer writes either. It only provisions the audit DP once — through the
 * shared {@link AuditTrailWriter}, which also turns its NGA archiving on when an archive
 * group is active (the manager creates the DP without archiving when it is missing) — and
 * declares its user with every write (`clientUser`): the webserver forwards its own session
 * identity when it has one, else this one (the WebUI authenticates on its websocket).
 */
import { AuditTrailWriter, currentAuditUser } from '@visuelconcept-winccoa/wui-kit/data/audit-trail.js';

const auditWriter = new AuditTrailWriter({ dpName: 'AuditTrail_ProcessMonitor', itemType: 'ProcessMonitor' });

/** Provision the audit DP with its archiving (once, at page init). Never throws. */
export async function ensureAuditDp(): Promise<void> {
  await auditWriter.ensure();
}

let user: Promise<{ name: string; id: number }> | null = null;

/** The connected user, declared with every write. */
export function clientUser(): Promise<{ name: string; id: number }> {
  user ??= currentAuditUser().catch(() => ({ name: '', id: 0 }));
  return user;
}
