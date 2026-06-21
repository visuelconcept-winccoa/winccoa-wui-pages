/**
 * Procedural building generator: floor + outdoor terrain + central walkway +
 * bay separators + steel columns + roof (shed / flat / monoslope) + semi-
 * transparent walls. Ported from the prototype's building section.
 *
 * Sub-floor pits (machines plunging below Y=0) are intentionally omitted from
 * this first pass — the demo layout keeps every machine on the slab.
 */
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry
} from 'three';
import type { BuildingConfig } from '../types.js';
import { FLOOR_PATTERNS } from './floor-patterns.js';

export interface BuildingResult {
  group: Group;
  /** Roof sub-group, toggled by the "show roof" control. */
  roofGroup: Group;
}

export class BuildingBuilder {
  build(cfg: BuildingConfig): BuildingResult {
    const root = new Group();
    root.name = 'building';
    const bayW = cfg.width / cfg.bays;
    const roofPeak = cfg.height + 6;

    this.addFloor(root, cfg);
    this.addWalkway(root, cfg);
    this.addSeparators(root, cfg, bayW);
    this.addColumns(root, cfg, bayW);
    const roofGroup = this.addRoof(cfg, bayW, roofPeak);
    root.add(roofGroup);
    this.addWalls(root, cfg);

    return { group: root, roofGroup };
  }

