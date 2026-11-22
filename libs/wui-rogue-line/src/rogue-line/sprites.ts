// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the sprites, drawn at start-up: the plant's machines (6-axis robot, CNC lathe,
 * CNC machining centre, hydraulic press, conveyor) with their stack light and the Visuel Concept
 * plate, in each state; the AGVs; the spare parts and key cards; the coolant tanks; the lamps;
 * the sparks of a repair. 64 × 64, transparent around (alpha 0). Generic machines: no maker's
 * name or colours scheme copied.
 */
import type { MachineKind, PickupKind } from './maps.js';
import { KEY_COLORS, LOGO_GRID, TEX, makeTexture, type Texture } from './textures.js';

export type MachineFrame = 'run' | 'run2' | 'stop' | 'fault-on' | 'fault-off';

type G = CanvasRenderingContext2D;

const LOGO_COLORS = LOGO_GRID.flat();

/** The Visuel Concept symbol, once loaded: on the machines' plates. */
let vcSymbol: CanvasImageSource | null = null;

function glowRect(g: G, gl: G, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  gl.fillRect(x, y, w, h);
}

function glowDisc(g: G, gl: G, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  gl.beginPath();
  gl.arc(x, y, r, 0, Math.PI * 2);
  gl.fill();
}

function box(g: G, x: number, y: number, w: number, h: number, base: string, hi: string, lo: string): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = hi;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = lo;
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x + w - 1, y, 1, h);
}

/** Yellow and black guard stripes. */
function stripes(g: G, x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#e0b000';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#16130e';
  for (let k = x - h; k < x + w + h; k += 6) {
    g.beginPath();
    g.moveTo(k, y + h);
    g.lineTo(k + 3, y + h);
    g.lineTo(k + 3 + h, y);
    g.lineTo(k + h, y);
    g.fill();
  }
  g.restore();
}

/** The stack light on its pole: red (fault, blinking), amber (stopped), green (running). */
function stackLight(g: G, gl: G, x: number, y: number, frame: MachineFrame): void {
  g.fillStyle = '#2a2a28';
  g.fillRect(x + 2, y + 15, 2, 8);
  const on = { red: frame === 'fault-on', amber: frame === 'stop', green: frame === 'run' || frame === 'run2' };
  (
    [
      ['red', '#ff2a1a', '#4a1210'],
      ['amber', '#ffb000', '#4a3510'],
      ['green', '#2aff5a', '#10401a']
    ] as [keyof typeof on, string, string][]
  ).forEach(([k, lit, off], i) => {
    if (on[k]) glowRect(g, gl, x, y + i * 5, 6, 4, lit);
    else {
      g.fillStyle = off;
      g.fillRect(x, y + i * 5, 6, 4);
    }
  });
}

/** A small control screen: the machine's number, red in fault. */
function screen(g: G, gl: G, x: number, y: number, w: number, h: number, id: number, frame: MachineFrame): void {
  const fault = frame === 'fault-on' || frame === 'fault-off';
  glowRect(g, gl, x, y, w, h, fault ? (frame === 'fault-on' ? '#3a0c08' : '#200604') : frame === 'stop' ? '#2a2208' : '#0a2012');
  g.fillStyle = fault ? '#ff5040' : frame === 'stop' ? '#ffb000' : '#5cf08e';
  g.font = 'bold 6px monospace';
  g.fillText(`M${id}`, x + 1, y + 6);
  if (h > 9) {
    g.fillRect(x + 1, y + 8, Math.max(2, w - 3), 1);
    g.fillRect(x + 1, y + 10, Math.max(2, (w - 3) / 2), 1);
  }
}

function plate(g: G, x: number, y: number, s: number): void {
  g.fillStyle = '#e9e7e0';
  g.fillRect(x, y, s, s);
  if (vcSymbol) g.drawImage(vcSymbol, x + 1, y + 1, s - 2, s - 2);
}

function sparks(g: G, gl: G, cx: number, cy: number, n: number, seed: number): void {
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + rnd() * 9;
    glowRect(g, gl, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1, rnd() > 0.5 ? '#fff6a0' : '#7fd8ff');
  }
}

// --- the machines ---------------------------------------------------------------------------

