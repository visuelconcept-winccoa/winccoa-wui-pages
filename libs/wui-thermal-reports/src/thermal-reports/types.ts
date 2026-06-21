/**
 * Domain model for Thermal Treatment Reports (rapports de traitement thermique,
 * "TTD" — traitement thermique de diffusion et apparentés).
 *
 * A report documents one furnace charge (charge / lot): its identity (n° rapport,
 * n° charge, OF, pièce, matière), the treatment recipe (a list of temperature
 * paliers held for a duration with a tolerance band and an atmosphere, plus the
 * quench medium), the furnace it ran on (linked to the existing Machine Fleet 3D
 * fleet) and the temperature datapoint whose NGA-archived history gives the
 * *actual* temperature curve over the charge window, the quality control results
 * (hardness, case depth, …) and a conformity verdict + validation workflow.
 *
 * Each report is persisted as one WinCC OA datapoint (Struct name+json — see
 * {@link ./data/report-store.ts}).
 */

/** Type of thermal treatment. */
export type TreatmentType =
  | 'cementation'
  | 'carbonitruration'
  | 'nitruration'
  | 'trempe'
  | 'revenu'
  | 'recuit'
  | 'detente'
  | 'normalisation'
  | 'autre';

/** Quench medium (milieu de trempe). */
export type QuenchMedium = 'none' | 'oil' | 'water' | 'polymer' | 'gas' | 'air' | 'salt';

/** Report lifecycle status. */
export type ReportStatus = 'draft' | 'running' | 'completed' | 'validated' | 'rejected';

/** Conformity verdict of the charge. */
export type Conformity = 'pending' | 'conform' | 'nonconform';

/**
 * One recipe step (palier): a target temperature held for a duration, within a
 * tolerance band, under an atmosphere.
 */
export interface ThermalStep {
  /** Setpoint temperature (°C). */
  setpoint: number;
  /** Hold duration (minutes). */
  durationMin: number;
  /** Allowed deviation *below* setpoint (°C, positive number). */
  tolMinus: number;
  /** Allowed deviation *above* setpoint (°C, positive number). */
  tolPlus: number;
  /** Atmosphere for this step (e.g. "Endo", "NH3", "N2", "Vide"). */
  atmosphere: string;
  /** Free label (e.g. "Montée", "Maintien", "Diffusion"). */
  label: string;
}

/** One quality-control measurement / result. */
export interface QualityResult {
  /** What was measured (e.g. "Dureté surface", "Profondeur de cémentation"). */
  label: string;
  /** Measured value. */
  value: number;
  /** Unit (e.g. "HV", "HRC", "mm"). */
  unit: string;
  /** Lower acceptance bound (NaN/undefined → no lower bound). */
  min?: number;
  /** Upper acceptance bound (NaN/undefined → no upper bound). */
  max?: number;
}

/** A complete thermal treatment report. */
export interface ThermalReport {
  /** Stable identifier (slug); unique within the list. */
  id: string;
  /** Full backing DP name (e.g. "System1:ThermalReport_x"); absent until persisted. */
  dp?: string;

  // --- identity ---
  /** Report number, e.g. "TTD-2026-0042". */
  reportNo: string;
  /** Charge / batch number, e.g. "CH-2026-0142". */
  charge: string;
  /** Linked production order (OF), optional. */
  orderNo: string;
  /** Part designation. */
  part: string;
  /** Material / grade (nuance), e.g. "16NiCrMo13". */
  material: string;
  /** Number of parts in the charge. */
  quantity: number;

  // --- treatment recipe ---
  treatment: TreatmentType;
  /** Global atmosphere (free text, e.g. "Endothermique + propane"). */
  atmosphere: string;
  quench: QuenchMedium;
  /** Ordered recipe steps (paliers). */
  steps: ThermalStep[];

