// Opponent brain. Drives a Fighter through the same input struct the player uses.
// Milestone 1 version: spacing, strafing, obstacle avoidance, rock throws, melee, simple reactions.
import * as THREE from 'three';
import { rand, clamp } from './util.js';

const PROFILES = {
  training: { range: 9, throwGap: [6, 9], react: 0.12, reactDelay: 0.45, guardBias: 0.2, melee: 0.15, lead: 0, spread: 1.6, speed: 0.55 },
  normal:   { range: 7.5, throwGap: [2.6, 4.4], react: 0.5, reactDelay: 0.24, guardBias: 0.45, melee: 0.55, lead: 0.5, spread: 0.7, speed: 0.9 },
  master:   { range: 6.5, throwGap: [1.4, 2.4], react: 0.85, reactDelay: 0.12, guardBias: 0.55, melee: 0.9, lead: 0.9, spread: 0.25, speed: 1 },
};

export class AI {
  constructor(world, self, foe, difficulty = 'normal') {
    this.world = world; this.f = self; this.foe = foe;
    this.setDifficulty(difficulty);
    this.strafeDir = 1; this.strafeT = 0;
    this.throwT = 2.5; this.thinkT = 0; this.reactT = -1; this.reaction = null;
    this.guardT = 0; this.holdT = 0; this.meleeT = 0;
    this.seen = new WeakSet();
    this.seenTech = -1; this.combo = []; this.comboT = 0; this.punishT = 0; this.jetT = 0;
  }
  setDifficulty(d) { this.d = d; this.P = PROFILES[d] || PROFILES.normal; }

  update(dt) {
    const f = this.f, foe = this.foe, P = this.P, inp = f.input, w = this.world;
    inp.hand = inp.leg = inp.special = inp.jump = inp.dodge = false;
    if (f.dead || foe.dead || !w.fighting) { inp.mx = inp.mz = 0; inp.handHeld = inp.legHeld = inp.guard = inp.jumpHeld = false; return; }
    this.jetT -= dt; inp.jumpHeld = this.jetT > 0;

    const dx = foe.pos.x - f.pos.x, dz = foe.pos.z - f.pos.z, dist = Math.hypot(dx, dz) || 1;
    const tx = dx / dist, tz = dz / dist;
    inp.faceYaw = Math.atan2(dx, dz); inp.strafe = true;

    // aim with lead + error
    const lead = P.lead * dist / 30;
    inp.aimPoint.set(foe.pos.x + foe.vel.x * lead + rand(-1, 1) * P.spread, foe.pos.y + 1.15 + rand(-0.3, 0.3) * P.spread, foe.pos.z + foe.vel.z * lead + rand(-1, 1) * P.spread);

    // ---- desired movement: keep preferred range, circle-strafe
    const lowHp = f.hp < f.maxHp * 0.3;
    const range = P.range + (lowHp ? 3 : 0);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(1.5, 3.5); }
    let radial = clamp((dist - range) / 3, -1, 1);
    let mx = tx * radial + -tz * this.strafeDir * 0.75;
    let mz = tz * radial + tx * this.strafeDir * 0.75;
    // obstacle avoidance: whiskers
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    for (const c of w.arena.colliders) {
      if (c.walk && c.top < 0.5) continue;
      const cx = c.x - f.pos.x, cz = c.z - f.pos.z;
      const rad = (c.kind === 'c' ? c.r : Math.max(c.hx, c.hz)) + 1.0;
      const ahead = cx * mx + cz * mz;
      if (ahead < 0 || ahead > 3.5 + rad) continue;
      const lat = cx * -mz + cz * mx; // signed lateral offset
      if (Math.abs(lat) < rad) {
        // steer sideways, away from the side the obstacle is on
        const push = (1 - Math.abs(lat) / rad) * 1.4 * (lat > 0 ? -1 : 1);
        const px = -mz, pz = mx; // left-perpendicular of travel direction
        mx += px * push; mz += pz * push;
      }
    }
    // keep away from walls
    const lim = 26;
    if (f.pos.x > lim) mx -= 1; if (f.pos.x < -lim) mx += 1;
    if (f.pos.z > lim) mz -= 1; if (f.pos.z < -lim) mz += 1;
    const l2 = Math.hypot(mx, mz) || 1;
    const spd = P.speed * (this.d === 'training' ? 0.6 : 1);
    inp.mx = mx / l2 * spd; inp.mz = mz / l2 * spd;

