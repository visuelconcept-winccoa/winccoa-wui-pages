// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offline/demo seeds — four realistic single-line diagrams, generated on
 * demand so names, descriptions and equipment labels are localized to the
 * ACTIVE UI language at creation time (they are then persisted as plain
 * strings, like any user-entered label):
 *
 *  1. HV source substation 63/20 kV — two incoming 63 kV lines, disconnector +
 *     breaker per incomer, two HV/MV transformers, two 20 kV half-busbars with
 *     a bus coupler (drawn horizontal — rotation 90°), four MV feeders.
 *  2. MV/LV substation 20 kV / 400 V — ring-main (two loop feeders with
 *     switch-disconnectors), fused transformer protection, LV main board with
 *     energy meter, surge arrester, earth and three feeders.
 *  3. Backed-up LV board — grid + standby generator through a changeover pair
 *     of contactors, one busbar, three outgoing feeders.
 *  4. DC railway traction feed — grid → transformer → rectifier → traction
 *     breaker → two catenary sections joined by a sectioning switch, a train
 *     bridging catenary to the track return, earthed.
 *
 * Coordinates are canvas units (grid-snapped). Datapoint bindings are
 * placeholder `Demo:*` names that stay unbound offline (the switchgear then
 * reads as closed, so the whole diagram lights up).
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { ml } from '../i18n.js';
import type { Edge, Measurement, Network, Node, Rotation, SymbolId } from '../types.js';

/** Localized text, resolved at generation time. */
function t(en: string, fr: string, de: string): string {
  return localize(ml(en, fr, de));
}

// Symbol ids reused across the demos (hoisted per lint no-duplicate-string).
const GRID_SOURCE: SymbolId = 'grid-source';
const DISCONNECTOR: SymbolId = 'disconnector';
const FEEDER_OUT: SymbolId = 'feeder-out';

/** Overview grouping labels, localized at generation time. */
const CAT_DISTRIB = (): string => t('Power distribution', 'Distribution électrique', 'Stromverteilung');
const CAT_RAIL = (): string => t('Railway electrification', 'Électrification ferroviaire', 'Bahnelektrifizierung');

/** Compact node literal (defaults: no rotation, unbound, closed=1, not a source). */
function node(
  id: string,
  symbol: SymbolId,
  label: string,
  x: number,
  y: number,
  extra: Partial<Node> = {}
): Node {
  return { id, symbol, label, labelDx: 0, labelDy: 0, x, y, rotation: 0 as Rotation, dp: '', closedValue: 1, source: false, ...extra };
}

function edge(id: string, fromNode: string, fromPort: string, toNode: string, toPort: string): Edge {
  return { id, from: { nodeId: fromNode, port: fromPort }, to: { nodeId: toNode, port: toPort } };
}

function meas(id: string, dp: string, label: string, unit: string, decimals: number, nodeId: string, x: number, y: number): Measurement {
  return { id, dp, label, unit, decimals, nodeId, x, y };
}

