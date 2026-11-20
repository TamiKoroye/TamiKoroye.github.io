// Hero character: a professionally rigged CC0 humanoid (Quaternius Universal Animation Library mannequin,
// 53-bone skeleton) driven by a blend of
//   (a) authored animation clips (idle, walk, jog, sprint, jump, roll, hit reactions) via THREE.AnimationMixer, and
//   (b) the game's procedural martial-arts system (styles.js), retargeted bone-by-bone from the invisible
//       driver rig onto this skeleton (stances, kicks, palm strikes, guards, bending gestures).
// The mesh is recoloured from its own skin weights into a bald, shirtless fighter with trousers, sash and wraps,
// cel-shaded with a gradient map and given an ink outline, matching the reference footage's look.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { HIP_H } from './character.js';
import { MOCAP, clipFor, LOOPS, LOOP_SPEED, STANCE_MIX } from './mocap.js';

let TEMPLATE = null, CLIPS = null;
export const heroReady = () => !!TEMPLATE;

// three-step cel ramp shared by characters and the arena
export const TOON_RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([96, 96, 96, 255, 168, 168, 168, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();

const USED = ['Fixing_Kneeling', 'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Hit_Chest', 'Hit_Head', 'Death01', 'Punch_Jab', 'Punch_Cross', 'Spell_Simple_Shoot'];

// The character is a binary glTF inside an ES module (assets/characters/ual-mannequin.glb.js): loaded like the
// game's own code and parsed in memory, with no fetch/XHR (some embedded hosts block those but allow scripts).
export async function loadHeroAssets() {
  let mod;
  try { mod = await import('../assets/characters/ual-mannequin.glb.js'); }
  catch (e) { throw new Error('character module assets/characters/ual-mannequin.glb.js did not load: ' + (e && e.message || e)); }
  const bin = atob(mod.default), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const g = await new GLTFLoader().parseAsync(bytes.buffer, '');
  let bones = 0, skinned = 0; g.scene.traverse(o => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
  if (!skinned || bones < 50) throw new Error(`character decoded without its skeleton (${bones} bones, ${skinned} skinned meshes)`);
  TEMPLATE = g;
  CLIPS = {};
  for (const name of USED) {
    const src = g.animations.find(a => a.name === name); if (!src) continue;
    const clip = src.clone();
    // in-place: drop root motion and pin the hips horizontally (the game moves the fighter itself)
    clip.tracks = clip.tracks.filter(t => t.name !== 'root.position');
    const hp = clip.tracks.find(t => t.name === 'DEF-hips.position');
    // the hips' parent (root) is Z-up: local X and Y are the ground plane, Z is height. Only the ground-plane
    // components are pinned, so crouching, kneeling, rolling and falling keep their real hip height
    if (hp) { const v = hp.values, x0 = v[0], y0 = v[1]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 1] = y0; } }
    CLIPS[name] = clip;
  }
  return g;
}

// my driver joint -> mannequin bone
const MAP = {
  hips: 'DEF-hips', spine: 'DEF-spine001', chest: 'DEF-spine003', neck: 'DEF-neck', head: 'DEF-head',
  sL: 'DEF-upper_armL', eL: 'DEF-forearmL', wL: 'DEF-handL', sR: 'DEF-upper_armR', eR: 'DEF-forearmR', wR: 'DEF-handR',
  hL: 'DEF-thighL', kL: 'DEF-shinL', aL: 'DEF-footL', hR: 'DEF-thighR', kR: 'DEF-shinR', aR: 'DEF-footR',
};
const LOWER = new Set(['hips', 'hL', 'kL', 'aL', 'hR', 'kR', 'aR']);
// rest directions of my driver bones (arms hang, legs down, feet forward, trunk up)
const MY_DIR = { hips: [0, 1, 0], spine: [0, 1, 0], chest: [0, 1, 0], neck: [0, 1, 0], head: [0, 1, 0],
  sL: [0, -1, 0], eL: [0, -1, 0], wL: [0, -1, 0], sR: [0, -1, 0], eR: [0, -1, 0], wR: [0, -1, 0],
  hL: [0, -1, 0], kL: [0, -1, 0], aL: [0, -0.25, 1], hR: [0, -1, 0], kR: [0, -1, 0], aR: [0, -0.25, 1] };
// child used to measure each mannequin bone's rest direction
const UAL_CHILD = { 'DEF-hips': 'DEF-spine001', 'DEF-spine001': 'DEF-spine002', 'DEF-spine003': 'DEF-neck', 'DEF-neck': 'DEF-head', 'DEF-head': null,
  'DEF-upper_armL': 'DEF-forearmL', 'DEF-forearmL': 'DEF-handL', 'DEF-handL': 'DEF-f_middle01L', 'DEF-upper_armR': 'DEF-forearmR', 'DEF-forearmR': 'DEF-handR', 'DEF-handR': 'DEF-f_middle01R',
  'DEF-thighL': 'DEF-shinL', 'DEF-shinL': 'DEF-footL', 'DEF-footL': 'DEF-toeL', 'DEF-thighR': 'DEF-shinR', 'DEF-shinR': 'DEF-footR', 'DEF-footR': 'DEF-toeR' };

// bones driven by the upper-body layer (everything above the hips)
const UPPER_RE = /spine|neck|head|shoulder|upper_arm|forearm|hand|f_|thumb/;

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);

// Hand shapes. Each finger joint curls about its local X axis on this skeleton (checked in a render); values are the
// curl of the [base, middle, tip] joints in radians, plus thumb curl and finger spread (local Z).
//   fist  : Hung Gar / Northern Shaolin striking fist        claw : tiger claw (gripping rock)
//   palm  : flat open palm with joined fingers (Air)         flow : relaxed, curved Tai Chi hand (Water)
//   relax : loose hand (reactions, falls)
const HANDS = {
  fist:  { f: [1.45, 1.6, 1.2], pinky: 0.1, thumb: [0.55, 0.6, 0.4], spread: 0 },
  claw:  { f: [0.55, 1.05, 0.85], pinky: 0.15, thumb: [0.25, 0.35, 0.3], spread: 0.12 },
  palm:  { f: [-0.3, -0.22, -0.12], pinky: 0, thumb: [-0.1, -0.05, 0], spread: 0.05 },
  flow:  { f: [-0.12, 0.02, 0.04], pinky: 0.14, thumb: [0, 0, 0], spread: 0.08 },
  relax: { f: [0.45, 0.55, 0.35], pinky: 0.12, thumb: [0.2, 0.25, 0.2], spread: 0.02 },
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const REACT = /^(hit_|Hit_|knockback|getup|block_hit|run_stop|struggle)/;

function rigQuat(o, stop, out) { out.identity(); for (let x = o; x && x !== stop; x = x.parent) out.premultiply(x.quaternion); return out; }
function rigPos(o, stop, out) { o.updateWorldMatrix(true, false); stop.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_m.copy(stop.matrixWorld).invert()); }

