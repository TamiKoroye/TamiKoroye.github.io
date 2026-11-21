// Element martial-arts styles: stance, locomotion character and keyframed techniques.
// All four share the same skeleton and pose primitives; each technique is a list of keyframe
// functions that write joint targets over the style's stance, interpolated with easing.
//   Earth: Hung Gar (rooted, wide, forceful)      Fire: Northern Shaolin (long, extended, explosive)
//   Water: Tai Chi (circular, continuous, soft)   Air: Baguazhang (circle-walking, open palms, spinning)
import { S, add, arm, legRaw, legIK, stanceLegs, hipDown, PX, PY, PZ } from './pose.js';

// ------------------------------------------------------------------ stances (idle / guard-ready)
function earthStance(p, t) {
  const b = Math.sin(t * 1.6);
  stanceLegs(p, -0.24 + b * 0.008, 0.18, 0.36, -0.14, 0.34);
  S(p, 'hips', 0.04, 0.22, 0); S(p, 'spine', 0.1, -0.08, 0); S(p, 'chest', 0.05 + b * 0.012, -0.12, 0);
  S(p, 'neck', -0.12, -0.02, 0); S(p, 'head', 0.02, 0, 0);
  arm(p, 1, -0.95, 0.22, -0.2, 1.15, -0.55);   // lead tiger claw
  arm(p, -1, 0.42, 0.18, 0, 2.15, 0.1);         // rear fist chambered at the hip
}
function fireStance(p, t) {
  const b = Math.sin(t * 7) * 0.025;            // light bounce on the balls of the feet
  stanceLegs(p, -0.15 + b, 0.48, 0.13, -0.44, 0.11);     // long front bow stance
  S(p, 'hips', 0.04, 0.3, 0); S(p, 'spine', 0.14, -0.08, 0); S(p, 'chest', 0.05, -0.18, 0);
  S(p, 'neck', -0.1, -0.1, 0); S(p, 'head', 0, 0, 0);
  arm(p, 1, -1.25, 0.15, -0.3, 0.5, -0.2);      // lead arm extended
  arm(p, -1, -0.65, 0.6, -0.3, 2.0, 0);         // rear fist high by the temple
  add(p, 'aL', 0.12, 0, 0); add(p, 'aR', 0.18, 0, 0);
}
function waterStance(p, t) {
  const w = t * 1.5, a = Math.sin(w), c = Math.cos(w);
  stanceLegs(p, -0.13 + a * 0.02, 0.27, 0.12, -0.08, 0.15);
  p[PZ] = -0.04 + a * 0.04;                     // weight shifting forward / back
  S(p, 'hips', 0, 0.15 + a * 0.12, 0); S(p, 'spine', 0.04, -0.06 - a * 0.06, 0); S(p, 'chest', 0.02, -0.04, 0);
  S(p, 'neck', -0.04, -0.05 - a * 0.05, 0);
  arm(p, 1, -0.85 + a * 0.25, 0.45 + c * 0.15, 0.4, 0.9 + c * 0.15, 0.3);    // rounded "ward off"
  arm(p, -1, -0.5 - a * 0.25, 0.35 - c * 0.12, 0.3, 1.2 - c * 0.15, 0.2);
}
function airStance(p, t) {
  const w = t * 2.1, a = Math.sin(w), c = Math.cos(w);
  stanceLegs(p, -0.15 + Math.abs(a) * 0.02, 0.2, 0.04, -0.15, 0.06);       // toe-in walking stance
  p[PX] = c * 0.025; p[PZ] = a * 0.025;          // small circular weight shifts
  S(p, 'hips', 0, 0.5 + a * 0.06, 0); S(p, 'spine', 0.04, 0.2, 0); S(p, 'chest', 0, 0.3, 0);
  S(p, 'neck', 0, -0.5, 0); S(p, 'head', 0, -0.25, 0);
  arm(p, 1, -1.45, 0.08, -0.8, 0.35, -1.0);     // lead open palm at eye level
  arm(p, -1, -1.0, -0.15, -0.4, 1.6, -0.7);     // rear palm guarding the lead elbow
  add(p, 'aL', 0.18 + a * 0.06, 0, 0); add(p, 'aR', 0.2 - a * 0.06, 0, 0);
}

// ------------------------------------------------------------------ technique helpers
const T = (o) => o;
const lunge = (p, s, py, front, back, out = 0.14) => stanceLegs(p, py, front, out, back, out, -s);

