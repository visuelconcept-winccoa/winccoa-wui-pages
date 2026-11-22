// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { LEVELS, exitReachable, parseLevel } from './maps.js';
import { machineState, normDpe, parseConfig } from './plant.js';
import { addResult, cleanNickname, leaderboard, ordinal, type GameResult } from './results.js';
import { fenceHits, hitDoor, markColor } from './render.js';
import { BUMP_PENALTY, NO_INPUT, REPAIR_SCORE, Sim, demoMachineState, type Input } from './sim.js';
import type { LevelDef } from './maps.js';

/** A level from rows (M1 a robot in electrical fault, M2 a lathe in mechanical fault). */
const tiny = (rows: string[]): LevelDef => ({
  name: 'Test',
  par: 60,
  rows,
  machines: { 1: { kind: 'robot', fault: 'electrical' }, 2: { kind: 'lathe', fault: 'mechanical' } }
});

const step = (sim: Sim, input: Partial<Input>, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, { ...NO_INPUT, ...input });
};

describe('levels', () => {
  it('are rectangular, have a start, an exit and key doors that need their card', () => {
    for (const def of LEVELS) {
      const w = def.rows[0].length;
      expect(def.rows.every((r) => r.length === w)).toBe(true);
      expect(def.rows.join('')).toContain('P');
      const level = parseLevel(def);
      expect(level.walls).toContain('exit');
      expect(exitReachable(level)).toBe(true);
      if (level.doors.some((d) => d.key)) expect(exitReachable(level, false)).toBe(false);
    }
  });

  it('have machines to repair, the spare parts their mechanical faults take, and decor', () => {
    for (const def of LEVELS) {
      const level = parseLevel(def);
      const machines = level.things.filter((t) => t.type === 'machine');
      expect(machines.length).toBeGreaterThanOrEqual(3);
      const mechanical = machines.filter((t) => t.type === 'machine' && t.fault === 'mechanical').length;
      expect(level.things.filter((t) => t.type === 'pickup' && t.kind === 'part').length).toBeGreaterThanOrEqual(mechanical);
      expect(level.things.some((t) => t.type === 'decor' && t.kind === 'pallets')).toBe(true);
      // a fenced robot cell, with its gate
      expect(level.fences.some((f) => f !== 0)).toBe(true);
      expect(level.doors.some((d) => d.fence)).toBe(true);
    }
  });

  it('carry both logos: WinCC OA and Visuel Concept panels on every level', () => {
    for (const def of LEVELS) {
      const level = parseLevel(def);
      expect(level.walls).toContain('vc');
    }
    expect(LEVELS.some((d) => parseLevel(d).walls.includes('logo'))).toBe(true);
  });

  it('turns a door across a corridor so that it closes the passage', () => {
    const level = parseLevel(tiny(['#####', '#P..#', '##D##', '#...#', '##x##']));
    expect(level.doors[0].axis).toBe('x');
    const side = parseLevel(tiny(['#####', '#PD.#', '##x##']));
    expect(side.doors[0].axis).toBe('y');
  });

  it('keeps the lamps light inside their room', () => {
    const level = parseLevel(tiny(['#######', '#Pl#..#', '#..#..#', '###x###']));
    expect(level.light[1 * 7 + 2]).toBeGreaterThan(level.light[1 * 7 + 5]);
  });
});

describe('doors (raycaster)', () => {
  it('hits the part of a door not slid away', () => {
    const door = { x: 2, y: 2, axis: 'x' as const, key: null, fence: false, open: 0, moving: 0 as const, hold: 0 };
    expect(hitDoor(door, 2.5, 0.5, 0, 1)?.dist).toBeCloseTo(2);
    expect(hitDoor({ ...door, open: 0.6 }, 2.5, 0.5, 0, 1)).toBeNull();
    expect(hitDoor({ ...door, open: 0.3 }, 2.5, 0.5, 0, 1)?.u).toBeCloseTo(0.2);
  });
});

