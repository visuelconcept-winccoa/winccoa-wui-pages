// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the levels (original maps) and their parsing into a grid. Pure.
 *
 * One character per cell (1 cell = 1 m):
 *
 * - walls: `#` steel panels · `%` rusted plates · `=` computer bank · `@` WinCC OA logo panel ·
 *   `V` Visuel Concept logo panel · `S` WinCC OA screen (the level's machines, live) ·
 *   `~` pipes · `H` hazard stripes · `&` concrete (yard) · `x` exit switch (use it to leave);
 * - doors: `D` · key doors `B` blue, `Y` yellow, `R` red (a door slides open on "use");
 * - safety fences: `|` a fence (see-through, not crossable; panels run to the fences and walls
 *   around) · `!` its gate (a see-through door);
 * - floors: `.` tiles · `,` grating · `s` coolant pool (hurts) · `:` open yard (sky, no ceiling);
 * - lights: `l` ceiling lamp · `L` red alarm beacon (flickers);
 * - `W`: the WinCC OA logo painted on the floor (on the floor of the cell to its left);
 * - floor markings, drawn on their own: a yellow safety line along the walls, a yellow and
 *   black hazard border around each machine, a yellow outline under each stack of pallets;
 * - things (on the floor of the cell to their left): `P` start · `g` AGV (shuttles along the
 *   longer free line) · `+` spare part · key cards `b` `y` `r` · decor: `o` coolant tank,
 *   `k` stack of pallets ·
 *   `1`–`9` machine `n` (its kind and its fault in the level's `machines`; bound to a datapoint).
 */

export type WallTex = 'steel' | 'rust' | 'computer' | 'scada' | 'logo' | 'vc' | 'pipes' | 'hazard' | 'concrete' | 'exit';
export type FloorTex = 'tiles' | 'grate' | 'coolant' | 'yard';
export type KeyColor = 'blue' | 'yellow' | 'red';
export type DecorKind = 'tank' | 'pallets';
export type PickupKind = 'part' | 'key-blue' | 'key-yellow' | 'key-red';
/** The plant's machines (generic kinds: no maker's name). */
export type MachineKind = 'robot' | 'lathe' | 'mill' | 'press' | 'conveyor';
/** What is wrong with a machine — and so the tool it takes. */
export type FaultKind = 'mechanical' | 'electrical' | 'software';

export const MACHINE_LABELS: Record<MachineKind, string> = {
  robot: '6-axis robot',
  lathe: 'CNC lathe',
  mill: 'CNC machining centre',
  press: 'Hydraulic press',
  conveyor: 'Conveyor'
};

export interface LevelDef {
  name: string;
  /** Par time, seconds. */
  par: number;
  rows: readonly string[];
  /** Each machine of the level: its kind and the fault it gets. */
  machines: Record<number, { kind: MachineKind; fault: FaultKind }>;
}

export interface Door {
  x: number;
  y: number;
  /** The door plane runs along x (the player passes north–south) or along y. */
  axis: 'x' | 'y';
  key: KeyColor | null;
  /** A gate in a safety fence (see-through). */
  fence: boolean;
  /** 0 closed … 1 open. */
  open: number;
  /** -1 closing, 0 still, 1 opening. */
  moving: -1 | 0 | 1;
  /** Seconds left before it closes again on its own. */
  hold: number;
}

export type Thing =
  | { type: 'agv'; x: number; y: number }
  | { type: 'pickup'; kind: PickupKind; x: number; y: number }
  | { type: 'decor'; kind: DecorKind; x: number; y: number }
  | { type: 'machine'; id: number; kind: MachineKind; fault: FaultKind; x: number; y: number };

export interface Level {
  name: string;
  par: number;
  w: number;
  h: number;
  /** Wall texture per cell, or null for an open cell (doors are open cells with a door). */
  walls: (WallTex | null)[];
  floors: FloorTex[];
  /** Light per cell, 0..1.5 (ceiling lamps, open yard); red beacons are kept apart. */
  light: Float32Array;
  /** Red beacon light per cell, 0..1 (flickers in the renderer). */
  alarm: Float32Array;
  doors: Door[];
  /** Safety fence per cell: its panels from the middle towards N 1 / E 2 / S 4 / W 8 (0: none). */
  fences: Uint8Array;
  /**
   * Floor markings per cell (bits): 1 / 2 / 4 / 8 a safety line along the north / east / south /
   * west wall, 16 a hazard border (a machine), 32 a storage outline (pallets), 64 the WinCC OA
   * logo painted on the floor.
   */
  marks: Uint8Array;
  /** Ceiling lamps (sprites hanging from the ceiling). */
  lamps: { x: number; y: number; red: boolean }[];
  things: Thing[];
  start: { x: number; y: number; angle: number };
}

const WALLS: Record<string, WallTex> = {
  '#': 'steel',
  '%': 'rust',
  '=': 'computer',
  S: 'scada',
  '@': 'logo',
  V: 'vc',
  '~': 'pipes',
  H: 'hazard',
  '&': 'concrete',
  x: 'exit'
};
const FLOORS: Record<string, FloorTex> = { '.': 'tiles', ',': 'grate', s: 'coolant', ':': 'yard' };
const DOORS: Record<string, KeyColor | null> = { D: null, B: 'blue', Y: 'yellow', R: 'red' };
const PICKUPS: Record<string, PickupKind> = {
  '+': 'part',
  b: 'key-blue',
  y: 'key-yellow',
  r: 'key-red'
};

export const LEVELS: readonly LevelDef[] = [
  {
    name: 'Intake Hall',
    par: 150,
    machines: { 1: { kind: 'robot', fault: 'electrical' }, 2: { kind: 'lathe', fault: 'mechanical' }, 3: { kind: 'mill', fault: 'software' } },
    rows: [
      '##VV############################',
      '#,,,,,k#~~~~~~~~~~~~~~~#%%%%%%%#',
      '#,P,,,,#.......l......k#.......#',
      '#,,,,,,D.....g.........D.......#',
      '#,,l,,,#.....|!|||.....#...l...#',
      '#,,,,,,#..W..|.1.|.....#.......#',
      '####D###.....|...|.....###D#####',
      '#k.....#..3..|||||.....#.......#',
      '#..+...#k......l......k#.......#',
      '#......####=S===D==S=###.......#',
      '#..l...#.......#.......#.......#',
      '#......D.......#...b...#..l....#',
      '#......#.......#...l...##BB#####',
      '#k.....#..l....#.......#,,,,,,k#',
      '####D###.......D.......#,,,l,,,#',
      '#%%%%%%#..o....#...+...#,,,,,,,#',
      '#.....L#########.......#,,,2,,,#',
      '#......#@@@V@@@#########,,,,,,,#',
      '#......D...l...B,,,,,,,,,,,,,,,#',
      '#......#.......#,,,,,,W,,,L,,,,#',
      '#......#.......#,,,g,,,,,,,,,,,#',
      '########HHHHHHH#######HHHHHHHxH#',
    ]
  },
  {
    name: 'Paint Shop',
    par: 210,
    machines: { 4: { kind: 'robot', fault: 'software' }, 5: { kind: 'press', fault: 'mechanical' }, 6: { kind: 'conveyor', fault: 'electrical' } },
    rows: [
      '####################################',
      '#::::::::::::::&&&&&&&&&&&&&&&&&&&&#',
      '#::P:::::::::k:&,,,,,,,,#.........k#',
      '#::::::::::::::&,,,l,,,,D..........#',
      '#::::o:W:::g:::&,,,,,,,,#....l.....#',
      '#::::::::::::::D,,,,,,,,#.........k#',
      '#:::::::::::::::,,,,,,,,####DD######',
      '#k:::::::::::::&,,,,,,,,#,,,,,,,,,,#',
      '#&&&&&&&D&&&&&&&&&&D&&&&#,,,l,|!|||#',
      '#ssss....s#.......#...+.#,,,,,|,4,|#',
      '#sssss.ssss#..l...#.....#,,,,,|,,,|#',
      '#ss.l..sss.D......D..l..#,,,,5|||||#',
      '#sssss..ssss#.....#.....#,,,,,,,,,,#',
      '#ssssss.sssss#..y.#.....#,,,,,,,,,,#',
      '#sssss..sssssH#####DDDDD#####YY#####',
      '#ssss..+.sssssH...........H.......k#',
      '#===S=====S====...l....L..H..l.....#',
      '#.......g.....D...........Y...W....#',
      '#..l..........=....6......H........#',
      '#=====VV=======HHHHHHHHHHHH%%%%x%%%#',
    ]
  },
  {
    name: 'Control Core',
    par: 270,
    machines: { 7: { kind: 'robot', fault: 'mechanical' }, 8: { kind: 'lathe', fault: 'electrical' }, 9: { kind: 'mill', fault: 'software' } },
    rows: [
      '########################################',
      '#~~~~~~~~~#==S====S==#@@@@@@@VV@@@@@@@@#',
      '#k...l....#...l......#................k#',
      '#..P..W...D.........D..g....l..........#',
      '#.........#..........#.....|!|||.......#',
      '#....+....#===S==S===#.....|.7.|.......#',
      '###DD######..........#.....|...|.......#',
      '#.........#..8....l..#....l|||||..l....#',
      '#..l......D..........D..W..............#',
      '#k........#..........#................k#',
      '#.........##########D#####RR############',
      '#.........#%%%%%%%%%,,,,%#,,,,,,,,,,,,,#',
      '####D######,,,,,,,,,,,,,%#,,,,,L,,,,,,,#',
      '#k,,,,,,,,#,,,l,,,,,,,,,%#,,,,,,,,,,,,,#',
      '#,,,l,,,,,D,,,,,,,,,,,,,R,,,9,,,,,,g,,,#',
      '#,,,,,,r,,#,,,,,,,,,,,,,%#,,,,,,,,,,,,,#',
      '#,,,,,,,,,#,,o,,,,,,o,,,%#,,,,,l,,,,,,,#',
      '#,,,,,,,,,#%%%%%%%%%%%%%%#,,,,,,,,,,,,k#',
      '##########################@@@V@@x@@V@@@#',
    ]
  }
];

/** Lamp reach, cells (light spreads through open cells only: no light through walls). */
const LAMP_REACH = 6;
const AMBIENT = 0.2;
const YARD_LIGHT = 0.85;

/** The grid of a level. */
export function parseLevel(def: LevelDef): Level {
  const h = def.rows.length;
  const w = Math.max(...def.rows.map((r) => r.length));
  const walls: (WallTex | null)[] = new Array(w * h).fill(null);
  const fences = new Uint8Array(w * h);
  const floors: FloorTex[] = new Array(w * h).fill('tiles');
  const doors: Door[] = [];
  const things: Thing[] = [];
  const lamps: Level['lamps'] = [];
  let start = { x: 1.5, y: 1.5, angle: 0 };
  const ch = (x: number, y: number): string => def.rows[y]?.[x] ?? '#';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = ch(x, y);
      const i = y * w + x;
      if (c in WALLS) {
        walls[i] = WALLS[c];
        continue;
      }
      floors[i] = FLOORS[c] ?? floorOf(def, x, y);
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (c === '|') fences[i] = 15;
      else if (c in DOORS || c === '!') doors.push({ x, y, axis: 'x', key: DOORS[c] ?? null, fence: c === '!', open: 0, moving: 0, hold: 0 });
      else if (c === 'P') start = { x: cx, y: cy, angle: 0 };
      else if (c === 'g') things.push({ type: 'agv', x: cx, y: cy });
      else if (c in PICKUPS) things.push({ type: 'pickup', kind: PICKUPS[c], x: cx, y: cy });
      else if (c === 'o' || c === 'k') things.push({ type: 'decor', kind: c === 'o' ? 'tank' : 'pallets', x: cx, y: cy });
      else if (c >= '1' && c <= '9') {
        const m = def.machines[Number(c)] ?? { kind: 'lathe', fault: 'mechanical' };
        things.push({ type: 'machine', id: Number(c), kind: m.kind, fault: m.fault, x: cx, y: cy });
      }
      else if (c === 'l' || c === 'L') lamps.push({ x: cx, y: cy, red: c === 'L' });
    }
  }
  const solid = (x: number, y: number): boolean => x < 0 || y < 0 || x >= w || y >= h || walls[y * w + x] !== null;
  const isDoor = (x: number, y: number): boolean => doors.some((d) => d.x === x && d.y === y);
  const isFence = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && fences[y * w + x] !== 0;
  const closed = (x: number, y: number): boolean => solid(x, y) || isDoor(x, y) || isFence(x, y);
  // a door between walls on its west and east (doors and fences count as walls) closes a north–south passage
  for (const d of doors) d.axis = closed(d.x - 1, d.y) && closed(d.x + 1, d.y) ? 'x' : 'y';
  // a fence's panels run from the middle of its cell to the fences, gates and walls around (N E S W)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!fences[y * w + x]) continue;
      fences[y * w + x] = (closed(x, y - 1) ? 1 : 0) | (closed(x + 1, y) ? 2 : 0) | (closed(x, y + 1) ? 4 : 0) | (closed(x - 1, y) ? 8 : 0) || 15;
    }
  // the start faces the most open direction
  start.angle = openestDirection(start.x, start.y, solid);
  const light = new Float32Array(w * h);
  const alarm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) light[i] = floors[i] === 'yard' ? YARD_LIGHT : AMBIENT;
  for (const lamp of lamps) spread(lamp.x | 0, lamp.y | 0, w, solid, lamp.red ? alarm : light, lamp.red ? 0.9 : 1.5);
  for (let i = 0; i < w * h; i++) light[i] = Math.min(1.5, light[i]);
  const marks = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (walls[i] !== null || floors[i] === 'coolant' || floors[i] === 'grate' || isDoor(x, y) || fences[i]) continue;
      // along the walls (not across a doorway)
      if (solid(x, y - 1)) marks[i] |= 1;
      if (solid(x + 1, y)) marks[i] |= 2;
      if (solid(x, y + 1)) marks[i] |= 4;
      if (solid(x - 1, y)) marks[i] |= 8;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ch(x, y) === 'W') marks[y * w + x] = 64;
  for (const t of things) {
    const i = Math.floor(t.y) * w + Math.floor(t.x);
    if (t.type === 'machine') marks[i] = 16;
    else if (t.type === 'decor' && t.kind === 'pallets') marks[i] = 32;
  }
  return { name: def.name, par: def.par, w, h, walls, fences, floors, light, alarm, doors, marks, lamps, things, start };
}