// ------------------------------------------------------------------ EARTH: Hung Gar
const earth = {
  key: 'earth', name: 'Earth', art: 'Hung Gar', color: 0x9a7b4f, sash: 0x6b8a3a,
  stance: earthStance,
  loco: { walk: 2.6, run: 5.9, sprint: 8.4, accel: 30, stride: 0.9, bob: 0.55, knee: 0.8, lean: 0.8, swing: 0.55, elbow: 1.7, carry: -0.2, out: 0.1, heavy: 1.4 },
  jump: { v: 8.4, air: 0 },
  dodge: { kind: 'roll', dur: 0.44, speed: 12, iframes: 0.7 },
  labels: { hand: 'STONE PUNCH', leg: 'EARTH KICK', guard: 'WALL', special: 'RUPTURE' },
  tech: {
    hand: T({ name: 'Stone Punch', clip: ['earth_punch', 'earth_punch2'], dur: 0.42, cost: 9, cancel: 0.6, upper: true, move: 3.2, lunge: 5,
      active: { from: 0.33, to: 0.5, dmg: 7, range: 1.8, arc: 0.4, knock: 3, level: 0 },
      events: [[0.34, 'earth.hand']],
      keys: [
        [0.0, (p, c) => { p[PY] = -0.26; S(p, 'hips', 0.04, 0.35 * c.s, 0); S(p, 'chest', 0.05, 0.2 * c.s, 0); arm(p, -c.s, 0.5, 0.15, 0, 2.2, 0); arm(p, c.s, -1.0, 0.25, -0.2, 1.3, -0.5); }],
        [0.36, (p, c) => { lunge(p, c.s, -0.27, 0.34, -0.36, 0.32); S(p, 'hips', 0.06, -0.55 * c.s, 0); S(p, 'spine', 0.15, -0.15 * c.s, 0); S(p, 'chest', 0.05, -0.3 * c.s, 0);
          arm(p, -c.s, -1.5, 0.08, -0.2, 0.05, 0); arm(p, c.s, 0.5, 0.15, 0, 2.15, 0); }],
        [0.6, (p, c) => { lunge(p, c.s, -0.27, 0.34, -0.36, 0.32); S(p, 'hips', 0.06, -0.5 * c.s, 0); S(p, 'chest', 0.05, -0.25 * c.s, 0); arm(p, -c.s, -1.45, 0.1, -0.2, 0.15, 0); arm(p, c.s, 0.5, 0.15, 0, 2.15, 0); }],
        [1.0, () => {}],
      ] }),
    leg: [
      T({ name: 'Earth Kick', clip: ['earth_kick', 'fire_round', 'earth_backkick', 'mma_kick'], dur: 0.6, cost: 10, cancel: 0.72, move: 0.6, lunge: 4,
        active: { from: 0.4, to: 0.56, dmg: 9, range: 2.0, arc: 0.3, knock: 6, level: 1 },
        events: [[0.42, 'earth.leg']],
        keys: [
          [0.0, () => {}],
          [0.3, (p, c) => { p[PY] = -0.16; legRaw(p, c.s, -1.5, 0.12, 1.95, 0.3); legIK(p, -c.s, 0.02, hipDown(-0.16) - 0.04, 0.16);
            S(p, 'spine', -0.05, 0, 0); arm(p, c.s, 0.3, 0.25, 0, 2.0); arm(p, -c.s, -0.95, 0.3, -0.2, 1.25, -0.5); }],
          [0.44, (p, c) => { p[PY] = -0.14; legRaw(p, c.s, -1.4, 0.1, 0.12, -0.6); legIK(p, -c.s, -0.02, hipDown(-0.14) - 0.04, 0.16);
            S(p, 'hips', -0.12, -0.25 * c.s, 0); S(p, 'spine', -0.2, 0, 0); arm(p, -c.s, -1.35, 0.2, 0, 0.3, -0.4); arm(p, c.s, 0.4, 0.3, 0, 2.0); }],
          [0.7, (p, c) => { stanceLegs(p, -0.3, 0.36, 0.3, -0.16, 0.3, c.s); S(p, 'spine', 0.22, 0, 0); arm(p, 1, -0.6, 0.3, 0, 0.4, 1.0); arm(p, -1, -0.6, 0.3, 0, 0.4, 1.0); }],
          [1.0, () => {}],
        ] }),
      T({ name: 'Earth Sweep', clip: ['earth_sweep', 'sweep_spin'], dur: 0.62, cost: 12, cancel: 0.75, move: 0.5, spin: [0.08, 0.7, 1],
        active: { from: 0.35, to: 0.6, dmg: 7, range: 2.2, arc: -1.1, knock: 4, level: 1 },
        events: [[0.45, 'earth.sweep']],
        keys: [
          [0.0, () => {}],
          [0.25, (p, c) => { p[PY] = -0.45; legIK(p, -c.s, 0.15, hipDown(-0.45), 0.2); legRaw(p, c.s, -0.25, 1.25, 0.15, 0.2); S(p, 'spine', 0.35, 0, 0.15 * c.s);
            arm(p, 1, -0.4, 0.5, 0, 0.6, 0.8); arm(p, -1, -0.4, 0.5, 0, 0.6, 0.8); }],
          [0.6, (p, c) => { p[PY] = -0.45; legIK(p, -c.s, 0.15, hipDown(-0.45), 0.2); legRaw(p, c.s, -0.3, 1.3, 0.1, 0.2); S(p, 'spine', 0.35, 0, 0.15 * c.s);
            arm(p, 1, -0.4, 0.6, 0, 0.5, 0.8); arm(p, -1, -0.4, 0.6, 0, 0.5, 0.8); }],
          [1.0, () => {}],
        ] }),
    ],
    charged: T({ name: 'Seismic Stomp', clip: 'earth_stomp', dur: 0.75, cost: 22, cancel: 0.82, move: 0, jumpAt: [0.14, 4.4],
      events: [[0.55, 'earth.seismic']],
      keys: [
        [0.0, () => {}],
        [0.3, (p) => { S(p, 'spine', -0.2, 0, 0); S(p, 'neck', 0.2, 0, 0); legRaw(p, -1, -2.2, 0.1, 0.15, 0.3); legRaw(p, 1, 0.3, 0.1, 1.1, -0.2); arm(p, 1, -2.6, 0.4, 0, 0.6); arm(p, -1, -2.6, 0.4, 0, 0.6); }],
        [0.56, (p) => { stanceLegs(p, -0.36, 0.3, 0.36, -0.2, 0.34, -1); S(p, 'spine', 0.45, 0, 0); arm(p, 1, -0.9, 0.9, 0, 0.3, 1.1); arm(p, -1, -0.9, 0.9, 0, 0.3, 1.1); }],
        [0.8, (p) => { stanceLegs(p, -0.32, 0.3, 0.36, -0.2, 0.34, -1); S(p, 'spine', 0.3, 0, 0); arm(p, 1, -0.8, 0.8, 0, 0.4, 1.0); arm(p, -1, -0.8, 0.8, 0, 0.4, 1.0); }],
        [1.0, () => {}],
      ] }),
    handHold: { name: 'Boulder Lift', period: 0.7, move: 2.6, drain: 4,
      pose: (p, c) => { const k = 0.5 - 0.5 * Math.cos(c.ph * Math.PI * 2);
        stanceLegs(p, -0.32 + 0.08 * k, 0.2, 0.36, -0.16, 0.36); S(p, 'spine', 0.3 - 0.25 * k, 0, 0); S(p, 'neck', -0.15, 0, 0);
        arm(p, 1, -0.3 - 1.4 * k, 0.3, 0.6, 0.4, 0.8 - 1.4 * k); arm(p, -1, -0.3 - 1.4 * k, 0.3, 0.6, 0.4, 0.8 - 1.4 * k); } },
    guard: (p) => { stanceLegs(p, -0.32, 0.12, 0.42, -0.12, 0.42); S(p, 'spine', 0.14, 0, 0); S(p, 'neck', -0.12, 0, 0);
      arm(p, 1, -1.3, 0.35, 0.3, 0.45, -1.25); arm(p, -1, -1.3, 0.35, 0.3, 0.45, -1.25); },
    // Ground Rupture: sink and drive both hands into the ground, then the ground ruptures in a line to the opponent
    special: T({ name: 'Ground Rupture', clip: 'earth_gather', onStart: 'earth.specialStart', dur: 0.55, cost: 30, cancel: 0.86, move: 0,
      events: [[0.42, 'earth.special']],
      keys: [
        [0.0, () => {}],
        [0.3, (p) => { stanceLegs(p, -0.38, 0.2, 0.4, -0.15, 0.4); S(p, 'spine', 0.4, 0, 0); arm(p, 1, -0.3, 0.3, 0.6, 0.3, 1.2); arm(p, -1, -0.3, 0.3, 0.6, 0.3, 1.2); }],
        [0.5, (p) => { stanceLegs(p, -0.22, 0.2, 0.4, -0.15, 0.4); S(p, 'spine', -0.05, 0, 0); arm(p, 1, -2.4, 0.3, 0.6, 0.2, -0.4); arm(p, -1, -2.4, 0.3, 0.6, 0.2, -0.4); }],
        [1.0, () => {}],
      ] }),
  },
};