describe('simulation', () => {
  it('opens a door on use, and a key door only with its card', () => {
    const sim = new Sim(tiny(['#####', '#P..#', '##D##', '#...#', '##B##', '#..x#', '#####']));
    sim.player.angle = Math.PI / 2;
    sim.player.x = 2.5;
    step(sim, { use: true }, 1 / 60);
    step(sim, {}, 1);
    expect(sim.level.doors[0].open).toBe(1);
    sim.player.y = 3.5;
    step(sim, { use: true }, 1 / 60);
    expect(sim.level.doors[1].open).toBe(0);
    expect(sim.events.some((e) => e.type === 'need-key')).toBe(true);
    sim.player.keys.add('blue');
    step(sim, { use: true }, 1 / 60);
    step(sim, {}, 1);
    expect(sim.level.doors[1].open).toBe(1);
  });

  it('slides along walls and never walks through one', () => {
    const sim = new Sim(tiny(['#####', '#P..#', '##x##']));
    sim.player.angle = 0;
    step(sim, { forward: 1 }, 3);
    expect(sim.player.x).toBeLessThan(4 - 0.24);
    expect(sim.player.x).toBeGreaterThan(3.5);
  });

  it('repairs a machine with the right tool held on it, not with another', () => {
    const sim = new Sim(tiny(['######', '#P1..#', '##x###']));
    sim.setMachineStates(() => 'fault');
    sim.player.angle = 0;
    sim.player.tool = 'wrench';
    step(sim, { work: true }, 4);
    expect(sim.machines[0].progress).toBe(0);
    expect(sim.events.filter((e) => e.type === 'wrong-tool')).toHaveLength(1);
    sim.player.tool = 'multimeter';
    step(sim, { work: true }, 1.5);
    expect(sim.machines[0].progress).toBeGreaterThan(0.4);
    // stepping away keeps the progress
    step(sim, {}, 1);
    expect(sim.machines[0].repaired).toBe(false);
    step(sim, { work: true }, 2);
    expect(sim.machines[0].repaired).toBe(true);
    expect(sim.score).toBe(REPAIR_SCORE);
  });

  it('takes a spare part for a mechanical fault', () => {
    const sim = new Sim(tiny(['#######', '#P2.+.#', '###x###']));
    sim.setMachineStates(() => 'fault');
    sim.player.angle = 0;
    step(sim, { work: true }, 1);
    expect(sim.events.some((e) => e.type === 'need-part')).toBe(true);
    expect(sim.machines[0].progress).toBe(0);
    sim.player.parts = 1;
    step(sim, { work: true }, 4);
    expect(sim.machines[0].repaired).toBe(true);
    expect(sim.player.parts).toBe(0);
  });

  it('keeps the exit shut while a machine is in fault, and counts the lost output', () => {
    const sim = new Sim(tiny(['######', '#P1..#', '#...x#', '######']));
    sim.setMachineStates(() => 'fault');
    sim.player.x = 3.5;
    sim.player.y = 2.5;
    sim.player.angle = 0;
    step(sim, { use: true }, 1 / 60);
    expect(sim.exitOn).toBe(false);
    expect(sim.events.some((e) => e.type === 'line-fault')).toBe(true);
    step(sim, {}, 2);
    expect(sim.stats.lost).toBeGreaterThan(1.9);
    sim.machines[0].repaired = true;
    step(sim, { use: true }, 1 / 60);
    expect(sim.exitOn).toBe(true);
    step(sim, {}, 1.5);
    expect(sim.finished).toBe(true);
    expect(sim.bonus().safety).toBe(500);
  });

  it('brings a repaired machine back into play when its datapoint faults again', () => {
    const sim = new Sim(tiny(['######', '#P1..#', '##x###']));
    sim.setMachineStates(() => 'fault');
    sim.machines[0].repaired = true;
    sim.setMachineStates(() => 'run');
    expect(sim.machines[0].repaired).toBe(false);
    sim.setMachineStates(() => 'fault');
    expect(sim.faulted()).toHaveLength(1);
    expect(sim.stats.faults).toBe(2);
  });

  it('gets bumped by an AGV in its lane: pushed aside, points off', () => {
    const sim = new Sim(tiny(['##########', '#P..g....#', '####x#####']));
    sim.score = 1000;
    // it goes east first, turns round at the wall and comes back
    step(sim, {}, 8);
    expect(sim.stats.bumps).toBeGreaterThan(0);
    expect(sim.score).toBe(1000 - BUMP_PENALTY * sim.stats.bumps);
  });

  it('slows down in the coolant', () => {
    const dry = new Sim(tiny(['########', '#P.....#', '###x####']));
    const wet = new Sim(tiny(['########', '#Psssss#', '###x####']));
    for (const s of [dry, wet]) {
      s.player.angle = 0;
      step(s, { forward: 1 }, 0.8);
    }
    expect(wet.player.x - 1.5).toBeLessThan((dry.player.x - 1.5) * 0.6);
  });

  it('picks up spare parts and key cards', () => {
    const sim = new Sim(tiny(['######', '#P+b.#', '###x##']));
    sim.player.x = 2.5;
    step(sim, {}, 0.1);
    sim.player.x = 3.5;
    step(sim, {}, 0.1);
    expect(sim.player.parts).toBe(1);
    expect(sim.player.keys.has('blue')).toBe(true);
  });

  it('starts the demo plant with every machine down', () => {
    expect(demoMachineState(1, 0)).toBe('fault');
    expect(demoMachineState(9, 100)).toBe('fault');
  });
});

