// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — what is drawn over the view on the low-resolution canvas (320 × 200): the tool
 * in the technician's gloved hands, the crosshair, the machine in front (its fault, the tool it
 * takes, the repair's progress), the minimap, the status bar (tool, machines repaired, time,
 * the plant's machines, spare parts, key cards, score), the messages and the full map.
 */
import { MACHINE_LABELS, type KeyColor } from './maps.js';
import { H, VIEW_H, W } from './render.js';
import { TOOL_FOR, TOOL_LABELS, TOOLS, type Machine, type Sim, type ToolId } from './sim.js';
import { KEY_COLORS, LOGO_GRID } from './textures.js';

type G = CanvasRenderingContext2D;

const AMBER = '#ffb21e';
const DIM = '#6d6556';
const FONT = (px: number, bold = true): string => `${bold ? 'bold ' : ''}${px}px "Courier New", monospace`;

// --- the tool in hand ---------------------------------------------------------------------------

function glove(g: G, x: number, y: number, s: number): void {
  g.fillStyle = '#7a4a1c';
  g.beginPath();
  g.ellipse(x, y, 12 * s, 9 * s, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#9a6228';
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.ellipse(x - 9 * s + k * 6 * s, y - 7 * s, 3 * s, 5 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  // the cuff of the work jacket, with its reflective band
  g.fillStyle = '#3a3a36';
  g.fillRect(x - 12 * s, y + 6 * s, 24 * s, 14 * s);
  g.fillStyle = '#d8d8c8';
  g.fillRect(x - 12 * s, y + 9 * s, 24 * s, 2 * s);
}

/**
 * The tool, bobbing with the walk, busy while `working` (`t` the time, for the motion);
 * `light` the light around (the tool darkens in the shadows).
 */
export function drawTool(g: G, tool: ToolId, walked: number, working: boolean, t: number, light: number): void {
  const bobX = Math.sin(walked * 2.2) * 6;
  const bobY = Math.abs(Math.cos(walked * 2.2)) * 5;
  g.save();
  g.filter = `brightness(${Math.round(Math.min(1.2, 0.45 + light * 0.7) * 100)}%)`;
  if (tool === 'wrench') {
    // turning a bolt: the wrench rocks to and fro
    const turn = working ? Math.sin(t * 9) * 0.35 : 0;
    g.translate(205 + bobX - (working ? 20 : 0), VIEW_H + 8 + bobY);
    g.rotate(-0.55 + turn);
    const grad = g.createLinearGradient(-5, 0, 5, 0);
    grad.addColorStop(0, '#5e5f5b');
    grad.addColorStop(0.5, '#c9c8bf');
    grad.addColorStop(1, '#4b4c48');
    g.fillStyle = grad;
    g.fillRect(-4, -78, 8, 80);
    g.fillStyle = '#8d8e86';
    g.beginPath();
    g.moveTo(-12, -92);
    g.lineTo(12, -92);
    g.lineTo(12, -76);
    g.lineTo(5, -76);
    g.lineTo(5, -84);
    g.lineTo(-5, -84);
    g.lineTo(-5, -76);
    g.lineTo(-12, -76);
    g.fill();
    g.fillStyle = '#d36b12';
    g.fillRect(-5, -30, 10, 34);
    glove(g, 0, -8, 1.3);
  } else if (tool === 'multimeter') {
    g.translate(150 + bobX, VIEW_H + bobY + (working ? -10 : 0));
    // the probes' leads
    g.strokeStyle = '#c42018';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-6, -40);
    g.quadraticCurveTo(-30, -70, working ? -8 : -20, -92);
    g.stroke();
    g.strokeStyle = '#1a1a1a';
    g.beginPath();
    g.moveTo(6, -40);
    g.quadraticCurveTo(34, -70, working ? 10 : 24, -92);
    g.stroke();
    g.lineWidth = 1;
    g.fillStyle = '#c42018';
    g.fillRect(working ? -10 : -22, -100, 3, 9);
    g.fillStyle = '#1a1a1a';
    g.fillRect(working ? 9 : 23, -100, 3, 9);
    // the meter
    g.fillStyle = '#e0b000';
    g.fillRect(-20, -62, 40, 62);
    g.fillStyle = '#2a2a28';
    g.fillRect(-16, -58, 32, 54);
    g.fillStyle = '#9fb38a';
    g.fillRect(-13, -55, 26, 14);
    g.fillStyle = '#1a2414';
    g.font = FONT(9);
    g.textAlign = 'center';
    g.fillText(working ? (230 + Math.round(Math.sin(t * 13) * 4)).toFixed(0) : '0.00', 0, -44);
    g.fillStyle = '#56564f';
    g.beginPath();
    g.arc(0, -26, 8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d9d6cc';
    g.beginPath();
    g.moveTo(0, -26);
    g.lineTo(Math.cos(-2 + (working ? 1.2 : 0)) * 7, -26 + Math.sin(-2 + (working ? 1.2 : 0)) * 7);
    g.stroke();
    g.textAlign = 'start';
    glove(g, -16, -8, 1.1);
    glove(g, 18, -10, 1.1);
  } else {
    // the laptop: the WinCC OA recipe being reloaded
    g.translate(160 + bobX, VIEW_H + bobY + (working ? -2 : 8));
    g.scale(0.78, 0.78);
    g.fillStyle = '#2a2c2e';
    g.beginPath();
    g.moveTo(-50, 0);
    g.lineTo(50, 0);
    g.lineTo(40, -22);
    g.lineTo(-40, -22);
    g.fill();
    g.fillStyle = '#44484b';
    for (let r = 0; r < 3; r++) for (let k = 0; k < 10; k++) g.fillRect(-36 + k * 7.4 + r * 1.5, -19 + r * 5, 5, 3);
    g.fillStyle = '#1d1f21';
    g.fillRect(-42, -78, 84, 56);
    g.fillStyle = '#0c1a22';
    g.fillRect(-38, -74, 76, 48);
    // the screen: the logo, a progress bar while working
    LOGO_GRID.forEach((row, r) => row.forEach((c, k) => ((g.fillStyle = c), g.fillRect(-30 + k * 5, -68 + r * 5, 4, 4))));
    g.fillStyle = '#d9e6ee';
    g.font = FONT(7);
    g.fillText('WinCC OA', -6, -60);
    g.fillStyle = '#7fa6b8';
    g.font = FONT(5, false);
    g.fillText(working ? 'loading recipe…' : 'ready', -6, -53);
    g.fillStyle = '#20343e';
    g.fillRect(-30, -40, 60, 5);
    if (working) {
      g.fillStyle = '#2fb6ff';
      g.fillRect(-30, -40, ((t * 40) % 60) + 1, 5);
    }
    glove(g, -42, -4, 1.1);
    glove(g, 44, -6, 1.1);
  }
  g.restore();
}

export function drawCrosshair(g: G, onTarget: boolean): void {
  g.fillStyle = onTarget ? 'rgba(120,255,150,0.9)' : 'rgba(255,230,180,0.7)';
  g.fillRect(W / 2 - 4, VIEW_H / 2, 3, 1);
  g.fillRect(W / 2 + 2, VIEW_H / 2, 3, 1);
  g.fillRect(W / 2, VIEW_H / 2 - 4, 1, 3);
  g.fillRect(W / 2, VIEW_H / 2 + 2, 1, 3);
}

/** The machine in front: what it is, its fault, the tool it takes, the repair's progress. */
export function drawTarget(g: G, sim: Sim): void {
  const m = sim.target;
  if (!m) return;
  const fault = m.state === 'fault' && !m.repaired;
  const lines = [`M${m.id} · ${MACHINE_LABELS[m.kind]}`];
  let color = '#5cf08e';
  if (fault) {
    color = '#ff6a50';
    const tool = TOOL_FOR[m.fault];
    const part = m.fault === 'mechanical' && !m.partFitted ? ' + a spare part' : '';
    lines.push(`${m.fault.toUpperCase()} FAULT · ${TOOL_LABELS[tool]} (${TOOLS.indexOf(tool) + 1})${part}`);
  } else lines.push(m.repaired ? 'Repaired · running' : m.state === 'run' ? 'Running' : m.state === 'stop' ? 'Stopped' : 'No signal');
  g.font = FONT(7);
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 10;
  const x = Math.round(W / 2 - w / 2);
  const y = VIEW_H / 2 - 40;
  g.fillStyle = 'rgba(10,10,8,0.72)';
  g.fillRect(x, y, w, fault ? 27 : 21);
  g.fillStyle = color;
  g.fillRect(x, y, 2, fault ? 27 : 21);
  g.textAlign = 'center';
  lines.forEach((l, k) => {
    g.fillStyle = k === 0 ? '#f2ead8' : color;
    g.fillText(l, W / 2, y + 9 + k * 9);
  });
  if (fault) {
    g.fillStyle = '#2a2622';
    g.fillRect(x + 5, y + 21, w - 10, 3);
    g.fillStyle = '#5cf08e';
    g.fillRect(x + 5, y + 21, Math.round((w - 10) * m.progress), 3);
  }
  g.textAlign = 'start';
}

// --- the minimap ------------------------------------------------------------------------------------

function machineLamp(m: Machine, time: number): string {
  if (m.state === 'fault' && !m.repaired) return Math.floor(time * 3) % 2 ? '#ff2a1a' : '#5a1410';
  if (m.state === 'run' || m.repaired) return '#2aff5a';
  if (m.state === 'stop') return AMBER;
  return DIM;
}

/** The minimap in the view's corner: the seen cells around the technician, north up. */
export function drawMinimap(g: G, sim: Sim, seen: Uint8Array): void {
  const lv = sim.level;
  const p = sim.player;
  const size = 62;
  const cells = 13;
  const s = size / cells;
  const x0 = W - size - 4;
  const y0 = 4;
  g.save();
  g.fillStyle = 'rgba(6,8,6,0.78)';
  g.fillRect(x0 - 1, y0 - 1, size + 2, size + 2);
  g.beginPath();
  g.rect(x0, y0, size, size);
  g.clip();
  const ox = x0 + size / 2 - p.x * s;
  const oy = y0 + size / 2 - p.y * s;
  const cx0 = Math.floor(p.x - cells / 2 - 1);
  const cy0 = Math.floor(p.y - cells / 2 - 1);
  for (let y = cy0; y < cy0 + cells + 3; y++) {
    for (let x = cx0; x < cx0 + cells + 3; x++) {
      if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) continue;
      const i = y * lv.w + x;
      if (!seen[i]) continue;
      const wall = lv.walls[i];
      g.fillStyle = wall ? (wall === 'exit' ? '#3dff7a' : '#4a7a46') : lv.fences[i] ? '#8a7000' : lv.floors[i] === 'coolant' ? '#1d4d14' : '#1a2219';
      g.fillRect(ox + x * s, oy + y * s, s + 0.5, s + 0.5);
    }
  }
  for (const d of lv.doors) {
    if (!seen[d.y * lv.w + d.x] || d.open > 0.9) continue;
    g.fillStyle = d.key ? KEY_COLORS[d.key] : d.fence ? '#e0b000' : '#b8b09a';
    g.fillRect(ox + d.x * s, oy + d.y * s, s, s);
  }
  for (const m of sim.machines) {
    g.fillStyle = machineLamp(m, sim.time);
    g.fillRect(ox + (m.x - 0.4) * s, oy + (m.y - 0.4) * s, s * 0.8, s * 0.8);
  }
  for (const a of sim.agvs) {
    if (!seen[Math.floor(a.y) * lv.w + Math.floor(a.x)]) continue;
    g.fillStyle = '#ff9a1a';
    g.fillRect(ox + (a.x - 0.3) * s, oy + (a.y - 0.3) * s, s * 0.6, s * 0.6);
  }
  g.restore();
  // the technician, at the centre
  const px = x0 + size / 2;
  const py = y0 + size / 2;
  g.fillStyle = '#fff3c0';
  g.beginPath();
  g.moveTo(px + Math.cos(p.angle) * 4, py + Math.sin(p.angle) * 4);
  g.lineTo(px + Math.cos(p.angle + 2.5) * 3, py + Math.sin(p.angle + 2.5) * 3);
  g.lineTo(px + Math.cos(p.angle - 2.5) * 3, py + Math.sin(p.angle - 2.5) * 3);
  g.fill();
  g.strokeStyle = '#6c6d66';
  g.strokeRect(x0 - 0.5, y0 - 0.5, size + 1, size + 1);
}

// --- the status bar -----------------------------------------------------------------------------

function panel(g: G, x: number, w: number): void {
  const y = VIEW_H;
  const grad = g.createLinearGradient(0, y, 0, H);
  grad.addColorStop(0, '#4a4b46');
  grad.addColorStop(1, '#262724');
  g.fillStyle = grad;
  g.fillRect(x, y, w, H - y);
  g.fillStyle = '#6c6d66';
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, H - y);
  g.fillStyle = '#121211';
  g.fillRect(x + w - 1, y, 1, H - y);
  g.fillStyle = '#0d0c0a';
  g.fillRect(x + 3, y + 3, w - 6, H - y - 6);
}