    // ---- reactions to incoming projectiles (any element)
    for (const r of w.bending.objs) {
      if (r.owner === f || r.state !== 'flying' || this.seen.has(r)) continue;
      const rx = f.pos.x - r.pos.x, rz = f.pos.z - r.pos.z, rd = Math.hypot(rx, rz);
      const closing = (r.vel.x * rx + r.vel.z * rz) / (rd * Math.hypot(r.vel.x, r.vel.z) || 1);
      if (rd < 16 && closing > 0.93) {
        this.seen.add(r);
        if (Math.random() < P.react) { this.reaction = Math.random() < P.guardBias ? 'guard' : 'dodge'; this.reactT = P.reactDelay * rand(0.8, 1.3); }
      }
    }
    // ---- reading the opponent's strikes: a wind-up that will reach us is answered with a guard, an evasion or
    // (master) a guard followed by a counter. Each strike is judged once, after a human-like delay.
    // (the Training partner does not read strikes: it is there to be hit)
    if (this.d !== 'training' && foe.action === 'tech' && foe.techN !== this.seenTech && foe.tech && foe.tech.active) {
      const A = foe.tech.active, u = foe.actionT / foe.tech.dur;
      if (u < A.from && dist < (A.range || 2.2) + 1.6) {
        this.seenTech = foe.techN;
        if (Math.random() < P.react) {
          const r = Math.random();
          this.reaction = r < P.guardBias ? 'guard' : 'dodge';
          this.reactT = Math.min(P.reactDelay, Math.max(0.03, (A.from - u) * foe.tech.dur - 0.06));
          if (this.reaction === 'guard' && this.d === 'master') this.counterAfter = true;
        }
      }
    }
    if (this.reaction) {
      this.reactT -= dt;
      if (this.reactT <= 0) {
        if (this.reaction === 'dodge') {
          const s = Math.random() < 0.5 ? -1 : 1;
          inp.mx = -tz * s; inp.mz = tx * s; inp.dodge = true;
          if (this.d !== 'training') this.punishT = 0.55;     // answer the evasion with a strike
        } else { this.guardT = dist < 4 ? rand(0.35, 0.6) : rand(0.6, 1.0); }
        this.reaction = null;
      }
    }
    this.guardT -= dt;
    inp.guard = this.guardT > 0;

    // ---- offense: element techniques chosen by range (Stage C will give each archetype its own brain)
    this.throwT -= dt; this.meleeT -= dt; this.holdT -= dt; this.specialT = (this.specialT ?? rand(4, 7)) - dt;
    inp.handHeld = this.holdT > 0 && this.holdKind === 'hand';
    inp.legHeld = this.holdT > 0 && this.holdKind === 'leg';
    // counter: a successful guard or evasion opens f.counterT; strike straight into it
    if (f.counterT > 0 && dist < 3.2 && (this.counterAfter || this.punishT > 0 || this.d !== 'training')) { this.guardT = 0; inp.guard = false; inp.hand = true; this.counterAfter = false; this.punishT = 0; return; }
    this.punishT -= dt;
    if (this.punishT > 0 && this.punishT < 0.3 && dist < 3) { inp.hand = true; this.punishT = 0; return; }
    if (inp.guard || f.dodgeT > 0) return;
    // combination in progress: each strike is pressed as the previous one's recovery opens
    if (this.combo.length) {
      this.comboT -= dt;
      if (this.comboT <= 0 && (!f.action || f.free('attack'))) { inp[this.combo.shift()] = true; this.comboT = this.d === 'master' ? 0.18 : 0.3; }
      if (dist > 3.4) this.combo.length = 0;
      return;
    }
    if (f.action) return;
    const held = w.bending.held(f);
    if (dist < 2.6 && this.meleeT <= 0) {
      // close range: hand / leg combinations
      if (Math.random() < P.melee) {
        // combinations: hand-hand-leg, hand-leg-leg, leg-leg; training throws single strikes
        const C = [['hand', 'hand', 'leg'], ['hand', 'leg', 'leg'], ['leg', 'leg'], ['hand', 'hand']];
        const c = this.d === 'training' ? [Math.random() < 0.55 ? 'hand' : 'leg'] : C[Math.floor(Math.random() * C.length)].slice(0, this.d === 'master' ? 3 : 2);
        inp[c.shift()] = true; this.combo = c; this.comboT = 0.3;
      }
      this.meleeT = this.d === 'master' ? 0.3 : 0.55;
    } else if (this.throwT <= 0 && dist > 3 && dist < 24 && f.en > 22) {
      this.throwT = rand(P.throwGap[0], P.throwGap[1]);
      const roll = Math.random();
      if (held > 0 || roll < 0.45) inp.hand = true;                         // launch held object / hand technique
      else if (roll < 0.7) inp.leg = true;                                   // kick projectile
      else if (this.d !== 'training') { inp.hand = true; this.holdKind = 'hand'; this.holdT = rand(0.9, 1.6); }  // sustained bending
      else inp.hand = true;
    } else if (this.specialT <= 0 && dist < 16 && f.en > 30) {
      inp.special = true; this.specialT = this.d === 'master' ? rand(3, 5) : rand(6, 10);
    } else if (this.d === 'master' && dist < 4 && Math.random() < dt * 0.6 && f.en > 30) {
      inp.leg = true; this.holdKind = 'leg'; this.holdT = 0.9;               // charged technique
    }
    // closing in: a running kick on arrival; firebenders sometimes take to the air on their flame jets
    if (this.d !== 'training' && dist > 2.6 && dist < 4.2 && f.speedNorm > 0.45 && f.en > 20 && Math.random() < dt * 1.5) inp.leg = true;
    if (f.el === 'fire' && this.d !== 'training' && f.onGround && f.en > 45 && dist < 9 && Math.random() < dt * 0.25) { inp.jump = true; this.jetT = rand(0.5, 0.9); }
    // close in for melee sometimes (normal / master)
    if (this.d !== 'training' && dist < 4.5 && !lowHp && Math.random() < dt * P.melee) { inp.mx = tx; inp.mz = tz; }
  }
}
