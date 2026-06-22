/** Types for the Audit-trail standalone page (fixed `_AuditTrail` GxP structure). */

/** WinCC OA DP type holding GxP audit records (system type, fixed structure). */
export const AUDIT_DP_TYPE = '_AuditTrail';

/** Prefix applied to user-created audit-trail DPs (the system DP stays `_AuditTrail`). */
export const AUDIT_DP_PREFIX = 'AuditTrail_';

/** Rolling live window: last 24 hours. */
export const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One fixed column of the `_AuditTrail` structure. */
export interface AuditField {
  /** Element name under the DP (e.g. `username`). */
  key: string;
  /** Header label shown in the table / exports. */
  label: string;
  /** `time` is rendered as a formatted date; everything else as text. */
  kind?: 'time';
}

/**
 * Display order of the `_AuditTrail` elements, GxP-readable (who / what / when /
 * why / old → new). The order also drives the queried columns and the exports.
 */
export const AUDIT_FIELDS: readonly AuditField[] = [
  { key: 'time', label: 'Horodatage', kind: 'time' },
  { key: 'username', label: 'Utilisateur' },
  { key: 'action', label: 'Action' },
  { key: 'item', label: 'Élément' },
  { key: 'itemtype', label: 'Type' },
  { key: 'oldval', label: 'Ancienne valeur' },
  { key: 'newval', label: 'Nouvelle valeur' },
  { key: 'reason', label: 'Raison' },
  { key: 'batchid', label: 'Batch' },
  { key: 'uinum', label: 'UI' },
  { key: 'host', label: 'Hôte' }
];

/** A displayable column = one archived leaf element of the target DP. */
export interface AuditColumn {
  /** Full DPE path, e.g. `AuditTrail_Production.username`. */
  dpe: string;
  /** Short label shown in the header. */
  label: string;
}

/** Persisted per-user view configuration (one `AuditTrail_Config` DP). */
export interface AuditConfig {
  /** Selected `_AuditTrail` datapoint shown in the viewer. */
  dpName: string;
  /** Live mode: rolling last-24h window with auto-refresh. */
  live: boolean;
  /** `datetime-local` bounds for the custom interval (used when `live === false`). */
  rangeStart: string;
  rangeEnd: string;
  /** Max rows rendered (most recent); guards huge histories. */
  maxRows: number;
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  dpName: '',
  live: true,
  rangeStart: '',
  rangeEnd: '',
  maxRows: 1000
};

/** One pivot row: a timestamp + the value of every fixed column at that instant. */
export interface AuditRow {
  t: number;
  values: (string | number | null)[];
}
