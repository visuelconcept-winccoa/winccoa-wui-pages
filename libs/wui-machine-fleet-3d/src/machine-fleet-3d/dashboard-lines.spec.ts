// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The machine dashboard shows the context line (production context, identities) above the
 * cards, then the process parameters ticked in the "Tableau de bord" column, at most MAX_SHOWN.
 */
import { describe, expect, it } from 'vitest';
import type { Kpi, MachineDef } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { MAX_SHOWN } from './display-cap.js';
import { dashboardParams, dashboardTicks, isContextParam, type DashboardDisplayEntry } from './dashboard-lines.js';

const article: Kpi = { key: 'ctx.article', label: 'Article', dp: 'WC.Context.Article', filterable: true };
const machineId: Kpi = { key: 'id.machine', label: 'Machine', value: 'CN_01' };
const measure = (i: number): Kpi => ({ key: `p${i}`, label: `P${i}`, dp: `WC.P${i}.Value`, showInCard: false });
const machine = (kpis: Kpi[], display?: DashboardDisplayEntry[]): MachineDef =>
  ({ id: 'M', name: 'M', kpis, display }) as unknown as MachineDef;
const keys = (r: Kpi[]): string[] => r.map((k) => k.key);

describe('isContextParam', () => {
  it('takes the production context and the fixed identities', () => {
    expect(isContextParam(article)).toBe(true);
    expect(isContextParam(machineId)).toBe(true);
  });
  it('leaves out a measured parameter, and one not bound yet', () => {
    expect(isContextParam(measure(1))).toBe(false);
    expect(isContextParam({ key: 'x', label: 'X' })).toBe(false);
  });
});

describe('dashboardParams', () => {
  it('shows every context line, whatever the ticks', () => {
    const r = dashboardParams(machine([article, machineId, measure(1)], [{ ref: 'param:ctx.article', inPopup: false }]));
    expect(keys(r.context)).toEqual(['ctx.article', 'id.machine']);
    expect(keys(r.process)).toEqual(['p1']);
  });

  it('by default, the first MAX_SHOWN process parameters, whatever the popup', () => {
    const kpis = [article, ...Array.from({ length: 14 }, (_, i) => measure(i + 1))];
    const r = dashboardParams(machine(kpis));
    expect(keys(r.process)).toEqual(Array.from({ length: MAX_SHOWN }, (_, i) => `p${i + 1}`));
  });

  it('follows the ticks, in display order', () => {
    const display = [
      { ref: 'param:p3', inDashboard: true },
      { ref: 'param:p1', inDashboard: true },
      { ref: 'param:p2', inDashboard: false }
    ];
    expect(keys(dashboardParams(machine([measure(1), measure(2), measure(3)], display)).process)).toEqual(['p3', 'p1']);
  });

  it('never shows more than MAX_SHOWN, even when more are ticked', () => {
    const kpis = Array.from({ length: 14 }, (_, i) => measure(i + 1));
    const display = kpis.map((k) => ({ ref: `param:${k.key}`, inDashboard: true }));
    expect(dashboardParams(machine(kpis, display)).process).toHaveLength(MAX_SHOWN);
  });
});

describe('dashboardTicks', () => {
  it('only covers the process parameters', () => {
    const ticks = dashboardTicks(machine([article, machineId, measure(1)]));
    expect([...ticks.keys()]).toEqual(['param:p1']);
  });
});
