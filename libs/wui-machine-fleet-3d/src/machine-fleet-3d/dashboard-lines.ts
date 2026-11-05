// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the machine dashboard's "Paramètres Process" band shows, split in two:
 *   - the CONTEXT line, always shown above the cards and outside the cap: the production
 *     context (article, contract… — the parameters marked `filterable`) and the fixed-value
 *     identities (machine, workcenter… — a value and no datapoint);
 *   - the PROCESS parameters (all the others) ticked in the "Tableau de bord" column of the
 *     "Affichage" tab, in its order, at most MAX_SHOWN.
 * The tick is stored as `inDashboard` on the machine's `display` entries (optional: an entry
 * without it takes the default, the first MAX_SHOWN process parameters in display order).
 * Pure functions, tested by dashboard-lines.spec.ts.
 */
import {
  resolveDisplaySlots,
  type DisplayEntry,
  type DisplaySlot,
  type Kpi,
  type MachineDef
} from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { MAX_SHOWN, capShown } from './display-cap.js';

/** A `display` entry with the dashboard tick (absent = default). */
export type DashboardDisplayEntry = DisplayEntry & { inDashboard?: boolean };

/** A context parameter: production context over time, or a fixed identity value. */
export function isContextParam(p: Kpi): boolean {
  if (p.filterable === true) return true;
  return (p.dp == null || p.dp === '') && p.value != null && p.value !== '';
}

/** A display item the dashboard may show as a process card (the "Tableau de bord" column). */
export function isProcessSlot(s: DisplaySlot): boolean {
  return s.kind === 'param' && s.param != null && !isContextParam(s.param);
}

/**
 * Dashboard tick of each process parameter (ref → shown), in display order: the stored tick,
 * else the default (shown while fewer than MAX_SHOWN are); past MAX_SHOWN, not shown.
 */
export function dashboardTicks(m: MachineDef, slots: DisplaySlot[] = resolveDisplaySlots(m)): Map<string, boolean> {
  const stored = new Map<string, boolean | undefined>();
  for (const e of (m.display ?? []) as DashboardDisplayEntry[]) stored.set(e.ref, e.inDashboard);
  const out = new Map<string, boolean>();
  let shown = 0;
  for (const s of slots) {
    if (!isProcessSlot(s)) continue;
    const wanted = (stored.get(s.ref) ?? true) && shown < MAX_SHOWN;
    if (wanted) shown++;
    out.set(s.ref, wanted);
  }
  return out;
}

/** The context parameters (machine order) and the ticked process parameters (display order). */
export function dashboardParams(m: MachineDef): { context: Kpi[]; process: Kpi[] } {
  const context = (m.kpis ?? []).filter(isContextParam);
  const slots = capShown(resolveDisplaySlots(m));
  const ticks = dashboardTicks(m, slots);
  const process = slots.filter((s) => ticks.get(s.ref) === true).map((s) => s.param as Kpi);
  return { context, process };
}