function label(g: G, text: string, x: number, w: number): void {
  g.fillStyle = '#a59c88';
  g.font = FONT(6);
  g.textAlign = 'center';
  g.fillText(text, x + w / 2, H - 5);
}

function big(g: G, text: string, x: number, w: number, color: string, px = 14): void {
  g.font = FONT(px);
  g.textAlign = 'center';
  g.fillStyle = '#000';
  g.fillText(text, x + w / 2 + 1, VIEW_H + 18);
  g.fillStyle = color;
  g.fillText(text, x + w / 2, VIEW_H + 17);
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function drawStatusBar(g: G, sim: Sim, levelNo: number): void {
  const p = sim.player;
  g.textBaseline = 'alphabetic';
  // tools
  panel(g, 0, 58);
  TOOLS.forEach((t, k) => {
    g.font = FONT(9);
    g.textAlign = 'center';
    g.fillStyle = t === p.tool ? '#fff3c0' : AMBER;
    g.fillText(String(k + 1), 14 + k * 15, VIEW_H + 13);
    if (t === p.tool) g.fillRect(10 + k * 15, VIEW_H + 15, 8, 1);
  });
  label(g, TOOL_LABELS[p.tool].replace('WinCC OA ', '').toUpperCase(), 0, 58);
  // machines repaired
  const total = sim.machines.filter((m) => m.state === 'fault' || m.repaired).length;
  const done = sim.machines.filter((m) => m.repaired).length;
  panel(g, 58, 50);
  big(g, `${done}/${total}`, 58, 50, total > 0 && done >= total ? '#4ee36a' : AMBER);
  label(g, 'REPAIRED', 58, 50);
  // time
  panel(g, 108, 50);
  big(g, clock(sim.time), 108, 50, sim.time > sim.level.par ? '#ff6a50' : AMBER, 13);
  label(g, `PAR ${clock(sim.level.par)}`, 108, 50);
  // the plant: the WinCC OA cube and the level's machines
  panel(g, 158, 62);
  LOGO_GRID.forEach((row, r) => row.forEach((c, k) => ((g.fillStyle = c), g.fillRect(163 + k * 3, VIEW_H + 6 + r * 3, 3, 3))));
  sim.machines.slice(0, 3).forEach((m, k) => {
    const x = 180 + k * 13;
    g.fillStyle = machineLamp(m, sim.time);
    g.beginPath();
    g.arc(x + 4, VIEW_H + 10, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#a59c88';
    g.font = FONT(6);
    g.textAlign = 'center';
    g.fillText(`M${m.id}`, x + 4, VIEW_H + 20);
  });
  label(g, 'PLANT', 158, 62);
  // spare parts
  panel(g, 220, 34);
  big(g, String(p.parts), 220, 34, p.parts > 0 ? AMBER : DIM);
  label(g, 'PARTS', 220, 34);
  // key cards
  panel(g, 254, 18);
  (['blue', 'yellow', 'red'] as KeyColor[]).forEach((k, i) => {
    g.fillStyle = p.keys.has(k) ? KEY_COLORS[k] : '#24221d';
    g.fillRect(258, VIEW_H + 5 + i * 8, 10, 6);
  });
  // score and level
  panel(g, 272, 48);
  g.font = FONT(9);
  g.textAlign = 'center';
  g.fillStyle = AMBER;
  g.fillText(String(sim.score), 296, VIEW_H + 14);
  g.fillStyle = '#a59c88';
  g.font = FONT(6);
  g.fillText(`LEVEL ${levelNo}`, 296, VIEW_H + 22);
  label(g, 'SCORE', 272, 48);
  g.textAlign = 'start';
}

// --- messages and the title ------------------------------------------------------------------------

export interface Message {
  text: string;
  t: number;
}

export function drawMessages(g: G, messages: readonly Message[]): void {
  g.font = FONT(8);
  g.textAlign = 'start';
  messages.slice(-3).forEach((m, k) => {
    const a = Math.max(0, Math.min(1, 3 - m.t));
    g.fillStyle = `rgba(0,0,0,${0.8 * a})`;
    g.fillText(m.text, 5, 11 + k * 10);
    g.fillStyle = `rgba(255,220,150,${a})`;
    g.fillText(m.text, 4, 10 + k * 10);
  });
}

/** The level's name and its job over the view for its first seconds. */
export function drawTitle(g: G, sim: Sim, levelNo: number): void {
  const t = sim.time;
  if (t > 4) return;
  const a = Math.min(1, 4 - t);
  g.textAlign = 'center';
  g.font = FONT(7);
  g.fillStyle = `rgba(255,178,30,${a})`;
  g.fillText(`LEVEL ${levelNo}`, W / 2, 46);
  g.font = FONT(16);
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.fillText(sim.level.name.toUpperCase(), W / 2 + 1, 65);
  g.fillStyle = `rgba(255,240,210,${a})`;
  g.fillText(sim.level.name.toUpperCase(), W / 2, 64);
  const n = sim.faulted().length;
  g.font = FONT(7);
  g.fillStyle = `rgba(255,220,150,${a})`;
  g.fillText(n > 0 ? `${n} machine${n > 1 ? 's' : ''} down: repair the line, then reach the exit` : 'The line runs: reach the exit', W / 2, 78);
  g.textAlign = 'start';
}

// --- the full map ----------------------------------------------------------------------------------

export function drawAutomap(g: G, sim: Sim, seen: Uint8Array): void {
  const lv = sim.level;
  g.fillStyle = 'rgba(4,6,4,0.86)';
  g.fillRect(0, 0, W, VIEW_H);
  const s = Math.min((W - 20) / lv.w, (VIEW_H - 24) / lv.h);
  const ox = (W - lv.w * s) / 2;
  const oy = (VIEW_H - 10 - lv.h * s) / 2;
  for (let y = 0; y < lv.h; y++) {
    for (let x = 0; x < lv.w; x++) {
      const i = y * lv.w + x;
      if (!seen[i]) continue;
      const wall = lv.walls[i];
      g.fillStyle = wall ? (wall === 'exit' ? '#3dff7a' : wall === 'logo' || wall === 'vc' ? '#2fb6ff' : '#3c7a3a') : lv.fences[i] ? '#8a7000' : lv.floors[i] === 'coolant' ? '#1d4d14' : '#141a13';
      g.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
  for (const d of lv.doors) {
    if (!seen[d.y * lv.w + d.x]) continue;
    g.fillStyle = d.key ? KEY_COLORS[d.key] : '#b8b09a';
    if (d.axis === 'x') g.fillRect(ox + d.x * s, oy + (d.y + 0.4) * s, s, s * 0.2);
    else g.fillRect(ox + (d.x + 0.4) * s, oy + d.y * s, s * 0.2, s);
  }
  // every machine is on the plant's map, seen or not
  g.font = FONT(6);
  for (const m of sim.machines) {
    g.fillStyle = machineLamp(m, sim.time);
    g.fillRect(ox + (m.x - 0.4) * s, oy + (m.y - 0.4) * s, s * 0.8, s * 0.8);
    g.fillStyle = '#d8d0bc';
    g.fillText(`M${m.id}`, ox + (m.x + 0.5) * s, oy + (m.y + 0.3) * s);
  }
  const p = sim.player;
  const px = ox + p.x * s;
  const py = oy + p.y * s;
  g.fillStyle = '#fff3c0';
  g.beginPath();
  g.moveTo(px + Math.cos(p.angle) * s, py + Math.sin(p.angle) * s);
  g.lineTo(px + Math.cos(p.angle + 2.5) * s * 0.6, py + Math.sin(p.angle + 2.5) * s * 0.6);
  g.lineTo(px + Math.cos(p.angle - 2.5) * s * 0.6, py + Math.sin(p.angle - 2.5) * s * 0.6);
  g.fill();
  g.font = FONT(7);
  g.fillStyle = AMBER;
  g.fillText(`${sim.level.name.toUpperCase()} · MAP (TAB)`, 6, VIEW_H - 5);
}
