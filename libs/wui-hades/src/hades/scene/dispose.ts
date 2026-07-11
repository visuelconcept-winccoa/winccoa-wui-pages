// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Three.js disposal helpers. Three does not free GPU resources automatically —
 * a leaked WebGLRenderer / undisposed geometry melts VRAM on every navigation.
 * (Same helper as the machine-fleet-3d page, duplicated so each page bundle
 * stays self-contained at packaging time.)
 */
import { Mesh, Sprite, type Material, type Object3D, type Texture } from 'three';

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap'
] as const;

function disposeMaterial(material: Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const key of TEXTURE_KEYS) {
    const tex = record[key] as Texture | undefined;
    tex?.dispose?.();
  }
  material.dispose();
}

/** Recursively dispose every geometry / material / texture under `root`. */
export function disposeObject(root: Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry?.dispose();
      const mat = obj.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) for (const m of mat) disposeMaterial(m);
      else if (mat) disposeMaterial(mat);
    } else if (obj instanceof Sprite) {
      // Canvas-backed billboards (PK marks, portal names) own their texture.
      disposeMaterial(obj.material);
    }
  });
  root.clear();
}