/** A 6-axis robot: an orange arm on its turntable, upright and moving when running, slumped in fault. */
function robot(g: G, gl: G, id: number, frame: MachineFrame): void {
  const fault = frame === 'fault-on' || frame === 'fault-off';
  stripes(g, 2, 61, 60, 3);
  // the base plate, the turntable and the shoulder housing
  box(g, 14, 54, 30, 8, '#3b3e3f', '#5d6264', '#1b1d1e');
  box(g, 18, 46, 22, 9, '#d8640e', '#f08a32', '#7a3606');
  box(g, 22, 38, 14, 10, '#e8700f', '#f59a48', '#7a3606');
  const pose = fault ? { a1: -0.25, a2: 1.75 } : frame === 'run2' ? { a1: -1.15, a2: 1.05 } : frame === 'stop' ? { a1: -1.45, a2: 1.6 } : { a1: -1.5, a2: 0.75 };
  const sx = 29;
  const sy = 40;
  const l1 = 25;
  const l2 = 21;
  const ex = sx + Math.cos(pose.a1) * l1;
  const ey = sy + Math.sin(pose.a1) * l1;
  const wx = ex + Math.cos(pose.a1 + pose.a2) * l2;
  const wy = ey + Math.sin(pose.a1 + pose.a2) * l2;
  const limb = (x0: number, y0: number, x1: number, y1: number, w: number, hi: string): void => {
    g.lineCap = 'round';
    g.strokeStyle = '#6a2e04';
    g.lineWidth = w + 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = hi;
    g.lineWidth = w;
    g.stroke();
  };
  limb(sx, sy, ex, ey, 10, '#ea7412');
  limb(ex, ey, wx, wy, 7, '#f28a2c');
  g.lineWidth = 1;
  for (const [x, y, r] of [
    [sx, sy, 6],
    [ex, ey, 5],
    [wx, wy, 3.5]
  ]) {
    g.fillStyle = '#2e3132';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5d6264';
    g.beginPath();
    g.arc(x, y, r * 0.45, 0, Math.PI * 2);
    g.fill();
  }
  // the tool flange and the gripper
  g.fillStyle = '#9a9c98';
  g.fillRect(wx - 4, wy + 3, 3, 6);
  g.fillRect(wx + 1, wy + 3, 3, 6);
  // the controller cabinet beside it
  box(g, 48, 36, 14, 26, '#c9cbc8', '#e6e8e5', '#7e807d');
  screen(g, gl, 50, 39, 10, 8, id, frame);
  plate(g, 50, 50, 9);
  stackLight(g, gl, 52, 18, frame);
  if (fault) sparks(g, gl, wx, wy, 12, id * 31 + (frame === 'fault-on' ? 1 : 2));
}