/** 1 — HV source substation 63/20 kV (two incomers, two transformers, coupled half-busbars). */
function demoSourceSubstation(): Network {
  return {
    id: 'demo-poste-source',
    category: CAT_DISTRIB(),
    name: t('Source substation 63/20 kV', 'Poste source 63/20 kV', 'Umspannwerk 63/20 kV'),
    description: t(
      'Two 63 kV incomers, HV/MV transformers, two coupled 20 kV half-busbars and four feeders.',
      'Deux arrivées 63 kV, transformateurs HTB/HTA, deux demi-jeux de barres 20 kV couplés et quatre départs.',
      'Zwei 63-kV-Einspeisungen, HS/MS-Transformatoren, zwei gekuppelte 20-kV-Halbsammelschienen und vier Abgänge.'
    ),
    updatedAt: '',
    nodes: [
      node('g1', GRID_SOURCE, t('Line 1 — 63 kV', 'Ligne 1 — 63 kV', 'Leitung 1 — 63 kV'), 200, 40, { source: true, dp: 'Demo:Line1.voltagePresent' }),
      node('g2', GRID_SOURCE, t('Line 2 — 63 kV', 'Ligne 2 — 63 kV', 'Leitung 2 — 63 kV'), 900, 40, { source: true, dp: 'Demo:Line2.voltagePresent' }),
      node('qs1', DISCONNECTOR, 'QS1', 210, 170, { dp: 'Demo:Incomer1.disconnector' }),
      node('qs2', DISCONNECTOR, 'QS2', 910, 170, { dp: 'Demo:Incomer2.disconnector' }),
      node('q1', 'breaker', 'Q1', 210, 290, { dp: 'Demo:Incomer1.breaker' }),
      node('q2', 'breaker', 'Q2', 910, 290, { dp: 'Demo:Incomer2.breaker' }),
      node('t1', 'transformer', 'T1 — 63/20 kV', 200, 410),
      node('t2', 'transformer', 'T2 — 63/20 kV', 900, 410),
      node('qa1', 'breaker', 'QA1', 210, 580, { dp: 'Demo:TrafoA.breaker' }),
      node('qa2', 'breaker', 'QA2', 910, 580, { dp: 'Demo:TrafoB.breaker' }),
      node('bba', 'busbar', t('Half-busbar A', 'Demi-barre A', 'Halbschiene A'), 130, 700),
      node('bbb', 'busbar', t('Half-busbar B', 'Demi-barre B', 'Halbschiene B'), 830, 700),
      // Bus coupler between the two half-busbars — drawn horizontal (rotation 90°).
      node('qc', 'breaker', t('Coupler QC', 'Couplage QC', 'Kupplung QC'), 560, 660, { rotation: 90, dp: 'Demo:Coupler.breaker', labelDy: -96 }),
      node('qd1', 'breaker', 'QD1', 150, 800, { dp: 'Demo:FeederA1.breaker' }),
      node('qd2', 'breaker', 'QD2', 290, 800, { dp: 'Demo:FeederA2.breaker' }),
      node('qd3', 'breaker', 'QD3', 850, 800, { dp: 'Demo:FeederB1.breaker' }),
      node('qd4', 'breaker', 'QD4', 990, 800, { dp: 'Demo:FeederB2.breaker' }),
      node('f1', FEEDER_OUT, t('Feeder A1', 'Départ A1', 'Abgang A1'), 150, 920),
      node('m1', 'motor', t('Auxiliaries', 'Auxiliaires', 'Eigenbedarf'), 280, 920),
      node('f3', FEEDER_OUT, t('Feeder B1', 'Départ B1', 'Abgang B1'), 850, 920),
      node('f4', FEEDER_OUT, t('Feeder B2', 'Départ B2', 'Abgang B2'), 990, 920)
    ],
    edges: [
      edge('e1', 'g1', 'b', 'qs1', 'a'),
      edge('e2', 'qs1', 'b', 'q1', 'a'),
      edge('e3', 'q1', 'b', 't1', 'a'),
      edge('e4', 't1', 'b', 'qa1', 'a'),
      edge('e5', 'qa1', 'b', 'bba', 'p3'),
      edge('e6', 'g2', 'b', 'qs2', 'a'),
      edge('e7', 'qs2', 'b', 'q2', 'a'),
      edge('e8', 'q2', 'b', 't2', 'a'),
      edge('e9', 't2', 'b', 'qa2', 'a'),
      edge('e10', 'qa2', 'b', 'bbb', 'p3'),
      edge('e11', 'bba', 'p6', 'qc', 'a'),
      edge('e12', 'qc', 'b', 'bbb', 'p1'),
      edge('e13', 'bba', 'p1', 'qd1', 'a'),
      edge('e14', 'qd1', 'b', 'f1', 'a'),
      edge('e15', 'bba', 'p4', 'qd2', 'a'),
      edge('e16', 'qd2', 'b', 'm1', 'a'),
      edge('e17', 'bbb', 'p2', 'qd3', 'a'),
      edge('e18', 'qd3', 'b', 'f3', 'a'),
      edge('e19', 'bbb', 'p5', 'qd4', 'a'),
      edge('e20', 'qd4', 'b', 'f4', 'a')
    ],
    measurements: [
      meas('mea1', 'Demo:Incomer1.current', 'I1', 'A', 0, 'q1', 60, 0),
      meas('mea2', 'Demo:Incomer2.current', 'I2', 'A', 0, 'q2', 60, 0),
      meas('mea3', 'Demo:BusbarA.voltage', 'U', 'kV', 1, '', 400, 668),
      meas('mea4', 'Demo:BusbarB.voltage', 'U', 'kV', 1, '', 1120, 668)
    ]
  };
}

