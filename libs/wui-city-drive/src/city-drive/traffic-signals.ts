// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Traffic signals of City Drive (#79), in the Japanese style: on every approach to a crossroads,
 * a galvanised pole on the corner at the driver's right, a mast arm reaching over the lanes, and
 * a horizontal signal head facing the drivers — green, amber, red from left to right — with a
 * backplate and a visor over each lamp. Only the lamp of the current phase is lit
 * (traffic.ts `lightAt`). Everything is instanced: a handful of draw calls for the whole city.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3
} from 'three';
import { ROAD_WIDTH, roadAxis, type City } from './city.js';
import type { NeonPalette } from './palette.js';
import { lightAt, type Light, type LightOverrides } from './traffic.js';

const POLE_H = 6.4;
const ARM_Y = 6.1;
const ARM_LEN = 6;
const LAMP_R = 0.2;
const LAMP_GAP = 0.5;
/** Unlit lens: dark, a hint of its colour. */
const DIM = 0.07;

interface Approach {
  i: number;
  j: number;
  /** 0 = traffic along Z, 1 = along X. */
  axis: 0 | 1;
}

export class TrafficSignals {
  readonly group = new Group();
  private readonly approaches: Approach[] = [];
  private readonly lamps: Record<Light, InstancedMesh>;
  private readonly lit: Record<Light, Color>;
  private readonly dim: Record<Light, Color>;

