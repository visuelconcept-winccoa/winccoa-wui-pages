// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exercise (drill) engine — safety training on the digital twin.
 *
 * A scenario is a timed list of INJECTIONS (simulated equipment states,
 * measures, smoke) plus the EXPECTED operator actions with target times.
 * While an exercise runs, the tunnel view freezes the live binding and lets
 * the engine drive the twin; every operator command is intercepted (NO dpSet
 * reaches the field — a drill can safely run against an in-service tunnel)
 * and matched against the expectations. The final report scores each action:
 * full points within the target time, half after it, zero if never done —
 * the "mise en situation" the operator-training requirements ask for, without
 * a heavyweight simulator.
 *
 * The engine is pure (time is passed in, no I/O) so the scoring behaviour is
 * unit-tested; the view owns the clock, the twin updates and the logbook.
 */
import { localize, ml } from '../i18n.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  STATE_FAULT,
  STATE_WARNING,
  tubeEquipment,
  type EquipmentDef,
  type EquipmentKind,
  type Tunnel
} from '../types.js';

/** One simulated event of a scenario. */
export interface Injection {
  /** Seconds after exercise start. */
  atS: number;
  /** Target: the unit of this kind nearest to `pkM` (skipped when absent). */
  kind: EquipmentKind;
  pkM: number;
  state?: number;
  measures?: Record<string, number>;
  /** Smoke intensity 0..1 rendered in the 3D twin at that PK. */
  smoke?: number;
  label: MultiLangString;
}

/** One action the operator is expected to take. */
export interface ExpectedAction {
  id: string;
  label: MultiLangString;
  kind: EquipmentKind;
  pointKey: string;
  value: number;
  /** Full score when done within this many seconds. */
  targetS: number;
}

export interface Scenario {
  id: string;
  name: MultiLangString;
  description: MultiLangString;
  durationS: number;
  injections: Injection[];
  expected: ExpectedAction[];
}

/** An injection resolved to a concrete equipment instance. */
export interface FiredInjection {
  injection: Injection;
  equipment: EquipmentDef;
  text: string;
}

export interface ActionResult {
  action: ExpectedAction;
  doneAtS?: number;
  withinTarget: boolean;
}

export interface ExerciseReport {
  scenarioId: string;
  durationS: number;
  actions: ActionResult[];
  /** 0..100. */
  score: number;
}

const HALF_CREDIT = 0.5;