/** The floor under a thing or a light: the floor of the nearest floor cell on its left, else above. */
function floorOf(def: LevelDef, x: number, y: number): FloorTex {
  for (let k = x - 1; k >= 0; k--) {
    const f = FLOORS[def.rows[y][k]];
    if (f) return f;
    if (def.rows[y][k] in WALLS) break;
  }
  for (let k = y - 1; k >= 0; k--) {
    const f = FLOORS[def.rows[k][x]];
    if (f) return f;
    if (def.rows[k][x] in WALLS) break;
  }
  return 'tiles';
}

function openestDirection(x: number, y: number, solid: (x: number, y: number) => boolean): number {
  let best = 0;
  let bestRun = -1;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    let run = 0;
    while (run < 30 && !solid(Math.floor(x + Math.cos(a) * (run + 1)), Math.floor(y + Math.sin(a) * (run + 1)))) run++;
    if (run > bestRun) {
      bestRun = run;
      best = a;
    }
  }
  return best;
}

/** Adds a lamp's light to the open cells it reaches (breadth first, through doorways). */
function spread(sx: number, sy: number, w: number, solid: (x: number, y: number) => boolean, into: Float32Array, power: number): void {
  const dist = new Map<number, number>([[sy * w + sx, 0]]);
  const queue = [[sx, sy]];
  while (queue.length > 0) {
    const [x, y] = queue.shift() as number[];
    const d = dist.get(y * w + x) as number;
    if (d >= LAMP_REACH) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (solid(nx, ny) || dist.has(ny * w + nx)) continue;
      dist.set(ny * w + nx, d + 1);
      queue.push([nx, ny]);
    }
  }
  for (const [i, d] of dist) into[i] += power * Math.pow(1 - d / (LAMP_REACH + 1), 1.6);
}

