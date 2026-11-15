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
import { MOCAP, clipFor, LOOPS } from './mocap.js';

let TEMPLATE = null, CLIPS = null;
export const heroReady = () => !!TEMPLATE;

// three-step cel ramp shared by characters and the arena
export const TOON_RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([96, 96, 96, 255, 168, 168, 168, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();

const USED = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Hit_Chest', 'Hit_Head', 'Death01', 'Punch_Jab', 'Punch_Cross', 'Spell_Simple_Shoot'];

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
    if (hp) { const v = hp.values, x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; } }
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

function rigQuat(o, stop, out) { out.identity(); for (let x = o; x && x !== stop; x = x.parent) out.premultiply(x.quaternion); return out; }
function rigPos(o, stop, out) { o.updateWorldMatrix(true, false); stop.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_m.copy(stop.matrixWorld).invert()); }

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

  // Choose the authored clip(s) from the fighter's state. Priority: knockdown / KO, hit reactions, dodges,
  // techniques, charge, guard, sustained bending, airborne, locomotion, then the element's combat stance.
  // When the fighter is moving under an upper-body action (a punch, guard, hold or the stance), the action's
  // upper-body tracks run over an authored walk / jog / sidestep for the legs. Procedural motion is a fallback only.
  drive(f, dt) {
    let wU = 1, wL = 1, clip = 'Idle_Loop', ts = 1, fade = 0.18, restart = false, layered = false;
    const A = f.A, sp = Math.hypot(f.vel.x, f.vel.z), fwd = f.moveLocal.y, side = f.moveLocal.x, moving = sp > 0.6 && f.onGround;
    const L = LOOPS[f.el] || {}, has = (n) => n && this.actions[n];
    const free = (!A || A.soft) && !f.guarding && !f.holding && !f.charging && !(f.restrainT > 0) && f.dodgeT <= 0 && !f.dead;
    const once = (name, scale, fd = 0.08) => { clip = name; ts = scale; wU = wL = 0; fade = fd; if (this.curName !== name) restart = true; };
    // authored footwork for the current movement direction and speed
    const loco = () => {
      if (fwd > 0.55) return sp < 2.4 ? ['Walk_Loop', THREE.MathUtils.clamp(sp / 1.5, 0.7, 1.6)] : sp < 7.6 ? ['Jog_Fwd_Loop', THREE.MathUtils.clamp(sp / 4.2, 0.8, 1.7)] : ['Sprint_Loop', THREE.MathUtils.clamp(sp / 7.4, 0.9, 1.5)];
      if (fwd < -0.55) return ['Walk_Loop', -THREE.MathUtils.clamp(sp / 1.5, 0.7, 1.8)];
      return [side > 0 ? 'strafe' : 'strafe_M', THREE.MathUtils.clamp(sp / 1.5, 0.7, 2.2)];
    };
    if (f.dead && has('ko')) once('ko', 1.1, 0.12);
    else if (f.action === 'down' && has('ko')) once('ko', 1.6, 0.1);
    else if (f.action === 'getup' && has('getup')) { once('getup', this.actions.getup.getClip().duration / Math.max(0.3, f.A.dur) * 0.75, 0.1); }
    else if (f.action === 'hit' || f.action === 'stagger') {
      const n = f.hitAlt ? 'hit_b' : 'hit_a';
      if (has(n)) { clip = n; ts = f.action === 'stagger' ? 1.1 : 1.5; wU = wL = 0; fade = 0.05; if (f.actionT < dt * 1.5 || this.curName !== n) restart = true; }
      else { clip = f.hitAlt ? 'Hit_Head' : 'Hit_Chest'; wU = wL = 0; if (this.curName !== clip || f.actionT < dt * 1.5) restart = true; ts = 1.2; fade = 0.05; }
    }
    else if (f.dodgeT > 0) {
      // dodge direction relative to facing picks the clip: sideways steps aside, backwards flips (air), anything
      // else is an authored roll
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw), lx = f.dodgeDir.x * c - f.dodgeDir.z * s, lz = f.dodgeDir.x * s + f.dodgeDir.z * c;
      const n = f.dodgeKind !== 'roll' && Math.abs(lx) > 0.5 && has('dodge_side') ? (lx < 0 ? 'dodge_side' : 'dodge_side_M') : lz < -0.6 && f.el === 'air' && has('dodge_back') ? 'dodge_back' : 'Roll';
      if (n === 'Roll') { clip = 'Roll'; wU = wL = 0; ts = 1.46 / (f.dodgeDur * 1.7); fade = 0.06; if (this.curName !== 'Roll') restart = true; }
      else once(n, this.actions[n].getClip().duration / Math.max(0.2, f.dodgeDur) * 0.8, 0.06);
    }
    if (clip === 'Idle_Loop' && f.action === 'tech' && f.tech.clip) {
      const [n, scale] = clipFor(f.tech, f.techSide);
      if (has(n)) {
        clip = n; ts = scale; wU = wL = 0; fade = 0.14;
        if (f.techN !== this.techN) { this.techN = f.techN; restart = true; }
        if (f.tech.upper && moving) layered = true;
      }
    }
    if (clip === 'Idle_Loop' && f.action === 'counter') {
      // the counterattack after a perfect guard: the element's spinning kick
      const T = f.style.tech.leg[1] || f.style.tech.leg[0], n = T && T.clip && (Array.isArray(T.clip) ? T.clip[0] : T.clip);
      if (has(n)) { clip = n; ts = this.actions[n].getClip().duration / Math.max(0.25, f.A.dur); wU = wL = 0; fade = 0.08; if (this.curName !== n) restart = true; }
    }
    if (clip === 'Idle_Loop' && f.restrainT > 0 && has(L.guard)) { clip = L.guard; ts = 0.6; wU = wL = 0; fade = 0.15; }   // trapped: struggling inside the guard
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
      else if (f.guarding && has(L.guard)) { clip = L.guard; wU = wL = 0; fade = 0.12; layered = moving; }
      else if (f.holding && has(L.hold)) { clip = L.hold; wU = wL = 0; fade = 0.2; layered = moving; }
      else if (free && !f.onGround) { clip = f.vel.y > 1.5 && f.airTime < 0.3 ? 'Jump_Start' : 'Jump_Loop'; wU = wL = 0; ts = f.vel.y > 1.5 ? 1.6 : 1; }
      else if (free && moving && fwd > 0.7) {
        [clip, ts] = loco(); wU = wL = 0; fade = 0.22;   // authored locomotion, matched to ground speed
      } else if (free && f.onGround && has(L.idle)) {
        // the element's authored combat stance; when stepping sideways or backwards, its upper body over authored footwork
        clip = L.idle; wU = wL = 0; fade = 0.25; layered = moving;
      }
    }
    // nothing else matched (any state not listed above): the element's authored stance, never the procedural body
    if (clip === 'Idle_Loop' && wU === 1 && has(L.idle)) { clip = L.idle; wU = wL = 0; fade = 0.2; layered = moving; }
    if (layered) {
      const [ln, lts] = loco();
      this.play(clip + '|U', fade, ts, restart);
      this.playLower(ln + '|L', lts, 0.18);
    } else {
      this.play(clip, fade, ts, restart);
      this.playLower(null, 1, 0.15);
    }
    if (this.cur) this.cur.timeScale = ts;
    if (ts === 0 && this.cur && this.chargeHold !== undefined) this.cur.time += (this.chargeHold - this.cur.time) * Math.min(1, dt * 6);
    const k = 1 - Math.exp(-(wU > this.wU || wL > this.wL ? 16 : 10) * dt);
    this.wU += (wU - this.wU) * k; this.wL += (wL - this.wL) * k;
    this.update(dt);
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
  }
  setEmissive(r, g, b) { this.material.emissive.setRGB(r, g, b); }
}
