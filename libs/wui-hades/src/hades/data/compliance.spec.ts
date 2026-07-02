// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compliance advisor rules — one suite per rule family, plus the closed loop
 * with the auto-fix generator: fixing every fixable deviation of a bare
 * tunnel must converge to a state with no errors and nothing left to fix.
 */
import { describe, expect, it } from 'vitest';
import { checkCompliance, exitSpacingOf, profileRules } from './compliance.js';
import { fixIssue, isFixable, placeSeries } from './placement.js';
import type { EquipmentKind, RegulatoryProfileId, Tunnel, TubeDirection } from '../types.js';

/** Bare single-tube tunnel of the given length (no equipment). */
function makeTunnel(
  lengthM: number,
  opts: {
    profile?: RegulatoryProfileId;
    direction?: TubeDirection;
    trafficPerLane?: number;
    gradientPct?: number;
  } = {}
): Tunnel {
  return {
    id: 't1',
    name: 'Test',
    profile: opts.profile ?? 'eu-2004-54',
    trafficPerLane: opts.trafficPerLane ?? 4000,
    tubes: [
      {
        id: 'tube-1',
        name: 'Tube 1',
        direction: opts.direction ?? 'unidirectional',
        lanes: 2,
        segments: [
          {
            id: 's1',
            name: 'S1',
            lengthM,
            gradientPct: opts.gradientPct ?? 0,
            curveRadiusM: 0,
            clearanceM: 4.5,
            lightingZone: 'entrance'
          }
        ]
      }
    ],
    equipment: [],
    modes: []
  };
}

function ruleIds(tunnel: Tunnel): string[] {
  return checkCompliance(tunnel).map((i) => i.ruleId);
}

describe('scope rule', () => {
  it('flags a tunnel below the profile threshold as informative only', () => {
    const issues = checkCompliance(makeTunnel(300));
    expect(issues.find((i) => i.ruleId === 'scope')?.severity).toBe('info');
  });

  it('does not flag a tunnel inside the scope', () => {
    expect(ruleIds(makeTunnel(2400))).not.toContain('scope');
  });
});

describe('spacing rules', () => {
  it('raises exit and SOS spacing errors on a bare 2400 m tunnel', () => {
    const ids = ruleIds(makeTunnel(2400));
    expect(ids).toContain('exit-spacing');
    expect(ids).toContain('sos-spacing');
  });

  it('accepts exits within the unidirectional threshold', () => {
    let tunnel = makeTunnel(2400, { profile: 'fr-cetu' });
    // 380 m spacing satisfies FR unidirectional (400 m)…
    tunnel = placeSeries(tunnel, {
      tubeId: 'tube-1',
      kind: 'emergency-exit',
      side: 'left',
      startM: 380,
      endM: 2400,
      everyM: 380
    }).tunnel;
    expect(ruleIds(tunnel)).not.toContain('exit-spacing');
  });

  it('rejects the same exits when the tube is bidirectional (stricter FR limit)', () => {
    let tunnel = makeTunnel(2400, { profile: 'fr-cetu', direction: 'bidirectional' });
    tunnel = placeSeries(tunnel, {
      tubeId: 'tube-1',
      kind: 'emergency-exit',
      side: 'left',
      startM: 380,
      endM: 2400,
      everyM: 380
    }).tunnel;
    // …but violates FR bidirectional (200 m).
    expect(ruleIds(tunnel)).toContain('exit-spacing');
  });

  it('counts the portal gaps, not only the inter-equipment gaps', () => {
    let tunnel = makeTunnel(1000);
    // One exit at PK 900 leaves a 900 m gap from the entry portal.
    tunnel = placeSeries(tunnel, {
      tubeId: 'tube-1',
      kind: 'emergency-exit',
      side: 'left',
      startM: 900,
      endM: 900,
      everyM: 100
    }).tunnel;
    expect(ruleIds(tunnel)).toContain('exit-spacing');
  });
});

