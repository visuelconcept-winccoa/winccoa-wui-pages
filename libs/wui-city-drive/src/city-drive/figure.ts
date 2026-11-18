// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How a person on foot moves (#89): the angles of the joints for a stride and for throwing a
 * cube. Pure, no three.js; figure-model.ts turns a {@link Pose} into the rotations of the body.
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
  /** Chest turned to the left (a throw, the counter-rotation of the stride). */
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

/**
 * A cube thrown `t` seconds after the throw started (it lasts {@link THROW_DURATION}): the right
 * arm draws back, the chest turning with it and the left arm coming forward for balance, then
 * whips over the shoulder; the cube leaves the hand at {@link THROW_RELEASE_AT}; the arm follows
 * through across the body and the stride takes over again.
 */
export function throwPose(base: Pose, t: number): Pose {
  const back = smooth(0, 0.16, t) * (1 - smooth(0.16, 0.26, t));
  const through = smooth(0.16, 0.26, t) * (1 - smooth(0.34, THROW_DURATION, t));
  const on = Math.max(back, through);
  return {
    ...base,
    shoulderR: lerp(base.shoulderR, back > through ? 2.4 : 0.9, on),
    elbowR: lerp(base.elbowR, back > through ? 1.6 : 0.25, on),
    acrossR: lerp(base.acrossR, back > through ? -0.35 : 0.45, on),
    shoulderL: lerp(base.shoulderL, 1.0, on * 0.8),
    elbowL: lerp(base.elbowL, 0.6, on * 0.8),
    acrossL: lerp(base.acrossL, 0.2, on),
    twist: base.twist - back * 0.45 + through * 0.4,
    pelvisYaw: base.pelvisYaw - back * 0.15 + through * 0.15,
    lean: base.lean - back * 0.08 + through * 0.2,
    nod: base.nod + through * 0.08
  };
}

/** Length of a throw (s), and when the cube leaves the hand. */
export const THROW_DURATION = 0.5;
export const THROW_RELEASE_AT = 0.2;
