// Articulated, procedurally animated humanoid fighter + movement physics.
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff, smooth01 } from './util.js';

// ---------------------------------------------------------------- pose data
const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'sL', 'eL', 'wL', 'sR', 'eR', 'wR', 'hL', 'kL', 'aL', 'hR', 'kR', 'aR'];
const JI = {}; JOINTS.forEach((n, i) => (JI[n] = i * 3));
const PN = JOINTS.length * 3;            // rotations
const POSE_LEN = PN + 3;                 // + hips offset (px, py, pz)
const PX = PN, PY = PN + 1, PZ = PN + 2;
const LEG = 0.42;                        // thigh and shin length
const HIP_H = 0.92;                      // standing hip height

function S(p, j, x, y, z) { const i = JI[j]; p[i] = x; p[i + 1] = y; p[i + 2] = z; }
function sideName(base, side) { return base + (side > 0 ? 'L' : 'R'); }
// side: +1 = left (+x), -1 = right (-x). abd > 0 raises the arm outwards. yaw mirrored.
function arm(p, side, fwd, abd, twist, elbow, wrist = 0) {
  S(p, sideName('s', side), fwd, twist * side, abd * side);
  S(p, sideName('e', side), -Math.max(0, elbow), 0, 0);
  S(p, sideName('w', side), wrist, 0, 0);
}
function legRaw(p, side, hx, hzOut, kx, ax) {
  S(p, sideName('h', side), hx, 0, hzOut * side);
  S(p, sideName('k', side), Math.max(0, kx), 0, 0);
  S(p, sideName('a', side), ax, 0, 0);
}
// Two-bone IK in the sagittal plane: foot `fwd` metres in front of the hip, `down` metres below it.
function legIK(p, side, fwd, down, out = 0.08) {
  let d = Math.hypot(fwd, down);
  d = Math.min(d, LEG * 2 - 0.001);
  const half = Math.acos(clamp(d / (2 * LEG), -1, 1));
  const a = Math.atan2(fwd, down) + half;
  const k = 2 * half;
  legRaw(p, side, -a, out, k, a - k);
}

// ---------------------------------------------------------------- body model
function makeMats(skinHex, pantsHex, sashHex) {
  return {
    skin: new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.62, metalness: 0.02 }),
    pants: new THREE.MeshStandardMaterial({ color: pantsHex, roughness: 0.9 }),
    sash: new THREE.MeshStandardMaterial({ color: sashHex, roughness: 0.75 }),
    wrap: new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.4 }),
  };
}

const G = {}; // shared geometries
function geo() {
  if (G.sphere) return G;
  G.sphere = new THREE.SphereGeometry(1, 16, 12);
  G.sphereLo = new THREE.SphereGeometry(1, 10, 8);
  G.capsule = new THREE.CapsuleGeometry(1, 1, 4, 12);
  G.thigh = new THREE.CylinderGeometry(0.105, 0.088, LEG, 12, 1);
  G.shin = new THREE.CylinderGeometry(0.088, 0.07, LEG * 0.86, 12, 1);
  G.wrap = new THREE.CylinderGeometry(0.066, 0.06, 0.09, 12, 1);
  G.uarm = new THREE.CylinderGeometry(0.066, 0.055, 0.27, 12, 1);
  G.farm = new THREE.CylinderGeometry(0.058, 0.045, 0.25, 12, 1);
  G.neck = new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10, 1);
  G.sash = new THREE.TorusGeometry(0.165, 0.024, 6, 24);
  G.nose = new THREE.ConeGeometry(0.018, 0.045, 6);
  return G;
}