/** 2 — MV/LV substation 20 kV / 400 V (ring-main, fused transformer, LV board). */
function demoMvLvSubstation(): Network {
  return {
    id: 'demo-poste-htabt',
    category: CAT_DISTRIB(),
    name: t('MV/LV substation 20 kV / 400 V', 'Poste HTA/BT 20 kV / 400 V', 'MS/NS-Station 20 kV / 400 V'),
    description: t(
      'Ring-main with two loop feeders, fused transformer protection and a LV board (meter, surge arrester, earth, three feeders).',
      'Boucle HTA à deux arrivées, protection transformateur par fusible et TGBT (compteur, parafoudre, terre, trois départs).',
      'Ringnetz mit zwei Einspeisungen, Trafoschutz per Sicherung und NS-Verteilung (Zähler, Ableiter, Erde, drei Abgänge).'
    ),
    updatedAt: '',
    nodes: [
      node('fi1', 'feeder-in', t('Loop in', 'Arrivée boucle', 'Ring-Einspeisung'), 160, 40, { source: true }),
      node('fi2', 'feeder-in', t('Loop out', 'Retour boucle', 'Ring-Ausspeisung'), 420, 40, { source: true }),
      node('is1', 'switch-disconnector', 'IS1', 170, 140, { dp: 'Demo:Loop1.switch' }),
      node('is2', 'switch-disconnector', 'IS2', 430, 140, { dp: 'Demo:Loop2.switch' }),
      node('bbmt', 'busbar', t('20 kV busbar', 'Jeu de barres 20 kV', '20-kV-Sammelschiene'), 120, 260),
      node('fu1', 'fuse', 'F1', 270, 340, { dp: '' }),
      node('t1', 'transformer', 'T — 20 kV / 400 V', 260, 460),
      node('kwh', 'meter', 'kWh', 268, 620),
      node('qg', 'breaker', t('Main breaker QG', 'Disjoncteur général QG', 'Hauptschalter QG'), 270, 740, { dp: 'Demo:LvMain.breaker' }),
      node('bbbt', 'busbar', t('LV busbar', 'Jeu de barres BT', 'NS-Sammelschiene'), 170, 860),
      node('qd1', 'breaker', 'QD1', 190, 940, { dp: 'Demo:LvLight.breaker' }),
      node('qd2', 'breaker', 'QD2', 310, 940, { dp: 'Demo:LvMotor.breaker' }),
      node('qd3', 'breaker', 'QD3', 430, 940, { dp: 'Demo:LvShop.breaker' }),
      node('l1', 'load', t('Lighting', 'Éclairage', 'Beleuchtung'), 190, 1060),
      node('m1', 'motor', t('Pump', 'Pompe', 'Pumpe'), 300, 1060),
      node('f1', FEEDER_OUT, t('Workshop', 'Atelier', 'Werkstatt'), 430, 1060),
      node('sa1', 'surge-arrester', t('Arrester', 'Parafoudre', 'Ableiter'), 40, 940),
      node('gnd', 'ground', t('Earth', 'Terre', 'Erde'), 40, 1060)
    ],
    edges: [
      edge('e1', 'fi1', 'b', 'is1', 'a'),
      edge('e2', 'is1', 'b', 'bbmt', 'p2'),
      edge('e3', 'fi2', 'b', 'is2', 'a'),
      edge('e4', 'is2', 'b', 'bbmt', 'p6'),
      edge('e5', 'bbmt', 'p4', 'fu1', 'a'),
      edge('e6', 'fu1', 'b', 't1', 'a'),
      edge('e7', 't1', 'b', 'kwh', 'a'),
      edge('e8', 'kwh', 'b', 'qg', 'a'),
      edge('e9', 'qg', 'b', 'bbbt', 'p3'),
      edge('e10', 'bbbt', 'p2', 'qd1', 'a'),
      edge('e11', 'qd1', 'b', 'l1', 'a'),
      edge('e12', 'bbbt', 'p4', 'qd2', 'a'),
      edge('e13', 'qd2', 'b', 'm1', 'a'),
      edge('e14', 'bbbt', 'p6', 'qd3', 'a'),
      edge('e15', 'qd3', 'b', 'f1', 'a'),
      edge('e16', 'bbbt', 'p1', 'sa1', 'a'),
      edge('e17', 'sa1', 'b', 'gnd', 'a')
    ],
    measurements: [
      meas('mea1', 'Demo:LvMain.current', 'I', 'A', 0, 'qg', 60, 0),
      meas('mea2', 'Demo:LvBusbar.voltage', 'U', 'V', 0, '', 560, 868)
    ]
  };
}

