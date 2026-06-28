// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence layer for thermal treatment reports — one WinCC OA datapoint per
 * report (type `ThermalReport_Report`, a Struct with String elements `name` +
 * `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the type/prefix
 * and keeps the page-specific method names. When the backend is unreachable or
 * the user lacks write rights, the store transparently falls back to an in-memory
 * list seeded with demo reports and sets `offline = true`.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { buildDemoReports } from './demo-reports.js';
import type { ThermalReport } from '../types.js';

export class ReportStore extends DpJsonStore<ThermalReport> {
  constructor() {
    super(
      'ThermalReport_Report',
      'ThermalReport_',
      (report) => report.reportNo,
      () => buildDemoReports([]),
      {
        slugFallback: 'ttd',
        slugSource: (r) => r.reportNo || r.charge,
        audit: { dpName: 'AuditTrail_ThermalReports', itemType: 'ThermalReport' }
      }
    );
  }

  listReports(): Promise<ThermalReport[]> {
    return this.list();
  }

  createReport(report: ThermalReport): Promise<ThermalReport> {
    return this.create(report);
  }

  saveReport(report: ThermalReport): Promise<void> {
    return this.save(report);
  }

  deleteReport(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with demo reports built against the supplied fleet. */
  importDemo(reports: ThermalReport[]): Promise<ThermalReport[]> {
    return this.importMany(reports);
  }
}