function part(parent, geom, mat, sx, sy, sz, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geom, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function buildBody(mats, build = 1) {
  const g = geo();
  const root = new THREE.Group();
  const tumble = new THREE.Group(); tumble.position.y = 0.6; root.add(tumble);
  const offs = new THREE.Group(); offs.position.y = -0.6; tumble.add(offs);
  const J = {};
  const mk = (name, parent, x, y, z) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); J[name] = o; return o; };

  const hips = mk('hips', offs, 0, HIP_H, 0);
  // pelvis / pants seat
  part(hips, g.sphere, mats.pants, 0.19 * build, 0.15, 0.14, 0, 0.0, -0.01);
  part(hips, g.sash, mats.sash, 1.08 * build, 0.8, 1, 0, 0.09, 0, Math.PI / 2);
  // sash tails
  part(hips, g.sphereLo, mats.sash, 0.04, 0.12, 0.02, 0.07, -0.02, 0.14, 0.2);

  const spine = mk('spine', hips, 0, 0.1, 0);
  part(spine, g.sphere, mats.skin, 0.165 * build, 0.17, 0.12, 0, 0.08, 0.0);     // abdomen
  part(spine, g.sphereLo, mats.skin, 0.075, 0.1, 0.04, 0.05, 0.08, 0.085);        // abs L
  part(spine, g.sphereLo, mats.skin, 0.075, 0.1, 0.04, -0.05, 0.08, 0.085);       // abs R

  const chest = mk('chest', spine, 0, 0.17, 0);
  part(chest, g.sphere, mats.skin, 0.235 * build, 0.2, 0.15, 0, 0.13, -0.005);    // rib cage / lats
  part(chest, g.sphere, mats.skin, 0.1 * build, 0.068, 0.04, 0.08, 0.19, 0.095, 0.15, 0, -0.12); // pec L
  part(chest, g.sphere, mats.skin, 0.1 * build, 0.068, 0.04, -0.08, 0.19, 0.095, 0.15, 0, 0.12);  // pec R
  part(chest, g.sphere, mats.skin, 0.17 * build, 0.08, 0.1, 0, 0.29, -0.03);       // traps

  const neck = mk('neck', chest, 0, 0.32, 0);
  part(neck, g.neck, mats.skin, 1, 1, 1, 0, 0.05, 0);
  const head = mk('head', neck, 0, 0.1, 0.01);
  part(head, g.sphere, mats.skin, 0.105, 0.125, 0.115, 0, 0.1, 0);                  // skull
  part(head, g.sphereLo, mats.skin, 0.08, 0.06, 0.08, 0, 0.035, 0.03);              // jaw
  part(head, g.nose, mats.skin, 1, 1, 1, 0, 0.09, 0.115, Math.PI / 2);
  part(head, g.sphereLo, mats.dark, 0.016, 0.012, 0.01, 0.038, 0.115, 0.1);         // eyes
  part(head, g.sphereLo, mats.dark, 0.016, 0.012, 0.01, -0.038, 0.115, 0.1);
  part(head, g.sphereLo, mats.skin, 0.02, 0.035, 0.015, 0.104, 0.1, 0);             // ears
  part(head, g.sphereLo, mats.skin, 0.02, 0.035, 0.015, -0.104, 0.1, 0);

  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const sh = mk('s' + s, chest, 0.215 * side * build, 0.24, -0.01);
    part(sh, g.sphere, mats.skin, 0.085, 0.08, 0.08, 0.01 * side, 0.0, 0);         // deltoid
    part(sh, g.uarm, mats.skin, 1, 1, 1, 0, -0.14, 0);
    part(sh, g.sphereLo, mats.skin, 0.05, 0.07, 0.05, 0, -0.13, 0.025);             // bicep
    const el = mk('e' + s, sh, 0, -0.285, 0);
    part(el, g.sphereLo, mats.skin, 0.055, 0.055, 0.055, 0, 0, 0);
    part(el, g.farm, mats.skin, 1, 1, 1, 0, -0.125, 0);
    part(el, g.wrap, mats.wrap, 0.85, 1, 0.85, 0, -0.22, 0);
    const wr = mk('w' + s, el, 0, -0.26, 0);
    part(wr, g.sphere, mats.skin, 0.05, 0.06, 0.055, 0, -0.035, 0.005);             // fist

    const hp = mk('h' + s, hips, 0.1 * side, -0.02, 0);
    part(hp, g.thigh, mats.pants, 1.05, 1, 1.05, 0, -LEG / 2, 0);
    const kn = mk('k' + s, hp, 0, -LEG, 0);
    part(kn, g.sphereLo, mats.pants, 0.09, 0.08, 0.09, 0, 0, 0);
    part(kn, g.shin, mats.pants, 1, 1, 1, 0, -LEG * 0.43, 0);
    part(kn, g.wrap, mats.wrap, 1, 1.2, 1, 0, -LEG + 0.07, 0);
    const an = mk('a' + s, kn, 0, -LEG, 0);
    part(an, g.sphere, mats.skin, 0.055, 0.04, 0.12, 0, -0.04, 0.055);              // foot
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, tumble, J };
}