// ------------------------------------------------------------------ FIRE: Northern Shaolin
const fire = {
  key: 'fire', name: 'Fire', art: 'Northern Shaolin', color: 0xe2552b, sash: 0xc8341f,
  stance: fireStance,
  loco: { walk: 3.2, run: 7.0, sprint: 9.8, accel: 40, stride: 1.05, bob: 1.1, knee: 1.25, lean: 1.4, swing: 1.1, elbow: 1.55, carry: -0.15, out: 0.03, heavy: 0.9 },
  jump: { v: 9.6, air: 0 },   // Fire jumps high (Air keeps flight, the highest)
  dodge: { kind: 'dash', dur: 0.32, speed: 17, iframes: 0.75, trail: 'fire' },
  labels: { hand: 'FIRE FIST', leg: 'FLAME KICK', guard: 'FIRE WALL', special: "DRAGON'S BREATH" },
  tech: {
    // jab (lead hand), cross (rear hand), hook: each fires a compact fireball out of the striking fist
    hand: T({ name: 'Fire Fist', clip: ['fire_jab', 'fire_punch', 'earth_punch'], dur: 0.27, cost: 6, cancel: 0.5, upper: true, move: 4.2, lunge: 5,
      active: { from: 0.28, to: 0.5, dmg: 5, range: 1.9, arc: 0.4, knock: 2, level: 0 },
      events: [[0.3, 'fire.hand']],
      keys: [
        [0.0, (p, c) => { S(p, 'hips', 0, 0.4 * c.s, 0); arm(p, -c.s, -0.6, 0.3, 0, 2.1, 0); }],
        [0.3, (p, c) => { lunge(p, c.s, -0.12, 0.5, -0.46, 0.1); S(p, 'hips', 0.05, -0.5 * c.s, 0); S(p, 'spine', 0.18, -0.1 * c.s, 0); S(p, 'chest', 0.04, -0.6 * c.s, 0);
          arm(p, -c.s, -1.62, 0.05, -0.3, 0.0, 0); arm(p, c.s, -0.6, 0.55, -0.3, 2.1, 0); }],
        [0.62, (p, c) => { lunge(p, c.s, -0.12, 0.5, -0.46, 0.1); S(p, 'hips', 0.05, -0.45 * c.s, 0); S(p, 'chest', 0.04, -0.5 * c.s, 0); arm(p, -c.s, -1.55, 0.08, -0.3, 0.1, 0); arm(p, c.s, -0.6, 0.55, -0.3, 2.1, 0); }],
        [1.0, () => {}],
      ] }),
    leg: [
      T({ name: 'Flame Kick', clip: ['fire_round', 'round_kick2'], dur: 0.46, cost: 9, cancel: 0.65, move: 1.0, lunge: 6,
        active: { from: 0.38, to: 0.55, dmg: 8, range: 2.2, arc: 0.35, knock: 5, level: 1 },
        events: [[0.42, 'fire.leg']],
        keys: [
          [0.0, () => {}],
          [0.26, (p, c) => { p[PY] = 0.0; legRaw(p, c.s, -1.85, 0.05, 2.05, 0.2); legIK(p, -c.s, 0.0, hipDown(0) - 0.02, 0.1); add(p, -c.s > 0 ? 'aL' : 'aR', 0.35, 0, 0);
            arm(p, c.s, 0.45, 0.6, 0, 0.5); arm(p, -c.s, -1.2, 0.4, 0, 1.8); }],
          [0.42, (p, c) => { p[PY] = 0.02; legRaw(p, c.s, -2.0, 0.05, 0.02, -0.3); legIK(p, -c.s, 0.02, hipDown(0.02) - 0.02, 0.1); S(p, 'spine', -0.28, 0, 0);
            arm(p, c.s, 0.6, 0.7, 0, 0.3); arm(p, -c.s, -1.3, 0.5, 0, 1.6); }],
          [0.62, (p, c) => { lunge(p, c.s, -0.1, 0.45, -0.4, 0.1); arm(p, c.s, -1.2, 0.2, 0, 0.6); arm(p, -c.s, -0.6, 0.55, 0, 2.0); }],
          [1.0, () => {}],
        ] }),
      T({ name: 'Spinning Flame Kick', clip: 'fire_spinback', dur: 0.56, cost: 12, cancel: 0.72, move: 1.5, spin: [0.05, 0.72, -1], lunge: 4,
        active: { from: 0.3, to: 0.62, dmg: 10, range: 2.3, arc: -1.1, knock: 7, level: 1 },
        events: [[0.42, 'fire.spin']],
        keys: [
          [0.0, () => {}],
          [0.3, (p, c) => { p[PY] = 0.04; legRaw(p, c.s, -0.6, 1.45, 0.1, 0.3); legIK(p, -c.s, 0.02, hipDown(0.04) - 0.03, 0.06); S(p, 'hips', 0, 0, -0.35 * c.s); S(p, 'spine', 0, 0, 0.25 * c.s);
            arm(p, 1, -0.4, 1.3, 0, 0.6); arm(p, -1, -0.3, 1.4, 0, 0.5); }],
          [0.62, (p, c) => { p[PY] = 0.04; legRaw(p, c.s, -0.5, 1.4, 0.15, 0.3); legIK(p, -c.s, 0.02, hipDown(0.04) - 0.03, 0.06); S(p, 'hips', 0, 0, -0.3 * c.s); arm(p, 1, -0.4, 1.2, 0, 0.6); arm(p, -1, -0.3, 1.3, 0, 0.5); }],
          [1.0, () => {}],
        ] }),
    ],
    charged: T({ name: 'Spinning Flame Kick', clip: 'fire_spinback', dur: 0.72, cost: 20, cancel: 0.82, move: 3, lunge: 6, spin: [0.08, 0.6, -1],
      active: { from: 0.35, to: 0.62, dmg: 12, range: 2.4, arc: -1.1, knock: 9, level: 2 },
      events: [[0.45, 'fire.charged']],
      keys: [
        [0.0, () => {}],
        [0.25, (p) => { legRaw(p, 1, -1.9, 0.1, 2.1, 0.2); legRaw(p, -1, -1.2, 0.1, 2.0, 0.2); S(p, 'spine', 0.2, 0, 0); arm(p, 1, -1.3, 0.5, 0, 1.8); arm(p, -1, -1.3, 0.5, 0, 1.8); }],
        [0.48, (p) => { legRaw(p, -1, -0.6, 1.3, 0.05, 0.3); legRaw(p, 1, -1.4, 0.2, 2.0, 0.2); S(p, 'spine', -0.1, 0, 0.3); arm(p, 1, -0.3, 1.4, 0, 0.4); arm(p, -1, -0.2, 1.4, 0, 0.4); }],
        [0.8, (p) => { stanceLegs(p, -0.2, 0.4, 0.12, -0.35, 0.12); S(p, 'spine', 0.25, 0, 0); arm(p, 1, -1.2, 0.2, 0, 0.5); arm(p, -1, -0.6, 0.55, 0, 2.0); }],
        [1.0, () => {}],
      ] }),
    handHold: { name: 'Fire Stream', period: 0.24, move: 2.4, drain: 14,
      pose: (p, c) => { const tr = Math.sin(c.t * 38) * 0.03; lunge(p, 1, -0.16, 0.45, -0.42, 0.1); S(p, 'hips', 0.05, 0.1, 0); S(p, 'spine', 0.2 + tr, 0, 0);
        arm(p, 1, -1.55 + tr, 0.15, -0.6, 0.15, -1.2); arm(p, -1, -1.5 - tr, 0.1, -0.6, 0.2, -1.2); } },
    guard: (p) => { stanceLegs(p, -0.14, 0.3, 0.14, -0.3, 0.12); S(p, 'spine', 0.08, 0, 0);
      arm(p, 1, -1.35, -0.1, 0.2, 1.75, 0.2); arm(p, -1, -1.25, -0.15, 0.2, 1.8, 0.2); },  // crossed forearms
    // Dragon Descent: a leaping flying kick with flames pouring from the feet; the kicking foot explodes on landing
    special: T({ name: 'Dragon Descent', clip: 'fire_fly', onStart: 'fire.specialStart', dur: 0.72, cost: 30, cancel: 0.88, move: 1, jumpAt: [0.08, 6.4], lunge: 9,
      events: [[0.5, 'fire.special']],
      keys: [
        [0.0, () => {}],
        [0.3, (p, c) => { S(p, 'chest', 0, -0.3 * c.s, 0); arm(p, -c.s, -2.1, 0.4, 0.4, 1.0, -0.9); arm(p, c.s, -0.6, 0.55, -0.3, 2.0, 0); }],
        [1.0, () => {}],
      ] }),
  },
};