/** 3 — Backed-up LV board (grid + generator through a changeover pair). */
function demoBackedUpBoard(): Network {
  return {
    id: 'demo-tgbt-secouru',
    category: CAT_DISTRIB(),
    name: t('Backed-up LV board', 'TGBT secouru', 'NS-Verteilung mit Ersatz'),
    description: t(
      'Grid and standby generator through a normal/backup changeover, one busbar and three feeders.',
      'Réseau et groupe électrogène via un inverseur normal/secours, un jeu de barres et trois départs.',
      'Netz und Notstromaggregat über eine Netz/Ersatz-Umschaltung, eine Sammelschiene und drei Abgänge.'
    ),
    updatedAt: '',
    nodes: [
      node('g1', GRID_SOURCE, t('Grid', 'Réseau', 'Netz'), 200, 40, { source: true, dp: 'Demo:Grid.available' }),
      node('ge1', 'generator', t('Generator', 'Groupe électrogène', 'Notstromaggregat'), 560, 40, { source: true, dp: 'Demo:Genset.running' }),
      node('kn', 'contactor', t('KN — normal', 'KN — normal', 'KN — Netz'), 210, 190, { dp: 'Demo:Changeover.normal' }),
      node('ks', 'contactor', t('KS — backup', 'KS — secours', 'KS — Ersatz'), 570, 190, { dp: 'Demo:Changeover.backup' }),
      node('bb', 'busbar', t('Busbar', 'Jeu de barres', 'Sammelschiene'), 240, 330),
      node('qd1', 'breaker', 'QD1', 260, 410, { dp: 'Demo:Pump.breaker' }),
      node('qd2', 'breaker', 'QD2', 380, 410, { dp: 'Demo:Light.breaker' }),
      node('qd3', DISCONNECTOR, 'QD3', 500, 410, { dp: 'Demo:Shop.breaker' }),
      node('m1', 'motor', t('Pump', 'Pompe', 'Pumpe'), 250, 530),
      node('l1', 'load', t('Lighting', 'Éclairage', 'Beleuchtung'), 380, 530),
      node('f1', FEEDER_OUT, t('Workshop', 'Atelier', 'Werkstatt'), 500, 530)
    ],
    edges: [
      edge('e1', 'g1', 'b', 'kn', 'a'),
      edge('e2', 'kn', 'b', 'bb', 'p1'),
      edge('e3', 'ge1', 'b', 'ks', 'a'),
      edge('e4', 'ks', 'b', 'bb', 'p6'),
      edge('e5', 'bb', 'p2', 'qd1', 'a'),
      edge('e6', 'qd1', 'b', 'm1', 'a'),
      edge('e7', 'bb', 'p3', 'qd2', 'a'),
      edge('e8', 'qd2', 'b', 'l1', 'a'),
      edge('e9', 'bb', 'p4', 'qd3', 'a'),
      edge('e10', 'qd3', 'b', 'f1', 'a')
    ],
    measurements: [
      meas('mea1', 'Demo:Grid.current', 'I', 'A', 1, 'kn', 60, 0),
      meas('mea2', 'Demo:Busbar.voltage', 'U', 'V', 0, '', 620, 338)
    ]
  };
}

