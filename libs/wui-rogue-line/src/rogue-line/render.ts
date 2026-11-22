// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the raycaster: a first-person view of the grid at a low resolution (320 × 168
 * for the view, the status bar below), scaled up with hard pixels.
 *
 * - walls by DDA through the grid; a door is a plane across the middle of its cell, slid aside
 *   by its opening; the walls beside a doorway show the door's track;
 * - floor and ceiling cast row by row; the open yard shows the sky (a panorama around);
 * - light per cell (lamps, yard), red beacons flicker, everything fades into the dark with the
 *   distance; glowing texels (screens, lamps, coolant) are not shaded;
 * - sprites (robots, pickups, machines, shots) sorted far to near, clipped by the walls' depths.
 */
import type { Door, Level } from './maps.js';
import type { Texture, TextureSet } from './textures.js';

export const W = 320;
export const H = 200;
export const VIEW_H = 168;
/** Half the camera plane: a field of view of about 66°. */
export const PLANE = 0.66;

export interface Camera {
  x: number;
  y: number;
  angle: number;
  /** Vertical bob of the view, pixels. */
  bob: number;
}

export interface Sprite {
  x: number;
  y: number;
  tex: Texture;
  /** Height in cells (1 = floor to ceiling). */
  scale: number;
  /** Height of its bottom above the floor, cells. */
  z: number;
  /** Mirrored (a robot walking the other way). */
  flip?: boolean;
}

export interface FrameState {
  time: number;
  exitOn: boolean;
}

const pack = (r: number, g: number, b: number): number => (255 << 24) | (b << 16) | (g << 8) | r;

export class Raycaster {
  readonly image: ImageData;
  private readonly buf: Uint32Array;
  readonly depth = new Float32Array(W);
  /** Depth per pixel of the view: fences and gates are see-through, sprites go behind them. */
  private readonly zbuf = new Float32Array(W * VIEW_H);
  /** The see-through hits of the current column (fences, gates), reused. */
  private readonly clear: { dist: number; u: number; t: Texture; cell: number; side: number }[] = [];
  /** The cells seen so far on this level (the automap), 1 when seen. */
  seen: Uint8Array = new Uint8Array(0);
  private readonly rayAngle = new Float32Array(W);

  constructor(private readonly tex: TextureSet) {
    this.image = new ImageData(W, H);
    this.buf = new Uint32Array(this.image.data.buffer);
  }

  /** The last shade computed (no allocation per pixel). */
  private sl = 0;
  private sr = 0;

  /** Shade of a cell at a distance: its light, faded into the dark (in `sl`, the red in `sr`). */
  private shade(level: Level, cell: number, dist: number, flicker: number): void {
    const fog = Math.max(0, 1 - dist / 15);
    const red = cell >= 0 ? level.alarm[cell] * flicker * fog : 0;
    this.sl = Math.min(1.6, (cell >= 0 ? level.light[cell] : 0.2) * Math.pow(fog, 1.5) * 1.15 + red * 0.25);
    this.sr = red;
  }

  private texel(t: Texture, u: number, v: number, light: number, red: number): number {
    const i = (v & (t.h - 1)) * t.w + (u & (t.w - 1));
    const c = t.px[i];
    if (t.glow[i]) return c | 0xff000000;
    const k = Math.round(light * 256);
    let r = ((c & 255) * k) >> 8;
    let g = (((c >> 8) & 255) * k) >> 8;
    let b = (((c >> 16) & 255) * k) >> 8;
    if (red > 0) {
      r += red * 90;
      g *= 1 - red * 0.35;
      b *= 1 - red * 0.35;
    }
    return pack(Math.min(255, r), Math.min(255, g | 0), Math.min(255, b | 0));
  }

  /** A painted floor marking (worn paint: a bit of the floor's light). */
  private paint(c: number, light: number, red: number): number {
    const k = Math.round(light * 0.85 * 256);
    let r = ((c & 255) * k) >> 8;
    const g = (((c >> 8) & 255) * k) >> 8;
    const b = (((c >> 16) & 255) * k) >> 8;
    r += red * 90;
    return pack(Math.min(255, r), Math.min(255, g), Math.min(255, b));
  }

