/**
 * Shared procedural textures, PBR materials, and geometry helpers for the
 * machine factory. Ported from the prototype's global `TEX` / `MAT_*` pools and
 * `addBase` / `addAnchorBolts` / `addVentGrille` / `addStatusLED` / `addPipe`
 * helpers, wrapped in a disposable class so each scene owns its GPU resources
 * (no cross-instance global state).
 */
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Texture
} from 'three';

type Vec3 = [number, number, number];

function newCanvasCtx(size: number): {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { cv, ctx };
}

function makeBrushedMetalTexture(): CanvasTexture {
  const s = 256;
  const { cv, ctx } = newCanvasCtx(s);
  ctx.fillStyle = '#555';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) {
    const y = Math.random() * s;
    const b = 60 + Math.random() * 80;
    ctx.strokeStyle = `rgba(${b},${b + 3},${b + 8},${0.12 + Math.random() * 0.18})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.3;
    ctx.beginPath();
    const x1 = Math.random() * s;
    ctx.moveTo(x1, y);
    ctx.lineTo(x1 + 30 + Math.random() * 100, y + (Math.random() - 0.5) * 0.8);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 15 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(30,30,35,0.35)');
    g.addColorStop(1, 'rgba(30,30,35,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalize(cv);
}

function makeRefractoryTexture(): CanvasTexture {
  const s = 256;
  const { cv, ctx } = newCanvasCtx(s);
  ctx.fillStyle = '#7d7570';
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 4 + Math.random() * 3) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 30},${50 + Math.random() * 25},${40 + Math.random() * 20},0.35)`;
    ctx.fillRect(0, y, s, 1 + Math.random() * 1.5);
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 3 + Math.random() * 12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(25,18,14,0.55)');
    g.addColorStop(1, 'rgba(25,18,14,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalize(cv, 4);
}

function makeIndustrialPaintTexture(baseColor: string): CanvasTexture {
  const s = 256;
  const { cv, ctx } = newCanvasCtx(s);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 8 + Math.random() * 20, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 15; i++) {
    ctx.fillStyle = `rgba(30,25,20,${0.3 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 8);
  }
  return finalize(cv, 4);
}

function finalize(cv: HTMLCanvasElement, anisotropy = 4): CanvasTexture {
  const tex = new CanvasTexture(cv);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Owns every shared texture / material / helper used by the machine factory. */
export class MachineMaterials {
  readonly brushedMetal = makeBrushedMetalTexture();
  readonly refractory = makeRefractoryTexture();

  readonly metal = new MeshStandardMaterial({
    map: this.brushedMetal,
    color: 0xC8_CC_D4,
    roughness: 0.38,
    metalness: 0.85
  });

  readonly steelDark = new MeshStandardMaterial({
    map: this.brushedMetal,
    color: 0x4A_52_63,
    roughness: 0.55,
    metalness: 0.7
  });

  readonly refractoryMat = new MeshStandardMaterial({
    map: this.refractory,
    color: 0x8B_86_80,
    roughness: 0.92,
    metalness: 0.05
  });

  readonly baseConcrete = new MeshStandardMaterial({
    color: 0x3A_3F_4C,
    roughness: 0.95,
    metalness: 0.05
  });

  private readonly paintCache = new Map<number, CanvasTexture>();
  private readonly disposables: (Texture | Material)[] = [];

  /** Textured industrial-paint material for painted parts. */
  byColor(color: number, emissiveIntensity = 0): MeshStandardMaterial {
    let tex = this.paintCache.get(color);
    if (!tex) {
      const hex = `#${color.toString(16).padStart(6, '0')}`;
      tex = makeIndustrialPaintTexture(hex);
      this.paintCache.set(color, tex);
    }
    const mat = new MeshStandardMaterial({
      color,
      map: tex,
      roughness: 0.45,
      metalness: 0.35,
      emissive: emissiveIntensity ? color : 0x00_00_00,
      emissiveIntensity
    });
    this.disposables.push(mat);
    return mat;
  }

  /** Flat (untextured) painted material for tiny parts. */
  flatMat(color: number, emissiveIntensity = 0): MeshStandardMaterial {
    const mat = new MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.3,
      emissive: emissiveIntensity ? color : 0x00_00_00,
      emissiveIntensity
    });
    this.disposables.push(mat);
    return mat;
  }

  addBase(group: Group, w: number, d: number, h = 0.4): Mesh {
    const base = new Mesh(new BoxGeometry(w, h, d), this.baseConcrete);
    base.position.y = h / 2;
    base.castShadow = base.receiveShadow = true;
    group.add(base);
    const plate = new Mesh(new PlaneGeometry(0.8, 0.4), this.flatMat(0xE5_E7_EB));
    plate.rotation.y = Math.PI / 2;
    plate.position.set(w / 2 + 0.01, h + 0.1, 0);
    group.add(plate);
    return base;
  }

  addAnchorBolts(group: Group, w: number, d: number, h = 0.4): void {
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
      for (const z of [-d / 2 + 0.3, d / 2 - 0.3]) {
        const bolt = new Mesh(new CylinderGeometry(0.1, 0.12, 0.15, 8), this.metal);
        bolt.position.set(x, h + 0.075, z);
        group.add(bolt);
      }
    }
  }

  addVentGrille(group: Group, w: number, h: number, pos: Vec3, rotY = 0): void {
    const grille = new Mesh(new BoxGeometry(w, h, 0.05), this.flatMat(0x1A_1D_24));
    grille.position.set(pos[0], pos[1], pos[2]);
    grille.rotation.y = rotY;
    group.add(grille);
    const lameH = h / 6;
    for (let i = 0; i < 5; i++) {
      const lame = new Mesh(new BoxGeometry(w * 0.9, 0.02, 0.08), this.flatMat(0x2A_2E_38));
      lame.position.set(pos[0], pos[1] - h / 2 + lameH * (i + 1), pos[2] + 0.02);
      lame.rotation.y = rotY;
      group.add(lame);
    }
  }

  addStatusLED(group: Group, pos: Vec3, color = 0x10_B9_81): Mesh {
    const mat = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.5,
      roughness: 0.3,
      metalness: 0.5
    });
    this.disposables.push(mat);
    const led = new Mesh(new CylinderGeometry(0.08, 0.08, 0.05, 12), mat);
    led.rotation.x = Math.PI / 2;
    led.position.set(pos[0], pos[1], pos[2]);
    group.add(led);
    return led;
  }

  addPipe(group: Group, from: Vec3, to: Vec3, radius = 0.08, color = 0x55_5A_68): void {
    const start = new Vector3(...from);
    const end = new Vector3(...to);
    const dir = new Vector3().subVectors(end, start);
    const len = dir.length();
    const pipe = new Mesh(new CylinderGeometry(radius, radius, len, 8), this.flatMat(color));
    pipe.position.copy(start).add(end).multiplyScalar(0.5);
    pipe.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    group.add(pipe);
  }

  dispose(): void {
    this.brushedMetal.dispose();
    this.refractory.dispose();
    this.metal.dispose();
    this.steelDark.dispose();
    this.refractoryMat.dispose();
    this.baseConcrete.dispose();
    for (const t of this.paintCache.values()) t.dispose();
    this.paintCache.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
