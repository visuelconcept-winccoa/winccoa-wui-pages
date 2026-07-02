// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compliance advisor — checks a tunnel configuration against the minimum
 * safety requirements of the selected regulatory profile and returns the list
 * of deviations shown live in the segment editor.
 *
 * Profiles (selectable per tunnel):
 *  - `eu-2004-54` — EU directive 2004/54/EC (trans-European network, > 500 m)
 *  - `fr-cetu`    — France, inter-ministerial circular 2000-63 / CETU
 *  - `ch-astra`   — Switzerland, ASTRA/OFROU directives
 *
 * ⚠️ The thresholds below are a SIMPLIFIED reading of those texts (the real
 * requirements depend on traffic class, new vs existing tunnel, risk analysis
 * and derogations). They are advisory design aids, not a certification: the
 * operator's safety officer remains the authority. Each rule carries the
 * reference (`ref`) of the clause it approximates.
 */
import { localize, ml } from '../i18n.js';
import {
  tubeEquipment,
  tubeLengthM,
  tunnelLengthM,
  type EquipmentKind,
  type RegulatoryProfileId,
  type Tunnel,
  type TubeDef
} from '../types.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

export type ComplianceSeverity = 'error' | 'warning' | 'info';

/** One deviation (or advisory note) raised by the advisor. */
export interface ComplianceIssue {
  severity: ComplianceSeverity;
  ruleId: string;
  message: string;
  /** Clause the rule approximates (shown as a badge). */
  ref: string;
  tubeId?: string;
  pkM?: number;
}

/** Numeric thresholds of one regulatory profile (simplified, see module docs). */
export interface ProfileRules {
  /** Directive scope: rules below apply from this tunnel length on. */
  scopeMinLengthM: number;
  /** Max spacing between emergency exits in a UNIDIRECTIONAL tube. */
  exitSpacingUniM: number;
  /** Max spacing between emergency exits in a BIDIRECTIONAL tube (stricter). */
  exitSpacingBidiM: number;
  /** Max spacing between SOS emergency stations inside the tunnel. */
  sosSpacingM: number;
  /** Mechanical ventilation required above this length … */
  ventilationMinLengthM: number;
  /** … when traffic per lane exceeds this (vehicles/day). */
  ventilationMinTraffic: number;
  /** CCTV/AID video surveillance required above this length. */
  cctvMinLengthM: number;
  /** Radio rebroadcast for emergency services required above this length. */
  radioMinLengthM: number;
  /** New tunnels should not exceed this longitudinal gradient (percent). */
  maxGradientPct: number;
  refs: { base: string; exits: string; sos: string; ventilation: string; gradient: string };
}

const PROFILES: Record<RegulatoryProfileId, ProfileRules> = {
  'eu-2004-54': {
    scopeMinLengthM: 500,
    exitSpacingUniM: 500,
    exitSpacingBidiM: 400,
    sosSpacingM: 150,
    ventilationMinLengthM: 1000,
    ventilationMinTraffic: 2000,
    cctvMinLengthM: 3000,
    radioMinLengthM: 1000,
    maxGradientPct: 5,
    refs: {
      base: '2004/54/CE',
      exits: '2004/54/CE ann. I §2.3.3',
      sos: '2004/54/CE ann. I §2.10',
      ventilation: '2004/54/CE ann. I §2.9',
      gradient: '2004/54/CE ann. I §2.2'
    }
  },
  'fr-cetu': {
    scopeMinLengthM: 300,
    exitSpacingUniM: 400,
    exitSpacingBidiM: 200,
    sosSpacingM: 200,
    ventilationMinLengthM: 800,
    ventilationMinTraffic: 2000,
    cctvMinLengthM: 1500,
    radioMinLengthM: 800,
    maxGradientPct: 5,
    refs: {
      base: 'IT 2000-63 (CETU)',
      exits: 'IT 2000-63 §4 (issues)',
      sos: 'IT 2000-63 §5 (niches)',
      ventilation: 'IT 2000-63 §6 (ventilation)',
      gradient: 'IT 2000-63 §3 (profil)'
    }
  },
  'ch-astra': {
    scopeMinLengthM: 300,
    exitSpacingUniM: 300,
    exitSpacingBidiM: 300,
    sosSpacingM: 150,
    ventilationMinLengthM: 600,
    ventilationMinTraffic: 2000,
    cctvMinLengthM: 1500,
    radioMinLengthM: 600,
    maxGradientPct: 5,
    refs: {
      base: 'ASTRA/OFROU (BSA)',
      exits: 'ASTRA — voies de fuite',
      sos: 'ASTRA — niches SOS',
      ventilation: 'ASTRA 13001 (ventilation)',
      gradient: 'ASTRA — tracé'
    }
  }
};