  constructor(city: City, p: NeonPalette) {
    const n = city.blocks;
    const DX = [0, 1, 0, -1];
    const DZ = [1, 0, -1, 0];
    const placements: { node: Vector3; f: Vector3; r: Vector3 }[] = [];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        for (let d = 0; d < 4; d++) {
          // traffic arriving at (i, j) while moving in direction d comes from the neighbour behind it
          const fi = i - DX[d];
          const fj = j - DZ[d];
          if (fi < 0 || fj < 0 || fi > n || fj > n) continue;
          this.approaches.push({ i, j, axis: d % 2 === 0 ? 0 : 1 });
          const f = new Vector3(DX[d], 0, DZ[d]);
          const r = new Vector3(-f.z, 0, f.x); // the driver's right
          placements.push({ node: new Vector3(roadAxis(i), 0, roadAxis(j)), f, r });
        }
      }
    }
    const count = placements.length;
    const metal = new MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.75, roughness: 0.38 });
    const housingMat = new MeshStandardMaterial({ color: 0x22282c, metalness: 0.3, roughness: 0.6 });
    const pole = new InstancedMesh(new CylinderGeometry(0.11, 0.15, POLE_H, 12), metal, count);
    const arm = new InstancedMesh(new CylinderGeometry(0.06, 0.08, ARM_LEN, 8), metal, count);
    const brace = new InstancedMesh(new CylinderGeometry(0.035, 0.035, 2.4, 6), metal, count);
    const housing = new InstancedMesh(new BoxGeometry(1.75, 0.6, 0.32), housingMat, count);
    const backplate = new InstancedMesh(new BoxGeometry(2.05, 0.84, 0.04), new MeshStandardMaterial({ color: 0x0d1012, roughness: 0.8 }), count);
    const visor = new InstancedMesh(new CylinderGeometry(LAMP_R + 0.06, LAMP_R + 0.06, 0.24, 14, 1, true, 0, Math.PI), housingMat, count * 3);
    const lampGeo = new CylinderGeometry(LAMP_R, LAMP_R, 0.05, 18);
    this.lit = { green: new Color(p.success).multiplyScalar(1.5), yellow: new Color(p.warning).multiplyScalar(1.5), red: new Color(p.alarm).multiplyScalar(1.5) };
    this.dim = {
      green: new Color(p.success).multiplyScalar(DIM),
      yellow: new Color(p.warning).multiplyScalar(DIM),
      red: new Color(p.alarm).multiplyScalar(DIM)
    };
    this.lamps = {
      green: new InstancedMesh(lampGeo, new MeshBasicMaterial({ toneMapped: false }), count),
      yellow: new InstancedMesh(lampGeo, new MeshBasicMaterial({ toneMapped: false }), count),
      red: new InstancedMesh(lampGeo, new MeshBasicMaterial({ toneMapped: false }), count)
    };
    const o = new Object3D();
    const at = (m: InstancedMesh, k: number, pos: Vector3, rot: [number, number, number], order: 'YXZ' | 'YZX' = 'YXZ'): void => {
      o.position.copy(pos);
      o.rotation.set(rot[0], rot[1], rot[2], order);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
    };
    const off = ROAD_WIDTH / 2;
    placements.forEach(({ node, f, r }, k) => {
      // pole on the right-hand corner, before the zebra crossing
      const base = node.clone().addScaledVector(f, -(off + 4.6)).addScaledVector(r, off + 1.1);
      at(pole, k, base.clone().setY(POLE_H / 2), [0, 0, 0]);
      // facing the driver: the head's front points along -f
      const yaw = Math.atan2(-f.x, -f.z);
      // mast arm: horizontal, from the pole out over the lanes (towards -r)
      const armMid = base.clone().addScaledVector(r, -ARM_LEN / 2).setY(ARM_Y);
      const armRot = new Matrix4().makeRotationAxis(new Vector3(f.x, 0, f.z), Math.PI / 2);
      o.position.copy(armMid);
      o.rotation.setFromRotationMatrix(armRot);
      o.updateMatrix();
      arm.setMatrixAt(k, o.matrix);
      // diagonal brace under the arm
      const braceMid = base.clone().addScaledVector(r, -0.95).setY(ARM_Y - 0.75);
      o.position.copy(braceMid);
      // leaning out over the road (towards -r) as it rises
      o.rotation.setFromRotationMatrix(new Matrix4().makeRotationAxis(new Vector3(f.x, 0, f.z), -Math.PI / 4.2));
      o.updateMatrix();
      brace.setMatrixAt(k, o.matrix);
      // signal head hanging under the arm, over the middle of the approach lane
      const head = base.clone().addScaledVector(r, -(off / 2 + 1.6)).setY(ARM_Y - 0.5);
      at(housing, k, head, [0, yaw, 0]);
      at(backplate, k, head.clone().addScaledVector(f, 0.18), [0, yaw, 0]);
      // lamps from the driver's left to right: green, amber, red
      const lampsOrder: Light[] = ['green', 'yellow', 'red'];
      lampsOrder.forEach((light, l) => {
        const lp = head.clone().addScaledVector(r, (l - 1) * LAMP_GAP).addScaledVector(f, -0.17);
        // the lens: a disc facing the driver (cylinder axis along f)
        at(this.lamps[light], k, lp, [Math.PI / 2, yaw, 0]);
        // visor: a half tube over the lens, open at the bottom (Ry·Rz·Rx: axis along f, the half on top)
        at(visor, k * 3 + l, lp.clone().addScaledVector(f, -0.12), [Math.PI / 2, yaw, Math.PI / 2], 'YZX');
      });
    });
    for (const m of [pole, arm, housing, backplate]) m.castShadow = true;
    this.group.add(pole, arm, brace, housing, backplate, visor, this.lamps.green, this.lamps.yellow, this.lamps.red);
    this.update(0, { allRed: new Set() });
  }

  /** Lights the lamp of each approach's phase at time t (s); the others stay dark. */
  update(t: number, overrides: LightOverrides): void {
    this.approaches.forEach(({ i, j, axis }, k) => {
      const state = lightAt(i, j, axis, t, overrides);
      for (const light of ['green', 'yellow', 'red'] as const) {
        this.lamps[light].setColorAt(k, state === light ? this.lit[light] : this.dim[light]);
      }
    });
    for (const m of Object.values(this.lamps)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
