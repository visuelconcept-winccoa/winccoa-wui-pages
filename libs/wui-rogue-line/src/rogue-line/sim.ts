// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the simulation of a level: the maintenance technician, the tools, the machines
 * to repair, the AGVs, the doors, the parts and the exit. Pure (no DOM), stepped at a fixed rate
 * by game.ts; what happened is queued in `events` (sounds, messages, score).
 *
 * Nothing to fight: the plant is down, the technician repairs it. Each machine in fault takes
 * its tool — the wrench (mechanical, with a spare part found in the level), the multimeter
 * (electrical), the laptop (software: the WinCC OA recipe reloaded) — held on it for a few
 * seconds. While a machine is down, the line loses output. The exit opens once every machine of
 * the level runs again. The AGVs shuttle along their lanes: one that bumps the technician costs
 * time and points; the coolant slows down.
 */
import { doorAt, isSolid, isWall, parseLevel, type DecorKind, type Door, type FaultKind, type KeyColor, type Level, type LevelDef, type MachineKind, type PickupKind } from './maps.js';

export type ToolId = 'wrench' | 'multimeter' | 'laptop';
export const TOOLS: readonly ToolId[] = ['wrench', 'multimeter', 'laptop'];
export type MachineState = 'run' | 'stop' | 'fault' | 'unknown';
export type Difficulty = 'easy' | 'normal' | 'hard';

export const TOOL_LABELS: Record<ToolId, string> = { wrench: 'Wrench', multimeter: 'Multimeter', laptop: 'WinCC OA laptop' };
export const TOOL_FOR: Record<FaultKind, ToolId> = { mechanical: 'wrench', electrical: 'multimeter', software: 'laptop' };

/** Seconds of work to repair a machine, by difficulty. */
const REPAIR_S: Record<Difficulty, number> = { easy: 2, normal: 3, hard: 4.5 };
/** AGV speed by difficulty, m/s. */
const AGV_SPEED: Record<Difficulty, number> = { easy: 1.2, normal: 1.7, hard: 2.3 };
const PLAYER_RADIUS = 0.25;
const WALK_SPEED = 3;
const RUN_SPEED = 5;
const USE_REACH = 1.7;
const DOOR_SPEED = 1.8;
const DOOR_HOLD = 4;
const AGV_RADIUS = 0.38;
/** Seconds the technician is knocked off balance by an AGV. */
const BUMP_S = 0.8;
export const BUMP_PENALTY = 150;
export const REPAIR_SCORE = 500;
/** Output lost per machine in fault and per second (parts). */
export const LOSS_PER_S = 1;

export interface Player {
  x: number;
  y: number;
  angle: number;
  tool: ToolId;
  parts: number;
  keys: Set<KeyColor>;
  /** Seconds left knocked off balance (no control). */
  stagger: number;
  /** Working on a machine this tick (the view's animation). */
  working: boolean;
  /** Distance walked (the view's bob). */
  walked: number;
}

export interface Machine {
  id: number;
  kind: MachineKind;
  fault: FaultKind;
  x: number;
  y: number;
  /** The plant's state (datapoint, or the demo). */
  state: MachineState;
  /** Repaired by the technician in this level (a fault then stays cleared). */
  repaired: boolean;
  /** Repair progress, 0..1 (kept when the technician steps away). */
  progress: number;
  /** A spare part already fitted (mechanical faults). */
  partFitted: boolean;
}

export interface Agv {
  x: number;
  y: number;
  /** Unit direction of travel. */
  dx: number;
  dy: number;
  /** Seconds it waits before going on (after a bump, at the end of its lane). */
  wait: number;
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  taken: boolean;
}

export interface Effect {
  x: number;
  y: number;
  kind: 'sparks' | 'done';
  t: number;
}