// ------------------------------------------------------------------ WATER: Tai Chi Chuan
const water = {
  key: 'water', name: 'Water', art: 'Tai Chi Chuan', color: 0x3d8fd6, sash: 0x2d6fb3,
  stance: waterStance,
  loco: { walk: 2.8, run: 6.2, sprint: 8.8, accel: 26, stride: 1.0, bob: 0.35, knee: 0.7, lean: 0.6, swing: 0.35, elbow: 0.8, carry: -0.55, out: 0.07, heavy: 0.6, flow: 1 },
  jump: { v: 7.4, air: 0 },
  dodge: { kind: 'slide', dur: 0.4, speed: 13, iframes: 0.7, trail: 'water' },
  labels: { hand: 'WATER PALM', leg: 'WATER KICK', guard: 'WATER SHIELD', special: 'DROWN' },
  tech: {
    // the water whip: one arm path per strike (across the body, overhead, diagonal), each hand in turn; the rope
    // comes out of the hand as the arm winds up (onStart) and is thrown on the impact frame
    // HAND alternates the twin whips with punches; each punch throws a ball of water or ice from the fist
    hand: T({ name: 'Water Palm', clip: ['whip_h', 'fire_jab', 'whip_v', 'fire_punch', 'whip_d', 'earth_punch'], onStart: 'water.whipOut', dur: 0.5, reach: 4.3, cost: 6, cancel: 0.62, upper: true, move: 3.8, lunge: 11,
      active: { from: 0.5, to: 0.64, dmg: 5, range: 1.9, arc: 0.4, knock: 4, level: 0 },
      events: [[0.52, 'water.hand']],
      keys: [
        [0.0, () => {}],
        [0.25, (p, c) => { p[PY] = -0.14; p[PZ] = -0.06; S(p, 'hips', 0, 0.3 * c.s, 0); arm(p, -c.s, 0.25, 0.55, 0.5, 1.2, 0.4); arm(p, c.s, -0.8, 0.45, 0.4, 0.9, 0.3); }],
        [0.42, (p, c) => { p[PY] = -0.12; S(p, 'hips', 0, 0.05 * c.s, 0); arm(p, -c.s, -1.25, 0.65, 0.6, 0.95, 0.4); arm(p, c.s, -0.6, 0.4, 0.4, 1.1, 0.3); }],
        [0.56, (p, c) => { lunge(p, c.s, -0.14, 0.34, -0.1, 0.14); p[PZ] = 0.06; S(p, 'hips', 0, -0.3 * c.s, 0); S(p, 'chest', 0, -0.15 * c.s, 0); arm(p, -c.s, -1.42, 0.22, 0.2, 0.3, -1.2); arm(p, c.s, -0.4, 0.4, 0.3, 1.3, 0.3); }],
        [1.0, () => {}],
      ] }),
    leg: [
      T({ name: 'Crescent Water Kick', clip: 'water_kick', dur: 0.62, cost: 9, cancel: 0.75, move: 1.2, lunge: 3,
        active: { from: 0.42, to: 0.6, dmg: 7, range: 2.1, arc: 0.1, knock: 6, level: 1 },
        events: [[0.5, 'water.leg']],
        keys: [
          [0.0, () => {}],
          [0.3, (p, c) => { p[PY] = -0.06; legRaw(p, c.s, -0.7, 0.95, 0.35, 0.2); legIK(p, -c.s, 0.02, hipDown(-0.06) - 0.03, 0.12); S(p, 'hips', 0, 0.25 * c.s, 0); arm(p, c.s, -0.9, 0.9, 0.4, 0.7, 0.2); arm(p, -c.s, -0.9, 0.6, 0.4, 0.9, 0.2); }],
          [0.5, (p, c) => { p[PY] = -0.06; legRaw(p, c.s, -1.4, -0.25, 0.2, 0.2); legIK(p, -c.s, 0.02, hipDown(-0.06) - 0.03, 0.12); S(p, 'hips', 0, -0.45 * c.s, 0); S(p, 'chest', 0, -0.2 * c.s, 0);
            arm(p, c.s, -0.5, 1.1, 0.4, 0.5, 0.2); arm(p, -c.s, -1.2, 0.5, 0.4, 0.6, -0.6); }],
          [0.75, (p, c) => { p[PY] = -0.14; legIK(p, c.s, 0.28, hipDown(-0.14), 0.12); legIK(p, -c.s, -0.1, hipDown(-0.14), 0.14); arm(p, 1, -0.8, 0.5, 0.4, 0.9, 0.3); arm(p, -1, -0.6, 0.4, 0.4, 1.1, 0.3); }],
          [1.0, () => {}],
        ] }),
      T({ name: 'Turning Wave Kick', clip: 'water_turn', dur: 0.7, cost: 11, cancel: 0.8, move: 1.0, spin: [0.05, 0.8, 1],
        active: { from: 0.35, to: 0.7, dmg: 7, range: 2.2, arc: -1.1, knock: 6, level: 1 },
        events: [[0.55, 'water.leg2']],
        keys: [
          [0.0, () => {}],
          [0.35, (p, c) => { p[PY] = -0.3; legIK(p, -c.s, 0.1, hipDown(-0.3), 0.14); legRaw(p, c.s, -0.4, 1.0, 0.3, 0.2); S(p, 'spine', 0.15, 0, 0.1 * c.s); arm(p, 1, -0.6, 1.2, 0.4, 0.6, 0.3); arm(p, -1, -0.6, 1.2, 0.4, 0.6, 0.3); }],
          [0.7, (p, c) => { p[PY] = -0.3; legIK(p, -c.s, 0.1, hipDown(-0.3), 0.14); legRaw(p, c.s, -0.3, 0.9, 0.3, 0.2); arm(p, 1, -0.6, 1.1, 0.4, 0.7, 0.3); arm(p, -1, -0.6, 1.1, 0.4, 0.7, 0.3); }],
          [1.0, () => {}],
        ] }),
    ],
    charged: T({ name: 'Tidal Sweep', clip: 'water_tidal', dur: 0.85, cost: 18, cancel: 0.88, move: 0.5, spin: [0.1, 0.75, 1],
      events: [[0.6, 'water.charged']],
      keys: [
        [0.0, () => {}],
        [0.35, (p) => { stanceLegs(p, -0.36, 0.25, 0.4, -0.2, 0.4); S(p, 'spine', 0.3, 0, 0); arm(p, 1, -0.4, 1.3, 0.5, 0.5, 0.3); arm(p, -1, -0.4, 1.3, 0.5, 0.5, 0.3); }],
        [0.65, (p) => { stanceLegs(p, -0.3, 0.3, 0.4, -0.2, 0.4); S(p, 'spine', 0.1, 0, 0); arm(p, 1, -1.4, 0.9, 0.3, 0.3, -1.0); arm(p, -1, -1.4, 0.9, 0.3, 0.3, -1.0); }],
        [1.0, () => {}],
      ] }),
    handHold: { name: 'Draw / Water Whip', period: 1.1, move: 3.2, drain: 6,
      pose: (p, c) => { const a = c.ph * Math.PI * 2, s1 = Math.sin(a), c1 = Math.cos(a);
        stanceLegs(p, -0.16 + 0.03 * s1, 0.28, 0.14, -0.1, 0.15); S(p, 'hips', 0, 0.2 * s1, 0); S(p, 'spine', 0.06, -0.1 * s1, 0);
        arm(p, 1, -1.0 + 0.6 * s1, 0.6 + 0.35 * c1, 0.5, 0.7, 0.3); arm(p, -1, -1.0 - 0.6 * s1, 0.6 - 0.35 * c1, 0.5, 0.7, 0.3); } },
    guard: (p, c) => { const a = Math.sin((c ? c.t : 0) * 2.2);
      stanceLegs(p, -0.18, 0.22, 0.16, -0.12, 0.16); S(p, 'hips', 0, 0.15 * a, 0); S(p, 'spine', 0.05, 0, 0);
      arm(p, 1, -1.15 + 0.15 * a, 0.75, 0.6, 1.0, 0.4); arm(p, -1, -1.15 - 0.15 * a, 0.75, 0.6, 1.0, 0.4); },
    // Drowning Sphere: water drawn up from the ground into both hands (onStart) is thrown round the opponent, holds
    // them inside a ball of water, freezes into jagged ice and shatters (js/specials.js)
    special: T({ name: 'Drowning Sphere', clip: 'water_cast', onStart: 'water.specialStart', dur: 0.6, cost: 26, cancel: 0.8, move: 1, upper: true,
      events: [[0.52, 'water.special']],
      keys: [
        [0.0, () => {}],
        [0.3, (p) => { p[PY] = -0.2; arm(p, 1, -0.4, 0.5, 0.8, 1.0, 0.6); arm(p, -1, -0.4, 0.5, 0.8, 1.0, 0.6); S(p, 'spine', 0.2, 0, 0); }],
        [0.55, (p) => { p[PY] = -0.12; arm(p, 1, -1.5, 0.2, 0.2, 0.25, -1.2); arm(p, -1, -1.5, 0.2, 0.2, 0.25, -1.2); S(p, 'spine', 0.05, 0, 0); }],
        [1.0, () => {}],
      ] }),
  },
};

