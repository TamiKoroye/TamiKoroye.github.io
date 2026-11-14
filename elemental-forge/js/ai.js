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
    inp.attack = inp.jump = inp.dodge = false;
    if (f.dead || foe.dead || !w.fighting) { inp.mx = inp.mz = 0; inp.bend = inp.guard = false; return; }

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

    // ---- reactions to incoming rocks
    for (const r of w.combat.rocks) {
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

    // ---- offense
    this.throwT -= dt; this.meleeT -= dt;
    if (this.holdT > 0) { this.holdT -= dt; inp.bend = this.holdT > 0; }
    else inp.bend = false;
    if (!inp.guard && this.throwT <= 0 && dist > 3.5 && dist < 26 && f.en > 25 && !f.action) {
      inp.bend = true; this.holdT = this.d === 'master' ? rand(0.35, 0.5) : rand(0.4, 0.8);
      this.throwT = rand(P.throwGap[0], P.throwGap[1]);
    }
    if (dist < 2.4 && this.meleeT <= 0 && !inp.guard && !f.holding) {
      if (Math.random() < P.melee) inp.attack = true;
      this.meleeT = this.d === 'master' ? 0.28 : 0.5;
    }
    // close in for melee sometimes (normal / master)
    if (this.d !== 'training' && dist < 4.5 && !lowHp && Math.random() < dt * P.melee) { inp.mx = tx; inp.mz = tz; }
  }
}
