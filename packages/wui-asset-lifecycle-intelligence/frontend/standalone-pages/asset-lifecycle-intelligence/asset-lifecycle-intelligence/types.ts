/**
 * Domain model for Asset Lifecycle Intelligence.
 *
 * Mirrors the data model from the Visuel Concept "Asset Lifecycle Intelligence
 * for WinCC OA" concept deck: each industrial asset carries its field identity
 * (MLFB, station, IP, firmware) plus the structured inputs that feed a
 * composite obsolescence/risk score (see {@link ./risk.ts}).
 */

/**
 * Product lifecycle phase — official Siemens product life-cycle nomenclature
 * (PM300 → PM500), per the Siemens "Overview of Products Life Cycle" model:
 *   PM300 active (orderable as a new part) → PM400 phase-out announced (still a
 *   new part, ~2 yrs max) → PM410 cancellation (spare part only, ~10 yrs) →
 *   PM490 discontinuation (warranty ~2 yrs) → PM500 end of life cycle.
 */
export type LifecyclePhase = 'PM300' | 'PM400' | 'PM410' | 'PM490' | 'PM500';

/** Firmware gap between the installed field version and the latest available. */
export type FirmwareStatus = 'upToDate' | 'minorBehind' | 'majorOrCve';

/** Process criticality — impact on production if the asset fails (FMEA). */
export type Criticality = 'low' | 'medium' | 'high' | 'critical';

/** Spare-parts supply situation (lead time / stock). */
export type SupplyStatus = 'inStock' | 'lead4to12' | 'over12OrOos';

/** Severity of unpatched security vulnerabilities (CVE). */
export type VulnSeverity = 'none' | 'low' | 'medium' | 'high';

/** Provenance of the asset record (how it entered the inventory). */
export type AssetSource = 'tia' | 'csv' | 'manual';

/** A single managed industrial asset. */
export interface Asset {
  /** Stable identifier (slug); also the suffix of the backing datapoint. */
  id: string;
  /** Backing WinCC OA datapoint name (empty in offline/in-memory mode). */
  dp: string;
  /** Free-text label, e.g. "CPU 1516F press-01". */
  name: string;
  /** Article number / order number (Siemens MLFB). */
  mlfb: string;
  /** PROFINET station name. */
  station: string;
  /** IP address on the OT network. */
  ip: string;
  /** Workshop / ISA-95 area (e.g. "Stamping"). */
  area: string;
  /** Installed firmware version in the field. */
  firmwareField: string;
  /** Latest firmware version available from the vendor. */
  firmwareAvail: string;
  /** Recommended successor MLFB (from PIH), if any. */
  successor: string;

  // --- risk inputs ---
  phase: LifecyclePhase;
  firmware: FirmwareStatus;
  criticality: Criticality;
  supply: SupplyStatus;
  vuln: VulnSeverity;
  /** Cumulative operating hours. */
  operatingHours: number;
  /** Mean time between failures, in hours (0 = unknown). */
  mtbfHours: number;

  /** How this asset record was created (TIA project / CSV import / manual). */
  source: AssetSource;

  /** TIA project name this asset was imported from (empty if not from AML). */
  tiaProject: string;
  /** Stable per-module key within the TIA project, for re-import matching. */
  tiaKey: string;

  /** Free-text engineering notes. */
  notes: string;
}

/** Discrete risk level derived from the composite score (see risk matrix). */
export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

/** Human-readable French labels for the lifecycle phases (Siemens PM300→PM500). */
export const PHASE_LABELS: Record<LifecyclePhase, string> = {
  PM300: 'PM300 — Phase active (pièce neuve)',
  PM400: 'PM400 — Annonce d’arrêt (pièce neuve)',
  PM410: 'PM410 — Annulation produit (rechange uniquement)',
  PM490: 'PM490 — Arrêt de commercialisation (garantie)',
  PM500: 'PM500 — Fin de cycle de vie'
};

/** Legacy phase codes (pre PLM-alignment) mapped to the current Siemens phases. */
const LEGACY_PHASES: Record<string, LifecyclePhase> = {
  PM100: 'PM300',
  PM200: 'PM300'
};

/** Coerce any stored / imported phase value to a valid current phase. */
export function normalizePhase(value: unknown): LifecyclePhase {
  const code = String(value ?? '');
  if (Object.prototype.hasOwnProperty.call(PHASE_LABELS, code)) {
    return code as LifecyclePhase;
  }
  return LEGACY_PHASES[code] ?? 'PM300';
}

export const FIRMWARE_LABELS: Record<FirmwareStatus, string> = {
  upToDate: 'À jour',
  minorBehind: '1 version mineure de retard',
  majorOrCve: 'Version majeure de retard ou CVE'
};

export const CRITICALITY_LABELS: Record<Criticality, string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
  critical: 'Critique'
};

export const SUPPLY_LABELS: Record<SupplyStatus, string> = {
  inStock: 'En stock, délai < 4 sem.',
  lead4to12: 'Délai 4–12 semaines',
  over12OrOos: 'Délai > 12 sem. ou rupture'
};

export const VULN_LABELS: Record<VulnSeverity, string> = {
  none: 'Aucune',
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée'
};

export const SOURCE_LABELS: Record<AssetSource, string> = {
  tia: 'Projet TIA',
  csv: 'Import CSV',
  manual: 'Manuel'
};

/** Chip colour per source, for the table badge. */
export const SOURCE_COLORS: Record<AssetSource, string> = {
  tia: '#0ea5e9',
  csv: '#14b8a6',
  manual: '#94a3b8'
};

/** A freshly created asset with sensible defaults. */
export function blankAsset(): Asset {
  return {
    id: '',
    dp: '',
    name: '',
    mlfb: '',
    station: '',
    ip: '',
    area: '',
    firmwareField: '',
    firmwareAvail: '',
    successor: '',
    phase: 'PM300',
    firmware: 'upToDate',
    criticality: 'medium',
    supply: 'inStock',
    vuln: 'none',
    operatingHours: 0,
    mtbfHours: 0,
    source: 'manual',
    tiaProject: '',
    tiaKey: '',
    notes: ''
  };
}