  render(level: Level, cam: Camera, sprites: Sprite[], frame: FrameState): void {
    const { buf } = this;
    const dirX = Math.cos(cam.angle);
    const dirY = Math.sin(cam.angle);
    const planeX = -dirY * PLANE;
    const planeY = dirX * PLANE;
    const horizon = Math.round(VIEW_H / 2 + cam.bob);
    // red beacons: a slow pulse with a stutter
    const flicker = 0.55 + 0.45 * Math.sin(frame.time * 6) * (Math.sin(frame.time * 23) > -0.6 ? 1 : 0.2);
    for (let x = 0; x < W; x++) this.rayAngle[x] = cam.angle + Math.atan(((2 * x) / W - 1) * PLANE);
    this.zbuf.fill(1e9);
    this.floorAndCeiling(level, cam, dirX, dirY, planeX, planeY, horizon, flicker, frame.time);
    for (let x = 0; x < W; x++) this.column(level, cam, x, dirX + planeX * ((2 * x) / W - 1), dirY + planeY * ((2 * x) / W - 1), horizon, flicker, frame);
    this.sprites(level, cam, sprites, dirX, dirY, planeX, planeY, horizon, flicker);
    // the status bar's area stays for the HUD
    buf.fill(0xff000000, W * VIEW_H);
  }

  private floorAndCeiling(level: Level, cam: Camera, dirX: number, dirY: number, planeX: number, planeY: number, horizon: number, flicker: number, time: number): void {
    const { buf, tex } = this;
    const rx0 = dirX - planeX;
    const ry0 = dirY - planeY;
    const rx1 = dirX + planeX;
    const ry1 = dirY + planeY;
    const sky = tex.sky;
    const flow = Math.floor(time * 6);
    for (let y = 0; y < VIEW_H; y++) {
      const floor = y > horizon;
      const p = floor ? y - horizon : horizon - y;
      if (p === 0) {
        buf.fill(0xff000000, y * W, y * W + W);
        continue;
      }
      const rowDist = (0.5 * VIEW_H) / p;
      const stepX = (rowDist * (rx1 - rx0)) / W;
      const stepY = (rowDist * (ry1 - ry0)) / W;
      let fx = cam.x + rowDist * rx0;
      let fy = cam.y + rowDist * ry0;
      for (let x = 0; x < W; x++, fx += stepX, fy += stepY) {
        const cx = Math.floor(fx);
        const cy = Math.floor(fy);
        const inside = cx >= 0 && cy >= 0 && cx < level.w && cy < level.h;
        const cell = inside ? cy * level.w + cx : -1;
        const kind = inside ? level.floors[cell] : 'tiles';
        if (!floor && kind === 'yard') {
          // the sky: by the ray's angle around, and the row up the panorama
          const a = this.rayAngle[x] / (Math.PI * 2);
          const u = Math.floor((a - Math.floor(a)) * sky.w);
          const v = Math.min(sky.h - 1, Math.floor((y / Math.max(1, horizon)) * sky.h));
          buf[y * W + x] = sky.px[v * sky.w + u] | 0xff000000;
          continue;
        }
        const t = floor ? tex.floors[kind] : tex.ceiling;
        const u = Math.floor((fx - cx) * t.w) + (floor && kind === 'coolant' ? flow : 0);
        const v = Math.floor((fy - cy) * t.h);
        this.shade(level, cell, rowDist, flicker);
        const mark = floor && cell >= 0 ? level.marks[cell] : 0;
        const paint = mark ? markColor(mark, fx - cx, fy - cy) : 0;
        buf[y * W + x] = paint ? this.paint(paint, this.sl, this.sr) : this.texel(t, u, v, floor ? this.sl : this.sl * 0.8, this.sr);
      }
    }
  }

