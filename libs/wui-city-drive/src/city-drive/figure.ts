// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How a person on foot moves (#89): the angles of the joints for a stride and for the weapons'
 * moves. Pure, no three.js; figure-model.ts turns a {@link Pose} into the rotations of the body.
 *
 * Angles in radians, positive = forward: a hip flexed brings the thigh forward, a knee flexed
 * brings the shin back, an ankle flexed lifts the toes, a shoulder flexed raises the arm
 * forward, an elbow flexed brings the forearm up.
 *
 * The gait follows the human walking cycle rather than two pendulums:
 * - the thigh swings forward faster than it goes back (swing ≈ 40 % of the cycle);
 * - the knee flexes a little just after the heel strikes (loading), stays nearly straight under
 *   the weight, then folds ~60° in the swing (~95° running);
 * - the ankle lifts the toes at the heel strike and pushes off at the end of the stance;
 * - the pelvis turns with the leg that swings forward and drops on the swinging side; the chest
 *   turns the other way, and the head stays facing ahead;
 * - the body sways over the standing foot;
 * - the arms swing against the legs with a lag, a little across the body, the elbows bending
 *   more on the way forward; the left and right arms are not mirror images (the dominant arm
 *   swings a little wider).
 * Running blends in: longer strides, folded knees, the trunk leaning, the elbows pumping at ~80°,
 * a flight phase in the bounce.
 */
import { RUN_SPEED, WALK_SPEED } from './walker.js';

export interface Pose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
  shoulderL: number;
  shoulderR: number;
  /** Arm moved across the body (+) or out (−). */
  acrossL: number;
  acrossR: number;
  elbowL: number;
  elbowR: number;
  /** Trunk leaning forward. */
  lean: number;
  /** Chest turned to the left (a slash, the counter-rotation of the stride). */
  twist: number;
  /** Pelvis turned to the left, and dropped on the left (+). */
  pelvisYaw: number;
  pelvisRoll: number;
  /** Sideways shift of the hips over the standing foot (m, + = left). */
  sway: number;
  /** Head nodding forward. */
  nod: number;
  /** Height of the hips above standing (m). */
  bob: number;
}

export type AttackKind = 'hammer' | 'sword' | 'crossbow';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Smooth 0 → 1 between e0 and e1. */
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** A bump of width `w` centred at `c` on the cycle (0..1, wraps). */
const bump = (u: number, c: number, w: number): number => {
  let d = Math.abs(u - c);
  d = Math.min(d, 1 - d);
  return Math.exp(-(d * d) / (2 * w * w));
};

/** One leg at cycle position u (0 = its heel strikes, 0.6 = its toes leave the ground). */
function leg(u: number, walk: number, run: number): { hip: number; knee: number; ankle: number } {
  // thigh: forward at the heel strike, back at the toe-off, then a quick swing forward
  const back = u < 0.6 ? u / 0.6 : 1 - (u - 0.6) / 0.4; // 0 → 1 (stance) → 0 (swing)
  const shaped = back < 0.5 ? 2 * back * back : 1 - 2 * (1 - back) * (1 - back);
  const hipAmp = lerp(0.45, 0.85, run);
  const hip = walk * (hipAmp * (1 - 2 * shaped) + lerp(0.02, 0.15, run));
  const knee = walk * (lerp(0.22, 0.45, run) * bump(u, 0.12, 0.06) + lerp(1.05, 1.65, run) * bump(u, 0.73, 0.09) + 0.06);
  const ankle = walk * (0.22 * bump(u, 0.02, 0.04) - lerp(0.35, 0.55, run) * bump(u, 0.6, 0.06) + 0.12 * bump(u, 0.8, 0.08));
  return { hip, knee, ankle };
}

/**
 * The stride: `phase` advances with the distance walked (walker.ts: one stride = 2π), `speed` in
 * m/s, negative backwards. `seed` (0..1) varies a person a little (arm swing, posture).
 */