/** Read-only thresholds of a profile (used by the auto-fix generator). */
export function profileRules(profile: RegulatoryProfileId): ProfileRules {
  return PROFILES[profile];
}

/** Localized display name of a regulatory profile. */
export function profileLabel(profile: RegulatoryProfileId): string {
  return localize(PROFILE_LABELS[profile]);
}

const PROFILE_LABELS: Record<RegulatoryProfileId, MultiLangString> = {
  'eu-2004-54': ml('EU — directive 2004/54/EC', 'UE — directive 2004/54/CE', 'EU — Richtlinie 2004/54/EG'),
  'fr-cetu': ml('France — CETU / IT 2000-63', 'France — CETU / IT 2000-63', 'Frankreich — CETU / IT 2000-63'),
  'ch-astra': ml('Switzerland — ASTRA/FEDRO', 'Suisse — OFROU/ASTRA', 'Schweiz — ASTRA')
};

export const ALL_PROFILES: readonly RegulatoryProfileId[] = ['eu-2004-54', 'fr-cetu', 'ch-astra'];

function issueMsg(msg: MultiLangString): string {
  return localize(msg);
}

function hasKind(tunnel: Tunnel, tube: TubeDef, kind: EquipmentKind): boolean {
  return tubeEquipment(tunnel, tube.id).some((e) => e.kind === kind);
}

/**
 * Max gap (metres) along a tube between consecutive equipments of a kind,
 * counting the portals as boundaries. Infinity when the tube has none.
 */
function maxSpacing(tunnel: Tunnel, tube: TubeDef, kind: EquipmentKind): number {
  const pks = tubeEquipment(tunnel, tube.id)
    .filter((e) => e.kind === kind)
    .map((e) => e.pkM);
  if (pks.length === 0) return Number.POSITIVE_INFINITY;
  const length = tubeLengthM(tube);
  let previous = 0;
  let widest = 0;
  for (const pk of pks) {
    widest = Math.max(widest, pk - previous);
    previous = pk;
  }
  return Math.max(widest, length - previous);
}

