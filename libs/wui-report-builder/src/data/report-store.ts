/** Persistence for report instances (1 DP per report, type `ReportBuilder_Report`). */
import type { Report } from '../types.js';
import { buildDemoReports } from './demo.js';
import { DpJsonStore } from './dp-json-store.js';

export class ReportStore extends DpJsonStore<Report> {
  constructor() {
    super('ReportBuilder_Report', 'ReportBuilder_Report_', (r) => r.reportNo || r.title || 'rapport', buildDemoReports, {
      audit: { dpName: 'AuditTrail_ReportBuilder', itemType: 'Report', exclude: ['createdAt', 'updatedAt'] }
    });
  }
}