  private addFloor(root: Group, cfg: BuildingConfig): void {
    const terrainMat = new MeshStandardMaterial({ color: 0x8A_93_A0, roughness: 1 });
    const terrain = new Mesh(new PlaneGeometry(600, 400), terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -0.02;
    terrain.receiveShadow = true;
    root.add(terrain);

    const def = FLOOR_PATTERNS[cfg.floorType] ?? FLOOR_PATTERNS.concrete;
    const tex = def.generate();
    tex.repeat.set(cfg.length / def.tileSize, cfg.width / def.tileSize);
    const floorMat = new MeshStandardMaterial({ map: tex, ...def.matParams });
    const floor = new Mesh(new PlaneGeometry(cfg.length, cfg.width), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    root.add(floor);
  }

  private addWalkway(root: Group, cfg: BuildingConfig): void {
    const len = cfg.length - 16;
    const walkwayMat = new MeshStandardMaterial({
      color: 0x1A_51_40,
      roughness: 0.88,
      emissive: 0x0A_2A_1E,
      emissiveIntensity: 0.4
    });
    const walkway = new Mesh(new PlaneGeometry(len, 3.2), walkwayMat);
    walkway.rotation.x = -Math.PI / 2;
    walkway.position.set(0, 0.015, 0);
    walkway.receiveShadow = true;
    root.add(walkway);

    const whiteLineMat = new MeshBasicMaterial({ color: 0xE5_E7_EB });
    for (const s of [-1, 1]) {
      const line = new Mesh(new PlaneGeometry(len, 0.12), whiteLineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.018, s * 1.6);
      root.add(line);
    }
  }

  private addSeparators(root: Group, cfg: BuildingConfig, bayW: number): void {
    const yellowMat = new MeshBasicMaterial({ color: 0xFB_BF_24 });
    const blackMat = new MeshBasicMaterial({ color: 0x11_13_18 });
    for (let i = 1; i < cfg.bays; i++) {
      const z = -cfg.width / 2 + i * bayW;
      if (Math.abs(z) < 2) continue;
      const base = new Mesh(new PlaneGeometry(cfg.length, 0.5), yellowMat);
      base.rotation.x = -Math.PI / 2;
      base.position.set(0, 0.014, z);
      root.add(base);
      const dashCount = Math.floor(cfg.length / 3);
      for (let d = 0; d < dashCount; d += 2) {
        const dash = new Mesh(new PlaneGeometry(1, 0.45), blackMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(-cfg.length / 2 + 1.5 + d * 3, 0.016, z);
        root.add(dash);
      }
    }
    // Yellow edge strips along the long sides.
    const edgeMat = new MeshBasicMaterial({ color: 0xFB_BF_24, transparent: true, opacity: 0.75 });
    for (const z of [-cfg.width / 2, cfg.width / 2]) {
      const edge = new Mesh(new PlaneGeometry(cfg.length, 0.6), edgeMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(0, 0.03, z);
      root.add(edge);
    }
  }

  private addColumns(root: Group, cfg: BuildingConfig, bayW: number): void {
    const steelMat = new MeshStandardMaterial({
      color: 0x5B_65_78,
      metalness: 0.6,
      roughness: 0.6
    });
    const colStep = cfg.colStep || 20;
    const colGeo = new BoxGeometry(0.8, cfg.height, 0.8);
    for (let x = -cfg.length / 2; x <= cfg.length / 2 + 0.1; x += colStep) {
      for (let zi = 0; zi <= cfg.bays; zi++) {
        const z = -cfg.width / 2 + zi * bayW;
        const col = new Mesh(colGeo, steelMat);
        col.position.set(x, cfg.height / 2, z);
        col.castShadow = true;
        root.add(col);
      }
    }
  }

  // eslint-disable-next-line max-lines-per-function -- three roof variants share one builder
  private addRoof(cfg: BuildingConfig, bayW: number, roofPeak: number): Group {
    const roofGroup = new Group();
    roofGroup.name = 'roof';
    // "none": building has no roof — return the empty (named) group.
    if (cfg.roofType === 'none') return roofGroup;
    const roofMat = new MeshStandardMaterial({
      color: 0x6B_76_88,
      transparent: true,
      opacity: 0.12,
      side: DoubleSide,
      roughness: 0.9
    });
    const frameMat = new MeshStandardMaterial({ color: 0x5B_65_78, metalness: 0.5 });
    const colStep = cfg.colStep || 20;

    if (cfg.roofType === 'flat') {
      const topH = cfg.height + 1.5;
      const slab = new Mesh(new BoxGeometry(cfg.length, 0.5, cfg.width), roofMat);
      slab.position.set(0, topH, 0);
      roofGroup.add(slab);
      for (let i = 0; i <= cfg.bays; i++) {
        const z = -cfg.width / 2 + i * bayW;
        const beam = new Mesh(new BoxGeometry(cfg.length, 0.4, 0.4), frameMat);
        beam.position.set(0, cfg.height, z);
        roofGroup.add(beam);
      }
      const trussStep = Math.max(colStep * 2, 8);
      for (let x = -cfg.length / 2; x <= cfg.length / 2 + 0.1; x += trussStep) {
        const beam = new Mesh(new BoxGeometry(0.4, 0.4, cfg.width), frameMat);
        beam.position.set(x, cfg.height, 0);
        roofGroup.add(beam);
      }
    } else if (cfg.roofType === 'monoslope') {
      const lowH = cfg.height;
      const highH = cfg.height + Math.max(4, cfg.width * 0.06);
      const slopeLen = Math.hypot(cfg.width, highH - lowH);
      const slopeAngle = Math.atan2(highH - lowH, cfg.width);
      const slab = new Mesh(new PlaneGeometry(cfg.length, slopeLen), roofMat);
      slab.rotation.order = 'YXZ';
      slab.rotation.x = -Math.PI / 2;
      slab.rotation.z = -slopeAngle;
      slab.position.set(0, (lowH + highH) / 2, 0);
      roofGroup.add(slab);
      const highRidge = new Mesh(new BoxGeometry(cfg.length, 0.5, 0.5), frameMat);
      highRidge.position.set(0, highH, cfg.width / 2);
      roofGroup.add(highRidge);
      const lowRidge = new Mesh(new BoxGeometry(cfg.length, 0.3, 0.3), frameMat);
      lowRidge.position.set(0, lowH, -cfg.width / 2);
      roofGroup.add(lowRidge);
      const trussStep = Math.max(colStep * 2, 8);
      for (let x = -cfg.length / 2; x <= cfg.length / 2 + 0.1; x += trussStep) {
        const truss = new Mesh(new BoxGeometry(0.3, 0.3, slopeLen), frameMat);
        truss.position.set(x, (lowH + highH) / 2, 0);
        truss.rotation.x = slopeAngle;
        roofGroup.add(truss);
      }
    } else {
      this.addShedRoof(roofGroup, cfg, bayW, roofPeak, roofMat, frameMat, colStep);
    }
    return roofGroup;
  }

  private addShedRoof(
    roofGroup: Group,
    cfg: BuildingConfig,
    bayW: number,
    roofPeak: number,
    roofMat: MeshStandardMaterial,
    frameMat: MeshStandardMaterial,
    colStep: number
  ): void {
    const trussStep = Math.max(colStep * 2, 8);
    for (let bay = 0; bay < cfg.bays; bay++) {
      const z0 = -cfg.width / 2 + bay * bayW;
      const zC = z0 + bayW / 2;
      const slopeL = Math.hypot(bayW / 2, roofPeak - cfg.height);
      const slopeGeo = new PlaneGeometry(cfg.length, slopeL);
      const angle = Math.atan2(roofPeak - cfg.height, bayW / 2);

      const r1 = new Mesh(slopeGeo, roofMat);
      r1.rotation.order = 'YXZ';
      r1.rotation.x = -Math.PI / 2;
      r1.rotation.z = -angle;
      r1.position.set(0, (cfg.height + roofPeak) / 2, z0 + bayW / 4);
      roofGroup.add(r1);

      const r2 = new Mesh(slopeGeo, roofMat);
      r2.rotation.order = 'YXZ';
      r2.rotation.x = -Math.PI / 2;
      r2.rotation.z = angle;
      r2.position.set(0, (cfg.height + roofPeak) / 2, z0 + (3 * bayW) / 4);
      roofGroup.add(r2);

      const ridge = new Mesh(new BoxGeometry(cfg.length, 0.5, 0.5), frameMat);
      ridge.position.set(0, roofPeak, zC);
      roofGroup.add(ridge);

      for (let x = -cfg.length / 2; x <= cfg.length / 2 + 0.1; x += trussStep) {
        const truss = new Group();
        const bot = new Mesh(new BoxGeometry(0.3, 0.3, bayW), frameMat);
        bot.position.set(x, cfg.height, zC);
        truss.add(bot);
        for (const s of [-1, 1]) {
          const arb = new Mesh(new BoxGeometry(0.3, 0.3, slopeL), frameMat);
          arb.position.set(x, (cfg.height + roofPeak) / 2, zC + (s * bayW) / 4);
          arb.rotation.x = -s * angle;
          truss.add(arb);
        }
        roofGroup.add(truss);
      }
    }
  }

  private addWalls(root: Group, cfg: BuildingConfig): void {
    const wallMat = new MeshStandardMaterial({
      color: 0x8D_96_A8,
      transparent: true,
      opacity: 0.18,
      side: DoubleSide,
      roughness: 0.8
    });
    const longWall = new PlaneGeometry(cfg.length, cfg.height);
    for (const s of [-1, 1]) {
      const w = new Mesh(longWall, wallMat);
      w.position.set(0, cfg.height / 2, (s * cfg.width) / 2);
      w.rotation.y = s > 0 ? Math.PI : 0;
      root.add(w);
    }
    const gableGeo = new PlaneGeometry(cfg.width, cfg.height);
    for (const s of [-1, 1]) {
      const w = new Mesh(gableGeo, wallMat);
      w.position.set((s * cfg.length) / 2, cfg.height / 2, 0);
      w.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.add(w);
    }
  }
}