/** A CNC lathe: the enclosure, its sliding window on the chuck, the control panel. */
function lathe(g: G, gl: G, id: number, frame: MachineFrame): void {
  const fault = frame === 'fault-on' || frame === 'fault-off';
  box(g, 4, 30, 56, 32, '#d9dcd8', '#f2f4f0', '#8a8d89');
  box(g, 4, 58, 56, 5, '#3b3e3f', '#5d6264', '#1b1d1e');
  // the window and the chuck behind it
  box(g, 8, 34, 30, 20, '#21282b', '#3d474b', '#0d1012');
  g.fillStyle = 'rgba(140,190,210,0.18)';
  g.fillRect(9, 35, 28, 18);
  g.fillStyle = '#6a6e6c';
  g.beginPath();
  g.arc(16, 44, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b3e3f';
  for (let k = 0; k < 3; k++) {
    const a = (frame === 'run2' ? 0.5 : 0) + (k * Math.PI * 2) / 3;
    g.fillRect(16 + Math.cos(a) * 4 - 1, 44 + Math.sin(a) * 4 - 1, 2, 2);
  }
  g.fillStyle = '#b8bcb8';
  g.fillRect(22, 43, 12, 2);
  if (frame === 'run' || frame === 'run2') glowRect(g, gl, 24, 41, 2, 1, '#d6f4ff');
  // the control panel
  box(g, 41, 33, 16, 22, '#2f3436', '#4b5254', '#15181a');
  screen(g, gl, 43, 35, 12, 9, id, frame);
  for (let k = 0; k < 4; k++) {
    g.fillStyle = k === 3 ? '#c02018' : '#8a8e8c';
    g.fillRect(43 + k * 3, 47, 2, 2);
  }
  plate(g, 44, 50, 4);
  g.fillStyle = '#1e5a8c';
  g.fillRect(4, 30, 56, 2);
  stackLight(g, gl, 52, 8, frame);
  if (fault) sparks(g, gl, 20, 44, 8, id * 17 + (frame === 'fault-on' ? 1 : 2));
}

/** A CNC machining centre: a taller enclosure with its spindle and the tool magazine. */
function mill(g: G, gl: G, id: number, frame: MachineFrame): void {
  const fault = frame === 'fault-on' || frame === 'fault-off';
  box(g, 6, 16, 44, 46, '#d6d9d5', '#eff1ed', '#868985');
  box(g, 6, 58, 44, 5, '#3b3e3f', '#5d6264', '#1b1d1e');
  // the tool magazine on the side
  box(g, 50, 22, 10, 30, '#9da09c', '#b9bcb8', '#5e615d');
  for (let k = 0; k < 6; k++) {
    g.fillStyle = '#3b3e3f';
    g.fillRect(52, 25 + k * 4, 6, 2);
  }
  // the doors' window: the spindle above the table
  box(g, 10, 22, 30, 26, '#1f2629', '#3a4448', '#0c0f10');
  g.fillStyle = 'rgba(140,190,210,0.16)';
  g.fillRect(11, 23, 28, 24);
  const z = frame === 'run2' ? 4 : 0;
  g.fillStyle = '#7d817f';
  g.fillRect(21, 23, 8, 10 + z);
  g.fillStyle = '#c9ccc8';
  g.fillRect(24, 33 + z, 2, 5);
  g.fillStyle = '#5a5e5c';
  g.fillRect(13, 42, 24, 4);
  g.fillStyle = '#9aa4a6';
  g.fillRect(19, 40, 12, 2);
  // the control panel, on its arm
  box(g, 38, 50, 12, 9, '#2f3436', '#4b5254', '#15181a');
  screen(g, gl, 39, 51, 10, 7, id, frame);
  plate(g, 11, 50, 7);
  g.fillStyle = '#1e5a8c';
  g.fillRect(6, 16, 44, 2);
  stackLight(g, gl, 42, 0, frame);
  if (fault) sparks(g, gl, 25, 38, 8, id * 13 + (frame === 'fault-on' ? 1 : 2));
}

/** A hydraulic press: the frame, its ram over the bolster, the guards. */
function press(g: G, gl: G, id: number, frame: MachineFrame): void {
  const fault = frame === 'fault-on' || frame === 'fault-off';
  box(g, 10, 6, 44, 10, '#3f6e8c', '#5a8aa8', '#1d3a4c');
  box(g, 10, 6, 8, 52, '#3f6e8c', '#5a8aa8', '#1d3a4c');
  box(g, 46, 6, 8, 52, '#3f6e8c', '#5a8aa8', '#1d3a4c');
  box(g, 6, 54, 52, 9, '#2c3a44', '#45596a', '#121a20');
  // the cylinder and the ram
  const ram = frame === 'run2' ? 18 : fault ? 22 : 8;
  g.fillStyle = '#b9bdba';
  g.fillRect(29, 16, 6, ram);
  box(g, 20, 16 + ram, 24, 6, '#5a5e5c', '#7e827f', '#2e302f');
  box(g, 20, 46, 24, 8, '#4a4e4c', '#6a6e6c', '#262827');
  stripes(g, 18, 40, 4, 14);
  stripes(g, 42, 40, 4, 14);
  screen(g, gl, 11, 30, 6, 8, id, frame);
  plate(g, 47, 30, 6);
  stackLight(g, gl, 48, 0, frame);
  if (fault) sparks(g, gl, 32, 44, 8, id * 11 + (frame === 'fault-on' ? 1 : 2));
}

/** A conveyor: a belt on its frame with boxes riding it, its control box at the end. */
function conveyor(g: G, gl: G, id: number, frame: MachineFrame): void {
  const fault = frame === 'fault-on' || frame === 'fault-off';
  for (const x of [8, 30, 52]) box(g, x, 46, 4, 17, '#4a4e4c', '#6a6e6c', '#262827');
  box(g, 2, 40, 60, 7, '#2a2c2b', '#444746', '#141514');
  g.fillStyle = '#1a1b1a';
  for (let x = (frame === 'run2' ? 3 : 0) + 2; x < 62; x += 6) g.fillRect(x, 41, 2, 1);
  stripes(g, 2, 47, 60, 2);
  // boxes, one fallen across in fault
  const shift = frame === 'run2' ? 4 : 0;
  box(g, 8 + shift, 30, 12, 10, '#b98a4e', '#d8aa6c', '#7a5426');
  if (fault) {
    g.save();
    g.translate(40, 34);
    g.rotate(0.6);
    box(g, -6, -5, 12, 10, '#b98a4e', '#d8aa6c', '#7a5426');
    g.restore();
  } else box(g, 34 + shift, 30, 12, 10, '#b98a4e', '#d8aa6c', '#7a5426');
  box(g, 50, 22, 12, 18, '#c9cbc8', '#e6e8e5', '#7e807d');
  screen(g, gl, 52, 24, 8, 7, id, frame);
  plate(g, 52, 33, 6);
  stackLight(g, gl, 53, 0, frame);
  if (fault) sparks(g, gl, 54, 30, 6, id * 7 + (frame === 'fault-on' ? 1 : 2));
}

const MACHINES: Record<MachineKind, (g: G, gl: G, id: number, frame: MachineFrame) => void> = { robot, lathe, mill, press, conveyor };

// --- the rest ------------------------------------------------------------------------------------

/** An AGV: a low cart with its warning light (blinking), its scanner and a load. */
function agv(g: G, gl: G, blink: boolean): void {
  box(g, 10, 44, 44, 14, '#d27a12', '#f09a32', '#6a3a06');
  stripes(g, 10, 54, 44, 3);
  g.fillStyle = '#1a1a19';
  g.fillRect(14, 58, 8, 5);
  g.fillRect(42, 58, 8, 5);
  g.fillStyle = '#26282a';
  g.fillRect(28, 46, 8, 4);
  glowRect(g, gl, 29, 47, 6, 1, '#3fd0ff');
  // the load
  box(g, 16, 30, 18, 14, '#b98a4e', '#d8aa6c', '#7a5426');
  box(g, 34, 34, 14, 10, '#8c8f8b', '#aeb1ad', '#545653');
  g.fillStyle = '#2a2a28';
  g.fillRect(46, 36, 2, 8);
  if (blink) glowDisc(g, gl, 47, 34, 3, '#ffb000');
  else {
    g.fillStyle = '#6a4a00';
    g.beginPath();
    g.arc(47, 34, 3, 0, Math.PI * 2);
    g.fill();
  }
}

function pickup(g: G, gl: G, kind: PickupKind): void {
  const y = 46;
  if (kind === 'part') {
    // a spare-part crate with a gear
    box(g, 18, y, 28, 16, '#6c7a3a', '#8a9a4e', '#3a4420');
    g.fillStyle = '#d9d6cc';
    g.beginPath();
    g.arc(32, y + 8, 5, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      g.fillRect(32 + Math.cos(a) * 6 - 1, y + 8 + Math.sin(a) * 6 - 1, 3, 3);
    }
    g.fillStyle = '#6c7a3a';
    g.beginPath();
    g.arc(32, y + 8, 2, 0, Math.PI * 2);
    g.fill();
    glowRect(g, gl, 20, y + 1, 3, 2, '#2aff5a');
    return;
  }
  const color = KEY_COLORS[kind.slice(4) as keyof typeof KEY_COLORS];
  box(g, 22, y + 2, 20, 13, '#d7d4ca', '#ffffff', '#86847c');
  glowRect(g, gl, 22, y + 6, 20, 4, color);
  g.fillStyle = '#2a2a26';
  g.fillRect(25, y + 11, 8, 2);
}

function tank(g: G, gl: G): void {
  const grad = g.createLinearGradient(18, 0, 46, 0);
  grad.addColorStop(0, '#163d12');
  grad.addColorStop(0.45, '#3aa22b');
  grad.addColorStop(0.55, '#7ee05c');
  grad.addColorStop(1, '#0f2a0c');
  g.fillStyle = grad;
  g.fillRect(18, 30, 28, 32);
  g.fillStyle = '#2e2e2b';
  g.fillRect(17, 30, 30, 3);
  g.fillRect(17, 59, 30, 3);
  g.fillRect(17, 44, 30, 2);
  g.fillStyle = '#f2c200';
  g.beginPath();
  g.moveTo(32, 34);
  g.lineTo(38, 40);
  g.lineTo(32, 46);
  g.lineTo(26, 40);
  g.fill();
  g.fillStyle = '#111';
  g.fillRect(31, 37, 2, 5);
  glowRect(g, gl, 30, 27, 4, 3, '#9dff6a');
}

/** A stack of pallets with boxes, stretch-wrapped. */
function pallets(g: G): void {
  for (const y of [56, 30]) {
    // the pallet: deck boards and blocks
    g.fillStyle = '#9a7646';
    g.fillRect(6, y + 2, 52, 3);
    g.fillStyle = '#6e5230';
    for (const x of [6, 29, 52]) g.fillRect(x, y + 5, 6, 3);
    g.fillStyle = '#b48c58';
    g.fillRect(6, y, 52, 2);
  }
  // the load on each: boxes under the film
  for (const [x, y, w, h] of [
    [8, 36, 22, 20],
    [31, 40, 24, 16],
    [10, 12, 20, 18],
    [31, 16, 22, 14]
  ]) box(g, x, y, w, h, '#b98a4e', '#d8aa6c', '#7a5426');
  g.fillStyle = 'rgba(220,230,240,0.22)';
  g.fillRect(7, 12, 50, 44);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let y = 14; y < 56; y += 7) g.fillRect(7, y, 50, 1);
  g.fillStyle = '#e8e4d8';
  g.fillRect(14, 42, 8, 5);
  g.fillRect(36, 20, 8, 5);
}

