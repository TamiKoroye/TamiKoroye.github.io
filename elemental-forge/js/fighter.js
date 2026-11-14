// Fighter: skinned martial-artist body, procedural layered animation and movement/combat state.
import * as THREE from 'three';
import { clamp, dampAngle, angleDiff, smooth01 } from './util.js';
import { buildSkinnedFighter, HIP_H, LEG } from './character.js';

// ---------------------------------------------------------------- pose data
const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'sL', 'eL', 'wL', 'sR', 'eR', 'wR', 'hL', 'kL', 'aL', 'hR', 'kR', 'aR'];
const JI = {}; JOINTS.forEach((n, i) => (JI[n] = i * 3));
const PN = JOINTS.length * 3;
const POSE_LEN = PN + 3;
const PX = PN, PY = PN + 1, PZ = PN + 2;

function S(p, j, x, y, z) { const i = JI[j]; p[i] = x; p[i + 1] = y; p[i + 2] = z; }
function add(p, j, x, y, z) { const i = JI[j]; p[i] += x; p[i + 1] += y; p[i + 2] += z; }
const sideName = (base, side) => base + (side > 0 ? 'L' : 'R');
// side: +1 = left (+x), -1 = right (-x). abd > 0 raises the arm outwards.
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
  const d = Math.min(Math.hypot(fwd, down), LEG * 2 - 0.001);
  const half = Math.acos(clamp(d / (2 * LEG), -1, 1));
  const a = Math.atan2(fwd, down) + half, k = 2 * half;
  legRaw(p, side, -a, out, k, a - k);
}
const hipDown = (py) => HIP_H + py - 0.08;
const seg = (u, a, b) => smooth01((u - a) / (b - a));

// ---------------------------------------------------------------- actions
// phases: active = [start, end] as a fraction of dur; cancel = fraction after which dodge/jump/attack may cancel recovery.
export const ACTIONS = {
  jab:     { dur: 0.30, upper: true,  active: [0.28, 0.5], cancel: 0.55, lunge: 6 },
  cross:   { dur: 0.32, upper: true,  active: [0.28, 0.5], cancel: 0.55, lunge: 6 },
  kick:    { dur: 0.58, upper: false, active: [0.36, 0.6], cancel: 0.68, lunge: 7 },
  heavy:   { dur: 0.52, upper: false, active: [0.42, 0.62], cancel: 0.72, lunge: 8 },
  slam:    { dur: 0.72, upper: false, fireAt: 0.55, cancel: 0.8 },
  counter: { dur: 0.4,  upper: false, active: [0.2, 0.55], cancel: 0.65, lunge: 10 },
  raise:   { dur: 0.32, upper: true },
  throw:   { dur: 0.36, upper: true, fireAt: 0.32, cancel: 0.6 },
  hit:     { dur: 0.3,  upper: false, react: true },
  stagger: { dur: 0.62, upper: false, react: true },
  down:    { dur: 0.85, upper: false, react: true },
  getup:   { dur: 0.45, upper: false, react: true },
  land:    { dur: 0.14, upper: false, soft: true },
  ko:      { dur: 99,   upper: false, react: true },
};
const COMBO = ['jab', 'cross', 'kick'];
const DODGE = { roll: 0.42, side: 0.26, back: 0.3 };
export const SPEED = { walk: 3.0, run: 6.6, sprint: 9.4 };

