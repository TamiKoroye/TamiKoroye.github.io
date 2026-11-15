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
  }
  setDifficulty(d) { this.d = d; this.P = PROFILES[d] || PROFILES.normal; }

  update(dt) {
    const f = this.f, foe = this.foe, P = this.P, inp = f.input, w = this.world;
    inp.hand = inp.leg = inp.special = inp.jump = inp.dodge = false;
    if (f.dead || foe.dead || !w.fighting) { inp.mx = inp.mz = 0; inp.handHeld = inp.legHeld = inp.guard = false; return; }

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
    if (this.reaction) {
      this.reactT -= dt;
      if (this.reactT <= 0) {
        if (this.reaction === 'dodge') {
          const s = Math.random() < 0.5 ? -1 : 1;
          inp.mx = -tz * s; inp.mz = tx * s; inp.dodge = true;
        } else { this.guardT = rand(0.6, 1.0); }
        this.reaction = null;
      }
    }
    this.guardT -= dt;
    inp.guard = this.guardT > 0;

    // ---- offense: element techniques chosen by range (Stage C will give each archetype its own brain)
    this.throwT -= dt; this.meleeT -= dt; this.holdT -= dt; this.specialT = (this.specialT ?? rand(4, 7)) - dt;
    inp.handHeld = this.holdT > 0 && this.holdKind === 'hand';
    inp.legHeld = this.holdT > 0 && this.holdKind === 'leg';
    if (inp.guard || f.action || f.dodgeT > 0) return;
    const held = w.bending.held(f);
    if (dist < 2.6 && this.meleeT <= 0) {
      // close range: hand / leg combinations
      if (Math.random() < P.melee) { if (Math.random() < 0.55) { inp.hand = true; } else { inp.leg = true; } }
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
    // close in for melee sometimes (normal / master)
    if (this.d !== 'training' && dist < 4.5 && !lowHp && Math.random() < dt * P.melee) { inp.mx = tx; inp.mz = tz; }
  }
}