export type SimEvent =
  | { type: 'work'; tool: ToolId }
  | { type: 'wrong-tool'; need: ToolId; id: number }
  | { type: 'need-part'; id: number }
  | { type: 'repair'; id: number; kind: MachineKind; score: number }
  | { type: 'pickup'; kind: PickupKind; text: string }
  | { type: 'door'; open: boolean }
  | { type: 'need-key'; key: KeyColor }
  | { type: 'line-fault'; ids: number[] }
  | { type: 'bump' }
  | { type: 'agv-near'; distance: number }
  | { type: 'splash' }
  | { type: 'exit' }
  /** A machine's alarm, as WinCC OA shows it: came (in fault) or went (running again). */
  | { type: 'alarm'; id: number; kind: MachineKind; fault: FaultKind; came: boolean };

export interface Stats {
  faults: number;
  repaired: number;
  bumps: number;
  partsFound: number;
  /** Output lost while machines were down (parts). */
  lost: number;
}

export interface Input {
  /** -1..1 forward / backward. */
  forward: number;
  /** -1..1 right / left. */
  strafe: number;
  /** Turn this tick, radians (mouse, keys, stick). */
  turn: number;
  run: boolean;
  /** The tool is held on what is in front (repair). */
  work: boolean;
  /** "Use" was pressed this tick (door, exit, and the start of a repair). */
  use: boolean;
  /** A tool chosen this tick. */
  tool: ToolId | null;
}

export const NO_INPUT: Input = { forward: 0, strafe: 0, turn: 0, run: false, work: false, use: false, tool: null };

export class Sim {
  readonly level: Level;
  readonly player: Player;
  readonly machines: Machine[] = [];
  readonly agvs: Agv[] = [];
  readonly pickups: Pickup[] = [];
  /** Tanks, pallets, fences: solid. */
  readonly decor: { kind: DecorKind; x: number; y: number }[] = [];
  readonly effects: Effect[] = [];
  readonly events: SimEvent[] = [];
  readonly stats: Stats = { faults: 0, repaired: 0, bumps: 0, partsFound: 0, lost: 0 };
  time = 0;
  score = 0;
  exitOn = false;
  /** Seconds since the exit switch was thrown (the level ends a moment later). */
  exitT = 0;
  /** The machine in front, within reach (the HUD's target), if any. */
  target: Machine | null = null;
  private wasWorking = false;
  private warnedFor: number | null = null;
  private lastSplash = -9;
  private lastBeep = -9;

  constructor(
    def: LevelDef,
    readonly difficulty: Difficulty = 'normal'
  ) {
    this.level = parseLevel(def);
    const s = this.level.start;
    this.player = { x: s.x, y: s.y, angle: s.angle, tool: 'wrench', parts: 0, keys: new Set(), stagger: 0, working: false, walked: 0 };
    for (const t of this.level.things) {
      if (t.type === 'agv') this.agvs.push(this.newAgv(t.x, t.y));
      else if (t.type === 'pickup') this.pickups.push({ kind: t.kind, x: t.x, y: t.y, taken: false });
      else if (t.type === 'decor') this.decor.push({ kind: t.kind, x: t.x, y: t.y });
      else this.machines.push({ id: t.id, kind: t.kind, fault: t.fault, x: t.x, y: t.y, state: 'unknown', repaired: false, progress: 0, partFitted: false });
    }
    this.machines.sort((a, b) => a.id - b.id);
  }

  /** An AGV shuttles along the longer free line through its cell. */
  private newAgv(x: number, y: number): Agv {
    const run = (dx: number, dy: number): number => {
      let n = 0;
      while (n < 40 && !isSolid(this.level, x + dx * (n + 1), y + dy * (n + 1))) n++;
      return n;
    };
    const along = run(1, 0) + run(-1, 0) >= run(0, 1) + run(0, -1);
    return { x, y, dx: along ? 1 : 0, dy: along ? 0 : 1, wait: 0 };
  }

  /** The machines' states, read from the plant (or the demo) each tick. */
  setMachineStates(state: (id: number) => MachineState): void {
    for (const m of this.machines) {
      const s = state(m.id);
      if (s === 'fault' && m.state !== 'fault' && !m.repaired) {
        this.stats.faults++;
        this.events.push({ type: 'alarm', id: m.id, kind: m.kind, fault: m.fault, came: true });
      }
      // a machine repaired here whose datapoint went back to normal can fault again later
      if (s !== 'fault' && m.repaired) {
        m.repaired = false;
        m.progress = 0;
        m.partFitted = false;
      }
      m.state = s;
    }
  }