export function gaitPose(phase: number, speed: number, seed = 0.5): Pose {
  const v = Math.abs(speed);
  const walk = clamp01(v / WALK_SPEED);
  const run = clamp01((v - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
  const dir = speed < 0 ? -1 : 1;
  const u = (((phase / (Math.PI * 2)) % 1) + 1) % 1; // 0..1 along the cycle, left heel strike at 0
  const L = leg(u, walk, run);
  const R = leg((u + 0.5) % 1, walk, run);
  // + while the left thigh is forward (it peaks at the left heel strike, u = 0); the arms lag a little
  const swingL = Math.cos(2 * Math.PI * (u - 0.06));
  const armAmp = lerp(0.3, 0.7, run) * walk;
  const dominant = 1 + (seed - 0.5) * 0.3;
  const shoulderL = -dir * armAmp * swingL * (2 - dominant) + 0.05;
  const shoulderR = dir * armAmp * swingL * dominant + 0.05;
  const elbowBase = lerp(0.22, 1.35, run) * Math.max(walk, 0.5) + 0.12;
  const elbowL = elbowBase + 0.3 * walk * Math.max(0, shoulderL);
  const elbowR = elbowBase + 0.3 * walk * Math.max(0, shoulderR);
  const s2 = Math.sin(2 * Math.PI * u);
  const standingL = Math.cos(2 * Math.PI * (u - 0.25)); // + while the left foot carries
  const bob = walk * (lerp(0.03, 0.08, run) * Math.abs(Math.cos(2 * Math.PI * u)) - lerp(0.03, 0.06, run));
  const idle = 1 - walk;
  return {
    hipL: dir * L.hip,
    hipR: dir * R.hip,
    kneeL: L.knee,
    kneeR: R.knee,
    ankleL: L.ankle,
    ankleR: R.ankle,
    shoulderL: shoulderL + idle * 0.03 * Math.sin(phase * 0.5 + 1),
    shoulderR: shoulderR + idle * 0.02 * Math.sin(phase * 0.5),
    acrossL: 0.12 * Math.max(0, shoulderL) - 0.06,
    acrossR: 0.12 * Math.max(0, shoulderR) - 0.06,
    elbowL,
    elbowR,
    lean: lerp(0.04, 0.22, run) * walk + (seed - 0.5) * 0.04,
    twist: -dir * walk * lerp(0.14, 0.24, run) * s2,
    pelvisYaw: dir * walk * lerp(0.1, 0.16, run) * s2,
    pelvisRoll: walk * 0.05 * -standingL,
    sway: walk * lerp(0.025, 0.012, run) * standingL + idle * 0.01 * Math.sin(phase * 0.3),
    nod: walk * 0.03 * Math.cos(4 * Math.PI * u) - lerp(0.02, 0.1, run) * walk,
    bob
  };
}

/** How each weapon is held between two blows (it replaces the swing of the right arm). */
export function holdPose(base: Pose, weapon: AttackKind): Pose {
  if (weapon === 'crossbow') {
    // carried in both hands across the chest
    return { ...base, shoulderR: 0.7, elbowR: 1.35, acrossR: 0.25, shoulderL: 0.85, elbowL: 1.5, acrossL: 0.35 };
  }
  // hammer, sword: carried in the right hand, the elbow bent so the head clears the ground,
  // the arm swinging less and slightly out
  return { ...base, shoulderR: base.shoulderR * 0.45 + 0.12, elbowR: weapon === 'hammer' ? 1.05 : 0.65, acrossR: -0.12 };
}

/**
 * A blow `t` seconds after it started (it lasts {@link ATTACK_DURATION}):
 * - hammer: both hands raise it over the head, then bring it down in front, knees bending
 *   (the hit at 0.3 s);
 * - sword: a wide slash from right to left, the chest and hips turning into it (hit at 0.18 s);
 * - crossbow: both arms up to aim, the shot at once, then the recoil.
 */
export function attackPose(base: Pose, weapon: AttackKind, t: number): Pose {
  const held = holdPose(base, weapon);
  if (weapon === 'hammer') {
    const up = smooth(0, 0.2, t) * (1 - smooth(0.2, 0.32, t));
    const down = smooth(0.2, 0.32, t) * (1 - smooth(0.42, 0.55, t));
    return {
      ...held,
      shoulderR: held.shoulderR + up * (2.75 - held.shoulderR) + down * (0.6 - held.shoulderR),
      shoulderL: held.shoulderL + up * (2.55 - held.shoulderL) + down * (0.75 - held.shoulderL),
      acrossL: held.acrossL + up * 0.3 + down * 0.35,
      acrossR: held.acrossR + up * 0.25 + down * 0.3,
      elbowL: lerp(held.elbowL, 1.1, up) + down * 0.1,
      elbowR: lerp(held.elbowR, up > down ? 1.0 : 0.1, Math.max(up, down)),
      lean: held.lean - up * 0.18 + down * 0.4,
      nod: held.nod - up * 0.15 + down * 0.2,
      kneeL: held.kneeL + down * 0.4,
      kneeR: held.kneeR + down * 0.4,
      hipL: held.hipL + down * 0.25,
      hipR: held.hipR + down * 0.25,
      bob: held.bob - down * 0.1
    };
  }
  if (weapon === 'sword') {
    const out = smooth(0, 0.08, t) * (1 - smooth(0.3, 0.4, t));
    const across = smooth(0.06, 0.24, t);
    const turn = out * lerp(-0.7, 0.8, across);
    return {
      ...held,
      shoulderR: lerp(held.shoulderR, 1.4, out),
      acrossR: lerp(held.acrossR, lerp(-0.9, 0.6, across), out),
      elbowR: lerp(held.elbowR, 0.2, out),
      shoulderL: held.shoulderL + out * 0.35,
      acrossL: held.acrossL - out * 0.4,
      twist: turn,
      pelvisYaw: turn * 0.4,
      lean: held.lean + out * 0.12,
      kneeL: held.kneeL + out * 0.2,
      kneeR: held.kneeR + out * 0.15
    };
  }
  const aim = smooth(0, 0.06, t) * (1 - smooth(0.26, 0.35, t));
  const recoil = smooth(0.06, 0.1, t) * (1 - smooth(0.1, 0.22, t));
  return {
    ...held,
    shoulderR: lerp(held.shoulderR, 1.5 + recoil * 0.25, aim),
    elbowR: lerp(held.elbowR, 0.25, aim),
    acrossR: lerp(held.acrossR, 0.15, aim),
    shoulderL: lerp(held.shoulderL, 1.55 + recoil * 0.25, aim),
    elbowL: lerp(held.elbowL, 0.45, aim),
    acrossL: lerp(held.acrossL, 0.4, aim),
    twist: held.twist + aim * 0.15,
    lean: held.lean - recoil * 0.1,
    nod: held.nod + aim * 0.1
  };
}

/** Length of a blow (s), and when it lands (the shot for the crossbow). */
export const ATTACK_DURATION: Record<AttackKind, number> = { hammer: 0.55, sword: 0.4, crossbow: 0.35 };
export const ATTACK_HIT_AT: Record<AttackKind, number> = { hammer: 0.3, sword: 0.18, crossbow: 0.07 };