// ---------------------------------------------------------------- Fighter
export class Fighter {
  constructor(world, opts) {
    this.world = world;
    this.name = opts.name;
    this.team = opts.team;
    const body = buildSkinnedFighter({ skin: opts.skin, pants: opts.pants, sash: opts.sash, wrap: opts.wrap, build: opts.build || 1, bulk: opts.bulk || 1 });
    this.root = body.root; this.tumble = body.tumble; this.J = body.J; this.material = body.material; this.mesh = body.mesh;
    this.triangles = body.triangles;
    world.scene.add(this.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.faceYaw = 0; this.spinYaw = 0;
    this.radius = 0.42; this.height = 1.75;
    this.onGround = true; this.groundY = 0; this.airTime = 0;
    this.maxHp = 100; this.hp = 100;
    this.maxEn = 100; this.en = 100;
    this.action = null; this.actionT = 0; this.actionFired = false; this.hitDone = false;
    this.comboIdx = 0; this.comboTimer = 0; this.queued = false;
    this.dodgeT = 0; this.dodgeDur = 0.42; this.dodgeKind = 'roll'; this.dodgeDir = new THREE.Vector3(); this.dodgeCd = 0;
    this.guarding = false; this.guardT = 0; this.holding = false; this.guardCd = 0;
    this.charging = false; this.chargeT = 0; this.atkHoldT = -1;
    this.counterT = 0;
    this.lungeT = 0; this.lungeDir = new THREE.Vector3();
    this.invuln = 0; this.flash = 0; this.stunT = 0;
    this.sprinting = false;
    this.buf = { attack: 0, dodge: 0, jump: 0 };
    this.runPhase = 0; this.time = Math.random() * 10; this.stepSide = 0;
    this.moveLocal = new THREE.Vector2(0, 1);
    this.speedNorm = 0; this.bank = 0; this.accLean = 0; this.prevFace = 0; this.prevVel = new THREE.Vector3();
    this.dead = false;
    this.input = Fighter.blankInput();
    this.heldRock = null; this.shield = null;
    this.target = null;
    this.stats = { hitsLanded: 0, blocks: 0, perfect: 0 };

    this.pose = new Float32Array(POSE_LEN);
    this.cur = new Float32Array(POSE_LEN);
    this.tmpPose = new Float32Array(POSE_LEN);
  }

  static blankInput() {
    return { mx: 0, mz: 0, strafe: false, faceYaw: null, attack: false, attackHeld: false, bend: false, guard: false, jump: false, dodge: false, sprint: false, aimPoint: new THREE.Vector3() };
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = this.faceYaw = this.prevFace = yaw; this.spinYaw = 0;
    this.hp = this.maxHp; this.en = this.maxEn; this.dead = false;
    this.action = null; this.guarding = false; this.holding = false; this.charging = false; this.atkHoldT = -1;
    this.dodgeT = 0; this.stunT = 0; this.invuln = 0; this.flash = 0; this.counterT = 0; this.lungeT = 0;
    this.buf.attack = this.buf.dodge = this.buf.jump = 0;
    this.tumble.quaternion.identity(); this.tumble.position.y = 0.6;
    this.pose.fill(0); this.cur.fill(0); this.runPhase = 0; this.bank = 0; this.accLean = 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.3, this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  handPos(side, out = new THREE.Vector3()) { return this.J['w' + side].getWorldPosition(out); }

  get actionU() { return this.action ? this.actionT / ACTIONS[this.action].dur : 1; }
  reacting() { return this.action && ACTIONS[this.action].react; }
  // may a new move start now? (free, or inside a cancel window of the current move)
  free(kind) {
    if (this.dead || this.stunT > 0 || this.reacting()) return false;
    if (this.dodgeT > 0) return kind === 'attack' ? this.dodgeT < this.dodgeDur * 0.3 : false; // roll -> attack
    if (!this.action) return true;
    const A = ACTIONS[this.action];
    if (A.soft) return true;
    if (this.action === 'raise') return kind === 'dodge';
    return A.cancel !== undefined && this.actionU >= A.cancel;
  }
  busy() { return !this.free('jump'); }
  canAct() { return !this.dead && this.stunT <= 0 && this.dodgeT <= 0; }

  startAction(name) {
    this.action = name; this.actionT = 0; this.actionFired = false; this.hitDone = false;
    this.spinYaw = 0; this.queued = false;
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    if (!(dt > 0)) return;
    const w = this.world, inp = this.input;
    this.time += dt;
    this.dodgeCd -= dt; this.guardCd -= dt; this.invuln -= dt; this.comboTimer -= dt; this.stunT -= dt; this.counterT -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    for (const k in this.buf) this.buf[k] = Math.max(0, this.buf[k] - dt);
    if (inp.attack) this.buf.attack = 0.25;
    if (inp.dodge) this.buf.dodge = 0.18;
    if (inp.jump) this.buf.jump = 0.15;
    if (this.guarding) this.guardT += dt;

    // ---- action timeline
    if (this.action) {
      const A = ACTIONS[this.action];
      this.actionT += dt;
      const u = this.actionT / A.dur;
      if (A.active && !this.hitDone && u >= A.active[0] && u <= A.active[1]) {
        if (w.combat.meleeCheck(this, this.action)) { this.hitDone = true; this.stats.hitsLanded++; }
      }
      if (A.fireAt && !this.actionFired && u >= A.fireAt) {
        this.actionFired = true;
        if (this.action === 'throw') w.combat.release(this);
        if (this.action === 'slam') w.combat.slam(this);
      }
      if (this.action === 'slam' && !this.actionFired && u > 0.12 && u < 0.2 && this.onGround) { this.vel.y = 4.2; this.onGround = false; }
      if (COMBO.includes(this.action) && this.queued && u >= 0.6 && this.action !== 'kick') this.startCombo();
      else if (u >= 1 && this.action !== 'ko') {
        const was = this.action;
        if (this.queued && COMBO.includes(was) && was !== 'kick') this.startCombo();
        else { this.action = null; this.spinYaw = 0; if (was === 'down') this.startAction('getup'); }
      }
    }

    const live = !this.dead;
    // ---- commands (buffered)
    if (live) {
      if (this.buf.dodge && this.dodgeCd <= 0 && this.en >= 10 && this.free('dodge') && !this.charging) { this.buf.dodge = 0; this.doDodge(); }
      if (this.buf.jump && this.onGround && this.free('jump') && !this.charging && !this.guarding) {
        this.buf.jump = 0; if (this.action) this.action = null;
        this.vel.y = 7.4; this.onGround = false; w.audio.whoosh(0.4);
      }
      if (this.buf.attack && !this.charging) {
        if (this.free('attack') && !this.guarding) {
          this.buf.attack = 0; this.dodgeT = 0;
          if (this.holding) { this.holding = false; this.startAction('throw'); }
          else if (this.counterT > 0) { this.counterT = 0; this.startAction('counter'); w.combat.lunge(this, ACTIONS.counter); w.popup(this, 'COUNTER', true); w.audio.whoosh(0.9); }
          else { if (this.comboTimer <= 0) this.comboIdx = 0; this.startCombo(); }
          this.atkHoldT = 0;
        } else if (COMBO.includes(this.action) && this.action !== 'kick' && this.actionU > 0.2) { this.queued = true; this.buf.attack = 0; }
      }
      // hold STRIKE: light -> charge stance -> heavy (short) or charged slam (long)
      if (this.atkHoldT >= 0) {
        if (!inp.attackHeld) {
          if (this.charging) {
            this.charging = false;
            if (this.chargeT >= 0.7) { this.startAction('slam'); w.audio.whoosh(1); }
            else { this.startAction('heavy'); w.combat.lunge(this, ACTIONS.heavy); w.audio.whoosh(0.8); }
          }
          this.atkHoldT = -1;
        } else {
          this.atkHoldT += dt;
          const lightDone = !this.action || (COMBO.includes(this.action) && this.actionU > 0.55);
          if (!this.charging && this.atkHoldT > 0.26 && lightDone && !this.guarding && this.stunT <= 0 && !this.reacting()) {
            this.charging = true; this.chargeT = 0; this.action = null; this.queued = false;
          }
        }
      }
      if (this.charging) {
        this.chargeT += dt;
        if (this.stunT > 0 || this.reacting() || this.dodgeT > 0) { this.charging = false; this.atkHoldT = -1; }
        else if (Math.random() < dt * 14) {
          const h = this.handPos(Math.random() < 0.5 ? 'L' : 'R', _v);
          w.fx.puff(h, _v2.set((Math.random() - 0.5), 0.8, (Math.random() - 0.5)), 0.12 + this.chargeT * 0.1, 0.3, this.chargeT >= 0.7 ? 0xffc35a : 0xc8b89a, 0.7, 1.5);
        }
      }
      // guard (stone shield)
      if (inp.guard && !this.guarding && this.guardCd <= 0 && this.en > 5 && !this.charging && (this.free('guard') || this.action === 'raise' || this.action === 'throw')) {
        if (this.action && !ACTIONS[this.action].soft) this.action = null;
        if (this.holding) { this.holding = false; w.combat.dropRock(this); }
        this.guarding = true; this.guardT = 0; w.combat.raiseShield(this);
      }
      // bending (rock)
      if (inp.bend && !this.holding && !this.guarding && !this.charging && this.free('bend') && this.en >= 16 && this.dodgeT <= 0) {
        if (w.combat.summonRock(this)) { this.holding = true; this.startAction('raise'); }
      }
      if (this.holding && !inp.bend && this.action !== 'raise' && this.action !== 'throw') { this.holding = false; this.startAction('throw'); }
    }
    if (this.guarding && (!inp.guard || this.dead || this.en <= 0 || this.stunT > 0 || this.reacting())) {
      this.guarding = false; this.guardCd = 0.25; w.combat.dropShield(this);
    }
    if (this.holding && (this.dead || this.stunT > 0 || this.reacting())) { this.holding = false; w.combat.dropRock(this); }

    // ---- energy / stamina
    let mx = live ? inp.mx : 0, mz = live ? inp.mz : 0;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; }
    this.sprinting = live && inp.sprint && mlen > 0.85 && this.onGround && !this.guarding && !this.holding && !this.charging && !this.action && this.en > 2;
    if (this.guarding) this.en -= 9 * dt;
    else if (this.sprinting) this.en -= 7 * dt;
    else if (!this.holding && !this.charging) this.en += (this.onGround ? 16 : 8) * dt;
    this.en = clamp(this.en, 0, this.maxEn);

    // ---- movement
    let maxSpeed = this.sprinting ? SPEED.sprint : SPEED.run;
    if (this.guarding) maxSpeed = 2.2;
    else if (this.charging) maxSpeed = 1.6;
    else if (this.holding) maxSpeed = 4.4;
    if (this.action && !ACTIONS[this.action].soft) {
      const A = ACTIONS[this.action];
      maxSpeed = A.react ? 0 : (A.upper ? 3.6 : (this.actionU > (A.cancel ?? 1) ? 3 : 0.5));
    }
    if (this.stunT > 0) maxSpeed = 0;

    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const k = smooth01(this.dodgeT / this.dodgeDur);
      const sp = this.dodgeKind === 'roll' ? 3 + 12 * k : this.dodgeKind === 'side' ? 2 + 13 * k : 2 + 10 * k;
      this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
      if (this.dodgeKind === 'back' && this.dodgeT > this.dodgeDur * 0.5 && this.onGround) { this.vel.y = 2.6; this.onGround = false; }
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.vel.x = this.lungeDir.x; this.vel.z = this.lungeDir.z;
    } else {
      const tx = mx * maxSpeed, tz = mz * maxSpeed;
      const wantMove = tx * tx + tz * tz > 0.01;
      // stronger accel from standstill, softer when already moving (keeps momentum through turns)
      const accel = this.onGround ? (wantMove ? (this.sprinting ? 22 : 34) : (this.reacting() ? 9 : 26)) : 10;
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz), step = accel * dt * (w.iceAt ? w.iceAt(this.pos) : 1);
      if (dl <= step || dl < 1e-6) { this.vel.x = tx; this.vel.z = tz; }
      else { this.vel.x += dx / dl * step; this.vel.z += dz / dl * step; }
    }
    this.vel.y -= 21 * dt;
    this.pos.addScaledVector(this.vel, dt);