/** 4 — DC railway traction feed (rectifier substation, sectioned catenary, train, track return). */
function demoRailwayTraction(): Network {
  return {
    id: 'demo-ferroviaire',
    category: CAT_RAIL(),
    name: t('DC traction substation', 'Sous-station de traction DC', 'DC-Unterwerk'),
    description: t(
      'DC traction substation: grid → transformer → rectifier → breaker → two catenary sections with a sectioning switch, a train on section 1, track return to earth.',
      'Sous-station de traction DC : réseau → transformateur → redresseur → disjoncteur → deux sections de caténaire (sectionnement), train sous la section 1, retour rail à la terre.',
      'DC-Unterwerk: Netz → Trafo → Gleichrichter → Schalter → zwei Fahrleitungsabschnitte mit Streckentrenner, ein Zug auf Abschnitt 1, Gleisrückführung zur Erde.'
    ),
    updatedAt: '',
    nodes: [
      node('g1', GRID_SOURCE, t('MV grid', 'Réseau HTA', 'MS-Netz'), 140, 40, { source: true, dp: 'Demo:Traction.gridAvailable' }),
      node('t1', 'transformer', t('Traction transformer', 'Transfo traction', 'Bahnstrom-Trafo'), 140, 160),
      node('r1', 'rectifier', t('Rectifier', 'Redresseur', 'Gleichrichter'), 148, 310),
      node('q1', 'breaker', t('Traction breaker', 'DJ traction', 'Bahnstromschalter'), 150, 410, { dp: 'Demo:Traction.breaker' }),
      node('c1', 'catenary', t('Catenary — section 1', 'Caténaire — section 1', 'Fahrleitung — Abschnitt 1'), 60, 520),
      node('s1', 'section-switch', t('Sectioning S1', 'Sectionnement S1', 'Streckentrenner S1'), 320, 531, { dp: 'Demo:Catenary.section1' }),
      node('c2', 'catenary', t('Catenary — section 2', 'Caténaire — section 2', 'Fahrleitung — Abschnitt 2'), 420, 520),
      node('tr1', 'train', t('Train 4712', 'Train 4712', 'Zug 4712'), 160, 600),
      node('k1', 'track', t('Track (return)', 'Rail (retour)', 'Gleis (Rückleitung)'), 60, 740),
      node('gnd1', 'ground', '', 40, 780)
    ],
    edges: [
      edge('e1', 'g1', 'b', 't1', 'a'),
      edge('e2', 't1', 'b', 'r1', 'a'),
      edge('e3', 'r1', 'b', 'q1', 'a'),
      edge('e4', 'q1', 'b', 'c1', 'p3'),
      edge('e5', 'c1', 'p6', 's1', 'a'),
      edge('e6', 's1', 'b', 'c2', 'p1'),
      edge('e7', 'c1', 'p4', 'tr1', 'a'),
      edge('e8', 'tr1', 'b', 'k1', 'p4'),
      edge('e9', 'k1', 'p1', 'gnd1', 'a')
    ],
    measurements: [
      meas('mea1', 'Demo:Catenary.voltage', 'U', 'V', 0, 'c1', -40, -46),
      meas('mea2', 'Demo:Traction.current', 'I', 'A', 0, 'q1', 60, 0)
    ]
  };
}

/** 5 — Simple DC feed (single catenary section, one train) — the minimal railway diagram. */
function demoRailwaySimpleFeed(): Network {
  return {
    id: 'demo-ferro-simple',
    category: CAT_RAIL(),
    name: t('Simple DC feed', 'Alimentation DC simple', 'Einfache DC-Speisung'),
    description: t(
      'The minimal railway diagram: rectifier substation → breaker → one catenary → a train → track return to earth.',
      'Le schéma ferroviaire minimal : sous-station redresseuse → disjoncteur → une caténaire → un train → retour rail à la terre.',
      'Das minimale Bahndiagramm: Gleichrichter-Unterwerk → Schalter → eine Fahrleitung → ein Zug → Gleisrückführung zur Erde.'
    ),
    updatedAt: '',
    nodes: [
      node('g1', GRID_SOURCE, t('MV grid', 'Réseau HTA', 'MS-Netz'), 120, 40, { source: true }),
      node('t1', 'transformer', t('Transformer', 'Transformateur', 'Trafo'), 120, 160),
      node('r1', 'rectifier', t('Rectifier', 'Redresseur', 'Gleichrichter'), 128, 310),
      node('q1', 'breaker', 'DJ', 130, 410, { dp: 'Demo:Feed.breaker' }),
      node('c1', 'catenary', t('Catenary', 'Caténaire', 'Fahrleitung'), 40, 520),
      node('tr1', 'train', t('Train', 'Train', 'Zug'), 140, 600),
      node('k1', 'track', t('Track (return)', 'Rail (retour)', 'Gleis (Rückleitung)'), 40, 740),
      node('gnd1', 'ground', '', 20, 780)
    ],
    edges: [
      edge('e1', 'g1', 'b', 't1', 'a'),
      edge('e2', 't1', 'b', 'r1', 'a'),
      edge('e3', 'r1', 'b', 'q1', 'a'),
      edge('e4', 'q1', 'b', 'c1', 'p3'),
      edge('e5', 'c1', 'p4', 'tr1', 'a'),
      edge('e6', 'tr1', 'b', 'k1', 'p4'),
      edge('e7', 'k1', 'p1', 'gnd1', 'a')
    ],
    measurements: [meas('mea1', 'Demo:Catenary.voltage', 'U', 'V', 0, 'c1', -40, -46)]
  };
}

