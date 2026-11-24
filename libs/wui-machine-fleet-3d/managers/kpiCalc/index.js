// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * Machine Fleet — kpiCalc manager (WinCC OA JavaScript Manager): the one process Machine Fleet needs, always running,
 * since the state recorder (formerly the fleetState manager) and the KPI calculator (formerly the kpiCalc manager of
 * wui-fleet-kpi-analysis) are one (winccoa-fra-msp-stma#373):
 *  - states.js: records each symbol's state and stop cause (MachineFleet3D_State_<symbol>, archived) — the history of
 *    the Gantt, the stops, the Pareto and the TRS — and sends the stop-cause catalogue to the machines that declare
 *    their slots (recorder.js, cause-push.js);
 *  - kpis.js: computes each symbol's TRS, MTBF and MTTR over their sliding window from that history
 *    (MachineFleet3D_Kpi_*, archived; kpi-math.js).
 * One connection to WinCC OA, both started at once and independent: one failing does not stop the other.
 *
 * Register in config/progs:  node | always | 30 | 2 | 2 |kpiCalc/index.js
 * After editing these files, restart the kpiCalc manager.
 */
const { WinccoaManager } = require('winccoa-manager');
const states = require('./states.js');
const kpis = require('./kpis.js');

const winccoa = new WinccoaManager();
void states.start(winccoa);
void kpis.start(winccoa);