/** Built-in scenarios (v1 — user-authorable scenarios can come later). */
export function builtinScenarios(): Scenario[] {
  return [
    {
      id: 'fire-mid',
      name: ml('HGV fire at mid-tunnel', 'Incendie poids lourd à mi-tunnel', 'LKW-Brand in Tunnelmitte'),
      description: ml(
        'Smoke detected mid-tube, fire alarm confirms. Close the tunnel, warn users, engage fire ventilation and full lighting.',
        'Fumée détectée à mi-tube, la détection incendie confirme. Fermez le tunnel, alertez les usagers, engagez la ventilation en régime feu et l’éclairage à 100 %.',
        'Rauch in Tunnelmitte, Brandmeldung bestätigt. Tunnel sperren, Nutzer warnen, Brandlüftung und volle Beleuchtung aktivieren.'
      ),
      durationS: 300,
      injections: [
        {
          atS: 5,
          kind: 'opacity-sensor',
          pkM: 1200,
          measures: { value: 9 },
          state: STATE_WARNING,
          smoke: 0.3,
          label: ml('Opacity rising at mid-tunnel', 'Opacité en hausse à mi-tunnel', 'Trübung steigt in Tunnelmitte')
        },
        {
          atS: 12,
          kind: 'camera',
          pkM: 1200,
          state: STATE_WARNING,
          measures: { incident: 1 },
          label: ml('AID: stopped vehicle, smoke', 'DAI : véhicule arrêté, fumée', 'AID: stehendes Fahrzeug, Rauch')
        },
        {
          atS: 25,
          kind: 'fire-detection',
          pkM: 1200,
          state: STATE_FAULT,
          measures: { alarmPk: 1200 },
          smoke: 0.7,
          label: ml('FIRE ALARM confirmed (PK 1+200)', 'ALARME INCENDIE confirmée (PK 1+200)', 'BRANDALARM bestätigt (PK 1+200)')
        },
        {
          atS: 60,
          kind: 'co-sensor',
          pkM: 1200,
          state: STATE_WARNING,
          measures: { value: 95 },
          smoke: 1,
          label: ml('CO rising sharply', 'CO en forte hausse', 'CO steigt stark an')
        }
      ],
      expected: [
        {
          id: 'close-barriers',
          label: ml('Close the barriers', 'Fermer les barrières', 'Schranken schließen'),
          kind: 'barrier',
          pointKey: 'cmd',
          value: 1,
          targetS: 90
        },
        {
          id: 'vms-fire',
          label: ml('VMS to « fire — evacuate »', 'PMV sur « incendie — évacuer »', 'WVZ auf « Brand — evakuieren »'),
          kind: 'vms',
          pointKey: 'page',
          value: 3,
          targetS: 90
        },
        {
          id: 'fans-fire',
          label: ml('Fans to fire regime', 'Ventilation en régime feu', 'Lüftung in Brandbetrieb'),
          kind: 'jet-fan',
          pointKey: 'cmd',
          value: 1,
          targetS: 150
        },
        {
          id: 'light-full',
          label: ml('Lighting to 100 %', 'Éclairage à 100 %', 'Beleuchtung auf 100 %'),
          kind: 'lighting',
          pointKey: 'level',
          value: 100,
          targetS: 150
        }
      ]
    },
    {
      id: 'accident',
      name: ml('Accident + SOS call', 'Accident + appel SOS', 'Unfall + Notruf'),
      description: ml(
        'A user calls from an SOS station after a collision. Protect the lane and slow the traffic down.',
        'Un usager appelle depuis une niche SOS après une collision. Neutralisez la voie et faites ralentir le trafic.',
        'Ein Nutzer meldet sich nach einer Kollision über eine Notrufnische. Fahrstreifen sperren und Verkehr verlangsamen.'
      ),
      durationS: 240,
      injections: [
        {
          atS: 5,
          kind: 'sos-niche',
          pkM: 800,
          state: STATE_WARNING,
          measures: { callActive: 1 },
          label: ml('SOS call active (PK 0+800)', 'Appel SOS en cours (PK 0+800)', 'Notruf aktiv (PK 0+800)')
        },
        {
          atS: 15,
          kind: 'camera',
          pkM: 800,
          state: STATE_WARNING,
          measures: { incident: 1 },
          label: ml('AID: collision, two vehicles', 'DAI : collision, deux véhicules', 'AID: Kollision, zwei Fahrzeuge')
        }
      ],
      expected: [
        {
          id: 'lane-cross',
          label: ml('Lane signal to red cross', 'Signal de voie en croix rouge', 'Fahrstreifensignal auf rotes Kreuz'),
          kind: 'lane-signal',
          pointKey: 'aspect',
          value: 2,
          targetS: 60
        },
        {
          id: 'vms-slow',
          label: ml('VMS to « slow down »', 'PMV sur « ralentir »', 'WVZ auf « langsam fahren »'),
          kind: 'vms',
          pointKey: 'page',
          value: 1,
          targetS: 60
        }
      ]
    },
    {
      id: 'vent-failure',
      name: ml('Ventilation failure', 'Panne de ventilation', 'Lüftungsausfall'),
      description: ml(
        'Jet fans drop out one by one while CO drifts up. Slow the traffic and prepare a closure.',
        'Les accélérateurs tombent en panne l’un après l’autre pendant que le CO monte. Faites ralentir le trafic et préparez une fermeture.',
        'Die Strahlventilatoren fallen nacheinander aus, während das CO steigt. Verkehr verlangsamen und Sperrung vorbereiten.'
      ),
      durationS: 240,
      injections: [
        {
          atS: 5,
          kind: 'jet-fan',
          pkM: 600,
          state: STATE_FAULT,
          label: ml('Jet fan fault (north)', 'Défaut accélérateur (nord)', 'Ventilatorstörung (Nord)')
        },
        {
          atS: 30,
          kind: 'jet-fan',
          pkM: 1400,
          state: STATE_FAULT,
          label: ml('Second jet fan fault', 'Deuxième accélérateur en défaut', 'Zweite Ventilatorstörung')
        },
        {
          atS: 60,
          kind: 'co-sensor',
          pkM: 1200,
          state: STATE_WARNING,
          measures: { value: 80 },
          label: ml('CO above threshold', 'CO au-dessus du seuil', 'CO über Schwellwert')
        }
      ],
      expected: [
        {
          id: 'vms-slow',
          label: ml('VMS to « slow down »', 'PMV sur « ralentir »', 'WVZ auf « langsam fahren »'),
          kind: 'vms',
          pointKey: 'page',
          value: 1,
          targetS: 90
        },
        {
          id: 'close-barriers',
          label: ml('Close the barriers', 'Fermer les barrières', 'Schranken schließen'),
          kind: 'barrier',
          pointKey: 'cmd',
          value: 1,
          targetS: 180
        }
      ]
    }
  ];
}