function lamp(g: G, gl: G, red: boolean, frame: number): void {
  if (red) {
    g.fillStyle = '#2a2a28';
    g.fillRect(28, 0, 8, 3);
    g.fillStyle = frame ? '#ff1a10' : '#701008';
    g.beginPath();
    g.ellipse(32, 6, 6, 4, 0, 0, Math.PI * 2);
    g.fill();
    if (frame) glowDisc(g, gl, frame === 1 ? 29 : 35, 6, 3, '#ffd0c0');
    return;
  }
  g.fillStyle = '#1e1e1c';
  g.fillRect(31, 0, 2, 4);
  g.fillStyle = '#3c3c38';
  g.fillRect(22, 4, 20, 3);
  glowRect(g, gl, 24, 7, 16, 2, '#fff2c8');
}

/** The sparks of a repair, and the burst of logo cubes when a machine runs again. */
function effect(g: G, gl: G, kind: 'sparks' | 'done', frame: number): void {
  if (kind === 'sparks') {
    sparks(g, gl, 32, 36, 16 - frame * 4, 5 + frame);
    return;
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const d = 6 + frame * 7;
    glowRect(g, gl, Math.round(32 + Math.cos(a) * d), Math.round(36 + Math.sin(a) * d * 0.7) - frame * 3, 3, 3, LOGO_COLORS[k % LOGO_COLORS.length]);
  }
}