/** Is the cell blocking (a wall, outside the map) — doors are not counted here. */
export function isWall(level: Level, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return cx < 0 || cy < 0 || cx >= level.w || cy >= level.h || level.walls[cy * level.w + cx] !== null;
}

/** Is the cell a wall or a safety fence (what nobody walks through, doors aside)? */
export function isSolid(level: Level, x: number, y: number): boolean {
  if (isWall(level, x, y)) return true;
  return level.fences[Math.floor(y) * level.w + Math.floor(x)] !== 0;
}

export function doorAt(level: Level, x: number, y: number): Door | undefined {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return level.doors.find((d) => d.x === cx && d.y === cy);
}

/**
 * Can every key door be opened and the exit be reached, keys picked up on the way? Breadth
 * first from the start, opening a key door once its card was reached (never, `withCards` false).
 * Used by the tests.
 */
export function exitReachable(level: Level, withCards = true): boolean {
  const keys = new Set<KeyColor>();
  const seen = new Set<number>();
  const cards = new Map<number, KeyColor>();
  for (const t of level.things) if (t.type === 'pickup' && t.kind.startsWith('key-')) cards.set(Math.floor(t.y) * level.w + Math.floor(t.x), t.kind.slice(4) as KeyColor);
  let frontier = [Math.floor(level.start.y) * level.w + Math.floor(level.start.x)];
  let blocked: number[] = [];
  let reached = false;
  for (let round = 0; round < 6 && !reached; round++) {
    const queue = [...frontier, ...blocked];
    blocked = [];
    frontier = [];
    while (queue.length > 0) {
      const i = queue.shift() as number;
      if (seen.has(i)) continue;
      const x = i % level.w;
      const y = Math.floor(i / level.w);
      const door = level.doors.find((d) => d.x === x && d.y === y);
      if (door?.key && !keys.has(door.key)) {
        blocked.push(i);
        continue;
      }
      seen.add(i);
      const card = cards.get(i);
      if (card && withCards) keys.add(card);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        const wall = level.walls[ny * level.w + nx];
        if (wall === 'exit') reached = true;
        if (wall === null && !level.fences[ny * level.w + nx] && !seen.has(ny * level.w + nx)) queue.push(ny * level.w + nx);
      }
    }
  }
  return reached;
}