/** 6 — Double-track substation: two feeder breakers, a track paralleling switch, two trains. */
function demoRailwayDoubleTrack(): Network {
  return {
    id: 'demo-ferro-double-voie',
    category: CAT_RAIL(),
    name: t('Double-track substation', 'Sous-station double voie', 'Zweigleisiges Unterwerk'),
    description: t(
      'One rectifier substation feeding two tracks through separate feeder breakers, a normally-open track paralleling switch, a train on each track.',
      'Une sous-station redresseuse alimentant deux voies par disjoncteurs de départ séparés, un sectionnement de mise en parallèle normalement ouvert, un train par voie.',
      'Ein Gleichrichter-Unterwerk speist zwei Gleise über getrennte Abgangsschalter, ein normal offener Gleiskuppelschalter, je ein Zug pro Gleis.'
    ),
    updatedAt: '',
    nodes: [
      node('g1', GRID_SOURCE, t('MV grid', 'Réseau HTA', 'MS-Netz'), 360, 20, { source: true }),
      node('t1', 'transformer', t('Transformer', 'Transformateur', 'Trafo'), 360, 140),
      node('r1', 'rectifier', t('Rectifier', 'Redresseur', 'Gleichrichter'), 368, 290),
      node('bb', 'busbar', t('DC busbar', 'Barre DC', 'DC-Sammelschiene'), 260, 400, { rotation: 0 }),
      node('q1', 'breaker', 'DJ V1', 220, 470, { dp: 'Demo:Track1.breaker' }),
      node('q2', 'breaker', 'DJ V2', 460, 470, { dp: 'Demo:Track2.breaker' }),
      node('c1', 'catenary', t('Catenary V1', 'Caténaire V1', 'Fahrleitung G1'), 60, 580),
      node('c2', 'catenary', t('Catenary V2', 'Caténaire V2', 'Fahrleitung G2'), 380, 580),
      node('sp', 'section-switch', t('Paralleling (N/O)', 'Mise en parallèle (N/O)', 'Kupplung (N/O)'), 320, 591, { dp: 'Demo:Track.paralleling', closedValue: 1 }),
      node('tr1', 'train', t('Train A', 'Train A', 'Zug A'), 140, 660),
      node('tr2', 'train', t('Train B', 'Train B', 'Zug B'), 460, 660),
      node('k1', 'track', t('Track V1', 'Rail V1', 'Gleis G1'), 60, 800),
      node('k2', 'track', t('Track V2', 'Rail V2', 'Gleis G2'), 380, 800),
      node('gnd1', 'ground', '', 40, 840)
    ],
    edges: [
      edge('e1', 'g1', 'b', 't1', 'a'),
      edge('e2', 't1', 'b', 'r1', 'a'),
      edge('e3', 'r1', 'b', 'bb', 'p3'),
      edge('e4', 'bb', 'p1', 'q1', 'a'),
      edge('e5', 'bb', 'p6', 'q2', 'a'),
      edge('e6', 'q1', 'b', 'c1', 'p3'),
      edge('e7', 'q2', 'b', 'c2', 'p3'),
      edge('e8', 'c1', 'p6', 'sp', 'a'),
      edge('e9', 'sp', 'b', 'c2', 'p1'),
      edge('e10', 'c1', 'p4', 'tr1', 'a'),
      edge('e11', 'c2', 'p5', 'tr2', 'a'),
      edge('e12', 'tr1', 'b', 'k1', 'p4'),
      edge('e13', 'tr2', 'b', 'k2', 'p5'),
      edge('e14', 'k1', 'p6', 'k2', 'p1'),
      edge('e15', 'k1', 'p1', 'gnd1', 'a')
    ],
    measurements: [
      meas('mea1', 'Demo:Track1.current', 'I1', 'A', 0, 'q1', -70, 0),
      meas('mea2', 'Demo:Track2.current', 'I2', 'A', 0, 'q2', 60, 0)
    ]
  };
}