// ------------------------------------------------------------------ AIR: Baguazhang
const air = {
  key: 'air', name: 'Air', art: 'Baguazhang', color: 0xd9e3e8, sash: 0xe0a33a,
  stance: airStance,
  // (21 Nov, after review: "Air bending should feel super super fast compared to others") was walk 3.4, run 7.4, sprint 10.6, accel 42
  loco: { walk: 4.2, run: 9.2, sprint: 13.0, accel: 70, stride: 1.2, bob: 0.4, knee: 0.75, lean: 1.2, swing: 0.25, elbow: 0.3, carry: 0.55, out: 0.0, heavy: 0.4 },
  jump: { v: 7.8, air: 1 },
  dodge: { kind: 'airdash', dur: 0.36, speed: 19, iframes: 0.85, trail: 'air' },
  labels: { hand: 'AIR PALM', leg: 'AIR KICK', guard: 'DEFLECT', special: 'TORNADO · HOLD' },   // (21 Nov: HOLD, the Air Bomb and the Vortex)
  tech: {
    hand: T({ name: 'Air Palm', clip: ['whip_h', 'whip_d', 'fire_punch', 'whip_v'], clipSpeed: 2.1, onStart: 'air.whipOut', dur: 0.32, reach: 4.3, cost: 6, cancel: 0.52, upper: true, move: 5, lunge: 11,
      active: { from: 0.3, to: 0.5, dmg: 4, range: 1.9, arc: 0.4, knock: 6, level: 0 },
      events: [[0.32, 'air.hand']],
      keys: [
        [0.0, (p, c) => { S(p, 'chest', 0, 0.4 * c.s, 0); arm(p, -c.s, -0.9, 0.5, -0.6, 1.9, -0.6); }],
        [0.32, (p, c) => { lunge(p, c.s, -0.14, 0.32, -0.16, 0.04); S(p, 'hips', 0, -0.5 * c.s, 0); S(p, 'chest', 0.05, -0.7 * c.s, 0); S(p, 'spine', 0.1, 0, 0);
          arm(p, -c.s, -1.52, 0.04, -0.9, 0.1, -1.3); arm(p, c.s, -1.0, -0.2, -0.4, 1.7, -0.7); }],
        [0.6, (p, c) => { lunge(p, c.s, -0.14, 0.32, -0.16, 0.04); S(p, 'hips', 0, -0.4 * c.s, 0); S(p, 'chest', 0.05, -0.5 * c.s, 0); arm(p, -c.s, -1.45, 0.06, -0.9, 0.2, -1.2); }],
        [1.0, () => {}],
      ] }),
    leg: [
      T({ name: 'Crescent Air Kick', clip: 'air_crescent', dur: 0.48, cost: 8, cancel: 0.66, move: 2.5, spin: [0.04, 0.62, -1], lunge: 4,
        active: { from: 0.3, to: 0.55, dmg: 6, range: 2.2, arc: -1.1, knock: 7, level: 1 },
        events: [[0.4, 'air.leg']],
        keys: [
          [0.0, () => {}],
          [0.3, (p, c) => { p[PY] = 0.02; legRaw(p, c.s, -1.6, 0.65, 0.1, 0.1); legIK(p, -c.s, 0.0, hipDown(0.02) - 0.02, 0.04); add(p, -c.s > 0 ? 'aL' : 'aR', 0.3, 0, 0);
            arm(p, 1, -1.2, 1.0, -0.8, 0.3, -1.0); arm(p, -1, -1.0, 1.1, -0.8, 0.3, -1.0); }],
          [0.6, (p, c) => { p[PY] = 0.0; legRaw(p, c.s, -1.2, 0.3, 0.3, 0.1); legIK(p, -c.s, 0.0, hipDown(0) - 0.02, 0.04); arm(p, 1, -1.2, 0.9, -0.8, 0.3, -1.0); arm(p, -1, -1.0, 1.0, -0.8, 0.3, -1.0); }],
          [1.0, () => {}],
        ] }),
      T({ name: 'Whirlwind Kick', clip: 'air_whirl', dur: 0.6, cost: 11, cancel: 0.75, move: 4, spin: [0.05, 0.7, -1], jumpAt: [0.1, 5.2], lunge: 5,
        active: { from: 0.3, to: 0.65, dmg: 8, range: 2.3, arc: -1.1, knock: 8, level: 1 },
        events: [[0.45, 'air.leg2']],
        keys: [
          [0.0, () => {}],
          [0.3, (p) => { legRaw(p, 1, -0.9, 0.9, 0.2, 0.3); legRaw(p, -1, -0.4, 0.6, 1.2, 0.3); S(p, 'spine', 0.1, 0, 0.2); arm(p, 1, -0.6, 1.4, -0.8, 0.2, -1.0); arm(p, -1, -0.6, 1.4, -0.8, 0.2, -1.0); }],
          [0.65, (p) => { legRaw(p, -1, -0.9, 0.9, 0.2, 0.3); legRaw(p, 1, -0.4, 0.6, 1.2, 0.3); S(p, 'spine', 0.1, 0, -0.2); arm(p, 1, -0.6, 1.4, -0.8, 0.2, -1.0); arm(p, -1, -0.6, 1.4, -0.8, 0.2, -1.0); }],
          [1.0, () => {}],
        ] }),
    ],
    charged: T({ name: 'Cyclone', clip: 'air_cyclone', dur: 0.95, cost: 20, cancel: 0.9, move: 2.5, spin: [0.05, 0.9, -2],
      events: [[0.3, 'air.charged'], [0.55, 'air.charged'], [0.8, 'air.charged']],
      keys: [
        [0.0, () => {}],
        [0.2, (p) => { stanceLegs(p, -0.18, 0.1, 0.1, -0.1, 0.1); add(p, 'aL', 0.3, 0, 0); add(p, 'aR', 0.3, 0, 0); arm(p, 1, -0.5, 1.45, -0.8, 0.15, -1.0); arm(p, -1, -0.5, 1.45, -0.8, 0.15, -1.0); S(p, 'spine', -0.05, 0, 0); }],
        [0.85, (p) => { stanceLegs(p, -0.18, 0.1, 0.1, -0.1, 0.1); add(p, 'aL', 0.3, 0, 0); add(p, 'aR', 0.3, 0, 0); arm(p, 1, -0.8, 1.45, -0.8, 0.15, -1.0); arm(p, -1, -0.8, 1.45, -0.8, 0.15, -1.0); }],
        [1.0, () => {}],
      ] }),
    handHold: { name: 'Wind Push', period: 0.5, move: 3.5, drain: 10,
      pose: (p, c) => { const s1 = Math.sin(c.ph * Math.PI * 2);
        stanceLegs(p, -0.16, 0.3, 0.06, -0.2, 0.06); S(p, 'hips', 0, 0.1 * s1, 0); S(p, 'spine', 0.12, 0, 0);
        arm(p, 1, -1.45 + 0.08 * s1, 0.2, -0.9, 0.25, -1.3); arm(p, -1, -1.4 - 0.08 * s1, 0.2, -0.9, 0.25, -1.3); } },
    guard: (p, c) => { const a = Math.sin((c ? c.t : 0) * 5);
      stanceLegs(p, -0.16, 0.18, 0.05, -0.16, 0.06); S(p, 'hips', 0, 0.5 * a, 0); S(p, 'chest', 0, 0.3 * a, 0);
      arm(p, 1, -1.35, 0.6 + 0.3 * a, -0.8, 0.4, -1.1); arm(p, -1, -0.9, 0.1, -0.5, 1.5, -0.8); },
    // Tornado: a full turn of the body winds a funnel up around the bender; the end of the turn sends it out
    special: T({ name: 'Tornado', clip: 'turn_spin', onStart: 'air.specialStart', dur: 0.6, cost: 30, cancel: 0.85, move: 0,
      events: [[0.7, 'air.special']],
      keys: [
        [0.0, () => {}],
        [0.2, (p) => { arm(p, 1, -1.0, 0.4, 0.2, 1.6, 0); arm(p, -1, -0.7, 0.4, -0.6, 1.4, 0.9); }],   // holding the ball
        [0.4, (p) => { arm(p, 1, -0.7, 0.4, -0.6, 1.4, 0.9); arm(p, -1, -1.0, 0.4, 0.2, 1.6, 0); }],
        [1.0, () => {}],
      ] }),
  },
};

// Water: the push that throws the Dragon Stream (started by HAND while the stream circulates)
water.tech.release = T({ name: 'Dragon Release', clip: 'water_palm', dur: 0.5, cost: 0, cancel: 0.75, move: 1.5, upper: true, events: [[0.52, 'water.specialRelease']], keys: [[0, () => {}], [1, () => {}]] });
export const STYLES = { earth, fire, water, air };
export const ELEMENTS = ['earth', 'fire', 'water', 'air'];

// Kick while stepping forward: one shared authored take; each element supplies its own effect at the impact.
// LEG while running uses it, so attacks keep the fighter's momentum instead of stopping the run.
const MOVE_EVENT = { earth: 'earth.leg', fire: 'fire.leg', water: 'water.lance', air: 'air.leg' };
for (const st of Object.values(STYLES)) {
  st.tech.legMove = T({ name: 'Running Kick', clip: 'move_kick', travels: true, dur: 0.55, cost: 9, cancel: 0.7, move: 4.6, lunge: 3,
    active: { from: 0.4, to: 0.58, dmg: 8, range: 2.3, arc: 0.45, knock: 6, level: 1 },
    events: [[0.45, MOVE_EVENT[st.key]]],
    keys: [[0.0, () => {}], [1.0, () => {}]] });
}

// ------------------------------------------------------------------ master specification (16 Nov) additions
// A third kick closes every LEG chain; Earth and Fire share the stomp (the same authored stamp, different results:
// rocks erupt under the opponent / a ring of fire expands from the foot). onStart fires when the technique begins.
const K0 = [[0.0, () => {}], [1.0, () => {}]];
const THIRD = {
  earth: T({ name: 'Axe Kick', clip: 'axe_kick', dur: 0.7, cost: 12, cancel: 0.8, move: 0.4, lunge: 3,
    active: { from: 0.45, to: 0.62, dmg: 11, range: 2.2, arc: 0.4, knock: 7, level: 1 }, events: [[0.5, 'earth.seismic']], keys: K0 }),
  fire: T({ name: 'Knee Strike', clip: 'knee_strike', dur: 0.45, cost: 10, cancel: 0.7, move: 1.5, lunge: 6,
    active: { from: 0.4, to: 0.6, dmg: 10, range: 1.9, arc: 0.3, knock: 8, level: 1 }, events: [[0.45, 'fire.knee']], keys: K0 }),
  water: T({ name: 'Rising Water Kick', clip: 'axe_kick', dur: 0.7, cost: 12, cancel: 0.8, move: 0.4, lunge: 2,
    active: { from: 0.45, to: 0.62, dmg: 7, range: 2.1, arc: 0.4, knock: 6, level: 1 }, events: [[0.5, 'water.column']], keys: K0 }),
  air: T({ name: 'Rising Wind Kick', clip: 'axe_kick', dur: 0.62, cost: 11, cancel: 0.78, move: 1.5, lunge: 3,
    active: { from: 0.45, to: 0.62, dmg: 6, range: 2.1, arc: 0.4, knock: 9, level: 1 }, events: [[0.5, 'air.column']], keys: K0 }),
};
for (const k of Object.keys(THIRD)) STYLES[k].tech.leg.push(THIRD[k]);
// Fire's fourth kick: a cartwheel flip whose feet pass overhead throwing flame along their path
STYLES.fire.tech.leg.push(T({ name: 'Flip Kick', clip: 'flip_kick', dur: 0.9, cost: 12, cancel: 0.82, move: 2, lunge: 3,
  active: { from: 0.45, to: 0.6, dmg: 9, range: 2.0, arc: 0.3, knock: 7, level: 1 }, events: [[0.42, 'fire.flip'], [0.55, 'fire.flip2']], keys: K0 }));