// ---------------------------------------------------------------- actions
export const ACTIONS = {
  jab:   { dur: 0.30, upper: true,  active: [0.3, 0.55], dmg: 6,  range: 1.75, knock: 2.5, lunge: 6 },
  cross: { dur: 0.32, upper: true,  active: [0.3, 0.55], dmg: 7,  range: 1.8,  knock: 3,   lunge: 6 },
  kick:  { dur: 0.6,  upper: false, active: [0.38, 0.62], dmg: 11, range: 2.1, knock: 8,   lunge: 7, spin: true },
  raise: { dur: 0.32, upper: true },
  throw: { dur: 0.36, upper: true, fireAt: 0.32 },
  hit:   { dur: 0.34, upper: false },
  land:  { dur: 0.14, upper: false, soft: true },
  ko:    { dur: 99,   upper: false },
};
const COMBO = ['jab', 'cross', 'kick'];

// ---------------------------------------------------------------- Fighter
export class Fighter {
  constructor(world, opts) {
    this.world = world;
    this.name = opts.name;
    this.team = opts.team;
    this.mats = makeMats(opts.skin, opts.pants, opts.sash);
    const body = buildBody(this.mats, opts.build || 1);
    this.root = body.root; this.tumble = body.tumble; this.J = body.J;
    world.scene.add(this.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.faceYaw = 0; this.spinYaw = 0;
    this.radius = 0.42;
    this.height = 1.75;
    this.onGround = true; this.groundY = 0; this.airTime = 0;
    this.maxHp = 100; this.hp = 100;
    this.maxEn = 100; this.en = 100;
    this.action = null; this.actionT = 0; this.actionFired = false; this.hitDone = false;
    this.comboIdx = 0; this.comboTimer = 0; this.queued = false;
    this.dodgeT = 0; this.dodgeDir = new THREE.Vector3(); this.dodgeCd = 0;
    this.guarding = false; this.holding = false; this.guardCd = 0;
    this.lungeT = 0; this.lungeDir = new THREE.Vector3();
    this.invuln = 0; this.flash = 0; this.stunT = 0;
    this.runPhase = 0; this.time = Math.random() * 10;
    this.moveLocal = new THREE.Vector2();
    this.speedNorm = 0;
    this.dead = false;
    this.input = Fighter.blankInput();
    this.aimPoint = new THREE.Vector3();
    this.heldRock = null; this.shield = null;
    this.target = null;

    this.pose = new Float32Array(POSE_LEN);
    this.cur = new Float32Array(POSE_LEN);
    this.tmpPose = new Float32Array(POSE_LEN);
  }

  static blankInput() {
    return { mx: 0, mz: 0, strafe: false, faceYaw: null, attack: false, bend: false, guard: false, jump: false, dodge: false, aimPoint: new THREE.Vector3() };
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = this.faceYaw = yaw; this.spinYaw = 0;
    this.hp = this.maxHp; this.en = this.maxEn; this.dead = false;
    this.action = null; this.guarding = false; this.holding = false;
    this.dodgeT = 0; this.stunT = 0; this.invuln = 0; this.flash = 0;
    this.tumble.quaternion.identity();
    this.pose.fill(0); this.cur.fill(0); this.runPhase = 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  get chest() { return this._chest || (this._chest = new THREE.Vector3()); }
  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.3, this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  handPos(side, out = new THREE.Vector3()) { return this.J['w' + side].getWorldPosition(out); }

  busy() { return this.action && !ACTIONS[this.action].soft && this.action !== 'raise' && this.action !== 'throw'; }
  canAct() { return !this.dead && this.stunT <= 0 && this.dodgeT <= 0; }

  startAction(name) {
    this.action = name; this.actionT = 0; this.actionFired = false; this.hitDone = false;
    if (name === 'kick') this.spinYaw = 0;
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    if (!(dt > 0)) return;
    const w = this.world, inp = this.input, A = this.action ? ACTIONS[this.action] : null;
    this.time += dt;
    this.dodgeCd -= dt; this.guardCd -= dt; this.invuln -= dt; this.comboTimer -= dt; this.stunT -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);

    // action timeline
    if (this.action) {
      this.actionT += dt;
      const u = this.actionT / A.dur;
      if (A.active && !this.hitDone && u >= A.active[0] && u <= A.active[1]) {
        if (w.combat.meleeCheck(this, this.action)) this.hitDone = true;
      }
      if (A.fireAt && !this.actionFired && u >= A.fireAt) { this.actionFired = true; w.combat.release(this); }
      if (A.active && this.queued && u >= 0.62 && this.action !== 'kick') { this.queued = false; this.nextCombo(); }
      else if (u >= 1 && this.action !== 'ko') {
        if (this.queued && this.action !== 'kick' && COMBO.includes(this.action)) { this.queued = false; this.nextCombo(); }
        else { this.action = null; this.spinYaw = 0; }
      }
    }

    const live = !this.dead;
    // ---- commands
    if (live && this.canAct()) {
      if (inp.dodge && this.dodgeCd <= 0 && this.en >= 12 && !this.holding) this.doDodge();
      else if (inp.jump && this.onGround && !this.busy()) { this.vel.y = 7.4; this.onGround = false; w.audio.whoosh(0.4); }
      if (inp.attack && this.dodgeT <= 0) {
        if (!this.action || ACTIONS[this.action].soft || this.action === 'throw') { this.comboIdx = this.comboTimer > 0 ? this.comboIdx : 0; this.startCombo(); }
        else if (COMBO.includes(this.action)) this.queued = true;
      }
      // guard (stone shield)
      const wantGuard = inp.guard && this.guardCd <= 0;
      if (wantGuard && !this.guarding && (!this.action || ACTIONS[this.action].soft || this.action === 'raise') && this.en > 5) {
        this.guarding = true; w.combat.raiseShield(this);
      }
      // bending (rock)
      if (inp.bend && !this.holding && !this.guarding && !this.action && this.en >= 16) {
        if (w.combat.summonRock(this)) { this.holding = true; this.startAction('raise'); }
      }
      if (this.holding && !inp.bend && this.action !== 'raise') {
        this.holding = false; this.startAction('throw');
      }
    }
    if (this.guarding && (!inp.guard || this.dead || this.en <= 0 || this.stunT > 0)) {
      this.guarding = false; this.guardCd = 0.3; w.combat.dropShield(this);
    }
    if (this.holding && (this.dead || this.stunT > 0)) { this.holding = false; w.combat.dropRock(this); }

    // energy
    if (this.guarding) this.en -= 9 * dt;
    else if (!this.holding) this.en += (this.onGround ? 16 : 8) * dt;
    this.en = clamp(this.en, 0, this.maxEn);

    // ---- movement
    let mx = live ? inp.mx : 0, mz = live ? inp.mz : 0;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; }
    let maxSpeed = 6.6;
    if (this.guarding) maxSpeed = 2.2;
    else if (this.holding) maxSpeed = 4.2;
    if (this.action && !ACTIONS[this.action].soft) maxSpeed = (A && A.upper) ? 3.2 : 0.6;
    if (this.stunT > 0) maxSpeed = 0;

    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const k = smooth01(this.dodgeT / 0.42);
      const sp = 3 + 12 * k;
      this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.vel.x = this.lungeDir.x; this.vel.z = this.lungeDir.z;
    } else {
      const tx = mx * maxSpeed, tz = mz * maxSpeed;
      const accel = this.onGround ? ((tx * tx + tz * tz) > 0.01 ? 38 : 30) : 11;
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz), step = accel * dt * (w.iceAt ? w.iceAt(this.pos) : 1);
      if (dl <= step || dl < 1e-6) { this.vel.x = tx; this.vel.z = tz; }
      else { this.vel.x += dx / dl * step; this.vel.z += dz / dl * step; }
    }
    this.vel.y -= 21 * dt;
    this.pos.addScaledVector(this.vel, dt);

    // collisions with arena geometry
    w.arena.collide(this);
    // land / ground
    const gy = w.arena.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gy + 0.001) {
      if (!this.onGround && this.airTime > 0.28 && !this.action && this.dodgeT <= 0) { this.startAction('land'); w.fx.dust(this.pos, 6, 1.4); }
      this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; this.airTime = 0;
    } else if (this.pos.y > gy + 0.05) {
      if (this.onGround && this.vel.y <= 0 && this.pos.y - gy < 0.5) { this.pos.y = gy; this.vel.y = 0; } // walk down steps
      else { this.onGround = false; this.airTime += dt; }
    }
    this.groundY = gy;

    // ---- facing
    let wantYaw = null;
    if (this.dead) wantYaw = null;
    else if (this.lungeT > 0) wantYaw = Math.atan2(this.lungeDir.x, this.lungeDir.z);
    else if (inp.strafe || this.guarding || this.holding || (this.action && this.action !== 'land' && this.action !== 'hit')) wantYaw = inp.faceYaw;
    else if (mlen > 0.15 && this.dodgeT <= 0) wantYaw = Math.atan2(mx, mz);
    if (wantYaw !== null && wantYaw !== undefined) {
      const rate = this.action && this.action !== 'land' ? 18 : (inp.strafe ? 14 : 11);
      this.faceYaw = dampAngle(this.faceYaw, wantYaw, rate, dt);
    }
    this.yaw = this.faceYaw + this.spinYaw;

    // local movement direction for animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speedNorm = clamp(sp / 6.6, 0, 1.3);
    if (sp > 0.05) {
      const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
      // local: z forward, x left
      const lz = (this.vel.x * s + this.vel.z * c) / sp, lx = (this.vel.x * c - this.vel.z * s) / sp;
      this.moveLocal.set(lx, lz);
    }
    this.runPhase += sp * dt * (Math.PI * 2 / 2.1);

    this.animate(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const f = this.flash;
    this.mats.skin.emissive.setRGB(f * 0.9, f * 0.25, f * 0.15);
  }

  startCombo() {
    const name = COMBO[this.comboIdx % 3];
    this.comboIdx = (this.comboIdx + 1) % 3; this.comboTimer = 0.75;
    this.startAction(name);
    this.world.combat.lunge(this, ACTIONS[name]);
    this.world.audio.whoosh(name === 'kick' ? 0.8 : 0.45);
  }
  nextCombo() { this.startCombo(); }

  doDodge() {
    const inp = this.input;
    let dx = inp.mx, dz = inp.mz;
    if (Math.hypot(dx, dz) < 0.2) { dx = -Math.sin(this.faceYaw); dz = -Math.cos(this.faceYaw); }
    const l = Math.hypot(dx, dz); this.dodgeDir.set(dx / l, 0, dz / l);
    this.dodgeT = 0.42; this.dodgeCd = 0.55; this.invuln = 0.32; this.en -= 12;
    this.action = null; this.spinYaw = 0;
    if (this.holding) { this.holding = false; this.world.combat.dropRock(this); }
    this.world.fx.dust(this.pos, 5, 1.2);
    this.world.audio.whoosh(0.6);
  }

  takeHit(dmg, dir, knock, heavy) {
    this.hp = Math.max(0, this.hp - dmg);
    this.flash = 1;
    this.vel.x += dir.x * knock; this.vel.z += dir.z * knock;
    if (heavy) this.vel.y = Math.max(this.vel.y, 3);
    if (this.hp <= 0) { this.die(dir); return; }
    if (this.holding) { this.holding = false; this.world.combat.dropRock(this); }
    this.startAction('hit'); this.stunT = heavy ? 0.42 : 0.22; this.spinYaw = 0; this.lungeT = 0;
    this.hitDir = dir.clone();
  }

  die(dir) {
    this.dead = true; this.guarding = false;
    this.world.combat.dropShield(this);
    this.startAction('ko'); this.koDir = dir.clone();
    this.vel.x = dir.x * 6; this.vel.z = dir.z * 6; this.vel.y = 4;
  }

  // ------------------------------------------------------------ animation
  animate(dt) {
    const p = this.pose; p.fill(0);
    const t = this.time;
    const onG = this.onGround;
    const spd = this.speedNorm;

    // ---- locomotion base
    this.idlePose(p, t);
    if (onG && spd > 0.06 && this.dodgeT <= 0) {
      const q = this.tmpPose; q.fill(0);
      this.runPose(q, this.runPhase, spd);
      const wRun = clamp(spd * 2.2, 0, 1);
      for (let i = 0; i < POSE_LEN; i++) p[i] += (q[i] - p[i]) * wRun;
    }
    if (!onG && this.dodgeT <= 0) this.airPose(p);

    // ---- continuous stances
    if (this.guarding) this.guardPose(p, onG && spd < 0.15);
    if (this.holding && this.action !== 'raise') this.holdPose(p, t);

    // ---- actions
    if (this.action) {
      const A = ACTIONS[this.action], u = clamp(this.actionT / A.dur, 0, 1);
      const q = this.tmpPose; q.set(p);
      this.actionPose(q, this.action, u);
      const legsToo = !A.upper || spd < 0.15 || !onG;
      for (let i = 0; i < POSE_LEN; i++) {
        const isLeg = i >= JI.hL && i < PN;
        const isHipRot = i < 3;
        if ((isLeg || isHipRot || i >= PN) && !legsToo) continue;
        p[i] = q[i];
      }
    }
    if (this.dodgeT > 0) this.dodgePose(p);

    // ---- smoothing towards target pose
    const fast = this.action && !ACTIONS[this.action].soft ? 30 : 16;
    const k = 1 - Math.exp(-fast * dt);
    const c = this.cur;
    for (let i = 0; i < POSE_LEN; i++) c[i] += (p[i] - c[i]) * k;

    const J = this.J;
    for (let j = 0; j < JOINTS.length; j++) {
      const o = J[JOINTS[j]], i = j * 3;
      o.rotation.set(c[i], c[i + 1], c[i + 2], 'YXZ');
    }
    J.hips.position.set(c[PX], HIP_H + c[PY], c[PZ]);

    // ---- whole-body tumble (dodge roll, KO)
    const tq = this.tumble.quaternion;
    if (this.dodgeT > 0) {
      const prog = 1 - this.dodgeT / 0.42;
      const ang = smooth01(clamp(prog / 0.9, 0, 1)) * Math.PI * 2;
      // roll axis perpendicular to dodge direction, in local space
      const c0 = Math.cos(this.yaw), s0 = Math.sin(this.yaw);
      const lz = this.dodgeDir.x * s0 + this.dodgeDir.z * c0, lx = this.dodgeDir.x * c0 - this.dodgeDir.z * s0;
      _axis.set(lz, 0, -lx).normalize();
      tq.setFromAxisAngle(_axis, ang);
    } else if (this.dead) {
      const prog = smooth01(clamp(this.actionT / 0.55, 0, 1));
      const c0 = Math.cos(this.yaw), s0 = Math.sin(this.yaw);
      const d = this.koDir || _fwd.set(0, 0, -1);
      const lz = d.x * s0 + d.z * c0, lx = d.x * c0 - d.z * s0;
      _axis.set(lz, 0, -lx).normalize();
      _q.setFromAxisAngle(_axis, prog * Math.PI / 2 * 0.98);
      tq.copy(_q);
      this.tumble.position.y = 0.6 - prog * 0.42;
    } else {
      tq.slerp(_qi, 1 - Math.exp(-20 * dt));
      this.tumble.position.y = 0.6;
    }
  }

  idlePose(p, t) {
    const b = Math.sin(t * 2.3);
    p[PY] = -0.07 + b * 0.006;
    S(p, 'hips', 0, 0.32, 0);
    S(p, 'spine', 0.06, -0.12, 0);
    S(p, 'chest', 0.04 + b * 0.015, -0.14, 0);
    S(p, 'neck', -0.05, -0.04, 0);
    S(p, 'head', 0.02, -0.02, 0);
    // guard up, lead hand (left) forward
    arm(p, 1, -0.95, 0.28, -0.3, 1.9, 0.1);
    arm(p, -1, -0.7, 0.32, -0.4, 2.15, 0.1);
    const down = HIP_H + p[PY] - 0.08;
    legIK(p, 1, 0.24, down, 0.1);
    legIK(p, -1, -0.2, down, 0.12);
  }

  runPose(p, ph, spd) {
    const ml = this.moveLocal; // x left, y forward
    const f = ml.y, s = ml.x;
    const A = 0.55 + 0.35 * Math.min(spd, 1);
    const sinL = Math.sin(ph), sinR = Math.sin(ph + Math.PI);
    p[PY] = -0.05 + Math.abs(Math.cos(ph)) * 0.06 * spd;
    const lean = 0.22 * Math.min(spd, 1) * f;
    S(p, 'hips', 0.05 * f, Math.sin(ph) * 0.18 * f, -s * 0.12);
    S(p, 'spine', lean * 0.6, -Math.sin(ph) * 0.12 * f, s * 0.05);
    S(p, 'chest', lean * 0.5, -Math.sin(ph) * 0.1 * f, 0);
    S(p, 'neck', -lean * 0.6, 0, 0);
    S(p, 'head', -lean * 0.3, 0, 0);
    for (const side of [1, -1]) {
      const sn = side > 0 ? sinL : sinR, cs = side > 0 ? Math.cos(ph) : Math.cos(ph + Math.PI);
      const swingFwd = sn * A * f;                                  // + forward
      const swingSide = sn * A * 0.7 * s;                            // + towards local +x
      const knee = 0.25 + 1.35 * Math.max(0, f >= 0 ? cs : -cs) * Math.min(1, spd + 0.3);
      const hzOut = swingSide * side + 0.05;
      legRaw(p, side, -swingFwd, hzOut, knee, -0.15 + 0.3 * Math.max(0, -sn * f));
      // arms counter-swing
      arm(p, side, sn * 0.75 * f - 0.25, 0.12 + Math.abs(s) * 0.15, 0, 1.45 + 0.2 * cs, 0);
    }
  }

  airPose(p) {
    const up = this.vel.y;
    const tuck = clamp(1 - Math.abs(up) / 7, 0, 1);
    p[PY] = -0.04;
    S(p, 'spine', 0.1 + tuck * 0.15, 0, 0);
    legRaw(p, 1, -0.9 - tuck * 0.4, 0.12, 1.4 + tuck * 0.4, -0.3);
    legRaw(p, -1, 0.15, 0.1, 0.9 + tuck * 0.5, -0.2);
    arm(p, 1, -0.5, 0.9, 0, 0.9);
    arm(p, -1, -0.2, 1.0, 0, 0.7);
  }

  guardPose(p, legs) {
    // earth stance: wide horse stance, both palms pushing forward
    S(p, 'spine', 0.12, 0, 0); S(p, 'chest', 0.05, 0, 0);
    S(p, 'neck', -0.1, 0, 0); S(p, 'head', -0.05, 0, 0);
    arm(p, 1, -1.35, 0.35, 0.3, 0.45, -1.2);
    arm(p, -1, -1.35, 0.35, 0.3, 0.45, -1.2);
    if (legs) {
      S(p, 'hips', 0.05, 0, 0);
      p[PY] = -0.2;
      const down = HIP_H + p[PY] - 0.08;
      legIK(p, 1, 0.15, down, 0.38);
      legIK(p, -1, -0.12, down, 0.38);
    }
  }

  holdPose(p, t) {
    const b = Math.sin(t * 6) * 0.05;
    S(p, 'chest', 0.02, 0.15, 0);
    arm(p, 1, -1.25 + b, 0.5, 0.2, 0.9, -0.9);
    arm(p, -1, -1.5 - b, 0.25, 0.2, 0.6, -1.1);
  }

  dodgePose(p) {
    p[PY] = -0.25;
    S(p, 'hips', 0, 0, 0); S(p, 'spine', 0.5, 0, 0); S(p, 'chest', 0.4, 0, 0); S(p, 'neck', 0.4, 0, 0);
    legRaw(p, 1, -1.9, 0.15, 2.3, -0.4);
    legRaw(p, -1, -1.7, 0.15, 2.3, -0.4);
    arm(p, 1, -1.2, 0.3, 0, 2.0);
    arm(p, -1, -1.2, 0.3, 0, 2.0);
  }

  actionPose(p, name, u) {
    switch (name) {
      case 'jab': case 'cross': {
        const side = name === 'jab' ? 1 : -1;  // jab = lead left, cross = right
        const wind = smooth01(clamp(u / 0.3, 0, 1)), ext = smooth01(clamp((u - 0.25) / 0.15, 0, 1)), back = smooth01(clamp((u - 0.65) / 0.35, 0, 1));
        const e = ext * (1 - back);
        S(p, 'hips', 0, (0.3 - 0.55 * e) * side, 0);
        S(p, 'chest', 0.06, (-0.15 * wind + -0.55 * e) * side, 0);
        S(p, 'spine', 0.12 * e, -0.2 * e * side, 0);
        arm(p, side, -0.9 - 0.7 * e, 0.28 - 0.2 * e, -0.2, 1.9 - 1.85 * e, 0);
        arm(p, -side, -0.75, 0.3, -0.4, 2.2, 0);
        if (u < 0.85) {
          const down = HIP_H - 0.12 - 0.08;
          p[PY] = -0.12;
          legIK(p, side, 0.38 * (0.5 + e * 0.5), down, 0.1);
          legIK(p, -side, -0.28, down, 0.12);
        }
        break;
      }
      case 'kick': {
        // jumping spin roundhouse with right leg
        const lift = Math.sin(clamp(u, 0, 1) * Math.PI);
        const ext = smooth01(clamp((u - 0.25) / 0.2, 0, 1)) * (1 - smooth01(clamp((u - 0.75) / 0.25, 0, 1)));
        this.spinYaw = -smooth01(clamp((u - 0.08) / 0.75, 0, 1)) * Math.PI * 2;
        p[PY] = 0.08 * lift;
        S(p, 'hips', 0, 0, -0.35 * ext);
        S(p, 'spine', 0, 0, 0.25 * ext); S(p, 'chest', 0.05, 0, 0.15 * ext);
        legRaw(p, -1, -0.4 * ext, 1.45 * ext, 1.5 * (1 - ext) + 0.1, 0.4);
        legIK(p, 1, 0.05, HIP_H - 0.08 + p[PY] - 0.04, 0.05);
        arm(p, 1, -0.4, 1.2, 0, 0.8);
        arm(p, -1, -0.2, 1.4, 0, 0.5);
        break;
      }
      case 'raise': {
        // crouch, palms up, sweep both arms upward to lift the stone
        const rise = smooth01(u);
        p[PY] = -0.24 + 0.12 * rise;
        S(p, 'hips', 0, 0, 0); S(p, 'spine', 0.35 - 0.3 * rise, 0, 0); S(p, 'chest', 0.1, 0, 0);
        S(p, 'neck', -0.2, 0, 0);
        arm(p, 1, -0.35 - 1.05 * rise, 0.3, 0.6, 0.5, 0.6 - 1.2 * rise);
        arm(p, -1, -0.35 - 1.05 * rise, 0.3, 0.6, 0.5, 0.6 - 1.2 * rise);
        const down = HIP_H + p[PY] - 0.08;
        legIK(p, 1, 0.2, down, 0.32);
        legIK(p, -1, -0.15, down, 0.32);
        break;
      }
      case 'throw': {
        // step-in and drive the right palm through the stone
        const wind = smooth01(clamp(u / 0.3, 0, 1)), push = smooth01(clamp((u - 0.25) / 0.2, 0, 1)), back = smooth01(clamp((u - 0.7) / 0.3, 0, 1));
        const e = push * (1 - back);
        S(p, 'hips', 0, -0.2 + 0.5 * wind - 0.8 * e, 0);
        S(p, 'chest', 0.1, 0.4 * wind - 0.9 * e, 0);
        S(p, 'spine', 0.15 * e, 0, 0);
        arm(p, -1, -1.0 - 0.6 * e, 0.4 - 0.3 * e, 0.2, 1.6 - 1.55 * e, -1.2 * e);
        arm(p, 1, -0.6 + 0.4 * e, 0.6, 0, 1.4, 0);
        if (this.speedNorm < 0.15) {
          p[PY] = -0.14;
          const down = HIP_H - 0.14 - 0.08;
          legIK(p, 1, 0.42, down, 0.15);
          legIK(p, -1, -0.32 + 0.1 * e, down, 0.15);
        }
        break;
      }
      case 'hit': {
        const k = Math.sin(clamp(u, 0, 1) * Math.PI);
        S(p, 'spine', -0.35 * k, 0, 0.1 * k); S(p, 'chest', -0.25 * k, 0, 0);
        S(p, 'neck', -0.3 * k, 0, 0); S(p, 'head', -0.2 * k, 0.2 * k, 0);
        arm(p, 1, -0.3, 0.7 * k + 0.2, 0, 0.8);
        arm(p, -1, -0.2, 0.8 * k + 0.2, 0, 0.6);
        p[PY] = -0.1 * k;
        break;
      }
      case 'land': {
        const k = Math.sin(clamp(u, 0, 1) * Math.PI);
        p[PY] = -0.07 - 0.15 * k;
        const down = HIP_H + p[PY] - 0.08;
        S(p, 'spine', 0.1 + 0.2 * k, 0, 0);
        legIK(p, 1, 0.22, down, 0.14); legIK(p, -1, -0.18, down, 0.14);
        break;
      }
      case 'ko': {
        S(p, 'spine', -0.2, 0, 0); S(p, 'neck', -0.2, 0, 0);
        arm(p, 1, -0.2, 1.3, 0, 0.4); arm(p, -1, -0.4, 1.1, 0, 0.6);
        legRaw(p, 1, -0.3, 0.2, 0.4, 0); legRaw(p, -1, 0.1, 0.15, 0.2, 0);
        p[PY] = 0;
        break;
      }
    }
  }
}
const _axis = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _fwd = new THREE.Vector3();