/** Run every rule of the tunnel's profile; returns deviations, worst first. */
export function checkCompliance(tunnel: Tunnel): ComplianceIssue[] {
  const rules = PROFILES[tunnel.profile];
  const issues: ComplianceIssue[] = [];
  const length = tunnelLengthM(tunnel);

  if (length < rules.scopeMinLengthM) {
    issues.push({
      severity: 'info',
      ruleId: 'scope',
      ref: rules.refs.base,
      message: issueMsg(
        ml(
          `Tunnel shorter than ${rules.scopeMinLengthM} m — outside the strict scope of the profile; rules shown as guidance.`,
          `Tunnel de moins de ${rules.scopeMinLengthM} m — hors du champ strict du référentiel ; règles données à titre indicatif.`,
          `Tunnel kürzer als ${rules.scopeMinLengthM} m — außerhalb des strikten Geltungsbereichs; Regeln nur als Hinweis.`
        )
      )
    });
  }

  for (const tube of tunnel.tubes) {
    checkTube(tunnel, tube, rules, issues);
  }

  const order: Record<ComplianceSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

function checkTube(tunnel: Tunnel, tube: TubeDef, rules: ProfileRules, issues: ComplianceIssue[]): void {
  const length = tubeLengthM(tube);
  if (length === 0) return;

  checkSpacings(tunnel, tube, rules, issues);
  checkVentilation(tunnel, tube, rules, issues, length);
  checkSystems(tunnel, tube, rules, issues, length);
  checkGeometry(tube, rules, issues);
}

/** Exit-spacing threshold of a tube (bidirectional tubes are stricter). */
export function exitSpacingOf(rules: ProfileRules, tube: TubeDef): number {
  return tube.direction === 'bidirectional' ? rules.exitSpacingBidiM : rules.exitSpacingUniM;
}

function checkSpacings(tunnel: Tunnel, tube: TubeDef, rules: ProfileRules, issues: ComplianceIssue[]): void {
  const exitSpacing = exitSpacingOf(rules, tube);
  const exitGap = maxSpacing(tunnel, tube, 'emergency-exit');
  if (exitGap > exitSpacing) {
    issues.push({
      severity: 'error',
      ruleId: 'exit-spacing',
      ref: rules.refs.exits,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name} (${tube.direction === 'bidirectional' ? 'bidirectional' : 'unidirectional'}): emergency exits more than ${exitSpacing} m apart (widest gap ${Math.round(exitGap)} m).`,
          `${tube.name} (${tube.direction === 'bidirectional' ? 'bidirectionnel' : 'unidirectionnel'}) : issues de secours espacées de plus de ${exitSpacing} m (plus grand intervalle ${Math.round(exitGap)} m).`,
          `${tube.name} (${tube.direction === 'bidirectional' ? 'Gegenverkehr' : 'Richtungsverkehr'}): Notausgänge mehr als ${exitSpacing} m auseinander (größte Lücke ${Math.round(exitGap)} m).`
        )
      )
    });
  }
  const sosGap = maxSpacing(tunnel, tube, 'sos-niche');
  if (sosGap > rules.sosSpacingM) {
    issues.push({
      severity: 'error',
      ruleId: 'sos-spacing',
      ref: rules.refs.sos,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: SOS stations more than ${rules.sosSpacingM} m apart (widest gap ${Math.round(sosGap)} m).`,
          `${tube.name} : niches SOS espacées de plus de ${rules.sosSpacingM} m (plus grand intervalle ${Math.round(sosGap)} m).`,
          `${tube.name}: Notrufnischen mehr als ${rules.sosSpacingM} m auseinander (größte Lücke ${Math.round(sosGap)} m).`
        )
      )
    });
  }
}

function checkVentilation(
  tunnel: Tunnel,
  tube: TubeDef,
  rules: ProfileRules,
  issues: ComplianceIssue[],
  length: number
): void {
  const needsVentilation =
    length > rules.ventilationMinLengthM && tunnel.trafficPerLane > rules.ventilationMinTraffic;
  if (needsVentilation && !hasKind(tunnel, tube, 'jet-fan')) {
    issues.push({
      severity: 'error',
      ruleId: 'ventilation',
      ref: rules.refs.ventilation,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: mechanical ventilation required (length > ${rules.ventilationMinLengthM} m and traffic > ${rules.ventilationMinTraffic} veh/day/lane) but no jet fan is placed.`,
          `${tube.name} : ventilation mécanique requise (longueur > ${rules.ventilationMinLengthM} m et trafic > ${rules.ventilationMinTraffic} véh/j/voie) mais aucun accélérateur n'est posé.`,
          `${tube.name}: mechanische Lüftung erforderlich (Länge > ${rules.ventilationMinLengthM} m und Verkehr > ${rules.ventilationMinTraffic} Fz/Tag/Spur), aber kein Strahlventilator platziert.`
        )
      )
    });
  }
  if (needsVentilation && hasKind(tunnel, tube, 'jet-fan') && !hasKind(tunnel, tube, 'anemometer')) {
    issues.push({
      severity: 'warning',
      ruleId: 'anemometer',
      ref: rules.refs.ventilation,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: ventilated tube without an anemometer — the longitudinal air speed cannot be regulated.`,
          `${tube.name} : tube ventilé sans anémomètre — la vitesse d'air longitudinale ne peut pas être régulée.`,
          `${tube.name}: belüftete Röhre ohne Anemometer — die Längsluftgeschwindigkeit kann nicht geregelt werden.`
        )
      )
    });
  }
}