  private column(level: Level, cam: Camera, x: number, rayX: number, rayY: number, horizon: number, flicker: number, frame: FrameState): void {
    const { tex } = this;
    let mapX = Math.floor(cam.x);
    let mapY = Math.floor(cam.y);
    const deltaX = Math.abs(1 / rayX);
    const deltaY = Math.abs(1 / rayY);
    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideX = rayX < 0 ? (cam.x - mapX) * deltaX : (mapX + 1 - cam.x) * deltaX;
    let sideY = rayY < 0 ? (cam.y - mapY) * deltaY : (mapY + 1 - cam.y) * deltaY;
    let side = 0;
    let dist = 0;
    let t: Texture | null = null;
    let u = 0;
    let lightCell = mapY * level.w + mapX;
    let wasDoor = level.doors.some((d) => d.x === mapX && d.y === mapY && !d.fence);
    const clear = this.clear;
    clear.length = 0;
    for (let steps = 0; steps < 64; steps++) {
      const prevCell = mapY * level.w + mapX;
      if (sideX < sideY) {
        sideX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += deltaY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= level.w || mapY >= level.h) break;
      const cell = mapY * level.w + mapX;
      const wall = level.walls[cell];
      if (dist < 1e8) this.seen[cell] = 1;
      if (wall !== null) {
        dist = side === 0 ? sideX - deltaX : sideY - deltaY;
        const hit = side === 0 ? cam.y + dist * rayY : cam.x + dist * rayX;
        u = Math.floor((hit - Math.floor(hit)) * 64);
        if ((side === 0 && rayX < 0) || (side === 1 && rayY > 0)) u = 63 - u;
        t = wasDoor ? tex.jamb : wall === 'exit' && frame.exitOn ? tex.exitOn : tex.walls[wall];
        lightCell = prevCell;
        break;
      }
      if (level.fences[cell]) fenceHits(level.fences[cell], mapX, mapY, cam.x, cam.y, rayX, rayY, (d, f, sd) => clear.push({ dist: d, u: Math.floor(f * 64), t: tex.fence, cell, side: sd }));
      const door = findDoor(level.doors, mapX, mapY);
      wasDoor = door !== undefined && !door.fence;
      if (door) {
        const hit = hitDoor(door, cam.x, cam.y, rayX, rayY);
        if (hit && door.fence) clear.push({ dist: hit.dist, u: Math.floor(hit.u * 64), t: tex.gate, cell, side: door.axis === 'x' ? 1 : 0 });
        else if (hit) {
          dist = hit.dist;
          u = Math.floor(hit.u * 64);
          t = door.key ? tex.doors[door.key] : tex.doors.plain;
          lightCell = cell;
          side = door.axis === 'x' ? 1 : 0;
          break;
        }
      }
    }
    this.depth[x] = t ? dist : 1e9;
    if (t) this.strip(level, x, t, u, dist, lightCell, side, horizon, flicker, false);
    // the see-through ones, far to near, over it
    clear.sort((a, b) => b.dist - a.dist);
    for (const c of clear) if (c.dist < this.depth[x]) this.strip(level, x, c.t, c.u, c.dist, c.cell, c.side, horizon, flicker, true);
  }

  /** One vertical strip of a wall, a door or a fence; `holes`: transparent texels let through. */
  private strip(level: Level, x: number, t: Texture, u: number, dist: number, lightCell: number, side: number, horizon: number, flicker: number, holes: boolean): void {
    const { buf, zbuf } = this;
    const lineH = VIEW_H / Math.max(dist, 0.01);
    const top = horizon - lineH / 2;
    const y0 = Math.max(0, Math.ceil(top));
    const y1 = Math.min(VIEW_H - 1, Math.floor(horizon + lineH / 2));
    this.shade(level, lightCell, dist, flicker);
    const red = this.sr;
    const l = side === 1 ? this.sl * 0.78 : this.sl;
    const step = 64 / lineH;
    let v = (y0 - top) * step;
    for (let y = y0; y <= y1; y++, v += step) {
      const tv = Math.floor(v);
      if (holes && t.px[(tv & 63) * t.w + (u & 63)] >>> 24 < 128) continue;
      buf[y * W + x] = this.texel(t, u, tv, l, red);
      zbuf[y * W + x] = dist;
    }
  }

  private sprites(level: Level, cam: Camera, list: Sprite[], dirX: number, dirY: number, planeX: number, planeY: number, horizon: number, flicker: number): void {
    const { buf, zbuf } = this;
    const inv = 1 / (planeX * dirY - dirX * planeY);
    const items = list
      .map((s) => {
        const dx = s.x - cam.x;
        const dy = s.y - cam.y;
        return { s, tx: inv * (dirY * dx - dirX * dy), ty: inv * (-planeY * dx + planeX * dy) };
      })
      .filter((o) => o.ty > 0.15)
      .sort((a, b) => b.ty - a.ty);
    for (const { s, tx, ty } of items) {
      const screenX = Math.floor((W / 2) * (1 + tx / ty));
      const cellH = VIEW_H / ty;
      const h = cellH * s.scale;
      const w = h;
      const bottom = horizon + cellH * (0.5 - s.z);
      const top = bottom - h;
      const x0 = Math.max(0, Math.floor(screenX - w / 2));
      const x1 = Math.min(W - 1, Math.floor(screenX + w / 2));
      const y0 = Math.max(0, Math.floor(top));
      const y1 = Math.min(VIEW_H - 1, Math.floor(bottom));
      const cell = Math.floor(s.y) * level.w + Math.floor(s.x);
      this.shade(level, cell, ty, flicker);
      const light = this.sl;
      const red = this.sr;
      const t = s.tex;
      for (let x = x0; x <= x1; x++) {
        let u = Math.floor(((x - (screenX - w / 2)) * t.w) / w);
        if (s.flip) u = t.w - 1 - u;
        if (u < 0 || u >= t.w) continue;
        for (let y = y0; y <= y1; y++) {
          const v = Math.floor(((y - top) * t.h) / h);
          if (v < 0 || v >= t.h) continue;
          const c = t.px[v * t.w + u];
          if (c >>> 24 < 128 || ty >= zbuf[y * W + x]) continue;
          buf[y * W + x] = this.texel(t, u, v, light, red);
          zbuf[y * W + x] = ty;
        }
      }
    }
  }
}

