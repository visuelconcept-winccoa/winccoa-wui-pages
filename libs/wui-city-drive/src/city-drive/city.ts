// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The city of City Drive, generated from a seed (#79). Pure data, no three.js.
 *
 * Ground plane XZ (Y up). Roads run along the grid lines x = k·CELL and z = k·CELL
 * (k = 0..blocks); a block sits between two consecutive roads. Every block holds a few
 * buildings, a park, the fuel station or the plant: the plant's buildings are the machines a
 * datapoint can be bound to (bindings.ts).
 */

export const ROAD_WIDTH = 16;
export const BLOCK_SIZE = 64;
export const CELL = BLOCK_SIZE + ROAD_WIDTH;
/** Distance from a road's axis to the middle of its right-hand lane. */
export const LANE_OFFSET = ROAD_WIDTH / 4;
export const SIDEWALK = 3;

export type BlockKind = 'buildings' | 'park' | 'station' | 'plant';

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Building extends Box {
  id: string;
  height: number;
  /** A machine of the plant: its colour follows a bound datapoint. */
  machine: boolean;
  /** Label shown on the minimap / missions (machines only). */
  label: string;
  /** Base tint index (0..n), for ordinary buildings. */
  tint: number;
}

export interface Block extends Box {
  i: number;
  j: number;
  kind: BlockKind;
}

export interface Tree {
  x: number;
  z: number;
  size: number;
}

export interface City {
  seed: number;
  /** Blocks per side. */
  blocks: number;
  /** Extent of the city: [0, size] on both axes. */
  size: number;
  blockList: Block[];
  buildings: Building[];
  trees: Tree[];
  /** Fuel station pad. */
  station: Box;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Axis coordinate of road k. */
export const roadAxis = (k: number): number => k * CELL;

function blockBox(i: number, j: number): Box {
  const h = ROAD_WIDTH / 2 + SIDEWALK;
  return { x0: roadAxis(i) + h, z0: roadAxis(j) + h, x1: roadAxis(i + 1) - h, z1: roadAxis(j + 1) - h };
}

function blockKind(i: number, j: number, blocks: number, rand: () => number): BlockKind {
  const mid = Math.floor(blocks / 2);
  if (i === mid && j === mid) return 'plant';
  if (i === 0 && j === blocks - 1) return 'station';
  return rand() < 0.16 ? 'park' : 'buildings';
}

/** 2 × 2 lots, each with a building of random footprint and height. */
function cityBuildings(b: Block, rand: () => number): Building[] {
  const out: Building[] = [];
  const w = (b.x1 - b.x0) / 2;
  const d = (b.z1 - b.z0) / 2;
  for (let u = 0; u < 2; u++) {
    for (let v = 0; v < 2; v++) {
      const margin = 2 + rand() * 4;
      const x0 = b.x0 + u * w + margin;
      const z0 = b.z0 + v * d + margin;
      out.push({
        id: `b-${b.i}-${b.j}-${u}${v}`,
        x0,
        z0,
        x1: x0 + w - 2 * margin,
        z1: z0 + d - 2 * margin,
        height: 8 + Math.round(rand() * rand() * 70),
        machine: false,
        label: '',
        tint: Math.floor(rand() * 5)
      });
    }
  }
  return out;
}

/** The plant: four machine halls named machine-1..4. */
function plantBuildings(b: Block): Building[] {
  const w = (b.x1 - b.x0) / 2;
  const d = (b.z1 - b.z0) / 2;
  const halls: Building[] = [];
  let n = 1;
  for (let v = 0; v < 2; v++) {
    for (let u = 0; u < 2; u++) {
      const x0 = b.x0 + u * w + 4;
      const z0 = b.z0 + v * d + 4;
      halls.push({
        id: `machine-${n}`,
        x0,
        z0,
        x1: x0 + w - 8,
        z1: z0 + d - 8,
        height: 9,
        machine: true,
        label: `M${n}`,
        tint: 0
      });
      n++;
    }
  }
  return halls;
}

function parkTrees(b: Block, rand: () => number): Tree[] {
  const trees: Tree[] = [];
  for (let k = 0; k < 14; k++) {
    trees.push({ x: b.x0 + 4 + rand() * (b.x1 - b.x0 - 8), z: b.z0 + 4 + rand() * (b.z1 - b.z0 - 8), size: 0.8 + rand() * 0.6 });
  }
  return trees;
}

export function generateCity(seed = 7, blocks = 6): City {
  const rand = rng(seed);
  const blockList: Block[] = [];
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  let station: Box = blockBox(0, blocks - 1);
  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
      const block: Block = { ...blockBox(i, j), i, j, kind: blockKind(i, j, blocks, rand) };
      blockList.push(block);
      if (block.kind === 'buildings') buildings.push(...cityBuildings(block, rand));
      else if (block.kind === 'plant') buildings.push(...plantBuildings(block));
      else if (block.kind === 'park') trees.push(...parkTrees(block, rand));
      else station = block;
    }
  }
  return { seed, blocks, size: blocks * CELL, blockList, buildings, trees, station };
}

/** Nearest point on a road axis (the drivable network) to (x, z). */
export function nearestRoadPoint(city: City, x: number, z: number): { x: number; z: number } {
  const clamp = (v: number): number => Math.min(city.size, Math.max(0, v));
  const kx = Math.round(x / CELL);
  const kz = Math.round(z / CELL);
  const onX = { x: clamp(kx * CELL), z: clamp(z) };
  const onZ = { x: clamp(x), z: clamp(kz * CELL) };
  const dx = Math.abs(onX.x - x);
  const dz = Math.abs(onZ.z - z);
  return dx <= dz ? onX : onZ;
}

/** The point of the road in front of a building's nearest face (a mission target). */
export function frontOf(city: City, b: Box): { x: number; z: number } {
  return nearestRoadPoint(city, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
}

/** True when (x, z) lies on a road surface (inside the city). */
export function onRoad(city: City, x: number, z: number): boolean {
  if (x < -ROAD_WIDTH / 2 || z < -ROAD_WIDTH / 2 || x > city.size + ROAD_WIDTH / 2 || z > city.size + ROAD_WIDTH / 2) {
    return false;
  }
  const near = (v: number): boolean => Math.abs(v - Math.round(v / CELL) * CELL) <= ROAD_WIDTH / 2;
  return near(x) || near(z);
}