// Earth (M6): a push kick that drives a slab of rock out of the ground, and a rising uppercut that erupts a rock
// column under the opponent (the third punch of the HAND chain, events chosen by clip in earth.hand)
// Earth, LEG chain (M9): the Flair: down on the hands, the legs sweep round twice and a ring of rock bursts out (earth.flair)
STYLES.earth.tech.leg.push(T({ name: 'Flair Sweep', clip: 'earth_flair', clipSpeed: 1.0, dur: 1.0, cost: 12, cancel: 0.85, full: true, fadeIn: 0.28, fadeOut: 0.32, move: 0.5, keys: K0,
  active: { from: 0.4, to: 0.7, dmg: 9, range: 2.3, arc: -1.6, knock: 7, level: 2 }, events: [[0.5, 'earth.flair']] }));
STYLES.earth.tech.leg.push(T({ name: 'Rock Push Kick', clip: 'earth_teep', dur: 0.6, cost: 11, cancel: 0.72, move: 0.5, lunge: 3, keys: K0,
  active: { from: 0.45, to: 0.6, dmg: 9, range: 2.2, arc: 0.3, knock: 9, level: 1 }, events: [[0.48, 'earth.teep']] }));
// the chain opens with the quick jab (impact 0.21 s); the heavy lunge punch (impact 0.52 s) is the second strike
STYLES.earth.tech.hand.clip = ['earth_punch2', 'earth_punch', 'fire_punch2'];
// (20 Nov, Earth phase one: new skills, earth.js) Dust Cloud: HAND with the stick pulled away from the rival. Brush Knee
// and Push (Tai Chi capture): the weight settles on the supporting leg, the lead arm sweeps down and up across the body
// drawing the dust, the step drives the other palm out; the storm leaves on the push. HAND kept held: the charged storm.
STYLES.earth.tech.dust = T({ name: 'Dust Cloud', clip: 'tc_brush_palm', clipSpeed: 2.2, dur: 0.7, cost: 14, cancel: 0.8, move: 0.6, keys: K0,
  events: [[0.45, 'earth.dust']] });
// (20 Nov, after review: the new moves were too hidden) SPECIAL tapped: Dust Storm (the same stamp and palm thrust,
// the dust fills the arena); SPECIAL held 0.3 s: Quicksand; LEG held: Earth Sinking; GUARD held 0.6 s: Rock Man
STYLES.earth.tech.storm = T({ name: 'Dust Storm', clip: 'tc_brush_palm', clipSpeed: 2.2, dur: 0.7, cost: 30, cancel: 0.8, move: 0.6, keys: K0, events: [[0.45, 'earth.storm']] });
// SPECIAL with the stick toward the rival: Earth Sinking (sink, both palms driven down into the ground)
STYLES.earth.tech.sink = T({ name: 'Earth Sinking', clip: 'earth_gather', clipSpeed: 2.6, dur: 0.6, cost: 22, cancel: 0.85, move: 0, keys: K0, events: [[0.42, 'earth.sink']] });
// SPECIAL with the stick to the side: Quicksand (a stable horse stance, the hands circling down)
STYLES.earth.tech.quicksand = T({ name: 'Quicksand', clip: 'earth_lift', clipSpeed: 1.4, dur: 0.8, cost: 20, cancel: 0.85, move: 0, keys: K0, events: [[0.5, 'earth.quicksand']] });
// SPECIAL with the stick pulled away: Rock Armour (a stamp; the stone climbs the body from the feet)
STYLES.earth.tech.armour = T({ name: 'Rock Armour', clip: 'stomp', dur: 0.95, cost: 30, cancel: 0.86, move: 0, keys: K0, events: [[0.5, 'earth.armour']] });

// Water's whip slam (M6): the whip wraps the rival and the bender lifts them overhead and slams them down
// (Mixamo Grab And Slam from the pull: the arms haul the whip back, lift it overhead, slam down to one knee; see weapons.grabSlam)
// (18 Nov: the Tai Chi 24 Form clips captured from video were tried here and taken out the same day: chained at
//  combat speed the captured body turns and capture noise made the bender twitch. The previous chain is restored)
// 18 Nov (M9): the flowing moves from the Drive dances join Water: the arm wave (Wave Hip Hop Dance) is a whip thrown
// on a ripple that runs through both arms; on LEG, the Butterfly Twirl kick and the tucked Spinning jump that throws a
// ring of water. These are studio motion capture (Mixamo), smooth at combat speed, and pass the gameplay jitter gate.
// (18 Nov, after the second review: the arm wave from Wave Hip Hop Dance is out: mid-combo it bent the body over
//  with the arms crossed and the hips twisted, the contortion in the recording)
STYLES.water.tech.hand.clip = ['whip_h', 'fire_jab', 'whip_v', 'fire_punch', 'whip_d', 'earth_punch', 'water_palm'];
STYLES.water.tech.leg.push(T({ name: 'Butterfly Twirl Kick', clip: 'water_twirl', dur: 0.9, cost: 11, cancel: 0.8, move: 2.5, lunge: 4, keys: K0,
  active: { from: 0.45, to: 0.65, dmg: 9, range: 2.3, arc: -1.2, knock: 7, level: 1 }, events: [[0.5, 'water.leg2']] }));
STYLES.water.tech.leg.push(T({ name: 'Spinning Water Ring', clip: 'water_spin', dur: 0.75, cost: 12, cancel: 0.8, move: 0.5, keys: K0,
  active: { from: 0.45, to: 0.62, dmg: 7, range: 2.2, arc: -1.4, knock: 6, level: 1 }, events: [[0.5, 'water.spin']] }));
// the Tidal Wave: Snake Creeps Down, sinking low and surging forward as the wave goes out
STYLES.water.tech.leg.push(T({ name: 'Water Sweep', clip: 'earth_sweep', dur: 0.62, cost: 11, cancel: 0.75, move: 0.5, lunge: 3, keys: K0,
  active: { from: 0.45, to: 0.68, dmg: 8, range: 2.4, arc: -1.4, knock: 4, level: 2 }, events: [[0.5, 'water.sweep']] }));
// a punch at the lingering ice shield (GUARD let go): a spike breaks off it and flies at the opponent (water.iceShot)
STYLES.water.tech.icePunch = T({ name: 'Ice Shard Punch', clip: ['fire_jab', 'fire_punch'], dur: 0.3, cost: 3, cancel: 0.55, move: 1, upper: true, keys: K0, events: [[0.45, 'water.iceShot']] });
// LEG while Fire jet-glides: both palms drive a blast of flame forward; the legs stay on the jets (fire.glideBlast)
STYLES.fire.tech.glideBlast = T({ name: 'Jet Blast', clip: 'water_palm', dur: 0.42, cost: 6, cancel: 0.6, move: 0, upper: true, keys: K0, events: [[0.5, 'fire.glideBlast']] });
// LEG while riding the ice arch: both palms push a volley of three ice spikes (water.archShot)
STYLES.water.tech.glideBlast = T({ name: 'Ice Volley', clip: 'water_palm', dur: 0.42, cost: 6, cancel: 0.6, move: 0, upper: true, keys: K0, events: [[0.5, 'water.archShot']] });
// Fire, GUARD + SPECIAL: Dragon's Breath (Mixamo Zombie Scream: draws in, leans forward and roars): a ball of fire
// breathed out of the mouth that engulfs whoever it hits, burning them for a few seconds (fire.breath, elements.js)
STYLES.fire.tech.breath = T({ name: "Dragon's Breath", clip: 'fire_breath', clipSpeed: 0.9, dur: 1.4, cost: 30, cancel: 0.95, move: 0, keys: K0, events: [[0.2, 'fire.breathInhale'], [0.5, 'fire.breath']] });   // (19 Nov: slower, so the roar is held; inhale, then ignite)
// HAND while riding the ice (the arch dodge or the ice surf): punches only, each throwing a ball of water or ice
// (18 Nov, after review: no whips while riding)
STYLES.water.tech.surfPunch = T({ name: 'Water Punch', clip: ['fire_jab', 'fire_punch'], dur: 0.3, cost: 4, cancel: 0.55, move: 1, upper: true, keys: K0, events: [[0.52, 'water.hand']] });
// in the air (water lifted on its column, Fire high on its jets): LEG is a somersault kick; the leg comes over and a
// wave of water / fire leaves it and smashes down on the rival (water.airFlip / fire.airFlip)
for (const k of ['water', 'fire']) STYLES[k].tech.airFlip = T({ name: 'Somersault Smash', clip: 'flip_kick', clipSpeed: 1.7, dur: 0.7, cost: 10, cancel: 0.8, move: 2, lunge: 2, keys: K0, events: [[0.5, k + '.airFlip']] });
STYLES.water.tech.whipSlam = T({ name: 'Whip Slam', clip: 'water_grabslam', clipSpeed: 1.6, dur: 1.1, cost: 0, cancel: 0.85, move: 0, keys: K0, events: [] });
// Fire's kick chain (17 Nov, M6): kick-heavy and flowing, each kick its own authored clip, every kick throwing flame
// from the kicking leg. LEG taps run through it in order; the chain restarts after a pause.
{
  const F = STYLES.fire.tech, byName = (n) => F.leg.find(t => t.name === n);
  const flame = byName('Flame Kick'), spin = byName('Spinning Flame Kick'), flip = byName('Flip Kick');
  const K = (o) => T({ cost: 9, cancel: 0.7, move: 0.8, lunge: 5, keys: K0, ...o });
  F.leg = [
    flame,
    K({ name: 'High Front Kick', clip: 'fire_front', dur: 0.5, active: { from: 0.4, to: 0.58, dmg: 8, range: 2.2, arc: 0.3, knock: 6, level: 1 }, events: [[0.45, 'fire.leg']] }),
    spin,
    K({ name: 'Body Kick', clip: 'fire_body', dur: 0.55, active: { from: 0.42, to: 0.6, dmg: 9, range: 2.2, arc: 0.4, knock: 6, level: 1 }, events: [[0.48, 'fire.leg']] }),
    K({ name: 'Flaming Sweep', clip: 'sweep_spin', dur: 0.62, cost: 11, active: { from: 0.45, to: 0.7, dmg: 9, range: 2.4, arc: -1.4, knock: 4, level: 2 }, events: [[0.5, 'fire.sweep']] }),
    K({ name: 'Hurricane Kick', clip: 'hurricane', clipSpeed: 1.6, dur: 1.0, cost: 14, cancel: 0.8, move: 1.5, jumpAt: [0.05, 6.5],
      active: { from: 0.3, to: 0.8, dmg: 7, range: 2.4, arc: -1.4, knock: 6, level: 1 }, events: [[0.32, 'fire.hurricane'], [0.52, 'fire.hurricane'], [0.72, 'fire.hurricane']] }),
    K({ name: 'Jumping Front Kick', clip: 'fire_jumpfront', dur: 0.75, cost: 11, jumpAt: [0.25, 5.5], active: { from: 0.45, to: 0.62, dmg: 10, range: 2.3, arc: 0.3, knock: 8, level: 1 }, events: [[0.48, 'fire.leg']] }),
    K({ name: 'Spinning Heel Kick', clip: 'fire_heel', dur: 0.62, cost: 11, active: { from: 0.42, to: 0.62, dmg: 10, range: 2.3, arc: -1.1, knock: 7, level: 1 }, events: [[0.46, 'fire.spin']] }),
    flip,
  ].filter(Boolean);
}
// every element: LEG in the air is a jumping kick, right foot first, then the left (alternating while airborne)
for (const k of ['earth', 'fire', 'water', 'air']) STYLES[k].tech.airKick = T({ name: 'Air Kick', clip: 'jump_kick', clipSpeed: 3.0, dur: 0.38, cost: 6, cancel: 0.55, move: 2.5, lunge: 4,
  active: { from: 0.5, to: 0.68, dmg: 7, range: 2.1, arc: 0.4, knock: 6, level: 1 }, events: [[0.55, k + '.airKick']], keys: K0 });
