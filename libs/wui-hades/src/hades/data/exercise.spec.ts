// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drill engine — injection timing (each fires once), action matching and the
 * scoring rules (full credit within target, half after, zero never) are the
 * contract the operator-training report stands on.
 */
import { describe, expect, it } from 'vitest';
import { ExerciseEngine, builtinScenarios, nearestEquipment } from './exercise.js';
import { demoTunnel } from './demo-tunnel.js';
import type { Scenario } from './exercise.js';

const FIRE = (): Scenario => builtinScenarios().find((s) => s.id === 'fire-mid')!;

describe('builtinScenarios', () => {
  it('ships three scenarios with injections and expectations', () => {
    const scenarios = builtinScenarios();
    expect(scenarios.length).toBe(3);
    for (const s of scenarios) {
      expect(s.injections.length).toBeGreaterThan(0);
      expect(s.expected.length).toBeGreaterThan(0);
    }
  });
});

describe('nearestEquipment', () => {
  it('picks the unit of the kind closest to the PK', () => {
    const tunnel = demoTunnel();
    const near = nearestEquipment(tunnel, 'sos-niche', 1195);
    expect(near).toBeDefined();
    expect(Math.abs(near!.pkM - 1195)).toBeLessThanOrEqual(100);
  });

  it('returns undefined when the kind is absent', () => {
    const tunnel = demoTunnel();
    tunnel.equipment = tunnel.equipment.filter((e) => e.kind !== 'radio');
    expect(nearestEquipment(tunnel, 'radio', 100)).toBeUndefined();
  });
});

describe('ExerciseEngine.tick', () => {
  it('fires each injection exactly once, in time order', () => {
    const engine = new ExerciseEngine(FIRE(), demoTunnel());
    expect(engine.tick(0)).toEqual([]);
    const first = engine.tick(6);
    expect(first.length).toBe(1);
    expect(first[0].injection.atS).toBe(5);
    // Same window again → nothing new.
    expect(engine.tick(6)).toEqual([]);
    // Jump to the end → the remaining three fire together.
    expect(engine.tick(300).length).toBe(3);
  });

  it('resolves injections to concrete demo equipment', () => {
    const engine = new ExerciseEngine(FIRE(), demoTunnel());
    const fired = engine.tick(30);
    for (const f of fired) {
      expect(f.equipment.kind).toBe(f.injection.kind);
      expect(f.text.length).toBeGreaterThan(0);
    }
  });
});

describe('ExerciseEngine scoring', () => {
  it('gives full credit for actions within their target time', () => {
    const scenario = FIRE();
    const engine = new ExerciseEngine(scenario, demoTunnel());
    for (const action of scenario.expected) {
      expect(engine.recordAction(action.kind, action.pointKey, action.value, action.targetS - 1)).not.toBeNull();
    }
    expect(engine.report(200).score).toBe(100);
  });

  it('gives half credit for late actions and zero for missed ones', () => {
    const scenario = FIRE(); // 4 expected actions → 25 pts each
    const engine = new ExerciseEngine(scenario, demoTunnel());
    const [a, b] = scenario.expected;
    engine.recordAction(a.kind, a.pointKey, a.value, a.targetS - 10); // full: 25
    engine.recordAction(b.kind, b.pointKey, b.value, b.targetS + 30); // half: 12.5
    const report = engine.report(scenario.durationS);
    expect(report.score).toBe(38); // round(37.5)
    expect(report.actions.filter((x) => x.doneAtS === undefined).length).toBe(2);
  });

  it('does not match a wrong value and never matches twice', () => {
    const scenario = FIRE();
    const engine = new ExerciseEngine(scenario, demoTunnel());
    // barrier cmd 0 (open) ≠ expected close (1).
    expect(engine.recordAction('barrier', 'cmd', 0, 10)).toBeNull();
    expect(engine.recordAction('barrier', 'cmd', 1, 10)).not.toBeNull();
    expect(engine.recordAction('barrier', 'cmd', 1, 20)).toBeNull();
  });

  it('isOver only after the scenario duration', () => {
    const scenario = FIRE();
    const engine = new ExerciseEngine(scenario, demoTunnel());
    expect(engine.isOver(scenario.durationS - 1)).toBe(false);
    expect(engine.isOver(scenario.durationS)).toBe(true);
  });
});