    // collisions and ground (steps, ramps, platforms)
    w.arena.collide(this);
    const gy = w.arena.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gy + 0.001) {
      if (!this.onGround && this.airTime > 0.28 && (!this.action || ACTIONS[this.action].soft) && this.dodgeT <= 0) { this.startAction('land'); w.fx.dust(this.pos, 6, 1.4); w.audio.step(1); }
      this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; this.airTime = 0;
    } else if (this.pos.y > gy + 0.03) {
      // stick to the ground walking down steps and ramps
      if (this.onGround && this.vel.y <= 0 && this.pos.y - gy < 0.5) { this.pos.y = gy; this.vel.y = 0; }
      else { this.onGround = false; this.airTime += dt; }
    } else this.pos.y = gy;
    this.groundY = gy;

    // ---- facing
    let wantYaw = null;
    if (this.dead || this.reacting()) wantYaw = null;
    else if (this.lungeT > 0) wantYaw = Math.atan2(this.lungeDir.x, this.lungeDir.z);
    else if (this.sprinting && mlen > 0.15) wantYaw = Math.atan2(mx, mz);
    else if (inp.strafe || this.guarding || this.holding || this.charging || (this.action && this.action !== 'land')) wantYaw = inp.faceYaw;
    else if (mlen > 0.15 && this.dodgeT <= 0) wantYaw = Math.atan2(mx, mz);
    if (wantYaw !== null && wantYaw !== undefined && this.dodgeT <= 0) {
      const rate = this.action && this.action !== 'land' ? 18 : (inp.strafe ? 14 : (this.sprinting ? 7 : 11));
      this.faceYaw = dampAngle(this.faceYaw, wantYaw, rate, dt);
    }
    this.yaw = this.faceYaw + this.spinYaw;

    // ---- motion analysis for animation (local move dir, turn banking, acceleration lean)
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speedNorm = clamp(sp / SPEED.run, 0, 1.45);
    const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
    if (sp > 0.05) {
      const lz = (this.vel.x * s + this.vel.z * c) / sp, lx = (this.vel.x * c - this.vel.z * s) / sp;
      this.moveLocal.set(lx, lz);
    }
    const yawRate = angleDiff(this.prevFace, this.faceYaw) / dt; this.prevFace = this.faceYaw;
    const ax = (this.vel.x - this.prevVel.x) / dt, az = (this.vel.z - this.prevVel.z) / dt; this.prevVel.copy(this.vel);
    const accF = (ax * s + az * c);
    const kk = 1 - Math.exp(-8 * dt);
    this.bank += (clamp(-yawRate * this.speedNorm * 0.07, -0.32, 0.32) - this.bank) * kk;
    this.accLean += (clamp(accF * 0.012, -0.28, 0.2) - this.accLean) * kk;
    const stride = 1.5 + 1.1 * Math.min(this.speedNorm, 1.4);
    const prevPh = this.runPhase;
    this.runPhase += sp * dt * (Math.PI * 2 / stride);
    if (this.onGround && sp > 1.2 && Math.floor(prevPh / Math.PI) !== Math.floor(this.runPhase / Math.PI)) w.audio.step(Math.min(1, sp / 7));

    this.animate(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const f = this.flash, ch = this.charging ? Math.min(1, this.chargeT / 0.7) * (0.15 + 0.1 * Math.sin(this.time * 30)) : 0;
    this.material.emissive.setRGB(f * 0.9 + ch, f * 0.25 + ch * 0.6, f * 0.15);
  }

  startCombo() {
    const name = COMBO[this.comboIdx % 3];
    this.comboIdx = (this.comboIdx + 1) % 3; this.comboTimer = 0.8;
    this.startAction(name);
    this.world.combat.lunge(this, ACTIONS[name]);
    this.world.audio.whoosh(name === 'kick' ? 0.8 : 0.45);
  }

  doDodge() {
    const inp = this.input;
    let dx = inp.mx, dz = inp.mz;
    if (Math.hypot(dx, dz) < 0.2) { dx = -Math.sin(this.faceYaw); dz = -Math.cos(this.faceYaw); }
    const l = Math.hypot(dx, dz); this.dodgeDir.set(dx / l, 0, dz / l);
    // direction relative to facing picks the move: forward = roll, sideways = sidestep, back = backstep
    const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
    const lz = this.dodgeDir.x * s + this.dodgeDir.z * c;
    const strafing = inp.strafe || this.guarding;
    this.dodgeKind = !strafing ? 'roll' : lz < -0.6 ? 'back' : Math.abs(lz) < 0.6 ? 'side' : 'roll';
    this.dodgeDur = DODGE[this.dodgeKind];
    this.dodgeT = this.dodgeDur; this.dodgeCd = 0.45; this.invuln = this.dodgeDur * 0.75; this.en -= 10;
    this.action = null; this.spinYaw = 0; this.queued = false;
    if (this.holding) { this.holding = false; this.world.combat.dropRock(this); }
    this.world.fx.dust(this.pos, 5, 1.2);
    this.world.audio.whoosh(0.6);
  }

  // level: 0 flinch, 1 stagger, 2 knockdown
  takeHit(dmg, dir, knock, level) {
    level = level === true ? 1 : (level || 0);
    this.hp = Math.max(0, this.hp - dmg);
    this.flash = 1;
    this.vel.x += dir.x * knock; this.vel.z += dir.z * knock;
    if (level >= 1) this.vel.y = Math.max(this.vel.y, level === 2 ? 4.5 : 2.5);
    this.hitDir = dir.clone(); this.koDir = dir.clone();
    if (this.hp <= 0) { this.die(dir); return; }
    if (this.holding) { this.holding = false; this.world.combat.dropRock(this); }
    this.charging = false; this.atkHoldT = -1; this.lungeT = 0; this.dodgeT = 0;
    if (level === 2) { this.startAction('down'); this.stunT = 0; this.invuln = 0.9; this.onGround = false; }
    else if (level === 1) { this.startAction('stagger'); this.stunT = 0.5; }
    else { this.startAction('hit'); this.stunT = 0.2; }
  }

  die(dir) {
    this.dead = true; this.guarding = false; this.charging = false;
    this.world.combat.dropShield(this);
    this.startAction('ko'); this.koDir = dir.clone();
    this.vel.x = dir.x * 6; this.vel.z = dir.z * 6; this.vel.y = 4;
  }

  // ------------------------------------------------------------ animation
  animate(dt) {
    const p = this.pose; p.fill(0);
    const t = this.time, onG = this.onGround, spd = this.speedNorm;

    // ---- locomotion base: idle <-> walk/run/sprint, air
    this.idlePose(p, t);
    if (onG && spd > 0.04 && this.dodgeT <= 0) {
      const q = this.tmpPose; q.fill(0);
      this.runPose(q, this.runPhase, spd);
      const wRun = clamp(spd * 3, 0, 1);
      for (let i = 0; i < POSE_LEN; i++) p[i] += (q[i] - p[i]) * wRun;
    }
    if (!onG && this.dodgeT <= 0 && this.action !== 'down' && this.action !== 'slam') this.airPose(p);

    // ---- motion dynamics: bank into turns, lean with acceleration, settle on stops
    add(p, 'spine', this.accLean * 0.9, 0, this.bank * 0.6);
    add(p, 'hips', this.accLean * 0.3, 0, this.bank * 0.4);
    add(p, 'neck', -this.accLean * 0.5, 0, -this.bank * 0.5);
    if (this.accLean < -0.05 && spd > 0.15) p[PY] -= -this.accLean * 0.25;

    // ---- continuous stances
    if (this.guarding) this.guardPose(p, onG && spd < 0.2);
    if (this.holding && this.action !== 'raise') this.holdPose(p, t);
    if (this.charging) this.chargePose(p, t, spd < 0.2);

    // ---- actions (upper-body actions layer over locomotion legs while moving)
    if (this.action) {
      const A = ACTIONS[this.action], u = clamp(this.actionT / A.dur, 0, 1);
      const q = this.tmpPose; q.set(p);
      this.actionPose(q, this.action, u);
      const legsToo = !A.upper || spd < 0.15 || !onG;
      for (let i = 0; i < POSE_LEN; i++) {
        const lower = (i >= JI.hL && i < PN) || i < 3 || i >= PN;
        if (lower && !legsToo) continue;
        p[i] = q[i];
      }
    }
    if (this.dodgeT > 0) this.dodgePose(p, 1 - this.dodgeT / this.dodgeDur);

    // ---- critically-damped smoothing towards the target pose (fast for strikes, softer for locomotion)
    const act = this.action && !ACTIONS[this.action].soft;
    const rate = act || this.dodgeT > 0 ? 28 : 15;
    const k = 1 - Math.exp(-rate * dt);
    const c = this.cur;
    for (let i = 0; i < POSE_LEN; i++) c[i] += (p[i] - c[i]) * k;
    const J = this.J;
    for (let j = 0; j < JOINTS.length; j++) { const i = j * 3; J[JOINTS[j]].rotation.set(c[i], c[i + 1], c[i + 2], 'YXZ'); }
    J.hips.position.set(c[PX], HIP_H + c[PY], c[PZ]);

    // ---- whole-body rotation (roll, knockdown, get-up, KO)
    const tq = this.tumble.quaternion;
    const local = (d) => { const c0 = Math.cos(this.yaw), s0 = Math.sin(this.yaw); return _axis.set(d.x * s0 + d.z * c0, 0, -(d.x * c0 - d.z * s0)).normalize(); };
    if (this.dodgeT > 0 && this.dodgeKind === 'roll') {
      const prog = 1 - this.dodgeT / this.dodgeDur;
      tq.setFromAxisAngle(local(this.dodgeDir), smooth01(clamp(prog / 0.9, 0, 1)) * Math.PI * 2);
      this.tumble.position.y = 0.6;
    } else if (this.dead || this.action === 'down' || this.action === 'getup') {
      let prog;
      if (this.dead) prog = smooth01(clamp(this.actionT / 0.55, 0, 1));
      else if (this.action === 'down') prog = smooth01(clamp(this.actionT / 0.35, 0, 1));
      else prog = 1 - smooth01(clamp(this.actionT / 0.4, 0, 1));
      tq.setFromAxisAngle(local(this.koDir || _fwd.set(0, 0, -1)), prog * Math.PI / 2 * 0.97);
      this.tumble.position.y = 0.6 - prog * 0.42;
    } else {
      tq.slerp(_qi, 1 - Math.exp(-20 * dt));
      this.tumble.position.y += (0.6 - this.tumble.position.y) * (1 - Math.exp(-20 * dt));
    }
  }

  idlePose(p, t) {
    const b = Math.sin(t * 2.3), sway = Math.sin(t * 1.1);
    p[PY] = -0.07 + b * 0.006;
    p[PX] = sway * 0.012;
    S(p, 'hips', 0, 0.32, sway * 0.02);
    S(p, 'spine', 0.06, -0.12, -sway * 0.02);
    S(p, 'chest', 0.04 + b * 0.015, -0.14, 0);
    S(p, 'neck', -0.05, -0.04, 0);
    S(p, 'head', 0.02, -0.02, 0);
    arm(p, 1, -0.95 + b * 0.03, 0.28, -0.3, 1.9, 0.1);
    arm(p, -1, -0.7 - b * 0.03, 0.32, -0.4, 2.15, 0.1);
    const down = hipDown(p[PY]);
    legIK(p, 1, 0.24, down, 0.1);
    legIK(p, -1, -0.2, down, 0.12);
  }

  // walk (spd < 0.5) -> run (1) -> sprint (1.4): stride, knee lift, lean and arm pump all scale with speed
  runPose(p, ph, spd) {
    const f = this.moveLocal.y, s = this.moveLocal.x;
    const run = Math.min(spd, 1), sprint = clamp((spd - 1) / 0.4, 0, 1);
    const A = 0.3 + 0.5 * run + 0.22 * sprint;
    const sinL = Math.sin(ph), sinR = -sinL;
    p[PY] = -0.03 - 0.03 * run + Math.abs(Math.cos(ph)) * (0.025 + 0.04 * run);
    const lean = (0.1 * run + 0.22 * sprint) * f;
    S(p, 'hips', 0.04 * f, sinL * (0.12 + 0.1 * run) * f, -s * 0.12);
    S(p, 'spine', lean * 0.6, -sinL * 0.1 * f, s * 0.05);
    S(p, 'chest', lean * 0.5, -sinL * (0.08 + 0.06 * run) * f, 0);
    S(p, 'neck', -lean * 0.6, 0, 0);
    S(p, 'head', -lean * 0.3, 0, 0);
    for (const side of [1, -1]) {
      const sn = side > 0 ? sinL : sinR, cs = side > 0 ? Math.cos(ph) : -Math.cos(ph);
      const swingFwd = sn * A * f, swingSide = sn * A * 0.7 * s;
      const lift = Math.max(0, f >= 0 ? cs : -cs);
      const knee = 0.15 + (0.6 + 0.9 * run + 0.4 * sprint) * lift;
      legRaw(p, side, -swingFwd, swingSide * side + 0.05, knee, -0.12 + 0.3 * Math.max(0, -sn * f));
      const elbow = 0.5 + 1.0 * run + 0.25 * sprint + 0.2 * cs * run;
      arm(p, side, sn * (0.35 + 0.4 * run + 0.35 * sprint) * f - 0.2 * run, 0.1 + Math.abs(s) * 0.15, 0, elbow, 0);
    }
  }

  airPose(p) {
    const tuck = clamp(1 - Math.abs(this.vel.y) / 7, 0, 1);
    p[PY] = -0.04;
    S(p, 'spine', 0.1 + tuck * 0.15, 0, 0);
    legRaw(p, 1, -0.9 - tuck * 0.4, 0.12, 1.4 + tuck * 0.4, -0.3);
    legRaw(p, -1, 0.15, 0.1, 0.9 + tuck * 0.5, -0.2);
    arm(p, 1, -0.5, 0.9, 0, 0.9);
    arm(p, -1, -0.2, 1.0, 0, 0.7);
  }

  guardPose(p, legs) {
    S(p, 'spine', 0.12, 0, 0); S(p, 'chest', 0.05, 0, 0);
    S(p, 'neck', -0.1, 0, 0); S(p, 'head', -0.05, 0, 0);
    arm(p, 1, -1.35, 0.35, 0.3, 0.45, -1.2);
    arm(p, -1, -1.35, 0.35, 0.3, 0.45, -1.2);
    if (legs) {
      S(p, 'hips', 0.05, 0, 0); p[PY] = -0.2;
      const down = hipDown(p[PY]);
      legIK(p, 1, 0.15, down, 0.38); legIK(p, -1, -0.12, down, 0.38);
    }
  }

  holdPose(p, t) {
    const b = Math.sin(t * 6) * 0.05;
    S(p, 'chest', 0.02, 0.15, 0);
    arm(p, 1, -1.25 + b, 0.5, 0.2, 0.9, -0.9);
    arm(p, -1, -1.5 - b, 0.25, 0.2, 0.6, -1.1);
  }

  chargePose(p, t, legs) {
    const k = Math.min(1, this.chargeT / 0.7), tr = Math.sin(t * 40) * 0.015 * k;
    S(p, 'hips', 0.05, 0.6, 0); S(p, 'spine', 0.18 + tr, -0.3, 0); S(p, 'chest', 0.08, -0.35 - 0.15 * k, 0);
    S(p, 'neck', -0.15, 0.5, 0); S(p, 'head', -0.05, 0.15, 0);
    arm(p, 1, -0.6, 0.25, 0.2, 1.4 + tr, 0.4);
    arm(p, -1, 0.35 + 0.2 * k, 0.3, 0.3, 1.9, 0.4);
    if (legs) {
      p[PY] = -0.2 - 0.06 * k;
      const down = hipDown(p[PY]);
      legIK(p, 1, 0.34, down, 0.2); legIK(p, -1, -0.3, down, 0.22);
    }
  }

  dodgePose(p, u) {
    if (this.dodgeKind === 'roll') {
      p[PY] = -0.25;
      S(p, 'hips', 0, 0, 0); S(p, 'spine', 0.5, 0, 0); S(p, 'chest', 0.4, 0, 0); S(p, 'neck', 0.4, 0, 0);
      legRaw(p, 1, -1.9, 0.15, 2.3, -0.4); legRaw(p, -1, -1.7, 0.15, 2.3, -0.4);
      arm(p, 1, -1.2, 0.3, 0, 2.0); arm(p, -1, -1.2, 0.3, 0, 2.0);
    } else if (this.dodgeKind === 'side') {
      // low lateral shuffle: lean into the direction of travel, trailing leg extended
      const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
      const lx = this.dodgeDir.x * c - this.dodgeDir.z * s; // +1 = towards local left
      const dir = lx >= 0 ? 1 : -1, e = Math.sin(u * Math.PI);
      p[PY] = -0.2 * e - 0.05;
      S(p, 'hips', 0.05, 0, -0.2 * dir * e); S(p, 'spine', 0.15, 0, 0.32 * dir * e); S(p, 'neck', 0, 0, -0.3 * dir * e);
      const down = hipDown(p[PY]);
      legIK(p, dir, 0.05, down - 0.05, 0.45 * e + 0.1);
      legIK(p, -dir, -0.05, down, 0.1 + 0.2 * e);
      arm(p, 1, -1.0, 0.4 + 0.3 * e, 0, 1.6); arm(p, -1, -0.8, 0.4 + 0.3 * e, 0, 1.8);
    } else {
      // backstep hop: torso upright, guard held high, legs tucked mid-air
      const e = Math.sin(u * Math.PI);
      p[PY] = -0.08;
      S(p, 'spine', -0.15 * e, 0, 0); S(p, 'chest', -0.1 * e, 0, 0);
      legRaw(p, 1, -0.5 * e - 0.2, 0.1, 0.8 * e + 0.4, -0.2); legRaw(p, -1, 0.1, 0.1, 0.5 * e + 0.3, -0.2);
      arm(p, 1, -1.2, 0.3, -0.3, 2.0); arm(p, -1, -1.0, 0.3, -0.3, 2.1);
    }
  }

  actionPose(p, name, u) {
    switch (name) {
      case 'jab': case 'cross': {
        const side = name === 'jab' ? 1 : -1;
        const wind = seg(u, 0, 0.3), ext = seg(u, 0.22, 0.38), back = seg(u, 0.62, 1);
        const e = ext * (1 - back);
        S(p, 'hips', 0, (0.3 - 0.55 * e) * side, 0);
        S(p, 'chest', 0.06, (-0.15 * wind - 0.55 * e) * side, 0);
        S(p, 'spine', 0.12 * e, -0.2 * e * side, 0);
        arm(p, side, -0.9 - 0.7 * e, 0.28 - 0.2 * e, -0.2, 1.9 - 1.85 * e, 0);
        arm(p, -side, -0.75, 0.3, -0.4, 2.2, 0);
        if (u < 0.85) {
          p[PY] = -0.12;
          const down = hipDown(p[PY]);
          legIK(p, side, 0.38 * (0.5 + e * 0.5), down, 0.1);
          legIK(p, -side, -0.28, down, 0.12);
        }
        break;
      }
      case 'kick': {
        const lift = Math.sin(u * Math.PI);
        const ext = seg(u, 0.25, 0.45) * (1 - seg(u, 0.75, 1));
        this.spinYaw = -seg(u, 0.08, 0.83) * Math.PI * 2;
        p[PY] = 0.08 * lift;
        S(p, 'hips', 0, 0, -0.35 * ext);
        S(p, 'spine', 0, 0, 0.25 * ext); S(p, 'chest', 0.05, 0, 0.15 * ext);
        legRaw(p, -1, -0.4 * ext, 1.45 * ext, 1.5 * (1 - ext) + 0.1, 0.4);
        legIK(p, 1, 0.05, HIP_H - 0.08 + p[PY] - 0.04, 0.05);
        arm(p, 1, -0.4, 1.2, 0, 0.8); arm(p, -1, -0.2, 1.4, 0, 0.5);
        break;
      }
      case 'heavy': {
        // chambered double palm strike: sink and coil, step through, drive both palms
        const coil = seg(u, 0, 0.38), push = seg(u, 0.36, 0.5), back = seg(u, 0.72, 1);
        const e = push * (1 - back), cl = coil * (1 - push);
        p[PY] = -0.18 - 0.06 * cl + 0.04 * e;
        S(p, 'hips', 0.05, 0.5 * cl - 0.3 * e, 0);
        S(p, 'spine', 0.25 * cl + 0.2 * e, -0.3 * cl + 0.2 * e, 0); S(p, 'chest', 0.05, -0.3 * cl + 0.15 * e, 0);
        S(p, 'neck', -0.2 * e, 0.3 * cl, 0);
        arm(p, 1, -0.3 * cl - 1.45 * e, 0.3, 0.2, 1.7 * (1 - e) + 0.15, -1.3 * e);
        arm(p, -1, 0.3 * cl - 1.35 * e, 0.35, 0.2, 1.9 * (1 - e) + 0.15, -1.3 * e);
        const down = hipDown(p[PY]);
        legIK(p, 1, 0.2 + 0.32 * e, down, 0.22); legIK(p, -1, -0.25 - 0.15 * e, down, 0.2);
        break;
      }
      case 'slam': {
        // charged axe kick: leap, right leg swings overhead, slams down at 55%
        const up = seg(u, 0.08, 0.4), drop = seg(u, 0.42, 0.56), rec = seg(u, 0.7, 1);
        const high = up * (1 - drop);
        S(p, 'spine', -0.2 * high + 0.45 * drop * (1 - rec), 0, 0); S(p, 'chest', -0.1 * high + 0.2 * drop * (1 - rec), 0, 0);
        S(p, 'neck', 0.2 * high, 0, 0);
        legRaw(p, -1, -2.3 * high - 0.6 * drop * (1 - rec), 0.1, 0.1 + 0.6 * drop * (1 - rec), 0.3);
        legRaw(p, 1, 0.3 * high, 0.1, 0.6 + 0.6 * high, -0.2);
        arm(p, 1, -2.4 * high - 0.3, 0.6 - 0.3 * high, 0, 0.6, 0);
        arm(p, -1, -2.4 * high - 0.3, 0.6 - 0.3 * high, 0, 0.6, 0);
        if (drop > 0.5) { p[PY] = -0.25 * (1 - rec); arm(p, 1, -0.9, 0.9, 0, 0.3, 0); arm(p, -1, -0.9, 0.9, 0, 0.3, 0); }
        break;
      }
      case 'counter': {
        // spinning backfist
        this.spinYaw = seg(u, 0.0, 0.55) * Math.PI * 2;
        const e = seg(u, 0.2, 0.4) * (1 - seg(u, 0.65, 1));
        p[PY] = -0.12;
        S(p, 'spine', 0.1, 0, 0.1 * e); S(p, 'chest', 0, 0.4 * e, 0);
        arm(p, -1, -1.45 * e - 0.4, 1.0 * e + 0.3, 0.6, 0.25 + 1.4 * (1 - e));
        arm(p, 1, -0.9, 0.4, -0.3, 2.1);
        const down = hipDown(p[PY]);
        legIK(p, 1, 0.25, down, 0.18); legIK(p, -1, -0.25, down, 0.18);
        break;
      }
      case 'raise': {
        const rise = smooth01(u);
        p[PY] = -0.24 + 0.12 * rise;
        S(p, 'hips', 0, 0, 0); S(p, 'spine', 0.35 - 0.3 * rise, 0, 0); S(p, 'chest', 0.1, 0, 0);
        S(p, 'neck', -0.2, 0, 0);
        arm(p, 1, -0.35 - 1.05 * rise, 0.3, 0.6, 0.5, 0.6 - 1.2 * rise);
        arm(p, -1, -0.35 - 1.05 * rise, 0.3, 0.6, 0.5, 0.6 - 1.2 * rise);
        const down = hipDown(p[PY]);
        legIK(p, 1, 0.2, down, 0.32); legIK(p, -1, -0.15, down, 0.32);
        break;
      }
      case 'throw': {
        const wind = seg(u, 0, 0.3), push = seg(u, 0.25, 0.45), back = seg(u, 0.7, 1);
        const e = push * (1 - back);
        S(p, 'hips', 0, -0.2 + 0.5 * wind - 0.8 * e, 0);
        S(p, 'chest', 0.1, 0.4 * wind - 0.9 * e, 0);
        S(p, 'spine', 0.15 * e, 0, 0);
        arm(p, -1, -1.0 - 0.6 * e, 0.4 - 0.3 * e, 0.2, 1.6 - 1.55 * e, -1.2 * e);
        arm(p, 1, -0.6 + 0.4 * e, 0.6, 0, 1.4, 0);
        if (this.speedNorm < 0.15) {
          p[PY] = -0.14;
          const down = hipDown(p[PY]);
          legIK(p, 1, 0.42, down, 0.15); legIK(p, -1, -0.32 + 0.1 * e, down, 0.15);
        }
        break;
      }
      case 'hit': {
        const k = Math.sin(u * Math.PI);
        S(p, 'spine', -0.35 * k, 0, 0.1 * k); S(p, 'chest', -0.25 * k, 0, 0);
        S(p, 'neck', -0.3 * k, 0, 0); S(p, 'head', -0.2 * k, 0.2 * k, 0);
        arm(p, 1, -0.3, 0.7 * k + 0.2, 0, 0.8); arm(p, -1, -0.2, 0.8 * k + 0.2, 0, 0.6);
        p[PY] = -0.1 * k;
        break;
      }
      case 'stagger': {
        // stumble backwards: torso thrown back, arms out for balance, two recovery steps
        const k = Math.sin(Math.min(1, u * 1.3) * Math.PI) , st = Math.sin(u * Math.PI * 3);
        p[PY] = -0.1 - 0.08 * k;
        S(p, 'spine', -0.45 * k, 0.2 * st, 0.12 * st); S(p, 'chest', -0.2 * k, 0, 0); S(p, 'neck', -0.35 * k, 0, 0);
        arm(p, 1, -0.6 * k, 1.2 * k + 0.2, 0, 0.6); arm(p, -1, -0.3 * k, 1.3 * k + 0.2, 0, 0.5);
        legRaw(p, 1, -0.3 + 0.5 * st, 0.15, 0.4 + 0.4 * Math.max(0, st), -0.1);
        legRaw(p, -1, -0.3 - 0.5 * st, 0.15, 0.4 + 0.4 * Math.max(0, -st), -0.1);
        break;
      }
      case 'down': case 'ko': {
        S(p, 'spine', -0.2, 0, 0); S(p, 'neck', -0.2, 0, 0);
        arm(p, 1, -0.2, 1.3, 0, 0.4); arm(p, -1, -0.4, 1.1, 0, 0.6);
        legRaw(p, 1, -0.3, 0.2, 0.4, 0); legRaw(p, -1, 0.1, 0.15, 0.2, 0);
        p[PY] = 0;
        break;
      }
      case 'getup': {
        // kip up: tuck legs, push off, rise into stance
        const k = 1 - seg(u, 0.4, 1);
        p[PY] = -0.3 * k;
        S(p, 'spine', 0.5 * k, 0, 0); S(p, 'neck', 0.2 * k, 0, 0);
        legRaw(p, 1, -1.4 * k, 0.15, 2.0 * k, -0.3 * k); legRaw(p, -1, -1.2 * k, 0.15, 1.9 * k, -0.3 * k);
        arm(p, 1, -0.6, 0.6, 0, 1.4); arm(p, -1, -0.6, 0.6, 0, 1.4);
        break;
      }
      case 'land': {
        const k = Math.sin(u * Math.PI);
        p[PY] = -0.07 - 0.15 * k;
        const down = hipDown(p[PY]);
        S(p, 'spine', 0.1 + 0.2 * k, 0, 0);
        legIK(p, 1, 0.22, down, 0.14); legIK(p, -1, -0.18, down, 0.14);
        break;
      }
    }
  }
}
const _axis = new THREE.Vector3(), _qi = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