// Fire in the air: quick alternating kicks (bicycle-style), each throwing flame from its own foot (Mixamo Kicking and
// its mirror; a dedicated bicycle-kick clip is not among the downloads)
STYLES.fire.tech.airKick = T({ name: 'Flaming Air Kick', clip: 'jump_kick', clipSpeed: 3.6, dur: 0.3, cost: 5, cancel: 0.5, move: 2.5, lunge: 3,
  active: { from: 0.45, to: 0.65, dmg: 7, range: 2.1, arc: 0.4, knock: 6, level: 1 }, events: [[0.5, 'fire.airKick']], keys: K0 });
// Air's kick in the air is the spinning hurricane kick (Mixamo Hurricane Kick), the leg extended through the turn
STYLES.air.tech.airKick = T({ name: 'Hurricane Kick', clip: 'hurricane', clipSpeed: 2.0, dur: 0.8, cost: 7, cancel: 0.6, move: 3, lunge: 4,
  active: { from: 0.5, to: 0.7, dmg: 8, range: 2.3, arc: 0.6, knock: 6, level: 1 }, events: [[0.55, 'air.airKick']], keys: K0 });
// every element: somersaults (DODGE in the air) and a roll (GUARD + DODGE); no damage, they are evasions
for (const k of ['earth', 'fire', 'water', 'air']) {
  STYLES[k].tech.flip = T({ name: 'Somersault', clip: 'flip_front', clipSpeed: 2.0, dur: 0.6, cost: 6, cancel: 0.8, move: 4, keys: K0 });
  STYLES[k].tech.flipBack = T({ name: 'Back Somersault', clip: 'dodge_back', clipSpeed: 2.2, dur: 0.6, cost: 6, cancel: 0.8, move: 3, keys: K0 });
  // (M6: the roll plays a little quicker, 0.62 s from 0.83, so an evasion does not leave the fighter committed for so long)
  STYLES[k].tech.roll = T({ name: 'Roll', clip: 'roll_dive', clipSpeed: 2.7, dur: 0.6, cost: 6, cancel: 0.8, move: 6, keys: K0 });
}
for (const k of ['earth', 'fire']) STYLES[k].tech.stomp = T({ name: k === 'earth' ? 'Earth Stomp' : 'Fire Stomp', clip: 'stomp', dur: 0.95, cost: 22, cancel: 0.86, move: 0,
  onStart: k + '.stompMark', events: [[0.5, k + '.stomp']], keys: K0 });
STYLES.water.tech.charged.name = 'Tidal Wave';
STYLES.air.tech.charged.name = 'Air Compression';
STYLES.water.tech.hand.name = 'Water Whip';
STYLES.air.tech.hand.name = 'Air Whip';
STYLES.water.tech.handHold.name = 'Twin Water Whips';
STYLES.air.tech.handHold.name = 'Twin Air Streams';
STYLES.water.labels.hand = 'WATER WHIP'; STYLES.air.labels.hand = 'AIR WHIP · HOLD BLAST';
STYLES.air.tech.charged.events = [[0.55, 'air.charged']];   // one compressed release

// Air's kicks (19 Nov, from the reference video's airbender): a low wind sweep and the floor spin in a whirl of wind
// join the Crescent and Whirlwind kicks (air.sweep / air.flair in elements.js)
STYLES.air.tech.leg.push(T({ name: 'Ground Gust Sweep', clip: 'earth_sweep', dur: 0.62, cost: 10, cancel: 0.75, move: 0.5, lunge: 3, keys: K0,
  active: { from: 0.45, to: 0.68, dmg: 6, range: 2.4, arc: -1.4, knock: 6, level: 2 }, events: [[0.5, 'air.sweep']] }));
STYLES.air.tech.leg.push(T({ name: 'Wind Flair', clip: 'earth_flair', clipSpeed: 1.0, dur: 1.0, cost: 12, cancel: 0.85, full: true, fadeIn: 0.28, fadeOut: 0.32, move: 0.5, keys: K0,
  events: [[0.35, 'air.flair'], [0.62, 'air.flair']] }));

// ---------------------------------------------------------------- Fire restructuring, phase one (19 Nov)
// Fire Jabs: HAND taps, left-right, about 0.3 s each (they were 0.56 s); the fist throws the fireball (fire.hand)
STYLES.fire.tech.hand.clipSpeed = 2.7;
// (the lunging hook, earth_punch, turns the whole body a quarter turn: at jab speed that read as a jerk; the jabs are
// the jab and the cross, each mirrored, so taps alternate left and right)
STYLES.fire.tech.hand.clip = ['fire_jab', 'fire_punch'];
// Fire Daggers and Fire Blade (one melee family): HAND at close range (rival within 2.3 m, on the floor). Two quick
// dagger slashes with short flames on both hands (elbows bent, whip_h / whip_d at speed), then a Fire Blade cut with
// long flame blades (whip_d_single: the torso turns into a downward diagonal cut). fire.dagger in elements.js.
// (19 Nov, later: the user's knife animations from the Drive replace the whip clips: Stable Sword Inward / Outward
// Slash, Stabbing, and Thrust Slash's spin into a two-armed slash for the Fire Blade finisher)
STYLES.fire.tech.melee = T({ name: 'Fire Daggers', clip: ['dagger_in', 'dagger_out', 'dagger_stab', 'blade_spin'], clipSpeed: 1.8, dur: 0.32, cost: 4, cancel: 0.62, move: 1.5, lunge: 8, keys: K0,
  events: [[0.45, 'fire.dagger']] });
// Fire Whip: HAND with the stick pulled away from the rival (draw back and lash): the arm draws back and the whip is
// released on the swing, following the hand (whip_v overhead, whip_h across). fire.whip in elements.js.
STYLES.fire.tech.whip = T({ name: 'Fire Whip', clip: ['whip_v', 'whip_h'], clipSpeed: 2.6, dur: 0.5, cost: 7, cancel: 0.7, move: 0.5, keys: K0,
  events: [[0.42, 'fire.whip']] });