  /** The machines still in fault on this level (not repaired by the technician). */
  faulted(): Machine[] {
    return this.machines.filter((m) => m.state === 'fault' && !m.repaired);
  }

  step(dt: number, input: Input): void {
    this.time += dt;
    const p = this.player;
    p.stagger = Math.max(0, p.stagger - dt);
    if (input.tool) p.tool = input.tool;
    this.target = this.machineAhead();
    if (p.stagger <= 0) this.movePlayer(dt, input);
    if (input.use) this.use();
    this.work(dt, input);
    this.takePickups();
    this.stepDoors(dt);
    this.stepAgvs(dt);
    this.stats.lost += this.faulted().length * LOSS_PER_S * dt;
    for (const e of this.effects) e.t += dt;
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i].t > 0.6) this.effects.splice(i, 1);
    if (this.exitOn) this.exitT += dt;
  }

  // --- the technician ------------------------------------------------------------------------

  private movePlayer(dt: number, input: Input): void {
    const p = this.player;
    p.angle += input.turn;
    const cell = Math.floor(p.y) * this.level.w + Math.floor(p.x);
    const wet = this.level.floors[cell] === 'coolant';
    const speed = (input.run && !wet ? RUN_SPEED : WALK_SPEED) * (wet ? 0.45 : 1) * dt;
    const fx = Math.cos(p.angle);
    const fy = Math.sin(p.angle);
    let dx = (fx * input.forward - fy * input.strafe) * speed;
    let dy = (fy * input.forward + fx * input.strafe) * speed;
    const len = Math.hypot(dx, dy);
    if (len > speed) {
      dx = (dx / len) * speed;
      dy = (dy / len) * speed;
    }
    const before = { x: p.x, y: p.y };
    this.slide(p, dx, dy, PLAYER_RADIUS);
    const moved = Math.hypot(p.x - before.x, p.y - before.y);
    p.walked += moved;
    if (wet && moved > 0 && this.time - this.lastSplash > 0.45) {
      this.lastSplash = this.time;
      this.events.push({ type: 'splash' });
    }
  }

  /** Moves along x then y, each blocked on its own (sliding along walls). */
  private slide(o: { x: number; y: number }, dx: number, dy: number, radius: number, agv: Agv | null = null): boolean {
    let moved = false;
    if (dx !== 0 && !this.blocked(o.x + dx, o.y, radius, agv)) {
      o.x += dx;
      moved = true;
    }
    if (dy !== 0 && !this.blocked(o.x, o.y + dy, radius, agv)) {
      o.y += dy;
      moved = true;
    }
    return moved;
  }

  /** Is a circle at (x, y) in a wall, a closed door, a machine, a tank (or, for the player, an AGV)? */
  blocked(x: number, y: number, radius: number, agv: Agv | null = null): boolean {
    for (const [ox, oy] of [
      [-radius, -radius],
      [radius, -radius],
      [-radius, radius],
      [radius, radius]
    ]) {
      if (isSolid(this.level, x + ox, y + oy)) return true;
      const d = doorAt(this.level, x + ox, y + oy);
      if (d && d.open < 0.9) return true;
    }
    for (const m of this.machines) if (Math.hypot(m.x - x, m.y - y) < radius + 0.4) return true;
    for (const t of this.decor) if (Math.abs(t.x - x) < radius + 0.36 && Math.abs(t.y - y) < radius + 0.36) return true;
    if (!agv) for (const a of this.agvs) if (Math.hypot(a.x - x, a.y - y) < radius + AGV_RADIUS) return true;
    for (const a of this.agvs) if (a !== agv && agv && Math.hypot(a.x - x, a.y - y) < radius + AGV_RADIUS) return true;
    return false;
  }

  /** The machine in front within reach: along the view, within a narrow cone. */
  private machineAhead(): Machine | null {
    const p = this.player;
    let best: Machine | null = null;
    let bestD = Infinity;
    for (const m of this.machines) {
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > USE_REACH + 0.4) continue;
      const along = dx * Math.cos(p.angle) + dy * Math.sin(p.angle);
      const across = Math.abs(-dx * Math.sin(p.angle) + dy * Math.cos(p.angle));
      if (along <= 0 || across > 0.6) continue;
      if (d < bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  /** The tool held on the machine in front: the repair goes on, or says what it takes. */
  private work(dt: number, input: Input): void {
    const p = this.player;
    const m = this.target;
    const holding = (input.work || input.use) && p.stagger <= 0;
    p.working = false;
    if (!holding || !m || m.state !== 'fault' || m.repaired) {
      if (!holding) this.warnedFor = null;
      this.wasWorking = false;
      return;
    }
    const need = TOOL_FOR[m.fault];
    if (p.tool !== need) {
      if (this.warnedFor !== m.id) this.events.push({ type: 'wrong-tool', need, id: m.id });
      this.warnedFor = m.id;
      return;
    }
    if (m.fault === 'mechanical' && !m.partFitted) {
      if (p.parts <= 0) {
        if (this.warnedFor !== m.id) this.events.push({ type: 'need-part', id: m.id });
        this.warnedFor = m.id;
        return;
      }
      p.parts--;
      m.partFitted = true;
    }
    p.working = true;
    if (!this.wasWorking || Math.floor((this.time - dt) * 4) !== Math.floor(this.time * 4)) {
      this.events.push({ type: 'work', tool: p.tool });
      this.effects.push({ x: m.x - Math.cos(p.angle) * 0.45, y: m.y - Math.sin(p.angle) * 0.45, kind: 'sparks', t: 0 });
    }
    this.wasWorking = true;
    m.progress = Math.min(1, m.progress + dt / REPAIR_S[this.difficulty]);
    if (m.progress >= 1) {
      m.repaired = true;
      this.stats.repaired++;
      this.score += REPAIR_SCORE;
      this.effects.push({ x: m.x, y: m.y, kind: 'done', t: 0 });
      this.events.push({ type: 'repair', id: m.id, kind: m.kind, score: REPAIR_SCORE });
      this.events.push({ type: 'alarm', id: m.id, kind: m.kind, fault: m.fault, came: false });
    }
  }

  /** "Use": the door or the exit switch in front. */
  private use(): void {
    const p = this.player;
    const cx = Math.cos(p.angle);
    const cy = Math.sin(p.angle);
    for (let d = 0.3; d <= USE_REACH; d += 0.1) {
      const x = p.x + cx * d;
      const y = p.y + cy * d;
      if (this.machines.some((m) => Math.hypot(m.x - x, m.y - y) < 0.5)) return;
      const door = doorAt(this.level, x, y);
      if (door) {
        this.openDoor(door);
        return;
      }
      if (isWall(this.level, x, y)) {
        const cell = this.level.walls[Math.floor(y) * this.level.w + Math.floor(x)];
        if (cell === 'exit') this.throwExit();
        return;
      }
    }
  }

  openDoor(door: Door, byAgv = false): void {
    if (door.key && !byAgv && !this.player.keys.has(door.key)) {
      this.events.push({ type: 'need-key', key: door.key });
      return;
    }
    if (door.key && byAgv) return;
    if (door.open < 1 && door.moving !== 1) {
      door.moving = 1;
      this.events.push({ type: 'door', open: true });
    }
    door.hold = DOOR_HOLD;
  }

  private throwExit(): void {
    if (this.exitOn) return;
    const faulted = this.faulted();
    if (faulted.length > 0) {
      this.events.push({ type: 'line-fault', ids: faulted.map((m) => m.id) });
      return;
    }
    this.exitOn = true;
    this.events.push({ type: 'exit' });
  }

  private takePickups(): void {
    const p = this.player;
    for (const k of this.pickups) {
      if (k.taken || Math.hypot(k.x - p.x, k.y - p.y) > 0.6) continue;
      k.taken = true;
      let text: string;
      if (k.kind === 'part') {
        p.parts++;
        this.stats.partsFound++;
        text = 'Spare part picked up';
      } else {
        const key = k.kind.slice(4) as KeyColor;
        p.keys.add(key);
        text = `${key[0].toUpperCase()}${key.slice(1)} key card`;
      }
      this.events.push({ type: 'pickup', kind: k.kind, text });
    }
  }

  // --- the plant -----------------------------------------------------------------------------

  private stepDoors(dt: number): void {
    for (const d of this.level.doors) {
      if (d.moving === 1) {
        d.open = Math.min(1, d.open + DOOR_SPEED * dt);
        if (d.open >= 1) d.moving = 0;
      } else if (d.moving === -1) {
        if (this.occupied(d)) {
          d.moving = 1;
          continue;
        }
        d.open = Math.max(0, d.open - DOOR_SPEED * dt);
        if (d.open <= 0) d.moving = 0;
      } else if (d.open >= 1) {
        d.hold -= dt;
        if (d.hold <= 0 && !this.occupied(d)) {
          d.moving = -1;
          this.events.push({ type: 'door', open: false });
        }
      }
    }
  }

  private occupied(d: Door): boolean {
    const inCell = (x: number, y: number): boolean => Math.abs(x - (d.x + 0.5)) < 0.9 && Math.abs(y - (d.y + 0.5)) < 0.9;
    return inCell(this.player.x, this.player.y) || this.agvs.some((a) => inCell(a.x, a.y));
  }

  private stepAgvs(dt: number): void {
    const p = this.player;
    const speed = AGV_SPEED[this.difficulty];
    let nearest = Infinity;
    for (const a of this.agvs) {
      nearest = Math.min(nearest, Math.hypot(a.x - p.x, a.y - p.y));
      if (a.wait > 0) {
        a.wait -= dt;
        continue;
      }
      const nx = a.x + a.dx * speed * dt;
      const ny = a.y + a.dy * speed * dt;
      // the technician in its way: a bump (it pushes, then waits a moment)
      if (Math.hypot(nx - p.x, ny - p.y) < AGV_RADIUS + PLAYER_RADIUS) {
        this.bump(a);
        continue;
      }
      const ahead = doorAt(this.level, a.x + a.dx * (AGV_RADIUS + 0.4), a.y + a.dy * (AGV_RADIUS + 0.4));
      if (ahead && ahead.open < 0.9) this.openDoor(ahead, true);
      if (!this.slide(a, a.dx * speed * dt, a.dy * speed * dt, AGV_RADIUS, a)) {
        // end of its lane (or a closed key door): turn round
        a.dx = -a.dx;
        a.dy = -a.dy;
        a.wait = 0.6;
      }
    }
    if (nearest < 4 && this.time - this.lastBeep > 0.8) {
      this.lastBeep = this.time;
      this.events.push({ type: 'agv-near', distance: nearest });
    }
  }

  private bump(a: Agv): void {
    const p = this.player;
    if (p.stagger > 0) return;
    // pushed aside, away from the AGV
    const away = Math.atan2(p.y - a.y, p.x - a.x);
    this.slide(p, Math.cos(away) * 0.6, Math.sin(away) * 0.6, PLAYER_RADIUS);
    p.stagger = BUMP_S;
    a.wait = 1.2;
    this.stats.bumps++;
    this.score = Math.max(0, this.score - BUMP_PENALTY);
    this.events.push({ type: 'bump' });
  }

  /** The level is over: the exit thrown a moment ago. */
  get finished(): boolean {
    return this.exitOn && this.exitT > 1.2;
  }

  /** The level's bonus: time under par, no bump. */
  bonus(): { time: number; safety: number } {
    const time = Math.max(0, Math.round((this.level.par - this.time) * 10));
    const safety = this.stats.bumps === 0 ? 500 : 0;
    return { time, safety };
  }
}

/** The demo plant (no datapoint): every machine of the levels is down at the start. */
export function demoMachineState(_id: number, _time: number): MachineState {
  return 'fault';
}
