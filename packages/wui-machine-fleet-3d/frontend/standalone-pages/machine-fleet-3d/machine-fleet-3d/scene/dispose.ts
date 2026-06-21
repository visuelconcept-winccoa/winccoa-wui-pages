/**
 * Three.js disposal helpers. Three does not free GPU resources automatically —
 * a leaked WebGLRenderer / undisposed geometry melts VRAM on every navigation.
 */
import { Mesh, type Material, type Object3D, type Texture } from 'three';

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
    }
  });
  root.clear();
}