// Fire Bomb: in the air, LEG held: the fighter drives down feet first and explodes on landing (from the reference: a
// leap that comes down in a dome of fire). The dive is in fighter.js, the blast is fire.bomb in elements.js.
STYLES.fire.tech.bomb = T({ name: 'Fire Bomb', clip: 'fire_fly', clipSpeed: 2.0, dur: 0.6, cost: 18, cancel: 0.95, move: 0, keys: K0, events: [] });
// Fire Comet (special): SPECIAL held for 0.3 s and released. Both hands draw a growing ball of fire in front of the
// chest (Standing 2H Magic Attack) and drive it out; it flies at the rival and explodes. 40 energy, 8 s cooldown.
// (20 Nov, after review) the Comet: both arms rise overhead (whip_v, the overhead strike), and the pose is HELD there
// while a concentrated mass of fire gathers above the raised palms and swells into an enormous glowing ball
// (updateComets pins the clip and the technique's clock for the charge); then the hips and shoulders turn and the arms
// drive forwards and downwards, and the Comet leaves on that drive. Events as fractions of the 1.4 s clip.
STYLES.fire.tech.comet = T({ name: 'Fire Comet', clip: 'whip_v', clipSpeed: 1, dur: 1.4, cost: 40, cancel: 0.85, move: 0, keys: K0, rawTiming: true,
  events: [[0.17, 'fire.cometCharge'], [0.63, 'fire.cometLaunch']] });
// (20 Nov, after review) LEG held (the charged stamp) is Earth Sinking for Earth: the rock trap under the rival
STYLES.earth.tech.stomp = STYLES.earth.tech.sink;
// (20 Nov, Earth brief) Earth Compression's release: a palm thrust (Air Palm's capture) drives the compressed stone out
STYLES.earth.tech.thrust = T({ name: 'Stone Thrust', clip: 'air_palm', clipSpeed: 1.6, dur: 0.5, cost: 0, cancel: 0.6, move: 0.5, upper: true, keys: K0, events: [[0.4, 'earth.thrust']] });
// (20 Nov, Earth brief: the rest of Earth's moves, on simple inputs)
// HAND with the stick pulled away: Earth Hand (one hand thrust at the rival, the fingers closing)
STYLES.earth.tech.earthHand = T({ name: 'Earth Hand', clip: 'air_palm', clipSpeed: 1.3, dur: 0.6, cost: 24, cancel: 0.8, move: 0.3, keys: K0, events: [[0.4, 'earth.hand2']] });
// LEG with the stick pulled away: Ground Shift (the horse-stance horizontal sweep: the hips turn, the forearms sweep sideways)
STYLES.earth.tech.shift = T({ name: 'Ground Shift', clip: 'whip_h_horse', clipSpeed: 1.8, dur: 0.6, cost: 16, cancel: 0.8, move: 0.3, keys: K0, events: [[0.45, 'earth.shift']] });
// GUARD held + LEG: Slab Shackles (the hands draw in and close: the gathering of Standing 2H Magic Attack)
STYLES.earth.tech.shackles = T({ name: 'Slab Shackles', clip: 'magic_2h', clipSpeed: 2.2, dur: 0.7, cost: 20, cancel: 0.85, move: 0, keys: K0, events: [[0.6, 'earth.shackles']] });
// SPECIAL held 1 s: Earthbreaker (Tai Chi Push: the deep stance, the arms gather, then both palms drive forward; the
// gathering pose is held about 1 s while the mass forms, earth.js updateBreakers)
// (20 Nov, after review: "the earth bender's stance on Earthbreaker is horrible ... does not look natural") the Tai Chi
// push (arms flung wide, head back, the weight on one leg) is replaced by Casting Spell's low rooted lunge: he sinks with
// the hands low by the hips while the rocks gather (held there, earth.js), then the arm sweeps and thrusts at the rival
STYLES.earth.tech.breaker = T({ name: 'Earthbreaker', clip: 'earth_pillar', clipSpeed: 1.3, dur: 1.4, cost: 50, cancel: 0.75, move: 0, keys: K0, rawTiming: true,
  events: [[0.03, 'earth.breakerGather'], [0.27, 'earth.breakerLaunch']] });
// (20 Nov, after review) the grounded stab: the rival on the floor; the knees bend, the body sinks and both flame daggers
// drive down into them (Hard Landing's drop into a deep crouch, the hand driven to the floor in front), then he rises. The blades are the
// hitboxes (elements.js bladeContact)
STYLES.fire.tech.groundStab = T({ name: 'Grounded Stab', clip: 'hard_land', clipSpeed: 2.2, dur: 0.6, cost: 4, cancel: 0.8, move: 1.2, lunge: 12, keys: K0, events: [[0.42, 'fire.dagger']] });

// (20 Nov, Airbending brief) the added Air skills. (21 Nov, after review: "the new moves need to be out, similar to Fire:
// long press HAND and different moves come out ... I can't be holding GUARD and another option") every one comes from a
// single button, by tap or long press and by where the rival is (fighter.js airHandTech and the LEG / SPECIAL tiers):
//   HAND tap: rival within 3 m the palm combination; 2.5 to 8.5 m the Air Whip as before; beyond 8.5 m Suction
//   HAND long press: the Twin Air Streams as before; letting go fires the Air Blast
//   HAND during the dodge: the Air Swipe
//   LEG tap: the kicks as before; the rival beyond 5 m, the Air Blades
//   LEG long press: the Air Compression as before; in the air or in flight, the Air Bomb dive (it bursts where he lands)
//   SPECIAL: tap the Tornado; held 0.3 s the Air Bomb; held 1 s the Air Vortex
STYLES.air.tech.airBlast = T({ name: 'Air Blast', clip: 'air_palm', clipSpeed: 1.4, dur: 0.64, cost: 6, cancel: 0.55, upper: true, move: 1, keys: K0, events: [[0.45, 'air.blast']] });
STYLES.air.tech.airSwipe = T({ name: 'Air Swipe', clip: 'air_vortex', clipSpeed: 1.6, dur: 0.6, cost: 9, cancel: 0.65, move: 1.2, keys: K0, events: [[0.45, 'air.swipe']] });
STYLES.air.tech.airBlades = T({ name: 'Air Blades', clip: 'whip_d', clipSpeed: 1.8, dur: 0.55, cost: 9, cancel: 0.65, upper: true, move: 0.8, keys: K0, events: [[0.45, 'air.blade1'], [0.6, 'air.blade2']] });
STYLES.air.tech.airBomb = T({ name: 'Air Bomb', clip: 'stand_jump', clipSpeed: 1.5, dur: 0.95, cost: 16, cancel: 0.75, move: 0, keys: K0, rawTiming: true, events: [[0.32, 'air.bomb']] });
STYLES.air.tech.suction = T({ name: 'Suction', clip: 'water_redirect', clipSpeed: 1.5, dur: 0.6, cost: 10, cancel: 0.7, upper: true, move: 0.5, keys: K0, events: [[0.4, 'air.suction']] });
// (21 Nov) Air Vortex: the arms circle in front of the body (the qigong circling of the guard) while the cyclone winds
// up round the bender, then it is sent at the rival
STYLES.air.tech.airVortex = T({ name: 'Air Vortex', clip: 'water_flow', clipSpeed: 2.4, keepDur: true, onStart: 'air.vortexStart', dur: 0.9, cost: 45, cancel: 0.9, move: 0, rawTiming: true, keys: K0, events: [[0.8, 'air.special']] });
// (21 Nov, after review: "Air bending should feel super super fast") every Air technique plays 1.3 times faster, so its
// strikes land sooner and recover sooner (mocap.js adoptTiming)
STYLES.air.tempo = 1.3;
// (21 Nov) the palm combination, close in (HAND taps within 2.5 m): open palm, turning palm, gale kick
STYLES.air.tech.airCombo = [
  T({ name: 'Air Palm Strike', clip: 'fire_jab', clipSpeed: 2.2, dur: 0.38, cost: 4, cancel: 0.5, upper: true, move: 1.5, lunge: 6, keys: K0, events: [[0.4, 'air.combo0']] }),
  T({ name: 'Turning Palm', clip: 'whip_h', clipSpeed: 2.0, dur: 0.45, cost: 4, cancel: 0.55, upper: true, move: 1.5, lunge: 5, keys: K0, events: [[0.4, 'air.combo1']] }),
  T({ name: 'Gale Kick', clip: 'move_kick', clipSpeed: 1.7, dur: 0.6, cost: 6, cancel: 0.7, move: 1.2, lunge: 4, keys: K0, events: [[0.45, 'air.combo2']] }),
];