  // --- furnace link + data source (Machine Fleet 3D) ---
  atelierId: string;
  atelierName: string;
  machineId: string;
  machineName: string;
  /** Temperature DPE whose archived history gives the actual curve. */
  tempDp: string;
  /** Charge cycle window (local `YYYY-MM-DDTHH:mm`, empty = unset). */
  startTime: string;
  endTime: string;

  // --- quality control ---
  results: QualityResult[];
  conformity: Conformity;

  // --- workflow ---
  status: ReportStatus;
  operator: string;
  validatedBy: string;
  validatedAt: string;
  notes: string;
}

export const TREATMENT_LABELS: Record<TreatmentType, string> = {
  cementation: 'Cémentation',
  carbonitruration: 'Carbonitruration',
  nitruration: 'Nitruration',
  trempe: 'Trempe',
  revenu: 'Revenu',
  recuit: 'Recuit',
  detente: 'Détensionnement',
  normalisation: 'Normalisation',
  autre: 'Autre'
};

export const QUENCH_LABELS: Record<QuenchMedium, string> = {
  none: 'Aucune',
  oil: 'Huile',
  water: 'Eau',
  polymer: 'Polymère',
  gas: 'Gaz (sous pression)',
  air: 'Air',
  salt: 'Bain de sels'
};

export const STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Brouillon',
  running: 'En cours',
  completed: 'Terminé',
  validated: 'Validé',
  rejected: 'Refusé'
};

/** Chip / accent colour per status. */
export const STATUS_COLORS: Record<ReportStatus, string> = {
  draft: '#94a3b8',
  running: '#3b82f6',
  completed: '#0ea5e9',
  validated: '#10b981',
  rejected: '#ef4444'
};

export const CONFORMITY_LABELS: Record<Conformity, string> = {
  pending: 'En attente',
  conform: 'Conforme',
  nonconform: 'Non conforme'
};

export const CONFORMITY_COLORS: Record<Conformity, string> = {
  pending: '#f59e0b',
  conform: '#10b981',
  nonconform: '#ef4444'
};

/** Sanitise an id into the form the MachineSim manager uses for its DP names. */
export function sanitizeId(id: string): string {
  return String(id).replaceAll(/[^A-Za-z0-9_]/g, '_');
}

/** Default temperature DPE for a fleet machine (the MachineSim element). */
export function tempDpForMachine(machineId: string): string {
  return machineId ? `MachineSim_${sanitizeId(machineId)}.temperature` : '';
}

/** Whether a quality result falls within its acceptance bounds (null = no bounds). */
export function resultConform(r: QualityResult): boolean | null {
  const hasMin = typeof r.min === 'number' && Number.isFinite(r.min);
  const hasMax = typeof r.max === 'number' && Number.isFinite(r.max);
  if (!hasMin && !hasMax) return null;
  const aboveMin = !hasMin || r.value >= (r.min as number);
  const belowMax = !hasMax || r.value <= (r.max as number);
  return aboveMin && belowMax;
}

/** A blank report with sensible defaults. */
export function blankReport(): ThermalReport {
  return {
    id: '',
    reportNo: '',
    charge: '',
    orderNo: '',
    part: '',
    material: '',
    quantity: 0,
    treatment: 'cementation',
    atmosphere: '',
    quench: 'oil',
    steps: [],
    atelierId: '',
    atelierName: '',
    machineId: '',
    machineName: '',
    tempDp: '',
    startTime: '',
    endTime: '',
    results: [],
    conformity: 'pending',
    status: 'draft',
    operator: '',
    validatedBy: '',
    validatedAt: '',
    notes: ''
  };
}

/** A blank recipe step. */
export function blankStep(): ThermalStep {
  return { setpoint: 0, durationMin: 0, tolMinus: 10, tolPlus: 10, atmosphere: '', label: '' };
}

/** A blank quality result. */
export function blankResult(): QualityResult {
  return { label: '', value: 0, unit: '', min: undefined, max: undefined };
}
