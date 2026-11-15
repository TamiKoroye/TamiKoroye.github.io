// Shared pose primitives for the procedural animation system.
// A pose is a flat Float32Array: 17 joints x (x, y, z) Euler rotations + hips offset (px, py, pz).
import { clamp, smooth01 } from './util.js';
import { HIP_H, LEG } from './character.js';

export { HIP_H, LEG };
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'sL', 'eL', 'wL', 'sR', 'eR', 'wR', 'hL', 'kL', 'aL', 'hR', 'kR', 'aR'];
export const JI = {}; JOINTS.forEach((n, i) => (JI[n] = i * 3));
export const PN = JOINTS.length * 3;
export const POSE_LEN = PN + 3;
export const PX = PN, PY = PN + 1, PZ = PN + 2;
export const LEG_START = JI.hL;

export function S(p, j, x, y, z) { const i = JI[j]; p[i] = x; p[i + 1] = y; p[i + 2] = z; }
export function add(p, j, x, y, z) { const i = JI[j]; p[i] += x; p[i + 1] += y; p[i + 2] += z; }
const sideName = (base, side) => base + (side > 0 ? 'L' : 'R');
// side: +1 = left (+x), -1 = right (-x).
// fwd < 0 raises the arm forward (-PI/2 = horizontal, -PI = overhead); abd > 0 raises it outwards;
// twist rotates the arm about its own axis; elbow > 0 bends the forearm; wrist < 0 opens the palm forward.
export function arm(p, side, fwd, abd, twist, elbow, wrist = 0) {
  S(p, sideName('s', side), fwd, twist * side, abd * side);
  S(p, sideName('e', side), -Math.max(0, elbow), 0, 0);
  S(p, sideName('w', side), wrist, 0, 0);
}
// hx < 0 swings the thigh forward; hzOut > 0 opens it sideways; kx bends the knee; ax tilts the foot.
export function legRaw(p, side, hx, hzOut, kx, ax) {
  S(p, sideName('h', side), hx, 0, hzOut * side);
  S(p, sideName('k', side), Math.max(0, kx), 0, 0);
  S(p, sideName('a', side), ax, 0, 0);
}
// Two-bone IK in the sagittal plane: foot `fwd` metres in front of the hip, `down` metres below, `out` opens it sideways.
export function legIK(p, side, fwd, down, out = 0.08) {
  const d = Math.min(Math.hypot(fwd, down), LEG * 2 - 0.001);
  const half = Math.acos(clamp(d / (2 * LEG), -1, 1));
  const a = Math.atan2(fwd, down) + half, k = 2 * half;
  legRaw(p, side, -a, out, k, a - k);
}
export const hipDown = (py) => HIP_H + py - 0.08;
export const seg = (u, a, b) => smooth01((u - a) / (b - a));
export function lerpPose(out, a, b, t) { for (let i = 0; i < POSE_LEN; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; }
// grounded stance helper: hips drop `py`, feet placed in front/behind and opened sideways
export function stanceLegs(p, py, lf, lo, rf, ro, lead = 1) {
  p[PY] = py;
  const d = hipDown(py);
  legIK(p, lead, lf, d, lo);
  legIK(p, -lead, rf, d, ro);
}