// the frame of Running Arc held as Fire's glide stance (seconds into the baked clip)
const GLIDE_POSE_T = 0.2;
// (20 Nov, after review: "when sliding on rock the arms flail like a confused person") Earth's rock-surf stance is one
// held frame of the surf stance (feet staggered, knees bent, the lead arm forward, the other near the chest); the clip
// looped its arms round every four seconds. The body's lean and the knees' give come from the slab's motion (fighter.js)
const EARTH_SURF_T = 2.3;
export class Hero {
  // parent: the group that also holds the driver's hips (the fighter's "offs" group); driverJ: driver bones
  constructor(parent, driverJ, colors) {
    this.parent = parent; this.J = driverJ;
    this.scene = SkeletonUtils.clone(TEMPLATE.scene);
    parent.add(this.scene);
    this.bones = {}; this.order = [];
    this.scene.traverse(o => { if (o.isBone) { this.bones[o.name] = o; } });
    const walk = (b) => { this.order.push(b); for (const c of b.children) if (c.isBone) walk(c); };
    walk(this.bones.root);
    this.meshes = [];
    this.scene.traverse(o => { if (o.isSkinnedMesh) this.meshes.push(o); });
    this.material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP });
    this.colors = colors;
    this.sashIdx = [];
    for (const m of this.meshes) this.dress(m);
    this.outline();
    this.face();

    // ---- rest data for retargeting (both rigs are in their rest poses at construction)
    this.scene.updateMatrixWorld(true);
    this.rest = {};
    for (const [my, ual] of Object.entries(MAP)) {
      const b = this.bones[ual];
      const ualRest = rigQuat(b, parent, new THREE.Quaternion());
      const myRest = rigQuat(driverJ[my], parent, new THREE.Quaternion());
      const p0 = rigPos(b, parent, new THREE.Vector3());
      const ch = UAL_CHILD[ual] ? this.bones[UAL_CHILD[ual]] : null;
      const dUal = ch ? rigPos(ch, parent, new THREE.Vector3()).sub(p0).normalize() : new THREE.Vector3(0, 1, 0);
      const dMy = new THREE.Vector3(...MY_DIR[my]).normalize();
      const C = new THREE.Quaternion().setFromUnitVectors(dUal, dMy);
      this.rest[ual] = { my, ualRest, myRestInv: myRest.clone().invert(), C, lower: LOWER.has(my) };
    }
    this.hipsRest = rigPos(this.bones['DEF-hips'], parent, new THREE.Vector3());
    // ---- authored clips
    this.mixer = new THREE.AnimationMixer(this.scene);
    this.actions = {};
    for (const [name, clip] of Object.entries(CLIPS)) {
      const a = this.mixer.clipAction(clip);
      if (!/Loop/.test(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[name] = a;
    }
    // retargeted motion-capture techniques (played once, held on the last frame until the next state)
    for (const [name, m] of Object.entries(MOCAP)) {
      const a = this.mixer.clipAction(m.clip);
      if (!m.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[name] = a;
    }
    // finger bones and their bind rotations (for the hand-shape layer)
    this.fingers = { L: [], R: [] };
    for (const side of ['L', 'R']) {
      for (const fn of FINGERS) for (let j = 1; j <= 3; j++) { const b = this.bones[`DEF-f_${fn}0${j}${side}`]; if (b) this.fingers[side].push({ b, rest: b.quaternion.clone(), j, fn }); }
      for (let j = 1; j <= 3; j++) { const b = this.bones[`DEF-thumb0${j}${side}`]; if (b) this.fingers[side].push({ b, rest: b.quaternion.clone(), j, fn: 'thumb' }); }
    }
    // which clips carry finger motion of their own (largest finger-joint rotation away from the clip's first frame,
    // radians). Those keep their captured fingers; the hand-shape layer only fills in for clips whose fingers are
    // frozen (many Mixamo strikes hold one fixed hand pose) or missing
    this.fingerMotion = {};
    const fq0 = new THREE.Quaternion(), fq1 = new THREE.Quaternion();
    for (const [name, a] of Object.entries(this.actions)) {
      let mx = 0;
      for (const t of a.getClip().tracks) {
        if (!/DEF-(f_|thumb)/.test(t.name) || !/quaternion$/.test(t.name)) continue;
        const v = t.values, n = v.length / 4; fq0.fromArray(v, 0);
        for (let i = 1; i < n; i += 2) mx = Math.max(mx, fq0.angleTo(fq1.fromArray(v, i * 4)));
      }
      this.fingerMotion[name] = mx;
    }
    this.handBlend = 0.85;
    const copy = (h) => ({ f: [...h.f], thumb: [...h.thumb], pinky: h.pinky, spread: h.spread });
    this.handW = { L: { cur: copy(HANDS.relax) }, R: { cur: copy(HANDS.relax) } };
    this.techN = -1; this.trace = []; this.clock = 0;
    this.cur = null; this.play('Idle_Loop', 0);
    this.wU = 1; this.wL = 1;
    this.target = { _rigQ: new Map() };
  }

  // per-vertex colours from skin weights: skin, trousers, sash, wraps. Trousers are inflated slightly.
  dress(mesh) {
    const g = mesh.geometry = mesh.geometry.clone();
    const pos = g.attributes.position, nrm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bones = mesh.skeleton.bones.map(b => b.name);
    const C = this.colors, joints = mesh.material && mesh.material.name === 'M_Joints';
    const col = new Float32Array(pos.count * 3);
    const skin = new THREE.Color(C.skin), skinD = skin.clone().multiplyScalar(0.86), pants = new THREE.Color(C.pants), sash = new THREE.Color(C.sash), wrap = new THREE.Color(C.wrap);
    for (let i = 0; i < pos.count; i++) {
      let best = -1, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const bn = bones[best] || '', y = pos.getY(i), x = Math.abs(pos.getX(i));
      if (!joints && bn === 'DEF-head') (this.headBox = this.headBox || new THREE.Box3()).expandByPoint(_v.fromBufferAttribute(pos, i));
      let c = joints ? skinD : skin, inflate = 0;
      if ((/thigh|shin/.test(bn) && y > 0.2) || (/hips/.test(bn) && y < 1.02) || (/spine001/.test(bn) && y < 0.98)) { c = pants; inflate = /shin/.test(bn) ? 0.012 : 0.02; }
      if (y > 0.975 && y < 1.035 && x < 0.2 && /hips|spine001/.test(bn)) { c = sash; inflate = 0.024; }
      if (/forearm/.test(bn) && x > 0.665) c = wrap;                    // wrist wraps (T-pose: forearm along +-x)
      if (/shin/.test(bn) && y <= 0.2 && y > 0.14) c = wrap;            // ankle wraps
      if (c === sash) this.sashIdx.push([g, i]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      if (inflate) { pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * inflate, pos.getY(i) + nrm.getY(i) * inflate, pos.getZ(i) + nrm.getZ(i) * inflate); }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mesh.material = this.material;
    mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
  }
  // the mannequin's head is a smooth egg: add ears, nose, brow and eyes (placed from the head's own bounds)
  face() {
    const B = this.headBox; if (!B) return;
    const head = this.bones['DEF-head'];
    this.scene.updateMatrixWorld(true);
    const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(this.parent.matrixWorld);
    const h = B.max.y - B.min.y, cz = (B.max.z + B.min.z) / 2, skin = new THREE.MeshToonMaterial({ color: this.colors.skin, gradientMap: TOON_RAMP });
    const dark = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
    const add = (geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z).applyMatrix4(toHead); m.scale.set(sx, sy, sz); m.quaternion.copy(new THREE.Quaternion().setFromRotationMatrix(toHead)); m.castShadow = true; head.add(m); return m; };
    const sph = new THREE.SphereGeometry(1, 10, 8);
    for (const s of [1, -1]) {
      add(sph, skin, s * (B.max.x - 0.004), B.min.y + h * 0.52, cz - 0.005, 0.016, 0.03, 0.02);                    // ears
      add(sph, dark, s * 0.034, B.min.y + h * 0.6, B.max.z - 0.012, 0.012, 0.007, 0.006);                          // eyes
    }
    add(sph, skin, 0, B.min.y + h * 0.48, B.max.z + 0.004, 0.016, 0.026, 0.02);                                     // nose
    add(sph, skin, 0, B.min.y + h * 0.66, B.max.z - 0.006, 0.062, 0.012, 0.016);                                    // brow ridge
    this.skinMat = skin;
  }
  setSash(hex) {
    const c = new THREE.Color(hex);
    for (const [g, i] of this.sashIdx) g.attributes.color.setXYZ(i, c.r, c.g, c.b);
    for (const m of this.meshes) m.geometry.attributes.color.needsUpdate = true;
  }
  // inverted-hull ink outline that follows the skinning
  outline() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1012, side: THREE.BackSide });
    mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  transformed += normalize(objectNormal) * 0.011;'); };
    for (const m of [...this.meshes]) {
      const o = new THREE.SkinnedMesh(m.geometry, mat);
      o.bind(m.skeleton, m.bindMatrix); o.frustumCulled = false;
      m.parent.add(o);
    }
  }

  // Actions by name. "clip|U" and "clip|L" are on-demand copies holding only the upper-body (spine, arms, head,
  // hands) or lower-body (hips, legs) tracks, so an authored technique can run over authored footwork.
  act(name) {
    if (!name) return null;
    if (this.actions[name]) return this.actions[name];
    const bar = name.indexOf('|'); if (bar < 0) return null;
    const base = this.actions[name.slice(0, bar)]; if (!base) return null;
    const upper = name.endsWith('|U'), src = base.getClip();
    const keep = (t) => { const bone = t.name.split('.')[0]; const up = UPPER_RE.test(bone); return upper ? up : !up; };
    const clip = new THREE.AnimationClip(name, src.duration, src.tracks.filter(keep));
    const a = this.mixer.clipAction(clip);
    if (base.loop === THREE.LoopOnce) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    return (this.actions[name] = a);
  }

  play(name, fade = 0.15, timeScale = 1, restart = false) {
    const a = this.act(name); if (!a) return;
    a.timeScale = timeScale;
    if (this.cur === a && !restart) return;
    // animation trace (debug overlay and gameplay audits): what replaced what, and how much of it had played
    if (this.cur) {
      const c = this.cur, d = c.getClip().duration;
      this.trace.push({ t: +this.clock.toFixed(2), from: this.curName, played: +(Math.min(1, c.time / d)).toFixed(2), to: name, ts: +timeScale.toFixed(2), fade, restart: this.cur === a });
      if (this.trace.length > 400) this.trace.shift();
    }
    if (this.cur === a) { a.reset(); a.setEffectiveWeight(1); a.play(); return; }
    // leaving a reaction, fall or get-up: a longer blend, so the body settles into the stance instead of snapping
    if (REACT.test(this.curName || '') && !REACT.test(name)) fade = Math.max(fade, 0.3);
    // switching between the full and the upper-body copy of the same clip keeps its place
    const same = this.curName && this.curName.split('|')[0] === name.split('|')[0] && !restart;
    const t0 = same ? this.cur.time : 0;
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.play(); if (same) a.time = t0;
    if (this.cur && fade > 0) this.cur.crossFadeTo(a, fade, false); else if (this.cur) this.cur.stop();
    this.cur = a; this.curName = name;
  }
  // the lower-body footwork layer (null fades it out)
  playLower(name, ts, fade = 0.2) {
    const a = this.act(name);
    if (this.low === a) { if (a) a.timeScale = ts; return; }
    if (this.low) this.low.fadeOut(fade);
    if (a) { a.reset(); a.enabled = true; a.timeScale = ts; a.setEffectiveWeight(1); a.fadeIn(fade); a.play(); }
    this.low = a; this.lowName = name;
  }

  // the knockdown clip for this fall (fighter.takeHit sets f.downClip), mirrored to the side the blow came from
  downName(f, hlx) {
    const n = f.downClip || 'knockback';
    if (!this.actions[n]) return 'knockback';
    return hlx > 0.3 && this.actions[n + '_M'] ? n + '_M' : n;
  }
  // Choose the authored clip(s) from the fighter's state. Priority: knockdown / KO, hit reactions, dodges,
  // techniques, charge, guard, sustained bending, airborne, locomotion, then the element's combat stance.
  // When the fighter is moving under an upper-body action (a punch, guard, hold or the stance), the action's
  // upper-body tracks run over an authored walk / jog / sidestep for the legs. Procedural motion is a fallback only.
  drive(f, dt) {
    let wU = 1, wL = 1, clip = 'Idle_Loop', ts = 1, fade = 0.18, restart = false, layered = false, startAt = 0, glideLegs = null;
    const A = f.A, sp = Math.hypot(f.vel.x, f.vel.z), fwd = f.moveLocal.y, side = f.moveLocal.x, moving = sp > 0.6 && f.onGround;
    const L = LOOPS[f.el] || {}, has = (n) => n && this.actions[n];
    // coming out of a run: the authored run-to-stop plays as the fighter halts
    // (the run counts if it was playing within the last 0.25 s: the walk can take over for a frame or two as the speed drops)
    if (this.curName === 'Jog_Fwd_Loop' || this.curName === 'sprint_loop') { this.runSp = this.runT > 0.5 ? sp : Math.max(this.runSp || 0, sp); this.runT = 0; } else this.runT = (this.runT ?? 9) + dt;
    if (this.runT < 0.25 && (this.runSp || 0) > 4.5 && sp < 2.4 && f.onGround && !(this.stopT > 0)) { this.stopT = 0.55; this.runT = 9; }
    else this.stopT = (this.stopT || 0) - dt;
    const free = (!A || A.soft) && !f.guarding && !f.holding && !f.charging && !(f.restrainT > 0) && f.dodgeT <= 0 && !f.dead;
    const once = (name, scale, fd = 0.08) => { clip = name; ts = scale; wU = wL = 0; fade = fd; if (this.curName !== name) restart = true; };
    // authored footwork for the current movement direction and speed
    const loco = () => {
      // captured speeds: Mixamo Run 3.6 m/s, Sprint 5.2 m/s, Jog Strafe 2.5 m/s, Jog Backward 2.0 m/s, Walking Backwards 0.47 m/s
      const C = THREE.MathUtils.clamp;
      // forward: walk, the character's own jog, then the Mixamo Sprint (the Mixamo Run, arms swept back, is not used)
      if (fwd > 0.55) return sp < 2.4 ? ['Walk_Loop', C(sp / 1.5, 0.7, 1.6)] : sp < 6.0 ? ['Jog_Fwd_Loop', C(sp / 4.2, 0.8, 1.5)] : has('sprint_loop') ? ['sprint_loop', C(sp / 5.2, 0.9, 1.7)] : ['Sprint_Loop', C(sp / 7.4, 0.9, 1.5)];
      if (fwd < -0.55) return sp < 1.2 && has('walk_back') ? ['walk_back', C(sp / 0.47, 0.8, 2.4)] : has('jog_back') ? [side > 0 ? 'jog_back_M' : 'jog_back', C(sp / 2.0, 0.8, 1.9)] : ['Walk_Loop', -C(sp / 1.5, 0.7, 1.8)];
      return [side > 0 ? 'strafe' : 'strafe_M', C(sp / 2.5, 0.7, 1.9)];
    };
    // elemental mobility: the legs hold the surfing stance / the flying pose, techniques play over them
    const mk = f.mob && f.mob.kind, lowOv = mk === 'surf' && f.onGround && has('surf_stance') ? (f.el === 'earth' ? ['surf_stance', 0, EARTH_SURF_T] : ['surf_stance', LOOP_SPEED.surf_stance]) : mk === 'fly' && has('air_loop') ? ['air_loop', 1] : null;   // (the reclined Mixamo Flying pose, air_fly, is kept in the pack for a later unlock: lying level it does not face the rival)
    // the blow's direction relative to the body (lz < 0: driven backwards, |lx| large: from the side)
    const hd = f.hitDir || f.koDir, hc = Math.cos(f.yaw), hs = Math.sin(f.yaw);
    const hlx = hd ? hd.x * hc - hd.z * hs : 0, hlz = hd ? hd.x * hs + hd.z * hc : -1;
    if (f.dead && has('ko')) {
      // knocked out: a side blow spins the fighter face down (Standing Death Left), a straight one drops them on
      // the back (Death) or twists them down (Knocked Out); the choice is made once, when the fall starts
      if (!/^ko/.test(this.curName || '')) this.koClip = Math.abs(hlx) > 0.7 && has('ko_c') ? 'ko_c' : f.hitAlt && has('ko_b') ? 'ko_b' : 'ko';
      once(this.koClip, 1.0, 0.18);
    }
    else if (f.action === 'down' && f.floorHit && has(this.downName(f, hlx))) {
      // struck while lying down: the lying pose held (the knockdown's last frame), no standing reaction
      const dn = this.downName(f, hlx);
      clip = dn; ts = this.curName === dn ? 1.5 : 0; wU = wL = 0; fade = 0.3; if (this.curName !== dn) { restart = true; startAt = this.actions[dn].getClip().duration - 0.03; }   // still falling: the fall finishes
    }
    else if (f.action === 'down' && !f.slamFall && this.downName(f, hlx) !== 'knockback' && has(this.downName(f, hlx))) {
      // the falls chosen from the blow (fighter.takeHit): Soccer Trip, Hit To The Legs, Hit To Head, Fall Flat,
      // Falling Flat Impact, each spread over the time on the floor
      const dn = this.downName(f, hlx), d = this.actions[dn].getClip().duration;
      once(dn, 1, 0.1); if (restart) this.downT0 = Math.min(0, f.actionT);   // (the fall starts with the time added in front)
      ts = THREE.MathUtils.clamp(d * 0.92 / Math.max(0.6, f.A.dur - (this.downT0 ?? 0)), 0.6, 2.4);
    }
    else if (f.action === 'down' && has('knockback')) {
      // knocked off the feet: Mixamo Knocked Down, onto the back. Thrown high (a tornado, a rupture, a slam), the
      // fall is spread over the time left in the air, so the back meets the floor when the body does instead of
      // the lying pose hanging in mid-air
      once('knockback', 1.25, 0.12);
      // slammed down from above (the water whip slam): the fall is joined where the body already tips back (60 % in),
      // so the back, not the knees, meets the floor; it may play fast enough to finish in the short drop
      const slam = f.slamFall && restart;
      if (slam) { startAt = this.actions.knockback.getClip().duration * 0.6; fade = 0.06; }
      const alt = f.pos.y - f.groundY;
      if (!f.onGround && alt > 0.3 && this.cur) {
        const g = 21, tLand = (f.vel.y + Math.sqrt(Math.max(0, f.vel.y * f.vel.y + 2 * g * alt))) / g;
        const left = this.actions.knockback.getClip().duration * 0.92 - (restart ? startAt : this.cur.time);
        ts = THREE.MathUtils.clamp(left / Math.max(0.08, tLand), 0.25, f.slamFall ? 4 : 1.25);
      }
    }
    else if (f.action === 'down' && has('ko')) once('ko', 1.6, 0.1);
    // lifted by wind (the tornado, a wind column): Mixamo Floating, limbs adrift, instead of a standing reaction
    else if (f.floatT > 0 && !f.onGround && !f.dead && has('air_float')) { clip = 'air_float'; ts = 1.4; wU = wL = 0; fade = 0.15; }
    // Air gets up with a spinning kip-up (Corkscrew Kip Up)
    // the element's get-up (fighter.js picks it: Fire kip-up with a double kick, Water kip-up, Air corkscrew kip-up,
    // Earth the heavy Getting Up); the time added before it (negative actionT) slows it to near its captured pace
    else if (f.action === 'getup' && f.getupClip && f.getupClip !== 'getup' && has(f.getupClip)) {
      if (this.curName !== f.getupClip) this.getupT0 = f.actionT;
      once(f.getupClip, this.actions[f.getupClip].getClip().duration / Math.max(0.3, f.A.dur - (this.getupT0 ?? 0)) * 0.8, 0.25);
    }
    // recovery from the floor: the Mixamo get-up (on the back, roll to a crouch, stand). UAL2's LayToIdle starts
    // from a crumpled pose that does not match the knockdown, so it is no longer used
    else if (f.action === 'getup' && has('getup')) { once('getup', this.actions.getup.getClip().duration / Math.max(0.3, f.A.dur) * 0.75, 0.1); }
    else if (f.action === 'landHigh' && has('land_high')) once('land_high', 1.25 / 0.42 * 0.75, 0.06);
    else if (f.action === 'hit' || f.action === 'stagger') {
      // a flinch alternates the two light reactions; a stagger is the heavy one: Big Side Hit (mirrored to the side
      // the blow came from) or, for a blow straight on, Receive Stomach Uppercut
      const heavy = f.action === 'stagger';
      const cut = f.cutClip && has(f.cutClip) ? (hlx > 0.3 && has(f.cutClip + '_M') ? f.cutClip + '_M' : f.cutClip) : null;
      const n = cut || (heavy ? (Math.abs(hlx) > 0.45 && has('hit_big') ? (hlx > 0 ? 'hit_big_M' : 'hit_big') : has('hit_body') ? 'hit_body' : 'hit_b') : f.headHit && has('hit_head') ? (hlx > 0 ? 'hit_head_M' : 'hit_head') : f.hitAlt ? 'hit_b' : 'hit_a');   // a punch snaps the head back (Head Hit)
      // several hits landing together (a punch and its fireball, a whip's two lashes) are one reaction: within
      // 0.3 s of a reaction starting, the clip already playing continues instead of switching or restarting
      const recent = /^hit_/.test(this.curName || '') && this.clock - (this.reactAt || -9) < 0.3 && !(heavy && !/^hit_(big|body|stomach_big)/.test(this.curName)) && !(cut && !this.curName.startsWith(cut.replace(/_M$/, '')));
      if (recent) { clip = this.curName; ts = this.cur.timeScale; wU = wL = 0; fade = 0.1; }
      else if (has(n)) { clip = n; ts = cut ? (heavy ? 1.6 : 1.5) : heavy ? 1.15 : /^hit_head/.test(n) ? 2.0 : 1.35; wU = wL = 0; fade = 0.1; if (f.actionT < dt * 1.5 || this.curName !== n) { restart = true; this.reactAt = this.clock; } }
      else { clip = f.hitAlt ? 'Hit_Head' : 'Hit_Chest'; wU = wL = 0; if (this.curName !== clip || f.actionT < dt * 1.5) restart = true; ts = 1.2; fade = 0.05; }
    }
    else if (f.dodgeT > 0) {
      // dodge direction relative to facing picks the clip: sideways steps aside, backwards flips (air), anything
      // else is an authored roll
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw), lx = f.dodgeDir.x * c - f.dodgeDir.z * s, lz = f.dodgeDir.x * s + f.dodgeDir.z * c;
      // Air's two-second whirlwind glide: the airborne gliding pose (UAL2 NinjaJump idle, as in flight)
      if (f.dodgeKind === 'glide' && has('air_loop')) { clip = 'air_loop'; ts = 1; wU = wL = 0; fade = 0.2; }
      // Air's flips: Corkscrew Evade / Cartwheel, spread over the dodge
      else if (f.dodgeKind === 'flip' && has(f.flipClip)) once(f.flipClip, this.actions[f.flipClip].getClip().duration / f.dodgeDur, 0.08);
      // Fire's rocket dodge: Fire's own fighting stance (fists up, knees bent), held nearly still while the jets carry
      // the body sideways: no steps, no running legs (the body's lean comes from fighter.js)
      // Fire's jet glide: the legs ride the jets in the skateboard crouch (Mixamo Skateboarding, the riding frames:
      // feet staggered, knees bent, never a step), the upper body in Male Action Pose (crouched, fists up); a punch or
      // blast thrown while gliding replaces only the upper body
      // Water's ice arch: the legs in the ice-surfing stance, the upper body in the water stance or the strike thrown
      else if (f.dodgeKind === 'arch' && has('surf_stance')) {
        clip = L.idle; ts = LOOP_SPEED[L.idle] || 1; fade = 0.1;
        if (f.action === 'tech' && f.tech && f.tech.clip) { const [n, scale] = clipFor(f.tech, f.techSide); if (has(n)) { clip = n; ts = scale; fade = 0.06; if (f.techN !== this.techN) { this.techN = f.techN; restart = true; } } }
        wU = wL = 0; layered = true; glideLegs = ['surf_stance', LOOP_SPEED.surf_stance || 1];
      }
      // (20 Nov, after review, with the user's reference clip and their Mixamo Running Arc) the rocket dodge and the
      // glide hold ONE frame of Running Arc, never playing it: knees bent, one foot a little ahead of the other, the body
      // pitched forward over the front knee, the arms swept back. Nothing steps or cycles; the jets at the heels move him.
      // A strike thrown while gliding replaces only the upper body; the legs stay frozen in that stance.
      else if (f.dodgeKind === 'rocket' && has('run_arc_l')) {
        clip = 'run_arc_l'; ts = 0; fade = 0.1; startAt = GLIDE_POSE_T;
        if (f.action === 'tech' && f.tech && f.tech.clip) { const [n, scale] = clipFor(f.tech, f.techSide); if (has(n)) { clip = n; ts = scale; fade = 0.06; startAt = 0; if (f.techN !== this.techN) { this.techN = f.techN; restart = true; } } }
        wU = wL = 0; layered = true; glideLegs = ['run_arc_l', 0, GLIDE_POSE_T];
      }
      else if (f.dodgeKind === 'rocket' && has('skate_ride')) {
        clip = has('fire_action') ? 'fire_action' : 'fire_idle'; ts = 1; fade = 0.08;
        if (f.action === 'tech' && f.tech && f.tech.clip) { const [n, scale] = clipFor(f.tech, f.techSide); if (has(n)) { clip = n; ts = scale; fade = 0.06; if (f.techN !== this.techN) { this.techN = f.techN; restart = true; } } }
        wU = wL = 0; layered = true; glideLegs = ['skate_ride', 0.6];
      }
      else {
      const n = f.dodgeKind !== 'roll' && Math.abs(lx) > 0.5 && has('dodge_side') ? (lx < 0 ? 'dodge_side' : 'dodge_side_M') : lz < -0.6 && f.el === 'air' && has('dodge_back') ? 'dodge_back' : 'Roll';
      if (n === 'Roll') { clip = 'Roll'; wU = wL = 0; ts = 1.46 / (f.dodgeDur * 1.7); fade = 0.06; if (this.curName !== 'Roll') restart = true; }
      else once(n, this.actions[n].getClip().duration / Math.max(0.2, f.dodgeDur) * 0.8, 0.06);
      }
    }
    // running along a wall (Mixamo Wall Run, mirrored for a wall on the right) or up it (Diagonal Wall Run)
    if (clip === 'Idle_Loop' && f.wall && f.action !== 'tech') {
      // Earth surfing along the wall on its slab: the riding stance
      const n = f.wall.kind === 'surf' ? 'surf_stance' : f.wall.kind === 'run' ? (f.wall.side > 0 ? 'wall_run' : 'wall_run_M') : 'wall_flip';
      if (has(n)) { if (f.wall.kind === 'surf') { clip = n; ts = LOOP_SPEED.surf_stance || 1; wU = wL = 0; fade = 0.15; } else once(n, f.wall.kind === 'run' ? this.actions[n].getClip().duration / f.wall.dur : 1.3, 0.1); }
    }
    if (clip === 'Idle_Loop' && f.action === 'tech' && f.tech.clip) {
      const [n, scale] = clipFor(f.tech, f.techSide);
      if (has(n)) {
        clip = n; ts = scale; wU = wL = 0; fade = f.tech.fadeIn || 0.14;
        if (f.techN !== this.techN) { this.techN = f.techN; restart = true; }
        // a strike on the ground is the whole authored clip, feet planted; only on the ice, the rock slab or in flight
        // do the arms strike over the riding pose
        if (lowOv) layered = true;
      }
    }
    if (clip === 'Idle_Loop' && f.action === 'counter') {
      // the counterattack after a perfect guard: the element's spinning kick
      const T = f.style.tech.leg[1] || f.style.tech.leg[0], n = T && T.clip && (Array.isArray(T.clip) ? T.clip[0] : T.clip);
      if (has(n)) { clip = n; ts = this.actions[n].getClip().duration / Math.max(0.25, f.A.dur); wU = wL = 0; fade = 0.08; if (this.curName !== n) restart = true; }
    }
    // caught (drowning sphere, tornado, whip capture): thrashing to get free (Mixamo Being Electrocuted), not a held pose
    if (clip === 'Idle_Loop' && f.restrainT > 0 && has('struggle')) { clip = 'struggle'; ts = 1.2; wU = wL = 0; fade = 0.15; }
    else if (clip === 'Idle_Loop' && f.restrainT > 0 && has(L.guard)) { clip = L.guard; ts = 0.6; wU = wL = 0; fade = 0.15; }
    if (clip === 'Idle_Loop' && f.charging) {
      // gathering force: the charged technique's own wind-up, held
      const T = f.style.tech.charged, n = T && T.clip;
      if (has(n)) { clip = n; ts = 0; wU = wL = 0; fade = 0.15; if (this.curName !== n) { restart = true; this.chargeHold = MOCAP[n].impact * 0.55; } }
    }
    if (clip === 'Idle_Loop' && wU === 1) {
      if (f.guarding && f.perfectT > 0 && has(f.el === 'water' ? 'water_redirect' : 'block_hit')) {
        // perfectly timed guard: water sweeps the attack aside, the others snap a block
        const n = f.el === 'water' ? (f.techSide > 0 ? 'water_redirect' : 'water_redirect_M') : 'block_hit';
        clip = has(n) ? n : 'block_hit'; wU = wL = 0; fade = 0.06; ts = 1.6; if (this.curName !== clip) restart = true;
      }
      else if (f.guarding && has(L.guard)) { clip = L.guard; wU = wL = 0; fade = 0.12; layered = moving || !!lowOv; }
      else if (f.holding && f.el === 'earth' && f.gatherT > 0 && has('Fixing_Kneeling')) {
        // Earth's rock lift: sinking to one knee with the hands on the ground (UAL Fixing_Kneeling, from 0.3 s to its
        // lowest point at 1.15 s, reached 0.28 s into each gathering of 0.42 s), once per rock drawn up
        // (18 Nov, after review: restarting the kneel for every rock jerked the body up and down) the bender sinks to the
        // knee once, then works the ground there: the clip rocks gently back and forth around its lowest point
        clip = 'Fixing_Kneeling'; wU = wL = 0; fade = 0.2;
        if (this.curName !== 'Fixing_Kneeling') { restart = true; startAt = 0.3; this.kneelDir = 1; ts = 2.2; }
        else { const t = this.cur.time; if (t > 1.2) this.kneelDir = -1; else if (t < 0.95) this.kneelDir = 1; ts = this.kneelDir * (t > 0.9 ? 0.45 : 2.2); }
      }
      else if (f.holding && has(L.hold)) { clip = L.hold; ts = LOOP_SPEED[L.hold] || 1; wU = wL = 0; fade = 0.2; layered = moving || !!lowOv; }
      else if (lowOv) { [clip, ts] = lowOv; if (lowOv[2] !== undefined) startAt = lowOv[2]; wU = wL = 0; fade = 0.2; }
      // take-off from a run (every element): the Running Jump's spring, before the element's own airborne pose
      else if (free && !f.onGround && !f.mob && f.airTime < 0.3 && f.vel.y > 1 && (f.lastGroundSp || 0) > 4.5 && has('run_jump')) once('run_jump', 1.0, 0.08);
      // take-off from standing (an ordinary jump): the Standing Jump's spring from its take-off frame
      else if (free && !f.onGround && !f.mob && !f.highJump && f.el !== 'air' && f.airTime < 0.25 && f.vel.y > 1 && has('stand_jump')) { once('stand_jump', 0.95, 0.1); if (restart) startAt = 0.4; }
      // Fire in the air (a jump, the flame jets): Male Dynamic Pose, the leap with arms out and a knee drawn up
      else if (free && !f.onGround && f.el === 'fire' && f.airTime > 0.12 && f.vel.y > -7 && has('fire_air_pose')) { clip = 'fire_air_pose'; ts = 1; wU = wL = 0; fade = 0.2; }
      else if (free && !f.onGround && f.highJump && has('jump_high')) {
        // propelled high jumps (ice ramp, rising slab, flame jets, water column): take-off, airborne, falling
        // Water on its column: Falling Into Pool's airborne frames (arms out, legs drawn up), held while the water lifts
        // (18 Nov, after review: the Falling Into Pool frames flailed and splayed the legs mid-air; standing on the column
        //  in the water stance instead, arms working the water)
        if (f.el === 'water' && has(L.idle) && (f.jetting || f.vel.y > -3)) { clip = L.idle; ts = LOOP_SPEED[L.idle] || 1; }
        else if (f.vel.y > 2 && f.airTime < 0.4) { clip = 'jump_high'; ts = 1.4; if (this.curName !== clip) restart = true; }
        else if (f.vel.y < -4 && has('fall_loop')) clip = 'fall_loop';
        else clip = 'air_loop';
        wU = wL = 0; fade = 0.15;
      }
      // a jump: Running Jump off a run, Standing Jump (from its take-off frame) off the spot
      else if (free && !f.onGround && (f.lastGroundSp || 0) > 4.5 && f.airTime < 0.9 && has('run_jump')) once('run_jump', 1.0, 0.08);
      else if (free && !f.onGround && f.airTime < 1.1 && has('stand_jump')) { once('stand_jump', 0.95, 0.1); if (restart) startAt = 0.4; }
      else if (free && !f.onGround) { clip = f.vel.y > 1.5 && f.airTime < 0.3 ? 'Jump_Start' : 'Jump_Loop'; wU = wL = 0; ts = f.vel.y > 1.5 ? 1.6 : 1; }
      // reversing at a run: Change Direction's braking plant, mirrored to the side of the turn
      else if (free && f.onGround && f.turnT > 0 && has('turn_back')) { const n = f.turnSide > 0 ? 'turn_back_M' : 'turn_back'; once(n, 1.6, 0.1); if (restart) startAt = 0.55; }
      // the first stride of a run from standing: the Male Locomotion Pose lunge
      else if (free && moving && fwd > 0.55 && f.burstT > 0 && has('loco_pose')) { clip = 'loco_pose'; ts = 1; wU = wL = 0; fade = 0.1; }
      else if (free && f.onGround && this.stopT > 0 && sp < 2.5 && has('run_stop')) { clip = 'run_stop'; ts = 1.5; wU = wL = 0; fade = 0.15; }
      else if (free && moving && fwd > 0.7) {
        [clip, ts] = loco(); wU = wL = 0; fade = 0.22;   // authored locomotion, matched to ground speed
      } else if (free && f.onGround && has(L.idle)) {
        // the element's authored combat stance; when stepping sideways or backwards, its upper body over authored footwork
        clip = L.idle; ts = LOOP_SPEED[L.idle] || 1; wU = wL = 0; fade = 0.25; layered = moving;
      }
    }
    // nothing else matched (any state not listed above): the element's authored stance, never the procedural body
    if (clip === 'Idle_Loop' && wU === 1 && has(L.idle)) { clip = L.idle; wU = wL = 0; fade = 0.2; layered = moving; }
    // leaving a move that ends far from standing (the Flair, on the hands): a slower blend, so the body rolls back up
    if (this.curName && clip !== this.curName.split('|')[0] && this.prevFadeOut) fade = Math.max(fade, this.prevFadeOut);
    this.prevFadeOut = f.action === 'tech' && f.tech && f.tech.fadeOut && clip === (clipFor(f.tech, f.techSide)[0]) ? f.tech.fadeOut : 0;
    if (layered) {
      const [ln, lts, lat] = glideLegs || lowOv || loco();
      this.play(clip + '|U', fade, ts, restart);
      this.playLower(ln + '|L', lts, 0.18);
      if (lat !== undefined && this.low) this.low.time = lat;   // a held frame (the glide stance): pinned every frame
    } else {
      this.play(clip, fade, ts, restart);
      // a stance that is too deep for the style keeps its arms and footing but rises part-way to the standing idle
      const mix = STANCE_MIX[clip];
      this.playLower(mix ? 'Idle_Loop|L' : null, 1, 0.25);
      if (mix && this.low) this.low.setEffectiveWeight(mix);
    }
    if (f.breathHold && this.curName && /fire_breath/.test(this.curName)) ts = 0;
    if (f.cometHold && this.curName && /whip_v/.test(this.curName)) ts = 0;   // (the Fire Comet: the arms stay raised while it forms)   // (Dragon's Breath: the roaring pose is held while the flame pours out)
    if (this.cur) this.cur.timeScale = ts;
    if (startAt && this.cur) this.cur.time = startAt;
    if (ts === 0 && this.cur && this.chargeHold !== undefined) this.cur.time += (this.chargeHold - this.cur.time) * Math.min(1, dt * 6);
    const k = 1 - Math.exp(-(wU > this.wU || wL > this.wL ? 16 : 10) * dt);
    this.wU += (wU - this.wU) * k; this.wL += (wL - this.wL) * k;
    this.handShape = this.chooseHands(f);
    this.update(dt);
  }

  // which hand shape each hand takes now (element style, then what the fighter is doing)
  chooseHands(f) {
    const el = f.el, T = f.action === 'tech' ? f.tech : null, st = f.style && f.style.tech;
    if (f.dead || f.action === 'down' || f.action === 'getup' || f.action === 'hit' || f.action === 'stagger') return ['relax', 'relax'];
    const base = { earth: 'fist', fire: 'fist', water: 'flow', air: 'palm' }[el] || 'relax';
    if (f.holding) return el === 'earth' ? ['claw', 'claw'] : el === 'fire' ? ['palm', 'palm'] : el === 'water' ? ['flow', 'flow'] : ['palm', 'palm'];
    if (T && st) {
      const isHand = T === st.hand || T.variantOf === st.hand;
      if (el === 'fire' && T === st.charged) return ['palm', 'palm'];
      if (el === 'water' && T === st.release) return ['palm', 'palm'];
      if (el === 'earth' && (T === st.special || T === st.stomp)) return ['claw', 'claw'];
      if (el === 'water' && isHand) return /punch|jab/.test(T.clip) ? ['fist', 'fist'] : ['palm', 'palm'];     // whips: open palms; punches: fists
      return [base, base];
    }
    if (f.guarding) return el === 'water' || el === 'air' ? ['palm', 'palm'] : ['fist', 'fist'];
    return [base, base];
  }
  // hand-shape layer: blends every finger joint toward the chosen shape (over whatever the clip did)
  applyHands(dt) {
    if (!this.handShape) return;
    // how strongly the shape replaces the clip's own fingers: captured finger motion is kept (reactions, falls and
    // locomotion entirely, strikes mostly); frozen or missing fingers take the style's shape
    const base = (this.curName || '').split('|')[0], moving = (this.fingerMotion[base] || 0) > 0.25;
    const want = !moving ? 0.85 : REACT.test(base) || /^(ko|run_|sprint_|walk_back|jog_back|strafe|Walk_|Jog_|Sprint_|fall_|wall_|getup)/.test(base) ? 0 : 0.3;
    this.handBlend += (want - this.handBlend) * (1 - Math.exp(-8 * dt));
    if (this.handBlend < 0.01) return;
    const shapes = { L: this.handShape[0], R: this.handShape[1] };
    for (const side of ['L', 'R']) {
      const H = this.handW[side], want = HANDS[shapes[side]] || HANDS.relax, k = 1 - Math.exp(-14 * dt);
      for (let j = 0; j < 3; j++) { H.cur.f[j] += (want.f[j] - H.cur.f[j]) * k; H.cur.thumb[j] += (want.thumb[j] - H.cur.thumb[j]) * k; }
      H.cur.pinky += (want.pinky - H.cur.pinky) * k; H.cur.spread += (want.spread - H.cur.spread) * k;
      const C = H.cur, sgn = side === 'L' ? 1 : -1;
      for (const F of this.fingers[side]) {
        if (F.fn === 'thumb') { _q.setFromAxisAngle(_X, C.thumb[F.j - 1]); }
        else {
          const extra = F.fn === 'pinky' ? C.pinky : F.fn === 'ring' ? C.pinky * 0.5 : 0;
          _q.setFromAxisAngle(_X, C.f[F.j - 1] + (F.j === 1 ? extra : extra * 0.6));
          if (F.j === 1) { const sp = { index: -1, middle: -0.2, ring: 0.4, pinky: 1 }[F.fn] * C.spread * sgn; _q.multiply(_q2.setFromAxisAngle(_Z, sp)); }
        }
        // 85 % toward the shape: clips that carry their own finger motion still show through a little
        F.b.quaternion.slerp(_q2.copy(F.rest).multiply(_q), this.handBlend);
      }
    }
  }
  update(dt) {
    this.clock += dt;
    this.mixer.update(dt);
    const P = this.parent;
    // the driver's current rig-space joint orientations
    const myQ = {};
    for (const my of Object.keys(MAP)) myQ[my] = rigQuat(this.J[my], P, new THREE.Quaternion());
    // walk the mannequin hierarchy, blending each mapped bone toward the retargeted procedural pose
    const rq = this.target._rigQ; rq.clear();
    const base = rigQuat(this.bones.root.parent, P, new THREE.Quaternion());
    for (const b of this.order) {
      const parentQ = b === this.bones.root ? base : rq.get(b.parent);
      const R = this.rest[b.name];
      if (R) {
        const w = R.lower ? this.wL : this.wU;
        if (w > 0.001) {
          // target = (driver delta from its rest) * (align mannequin rest direction to driver rest direction) * mannequin rest
          _q.copy(myQ[R.my]).multiply(R.myRestInv).multiply(R.C).multiply(R.ualRest);
          _q2.copy(parentQ).invert().multiply(_q);
          b.quaternion.slerp(_q2, Math.min(1, w));
        }
      }
      rq.set(b, parentQ.clone().multiply(b.quaternion));
    }
    // hips height / shift from the procedural pose (crouches, lunges)
    if (this.wL > 0.001) {
      const hb = this.bones['DEF-hips'], off = _v.copy(this.J.hips.position).sub(new THREE.Vector3(0, HIP_H, 0)).add(this.hipsRest);
      hb.parent.updateWorldMatrix(true, false); P.updateWorldMatrix(true, false);
      const toLocal = _m.copy(hb.parent.matrixWorld).invert().multiply(P.matrixWorld);
      hb.position.lerp(off.applyMatrix4(toLocal), Math.min(1, this.wL));
    }
    this.applyHands(dt);
  }
  setEmissive(r, g, b) { this.material.emissive.setRGB(r, g, b); }
}