export interface SpriteSet {
  machine: (kind: MachineKind, id: number, frame: MachineFrame) => Texture;
  agv: Texture[];
  pickups: Record<PickupKind, Texture>;
  decor: Record<'tank' | 'pallets', Texture>;
  lamp: Texture;
  beacon: Texture[];
  sparks: Texture[];
  done: Texture[];
}

let machineCache: Map<string, Texture> | null = null;

/** The Visuel Concept symbol is loaded: the machines are drawn again with it. */
export function setVcSymbol(img: CanvasImageSource): void {
  vcSymbol = img;
  machineCache?.clear();
}

export function makeSprites(): SpriteSet {
  const machines = new Map<string, Texture>();
  machineCache = machines;
  const kinds: PickupKind[] = ['part', 'key-blue', 'key-yellow', 'key-red'];
  return {
    machine: (kind, id, frame) => {
      const key = `${kind}:${id}:${frame}`;
      let t = machines.get(key);
      if (!t) {
        t = makeTexture(TEX, TEX, 300 + id, (g, gl) => MACHINES[kind](g, gl, id, frame));
        machines.set(key, t);
      }
      return t;
    },
    agv: [true, false].map((b) => makeTexture(TEX, TEX, 200, (g, gl) => agv(g, gl, b))),
    pickups: Object.fromEntries(kinds.map((k) => [k, makeTexture(TEX, TEX, 210, (g, gl) => pickup(g, gl, k))])) as SpriteSet['pickups'],
    decor: {
      tank: makeTexture(TEX, TEX, 220, (g, gl) => tank(g, gl)),
      pallets: makeTexture(TEX, TEX, 221, (g) => pallets(g))
    },
    lamp: makeTexture(TEX, TEX, 230, (g, gl) => lamp(g, gl, false, 0)),
    beacon: [0, 1, 2].map((f) => makeTexture(TEX, TEX, 240 + f, (g, gl) => lamp(g, gl, true, f))),
    sparks: [0, 1, 2].map((f) => makeTexture(TEX, TEX, 250 + f, (g, gl) => effect(g, gl, 'sparks', f))),
    done: [0, 1, 2, 3].map((f) => makeTexture(TEX, TEX, 260 + f, (g, gl) => effect(g, gl, 'done', f)))
  };
}