/** 7 — 2×25 kV AC autotransformer feed (complex): line + feeder + rail, three AT cells, a train. */
function demoRailway2x25(): Network {
  return {
    id: 'demo-ferro-2x25kv',
    category: CAT_RAIL(),
    name: t('2×25 kV AC (autotransformers)', '2×25 kV AC (autotransformateurs)', '2×25 kV AC (Autotrafos)'),
    description: t(
      'High-speed 2×25 kV AC scheme: substation transformer and breaker feed the catenary; autotransformer cells along the line balance catenary/feeder/rail; a train draws from the catenary.',
      'Schéma 2×25 kV AC grande vitesse : transformateur de sous-station et disjoncteur alimentent la caténaire ; des cellules autotransformateur le long de la ligne équilibrent caténaire/feeder/rail ; un train soutire sur la caténaire.',
      'Hochgeschwindigkeits-2×25-kV-AC: Unterwerkstrafo und Schalter speisen die Fahrleitung; Autotrafo-Zellen entlang der Strecke gleichen Fahrleitung/Feeder/Schiene aus; ein Zug bezieht aus der Fahrleitung.'
    ),
    updatedAt: '',
    nodes: [
      node('g1', GRID_SOURCE, t('HV grid 225 kV', 'Réseau HTB 225 kV', 'HS-Netz 225 kV'), 120, 20, { source: true }),
      node('qs', DISCONNECTOR, 'QS', 130, 130, { dp: 'Demo:Line.disconnector' }),
      node('t1', 'transformer', t('225/2×25 kV', '225/2×25 kV', '225/2×25 kV'), 120, 240),
      node('q1', 'breaker', 'DJ', 130, 400, { dp: 'Demo:Line.breaker' }),
      node('c1', 'catenary', t('Catenary', 'Caténaire', 'Fahrleitung'), 40, 520),
      node('c2', 'catenary', t('Catenary', 'Caténaire', 'Fahrleitung'), 420, 520),
      node('sp', 'section-switch', t('Sectioning', 'Sectionnement', 'Streckentrenner'), 320, 531, { dp: 'Demo:Catenary.sectioning' }),
      node('at1', 'autotransformer', 'AT1', 200, 620),
      node('at2', 'autotransformer', 'AT2', 560, 620),
      node('tr1', 'train', t('High-speed train', 'Train grande vitesse', 'Hochgeschwindigkeitszug'), 60, 690),
      node('k1', 'track', t('Track (return)', 'Rail (retour)', 'Gleis (Rückleitung)'), 40, 820),
      node('k2', 'track', t('Track (return)', 'Rail (retour)', 'Gleis (Rückleitung)'), 420, 820),
      node('gnd1', 'ground', '', 20, 860)
    ],
    edges: [
      edge('e1', 'g1', 'b', 'qs', 'a'),
      edge('e2', 'qs', 'b', 't1', 'a'),
      edge('e3', 't1', 'b', 'q1', 'a'),
      edge('e4', 'q1', 'b', 'c1', 'p3'),
      edge('e5', 'c1', 'p6', 'sp', 'a'),
      edge('e6', 'sp', 'b', 'c2', 'p1'),
      edge('e7', 'c1', 'p2', 'at1', 'a'),
      edge('e8', 'at1', 'b', 'k1', 'p2'),
      edge('e9', 'c2', 'p5', 'at2', 'a'),
      edge('e10', 'at2', 'b', 'k2', 'p5'),
      edge('e11', 'c1', 'p4', 'tr1', 'a'),
      edge('e12', 'tr1', 'b', 'k1', 'p4'),
      edge('e13', 'k1', 'p6', 'k2', 'p1'),
      edge('e14', 'k1', 'p1', 'gnd1', 'a')
    ],
    measurements: [
      meas('mea1', 'Demo:Catenary.voltage', 'U cat.', 'kV', 1, 'c1', -60, -46),
      meas('mea2', 'Demo:Line.current', 'I', 'A', 0, 'q1', 60, 0)
    ]
  };
}

/**
 * Build the demo networks — labels localized to the active UI language at
 * generation time. A fresh deep structure on every call (safe to persist/mutate).
 * Ordered by family then by rising complexity (the overview groups by category).
 */
export function demoNetworks(): Network[] {
  return [
    // Power distribution
    demoBackedUpBoard(),
    demoMvLvSubstation(),
    demoSourceSubstation(),
    // Railway electrification — simple → complex
    demoRailwaySimpleFeed(),
    demoRailwayTraction(),
    demoRailwayDoubleTrack(),
    demoRailway2x25()
  ];
}