describe('safety fences', () => {
  it('surround a robot cell: not crossable, entered through the gate once opened', () => {
    const sim = new Sim(tiny(['#######', '#P....#', '#.|!|.#', '#.|1|.#', '#.|||.#', '###x###']));
    const level = sim.level;
    // the panels run to the fences and the gate around
    expect(level.fences[2 * level.w + 2]).toBe(2 | 4);
    expect(level.doors[0]).toMatchObject({ fence: true, axis: 'x' });
    sim.player.x = 3.5;
    sim.player.y = 1.5;
    sim.player.angle = Math.PI / 2;
    step(sim, { forward: 1 }, 1);
    expect(sim.player.y).toBeLessThan(2);
    step(sim, { use: true }, 1 / 60);
    step(sim, {}, 0.8);
    expect(level.doors[0].open).toBe(1);
    expect(sim.blocked(2.5, 3.5, 0.25)).toBe(true);
  });

  it('are hit by a ray on their panels only', () => {
    const hits: number[] = [];
    // a west–east panel (mask E | W) in cell (2, 2), seen from below
    fenceHits(2 | 8, 2, 2, 2.3, 4.5, 0, -1, (d) => hits.push(d));
    expect(hits).toEqual([2]);
    hits.length = 0;
    // only its east half: a ray on the west side passes
    fenceHits(2, 2, 2, 2.3, 4.5, 0, -1, (d) => hits.push(d));
    expect(hits).toEqual([]);
  });
});

describe('WinCC OA alarms', () => {
  it('come when a machine faults and go when it is repaired', () => {
    const sim = new Sim(tiny(['######', '#P1..#', '##x###']));
    sim.setMachineStates(() => 'fault');
    expect(sim.events).toContainEqual({ type: 'alarm', id: 1, kind: 'robot', fault: 'electrical', came: true });
    sim.player.angle = 0;
    sim.player.tool = 'multimeter';
    step(sim, { work: true }, 4);
    expect(sim.events).toContainEqual({ type: 'alarm', id: 1, kind: 'robot', fault: 'electrical', came: false });
  });

  it('paint the WinCC OA logo on the floor of the W cells', () => {
    const level = parseLevel(tiny(['#####', '#PW.#', '##x##']));
    expect(level.marks[1 * level.w + 2]).toBe(64);
    expect(markColor(64, 0.2, 0.2)).not.toBe(0);
    expect(markColor(64, 0.05, 0.5)).toBe(0);
  });
});

describe('floor markings', () => {
  it('draws a safety line along the walls, the hazard border of a machine, a pallet outline', () => {
    const level = parseLevel(tiny(['######', '#P.1.#', '#..k.#', '###x##']));
    const w = level.w;
    expect(level.marks[1 * w + 2] & 1).toBe(1);
    expect(level.marks[1 * w + 3]).toBe(16);
    expect(level.marks[2 * w + 3]).toBe(32);
    expect(markColor(1, 0.5, 0.13)).not.toBe(0);
    expect(markColor(1, 0.5, 0.5)).toBe(0);
    expect(markColor(16, 0.05, 0.5)).not.toBe(0);
    expect(markColor(32, 0.5, 0.5)).toBe(0);
  });
});

describe('plant bindings', () => {
  it('parses the config and keeps only well-formed machines', () => {
    expect(parseConfig('{"machines":[{"id":1,"dpe":"A.State"},{"id":12,"dpe":"B"},{"id":2}]}').machines).toEqual([{ id: 1, dpe: 'A.State' }]);
    expect(parseConfig('not json').machines).toEqual([]);
  });

  it('maps values to machine states', () => {
    expect(machineState(2)).toBe('fault');
    expect(machineState(1)).toBe('run');
    expect(machineState(false)).toBe('stop');
    expect(machineState('Défaut')).toBe('fault');
    expect(machineState(5, { fault: [5] })).toBe('fault');
    expect(machineState(7, { fault: [5] })).toBe('unknown');
  });

  it('normalises the DPE names given back by dpConnect', () => {
    expect(normDpe('System1:Line.State.:_online.._value')).toBe('Line.State');
  });
});

describe('results', () => {
  const r = (id: string, nickname: string, score: number): GameResult => ({ id, nickname, score, level: 1, completed: false, difficulty: 'normal', at: Number(id) });

  it('ranks each nickname by its best run, and shows mine further down', () => {
    let log: GameResult[] = [];
    for (let k = 0; k < 12; k++) log = addResult(log, r(String(k), `p${k}`, 1000 - k * 10));
    log = addResult(log, r('99', 'P0', 2000));
    log = addResult(log, r('100', 'late', 1));
    const board = leaderboard(log, '100', 10);
    expect(board[0]).toMatchObject({ nickname: 'P0', score: 2000 });
    expect(board.filter((b) => b.nickname.toLowerCase() === 'p0')).toHaveLength(1);
    expect(board).toHaveLength(11);
    expect(board[10]).toMatchObject({ mine: true, place: 13 });
  });

  it('cleans nicknames and writes ordinals', () => {
    expect(cleanNickname('  <b>Ana</b>  ')).toBe('bAna/b');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(23)).toBe('23rd');
  });
});