function checkSystems(
  tunnel: Tunnel,
  tube: TubeDef,
  rules: ProfileRules,
  issues: ComplianceIssue[],
  length: number
): void {
  if (length > rules.scopeMinLengthM && !hasKind(tunnel, tube, 'fire-detection')) {
    issues.push({
      severity: 'warning',
      ruleId: 'fire-detection',
      ref: rules.refs.base,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: no fire-detection equipment placed.`,
          `${tube.name} : aucune détection incendie posée.`,
          `${tube.name}: keine Branddetektion platziert.`
        )
      )
    });
  }
  if (length > rules.cctvMinLengthM && !hasKind(tunnel, tube, 'camera')) {
    issues.push({
      severity: 'warning',
      ruleId: 'cctv',
      ref: rules.refs.base,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: video surveillance (CCTV/AID) expected above ${rules.cctvMinLengthM} m.`,
          `${tube.name} : vidéosurveillance (CCTV/DAI) attendue au-delà de ${rules.cctvMinLengthM} m.`,
          `${tube.name}: Videoüberwachung (CCTV/AID) ab ${rules.cctvMinLengthM} m erwartet.`
        )
      )
    });
  }
  if (length > rules.radioMinLengthM && !hasKind(tunnel, tube, 'radio')) {
    issues.push({
      severity: 'warning',
      ruleId: 'radio',
      ref: rules.refs.base,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: radio rebroadcast for emergency services expected above ${rules.radioMinLengthM} m.`,
          `${tube.name} : retransmission radio des services de secours attendue au-delà de ${rules.radioMinLengthM} m.`,
          `${tube.name}: Funkübertragung für Einsatzdienste ab ${rules.radioMinLengthM} m erwartet.`
        )
      )
    });
  }
  if (length > rules.scopeMinLengthM && !hasKind(tunnel, tube, 'power')) {
    issues.push({
      severity: 'warning',
      ruleId: 'power',
      ref: rules.refs.base,
      tubeId: tube.id,
      message: issueMsg(
        ml(
          `${tube.name}: no backed-up power supply placed (safety systems need one).`,
          `${tube.name} : aucune alimentation secourue posée (nécessaire aux équipements de sécurité).`,
          `${tube.name}: keine Notstromversorgung platziert (für Sicherheitseinrichtungen erforderlich).`
        )
      )
    });
  }
}

function checkGeometry(tube: TubeDef, rules: ProfileRules, issues: ComplianceIssue[]): void {
  let pk = 0;
  for (const segment of tube.segments) {
    if (Math.abs(segment.gradientPct) > rules.maxGradientPct) {
      issues.push({
        severity: 'warning',
        ruleId: 'gradient',
        ref: rules.refs.gradient,
        tubeId: tube.id,
        pkM: pk,
        message: issueMsg(
          ml(
            `${tube.name} / ${segment.name}: longitudinal gradient ${segment.gradientPct} % exceeds ${rules.maxGradientPct} % (not permitted in new tunnels unless no other solution).`,
            `${tube.name} / ${segment.name} : pente longitudinale de ${segment.gradientPct} % supérieure à ${rules.maxGradientPct} % (interdite en tunnel neuf sauf impossibilité géographique).`,
            `${tube.name} / ${segment.name}: Längsneigung ${segment.gradientPct} % über ${rules.maxGradientPct} % (in neuen Tunneln unzulässig, außer ohne Alternative).`
          )
        )
      });
    }
    pk += segment.lengthM;
  }
  const first = tube.segments[0];
  if (first && first.lightingZone !== 'entrance') {
    issues.push({
      severity: 'info',
      ruleId: 'lighting-zone',
      ref: 'CIE 88',
      tubeId: tube.id,
      pkM: 0,
      message: issueMsg(
        ml(
          `${tube.name}: the first segment is not an entrance lighting zone (CIE 88 reinforcement).`,
          `${tube.name} : le premier segment n'est pas une zone d'éclairage d'entrée (renforcement CIE 88).`,
          `${tube.name}: das erste Segment ist keine Einfahrts-Beleuchtungszone (CIE-88-Verstärkung).`
        )
      )
    });
  }
}