const YELLOW = pack(224, 176, 0);
const BLACK = pack(22, 19, 14);

/**
 * The floor marking at (u, v) in a cell, or 0: a safety line 10–17 cm from a wall, the yellow and
 * black hazard border of a machine's cell, the yellow outline of a pallet's place, the WinCC OA
 * logo.
 */
const LOGO_PACKED = [
  [0x20b9d8, 0x10567d, 0x04646f, 0x20b9d8],
  [0x10567d, 0xfdd731, 0x20b9d8, 0xfdd731],
  [0xfdd731, 0x04646f, 0x10567d, 0x04646f],
  [0x10567d, 0xfdd731, 0x04646f, 0x20b9d8]
].map((row) => row.map((c) => pack(c >> 16, (c >> 8) & 255, c & 255)));

export function markColor(mark: number, u: number, v: number): number {
  if (mark & 64) {
    // the WinCC OA logo painted on the floor: 4 × 4 squares, a dark gap between them
    if (u < 0.1 || v < 0.1 || u > 0.9 || v > 0.9) return 0;
    const fu = (u - 0.1) / 0.2;
    const fv = (v - 0.1) / 0.2;
    if (fu - Math.floor(fu) > 0.88 || fv - Math.floor(fv) > 0.88) return BLACK;
    return LOGO_PACKED[Math.min(3, Math.floor(fv))][Math.min(3, Math.floor(fu))];
  }
  if (mark & 16) {
    const edge = Math.min(u, v, 1 - u, 1 - v);
    if (edge > 0.12) return 0;
    return Math.floor((u + v) * 7) % 2 ? YELLOW : BLACK;
  }
  if (mark & 32) {
    const edge = Math.min(u, v, 1 - u, 1 - v);
    return edge > 0.04 && edge < 0.09 ? YELLOW : 0;
  }
  const on = (d: number): boolean => d > 0.1 && d < 0.17;
  if ((mark & 1 && on(v)) || (mark & 2 && on(1 - u)) || (mark & 4 && on(1 - v)) || (mark & 8 && on(u))) return YELLOW;
  return 0;
}

/**
 * Where a ray meets the panels of a fence cell (from its middle towards the sides in `mask`:
 * N 1, E 2, S 4, W 8): `hit(dist, u, side)` for each, u along the panel across the whole cell.
 */
export function fenceHits(mask: number, cx: number, cy: number, px: number, py: number, rx: number, ry: number, hit: (dist: number, u: number, side: number) => void): void {
  const mx = cx + 0.5;
  const my = cy + 0.5;
  // north–south panels: the plane x = mx
  if (mask & 5 && Math.abs(rx) > 1e-9) {
    const d = (mx - px) / rx;
    const y = py + d * ry;
    if (d > 0 && ((mask & 1 && y >= cy && y <= my) || (mask & 4 && y >= my && y < cy + 1))) hit(d, y - cy, 0);
  }
  // west–east panels: the plane y = my
  if (mask & 10 && Math.abs(ry) > 1e-9) {
    const d = (my - py) / ry;
    const x = px + d * rx;
    if (d > 0 && ((mask & 8 && x >= cx && x <= mx) || (mask & 2 && x >= mx && x < cx + 1))) hit(d, x - cx, 1);
  }
}

function findDoor(doors: readonly Door[], x: number, y: number): Door | undefined {
  for (const d of doors) if (d.x === x && d.y === y) return d;
  return undefined;
}

/**
 * Where a ray meets a door's plane (across the middle of its cell), if it hits the part not
 * slid away: the distance (in the ray's units, i.e. perpendicular) and the texture's u.
 */
export function hitDoor(door: Door, px: number, py: number, rx: number, ry: number): { dist: number; u: number } | null {
  if (door.open >= 0.999) return null;
  const across = door.axis === 'x';
  const r = across ? ry : rx;
  if (Math.abs(r) < 1e-9) return null;
  const plane = across ? door.y + 0.5 : door.x + 0.5;
  const dist = (plane - (across ? py : px)) / r;
  if (dist <= 0) return null;
  const along = across ? px + dist * rx : py + dist * ry;
  const cell = across ? door.x : door.y;
  const f = along - cell;
  if (f < 0 || f >= 1) return null;
  // the door slides to the side: what is left of it spans [open, 1)
  if (f < door.open) return null;
  return { dist, u: f - door.open };
}