describe('ventilation rule', () => {
  it('requires jet fans on a long, busy tunnel', () => {
    expect(ruleIds(makeTunnel(2400, { trafficPerLane: 4000 }))).toContain('ventilation');
  });

  it('does not require ventilation under the traffic threshold', () => {
    expect(ruleIds(makeTunnel(2400, { trafficPerLane: 1000 }))).not.toContain('ventilation');
  });

  it('asks for an anemometer once fans exist', () => {
    let tunnel = makeTunnel(2400);
    tunnel = fixIssue(tunnel, { severity: 'error', ruleId: 'ventilation', message: '', ref: '', tubeId: 'tube-1' }).tunnel;
    const ids = ruleIds(tunnel);
    expect(ids).not.toContain('ventilation');
    expect(ids).toContain('anemometer');
  });
});

describe('geometry rules', () => {
  it('warns above the maximum longitudinal gradient', () => {
    expect(ruleIds(makeTunnel(2400, { gradientPct: 6 }))).toContain('gradient');
  });

  it('accepts the maximum gradient itself', () => {
    expect(ruleIds(makeTunnel(2400, { gradientPct: 5 }))).not.toContain('gradient');
  });

  it('notes a first segment that is not an entrance lighting zone', () => {
    const tunnel = makeTunnel(2400);
    tunnel.tubes[0].segments[0].lightingZone = 'interior';
    expect(ruleIds(tunnel)).toContain('lighting-zone');
  });
});

describe('profile thresholds', () => {
  it('differ between profiles', () => {
    expect(profileRules('fr-cetu').sosSpacingM).not.toBe(profileRules('eu-2004-54').sosSpacingM);
  });

  it('exitSpacingOf picks the direction-specific limit', () => {
    const rules = profileRules('fr-cetu');
    const tube = makeTunnel(1000, { direction: 'bidirectional' }).tubes[0];
    expect(exitSpacingOf(rules, tube)).toBe(rules.exitSpacingBidiM);
    tube.direction = 'unidirectional';
    expect(exitSpacingOf(rules, tube)).toBe(rules.exitSpacingUniM);
  });
});

describe('auto-fix convergence', () => {
  for (const profile of ['eu-2004-54', 'fr-cetu', 'ch-astra'] as const) {
    for (const direction of ['unidirectional', 'bidirectional'] as const) {
      it(`fixing every fixable issue converges (${profile}, ${direction})`, () => {
        let tunnel = makeTunnel(2400, { profile, direction });
        // Iterate: fixing one rule can reveal the next (fans → anemometer).
        for (let round = 0; round < 10; round++) {
          const fixable = checkCompliance(tunnel).filter((i) => isFixable(i));
          if (fixable.length === 0) break;
          for (const issue of fixable) {
            tunnel = fixIssue(tunnel, issue).tunnel;
          }
        }
        const remaining = checkCompliance(tunnel);
        expect(remaining.filter((i) => i.severity === 'error')).toEqual([]);
        expect(remaining.filter((i) => isFixable(i))).toEqual([]);
      });
    }
  }

  it('generated series respects the spacing threshold, portals included', () => {
    const tunnel = makeTunnel(2400);
    const fixed = fixIssue(tunnel, {
      severity: 'error',
      ruleId: 'sos-spacing',
      message: '',
      ref: '',
      tubeId: 'tube-1'
    }).tunnel;
    const pks = fixed.equipment
      .filter((e) => e.kind === 'sos-niche')
      .map((e) => e.pkM)
      .sort((a, b) => a - b);
    const spacing = profileRules('eu-2004-54').sosSpacingM;
    let previous = 0;
    for (const pk of pks) {
      expect(pk - previous).toBeLessThanOrEqual(spacing);
      previous = pk;
    }
    expect(2400 - previous).toBeLessThanOrEqual(spacing);
  });
});
