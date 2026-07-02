// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client-side alarm engine: turns the live sensor + equipment snapshots into a
 * de-duplicated list of active alarms. Two sources:
 *  - **Threshold** breaches of the {@link THRESHOLDS} bands (discharge limits +
 *    operating bands), and
 *  - **Equipment faults** (any device reporting the fault state).
 *
 * `firstSeen` (id → ISO time) and `acked` (set of ids) are owned by the caller
 * so an alarm keeps its onset time and acknowledgement across refreshes; ids
 * that clear are pruned from both so a re-occurrence starts fresh.
 */
import { EQ_FAULT, EQUIPMENT, THRESHOLDS } from './model.js';
import { MSG, localize } from './i18n.js';
import type { Alarm, EquipmentStates, SensorValues } from './types.js';

/** Is `value` outside the threshold band? */
function breached(t: (typeof THRESHOLDS)[number], value: number): boolean {
  if (t.kind === 'max') return t.max != null && value > t.max;
  return (t.min != null && value < t.min) || (t.max != null && value > t.max);
}

/** Format a threshold band for the alarm value column (e.g. "3.1 / ≤ 35 mg/L"). */
function bandLabel(t: (typeof THRESHOLDS)[number], value: number): string {
  const u = t.unit ? ` ${t.unit}` : '';
  if (t.kind === 'max') return `${value} / ≤ ${t.max}${u}`;
  return `${value} / ${t.min}–${t.max}${u}`;
}

export function deriveAlarms(
  sensors: SensorValues,
  equipment: EquipmentStates,
  firstSeen: Map<string, string>,
  acked: Set<string>
): Alarm[] {
  const now = new Date().toISOString();
  const alarms: Alarm[] = [];
  const liveIds = new Set<string>();

  // 1) threshold breaches
  for (const t of THRESHOLDS) {
    const value = sensors[t.path];
    if (value == null || !breached(t, value)) continue;
    const id = `threshold:${t.path}`;
    liveIds.add(id);
    if (!firstSeen.has(id)) firstSeen.set(id, now);
    alarms.push({
      id,
      kind: 'threshold',
      source: localize(t.label),
      message: localize(MSG.alarms.thresholdMsg),
      value: bandLabel(t, value),
      // A legal discharge-limit breach is high severity; an operating-band drift is a warning.
      severity: t.path.startsWith('outlet.') ? 'high' : 'warn',
      since: firstSeen.get(id) ?? now,
      acknowledged: acked.has(id)
    });
  }

  // 2) equipment faults
  for (const e of EQUIPMENT) {
    if (equipment[e.id]?.state !== EQ_FAULT) continue;
    const id = `fault:${e.id}`;
    liveIds.add(id);
    if (!firstSeen.has(id)) firstSeen.set(id, now);
    alarms.push({
      id,
      kind: 'fault',
      source: localize(e.label),
      message: localize(MSG.alarms.faultMsg),
      value: '',
      severity: 'high',
      since: firstSeen.get(id) ?? now,
      acknowledged: acked.has(id)
    });
  }

  // 3) prune memory for conditions that cleared, so a re-occurrence restarts.
  for (const id of [...firstSeen.keys()]) if (!liveIds.has(id)) firstSeen.delete(id);
  for (const id of [...acked]) if (!liveIds.has(id)) acked.delete(id);

  // High severity first, then oldest first.
  return alarms.sort((a, b) => (a.severity === b.severity ? a.since.localeCompare(b.since) : a.severity === 'high' ? -1 : 1));
}
