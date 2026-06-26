/**
 * Composite risk-scoring engine.
 *
 * Implements the weighted model from the concept deck: the overall risk score
 * (0–100) is a weighted sum of six components, each scored 0–100 from a
 * different data source. The per-component scoring rules and the score→level
 * risk matrix are taken verbatim from the deck (slides "Detailed scoring" and
 * "Risk matrix").
 *
 * Overall = Σ (componentScore × weight), weights summing to 1.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { ml } from './i18n.js';
import type { Asset, RiskLevel } from './types.js';

const SCORE_MAX = 100;

/** One weighted contributor to the overall score. */
export interface RiskComponent {
  key: string;
  /** Short French label. */
  label: string;
  /** Weight in [0,1]; all weights sum to 1. */
  weight: number;
  /** Component score in [0,100]. */
  score: number;
  /** Data source feeding this component (for transparency). */
  source: string;
}

export interface RiskResult {
  /** Overall score, rounded, in [0,100]. */
  score: number;
  level: RiskLevel;
  components: RiskComponent[];
}

/** Component weights (sum = 1.0) — deck "Composite scoring model". */
const WEIGHTS = {
  obsolescence: 0.25,
  firmware: 0.2,
  criticality: 0.2,
  supply: 0.15,
  vuln: 0.1,
  age: 0.1
} as const;

// Obsolescence risk by Siemens lifecycle phase: PM300 active (orderable as a new
// part) is low; risk rises as the product moves to phase-out, cancellation
// (spare only), discontinuation and finally end of life.
const OBSOLESCENCE_SCORES: Record<Asset['phase'], number> = {
  PM300: 10,
  PM400: 40,
  PM410: 70,
  PM490: 90,
  PM500: 100
};

const FIRMWARE_SCORES: Record<Asset['firmware'], number> = {
  upToDate: 0,
  minorBehind: 30,
  majorOrCve: 80
};

const CRITICALITY_SCORES: Record<Asset['criticality'], number> = {
  low: 10,
  medium: 40,
  high: 70,
  critical: 100
};

const SUPPLY_SCORES: Record<Asset['supply'], number> = {
  inStock: 0,
  lead4to12: 40,
  over12OrOos: 90
};

const VULN_SCORES: Record<Asset['vuln'], number> = {
  none: 0,
  low: 30,
  medium: 60,
  high: 100
};

/** Operating-hours wear: hours / MTBF as a percentage, clamped to [0,100]. */
function ageScore(operatingHours: number, mtbfHours: number): number {
  if (mtbfHours <= 0) return 0;
  return Math.min(SCORE_MAX, Math.round((operatingHours / mtbfHours) * SCORE_MAX));
}

/** Compute the full risk breakdown for an asset. */
export function computeRisk(asset: Asset): RiskResult {
  const components: RiskComponent[] = [
    {
      key: 'obsolescence',
      label: 'Obsolescence',
      weight: WEIGHTS.obsolescence,
      score: OBSOLESCENCE_SCORES[asset.phase],
      source: 'API PIH'
    },
    {
      key: 'firmware',
      label: 'Écart firmware',
      weight: WEIGHTS.firmware,
      score: FIRMWARE_SCORES[asset.firmware],
      source: 'SAT + PIH'
    },
    {
      key: 'criticality',
      label: 'Criticité process',
      weight: WEIGHTS.criticality,
      score: CRITICALITY_SCORES[asset.criticality],
      source: 'FMEA / WinCC OA'
    },
    {
      key: 'supply',
      label: 'Chaîne d’appro.',
      weight: WEIGHTS.supply,
      score: SUPPLY_SCORES[asset.supply],
      source: 'API PIH (livraison)'
    },
    {
      key: 'vuln',
      label: 'Vulnérabilités',
      weight: WEIGHTS.vuln,
      score: VULN_SCORES[asset.vuln],
      source: 'PIH + CVE'
    },
    {
      key: 'age',
      label: 'Âge / usure',
      weight: WEIGHTS.age,
      score: ageScore(asset.operatingHours, asset.mtbfHours),
      source: "Heures de service, MTBF"
    }
  ];

  const weighted = components.reduce((sum, c) => sum + c.score * c.weight, 0);
  const score = Math.round(weighted);
  return { score, level: riskLevel(score), components };
}

/** Threshold bands and actions — deck "Risk matrix". */
export interface RiskBand {
  level: RiskLevel;
  /** Inclusive lower bound of the band. */
  min: number;
  /** Inclusive upper bound of the band. */
  max: number;
  label: MultiLangString;
  action: MultiLangString;
  review: string;
  alarm: string;
  /** CSS colour (theme token or hex) for badges/bars. */
  color: string;
}

export const RISK_BANDS: RiskBand[] = [
  {
    level: 'low',
    min: 0,
    max: 25,
    label: ml('Low', 'Faible', 'Niedrig'),
    action: ml('No action required', 'Aucune action requise', 'Keine Maßnahme erforderlich'),
    review: 'Revue annuelle',
    alarm: 'Information',
    color: '#10b981'
  },
  {
    level: 'moderate',
    min: 26,
    max: 50,
    label: ml('Moderate', 'Modéré', 'Mäßig'),
    action: ml('Plan at next shutdown', 'À planifier au prochain arrêt', 'Beim nächsten Stillstand einplanen'),
    review: 'Revue trimestrielle',
    alarm: 'Avertissement',
    color: '#f59e0b'
  },
  {
    level: 'high',
    min: 51,
    max: 75,
    label: ml('High', 'Élevé', 'Hoch'),
    action: ml('Plan within 3 months', 'À planifier sous 3 mois', 'Innerhalb von 3 Monaten einplanen'),
    review: 'Revue mensuelle',
    alarm: 'Alarme haute',
    color: '#f97316'
  },
  {
    level: 'critical',
    min: 76,
    max: 100,
    label: ml('Critical', 'Critique', 'Kritisch'),
    action: ml('Immediate action required', 'Action immédiate requise', 'Sofortmaßnahme erforderlich'),
    review: 'Suivi hebdomadaire',
    alarm: 'Alarme critique',
    color: '#ef4444'
  }
];

const RISK_BANDS_BY_LEVEL: Record<RiskLevel, RiskBand> = Object.fromEntries(
  RISK_BANDS.map((b) => [b.level, b])
) as Record<RiskLevel, RiskBand>;

/** Map a 0–100 score to its risk level. */
export function riskLevel(score: number): RiskLevel {
  const band = RISK_BANDS.find((b) => score >= b.min && score <= b.max);
  return band ? band.level : 'critical';
}

/** Look up the band (label/action/colour) for a level. */
export function bandForLevel(level: RiskLevel): RiskBand {
  return RISK_BANDS_BY_LEVEL[level];
}
