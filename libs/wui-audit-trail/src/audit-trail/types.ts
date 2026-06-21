/** Types for the Audit-trail standalone page. */

export type AuditPeriod = 'today' | '24h' | '7d' | '30d' | 'custom';

export const AUDIT_PERIOD_LABEL: Record<AuditPeriod, string> = {
  today: "Aujourd'hui",
  '24h': '24 heures',
  '7d': '7 jours',
  '30d': '30 jours',
  custom: 'Personnalisé…'
};

/** A displayable column = one archived leaf element of the target DP. */
export interface AuditColumn {
  /** Full DPE path, e.g. `System1:MachineSim_x.state`. */
  dpe: string;
  /** Short label shown in the header (path relative to the DP). */
  label: string;
}

/** Persisted page configuration (one config DP). */
export interface AuditConfig {
  /** Target datapoint whose archived structure is shown. */
  dpName: string;
  period: AuditPeriod;
  /** yyyy-MM-dd bounds for `period === 'custom'`. */
  customStart: string;
  customEnd: string;
  /** Selected element DPE paths (subset of the DP's leaves); empty = all. */
  columns: string[];
  /** Live refresh (dpConnect-driven re-query). */
  refresh: boolean;
  /** Max rows rendered (most recent); guards huge histories. */
  maxRows: number;
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  dpName: '',
  period: '24h',
  customStart: '',
  customEnd: '',
  columns: [],
  refresh: true,
  maxRows: 500
};

/** One pivot row: a timestamp + the (carried-forward) value per column. */
export interface AuditRow {
  t: number;
  values: (string | number | null)[];
}