/** The unit of `kind` nearest to `pkM` in the tunnel (any tube). */
export function nearestEquipment(tunnel: Tunnel, kind: EquipmentKind, pkM: number): EquipmentDef | undefined {
  let best: EquipmentDef | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tube of tunnel.tubes) {
    for (const equipment of tubeEquipment(tunnel, tube.id)) {
      if (equipment.kind !== kind) continue;
      const distance = Math.abs(equipment.pkM - pkM);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = equipment;
      }
    }
  }
  return best;
}

/**
 * Pure drill engine: the caller owns the clock (pass elapsed seconds), the
 * twin updates and the logbook. `tick` returns the injections that fire in
 * the elapsed window; `recordAction` matches an intercepted command against
 * the expectations; `report` scores the run.
 */
export class ExerciseEngine {
  private fired = new Set<number>();
  private readonly done = new Map<string, number>();

  constructor(
    readonly scenario: Scenario,
    private readonly tunnel: Tunnel
  ) {}

  /** Injections newly due at `elapsedS`, resolved to concrete equipment. */
  tick(elapsedS: number): FiredInjection[] {
    const out: FiredInjection[] = [];
    for (const [index, injection] of this.scenario.injections.entries()) {
      if (this.fired.has(index) || injection.atS > elapsedS) continue;
      this.fired.add(index);
      const equipment = nearestEquipment(this.tunnel, injection.kind, injection.pkM);
      if (!equipment) continue;
      out.push({ injection, equipment, text: localize(injection.label) });
    }
    return out;
  }

  /** True once every injection has fired and the scenario time is over. */
  isOver(elapsedS: number): boolean {
    return elapsedS >= this.scenario.durationS;
  }

  /**
   * Match one intercepted operator command; returns the expectation it
   * satisfies (first unsatisfied match wins), or null.
   */
  recordAction(kind: EquipmentKind, pointKey: string, value: number, elapsedS: number): ExpectedAction | null {
    for (const action of this.scenario.expected) {
      if (this.done.has(action.id)) continue;
      if (action.kind === kind && action.pointKey === pointKey && action.value === value) {
        this.done.set(action.id, elapsedS);
        return action;
      }
    }
    return null;
  }

  /** Live progress for the checklist UI. */
  progress(): { satisfied: string[]; total: number } {
    return { satisfied: [...this.done.keys()], total: this.scenario.expected.length };
  }

  /** Final scored report (full credit within target, half after, zero never). */
  report(elapsedS: number): ExerciseReport {
    const actions: ActionResult[] = this.scenario.expected.map((action) => {
      const doneAtS = this.done.get(action.id);
      return {
        action,
        ...(doneAtS !== undefined && { doneAtS }),
        withinTarget: doneAtS !== undefined && doneAtS <= action.targetS
      };
    });
    const per = actions.length > 0 ? 100 / actions.length : 0;
    const score = actions.reduce((sum, a) => {
      if (a.doneAtS === undefined) return sum;
      return sum + (a.withinTarget ? per : per * HALF_CREDIT);
    }, 0);
    return {
      scenarioId: this.scenario.id,
      durationS: Math.min(elapsedS, this.scenario.durationS),
      actions,
      score: Math.round(score)
    };
  }
}
