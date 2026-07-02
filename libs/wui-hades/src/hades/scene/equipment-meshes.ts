// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Primitive 3D representations of the equipment catalog. Each factory returns
 * a small Group whose `userData.equipmentId` makes it raycast-pickable and
 * whose `userData.statusMaterial` is the material recoloured live from the
 * bound state datapoint. Scene colours are an own palette (a WebGL canvas
 * cannot resolve CSS theme tokens); it mirrors the semantic colours of the UI.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry
} from 'three';
import { STATE_FAULT, STATE_RUN, STATE_WARNING, type EquipmentKind } from '../types.js';

/** Scene palette for equipment states (mirrors the UI semantic colours). */
const STATE_HEX: Record<number, number> = {
  [STATE_RUN]: 0x01_c8_5c,
  [STATE_WARNING]: 0xff_aa_00,
  [STATE_FAULT]: 0xff_35_35
};
const STATE_OFF_HEX = 0x8f_9bb0;

const BODY_HEX = 0x5c_67_78;
const EXIT_HEX = 0x01_c8_5c;
const HYDRANT_HEX = 0xd6_45_45;

export interface EquipmentSceneData {
  equipmentId: string;
  statusMaterial: MeshStandardMaterial;
  /** Spun every tick when the state is RUN (jet-fan impeller). */
  spin?: Mesh;
}

function statusMaterial(baseHex: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: baseHex,
    emissive: baseHex,
    emissiveIntensity: 0.55,
    roughness: 0.5,
    metalness: 0.15
  });
}

function bodyMaterial(hex = BODY_HEX): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: hex, roughness: 0.75, metalness: 0.3 });
}

/** Apply the live state code to a built equipment group. */
export function applyState(group: Group, state: number | undefined): void {
  const data = group.userData as Partial<EquipmentSceneData>;
  const material = data.statusMaterial;
  if (!material) return;
  const hex = state !== undefined && STATE_HEX[state] !== undefined ? STATE_HEX[state] : STATE_OFF_HEX;
  material.color.setHex(hex);
  material.emissive.setHex(hex);
}

/** Build the pickable primitive group of one equipment kind. */
export function buildEquipmentMesh(kind: EquipmentKind, equipmentId: string): Group {
  const group = new Group();
  const status = statusMaterial(STATE_OFF_HEX);
  const data: EquipmentSceneData = { equipmentId, statusMaterial: status };

  switch (kind) {
    case 'jet-fan': {
      const shell = new Mesh(new CylinderGeometry(0.55, 0.55, 2.6, 16, 1, true), bodyMaterial());
      shell.rotation.x = Math.PI / 2;
      const impeller = new Mesh(new BoxGeometry(0.9, 0.12, 0.12), status);
      data.spin = impeller;
      group.add(shell, impeller);
      break;
    }
    case 'lighting': {
      const strip = new Mesh(new BoxGeometry(0.35, 0.12, 3.2), status);
      group.add(strip);
      break;
    }
    case 'sos-niche': {
      const niche = new Mesh(new BoxGeometry(0.5, 1.4, 1.2), bodyMaterial());
      const lamp = new Mesh(new SphereGeometry(0.16, 12, 12), status);
      lamp.position.y = 0.95;
      group.add(niche, lamp);
      break;
    }
    case 'emergency-exit': {
      const door = new Mesh(new BoxGeometry(0.25, 2.1, 1.3), bodyMaterial(EXIT_HEX));
      const sign = new Mesh(new BoxGeometry(0.12, 0.4, 0.9), status);
      sign.position.y = 1.45;
      group.add(door, sign);
      break;
    }
    case 'camera': {
      const body = new Mesh(new BoxGeometry(0.3, 0.3, 0.7), bodyMaterial());
      const lens = new Mesh(new ConeGeometry(0.16, 0.35, 12), status);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.5;
      group.add(body, lens);
      break;
    }
    case 'vms': {
      const panel = new Mesh(new BoxGeometry(2.4, 1.1, 0.2), bodyMaterial(0x22_28_33));
      const screen = new Mesh(new BoxGeometry(2.1, 0.8, 0.06), status);
      screen.position.z = 0.12;
      group.add(panel, screen);
      break;
    }
    case 'lane-signal': {
      const box = new Mesh(new BoxGeometry(0.7, 0.7, 0.15), bodyMaterial(0x22_28_33));
      const light = new Mesh(new SphereGeometry(0.22, 12, 12), status);
      light.position.z = 0.12;
      group.add(box, light);
      break;
    }
    case 'barrier': {
      const post = new Mesh(new BoxGeometry(0.3, 1.1, 0.3), bodyMaterial());
      const arm = new Mesh(new BoxGeometry(0.12, 0.12, 4), status);
      arm.position.set(0, 1, 2);
      group.add(post, arm);
      break;
    }
    case 'pump': {
      const tank = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 14), bodyMaterial());
      const lamp = new Mesh(new SphereGeometry(0.14, 12, 12), status);
      lamp.position.y = 0.7;
      group.add(tank, lamp);
      break;
    }
    case 'power': {
      const cabinet = new Mesh(new BoxGeometry(1.1, 1.8, 0.6), bodyMaterial(0x38_40_50));
      const lamp = new Mesh(new SphereGeometry(0.12, 12, 12), status);
      lamp.position.set(0.35, 0.75, 0.34);
      group.add(cabinet, lamp);
      break;
    }
    case 'radio': {
      const mast = new Mesh(new CylinderGeometry(0.05, 0.05, 1.6, 8), bodyMaterial());
      const tip = new Mesh(new SphereGeometry(0.12, 12, 12), status);
      tip.position.y = 0.85;
      group.add(mast, tip);
      break;
    }
    case 'hydrant': {
      const body = new Mesh(new CylinderGeometry(0.2, 0.24, 0.9, 12), bodyMaterial(HYDRANT_HEX));
      const cap = new Mesh(new SphereGeometry(0.14, 12, 12), status);
      cap.position.y = 0.55;
      group.add(body, cap);
      break;
    }
    // Sensors and fire detection share the small wall/ceiling box shape.
    default: {
      const box = new Mesh(new BoxGeometry(0.45, 0.45, 0.45), bodyMaterial());
      const lamp = new Mesh(new SphereGeometry(0.13, 12, 12), status);
      lamp.position.y = 0.35;
      group.add(box, lamp);
      break;
    }
  }

  group.userData = data;
  return group;
}
