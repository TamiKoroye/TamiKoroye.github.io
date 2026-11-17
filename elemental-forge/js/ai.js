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
    inp.hand = inp.leg = inp.special = inp.jump = inp.dodge = inp.roll = false;
    if (f.dead || foe.dead || !w.fighting) { inp.mx = inp.mz = 0; inp.handHeld = inp.legHeld = inp.guard = inp.jumpHeld = false; return; }
    this.jetT -= dt; inp.jumpHeld = this.jetT > 0;
    this.mobT = (this.mobT || 0) - dt; inp.dodgeHeld = this.mobT > 0;
    if (this.mobT > 0 && f.el === 'air' && f.mob && f.mob.kind === 'fly') inp.jumpHeld = this.mobT > 0.8;   // climb, then drift down

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
    // hurt and under ranged attack: take cover behind the nearest tall obstacle (ruin walls, piers, raised pillars)
    if (this.d !== 'training' && lowHp && dist > 6) {
      let best = null, bd = 12;
      for (const c of w.arena.colliders) { if (c.dead || c.top < 1.5) continue; const d = Math.hypot(c.x - f.pos.x, c.z - f.pos.z); if (d < bd) { bd = d; best = c; } }
      if (best) {
        const ox = best.x - foe.pos.x, oz = best.z - foe.pos.z, l = Math.hypot(ox, oz) || 1, sz = (best.r || Math.max(best.hx, best.hz)) + 1.0;
        const cx = best.x + ox / l * sz, cz = best.z + oz / l * sz, dx2 = cx - f.pos.x, dz2 = cz - f.pos.z, d2 = Math.hypot(dx2, dz2);
        if (d2 > 0.6) { mx = dx2 / d2; mz = dz2 / d2; } else { mx *= 0.2; mz *= 0.2; }
        this.inCover = d2 < 1.2;
      }
    } else this.inCover = false;
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
    // ---- area attacks and mobility (16 Nov brief): each threat is read once, after the same human-like delay
    const Wp = w.bending.weapons;
    if (Wp && this.d !== 'training') {
      const away = (x, z) => { const ax = f.pos.x - x, az = f.pos.z - z, l = Math.hypot(ax, az) || 1; inp.mx = ax / l; inp.mz = az / l; };
      // marked ground (earth eruption, water / air column) under us: get off it
      for (const E of [...Wp.erupts.filter(e => !e.fired && e.f === foe), ...Wp.columns.filter(c => !c.started && c.f === foe)]) {
        if (Math.hypot(f.pos.x - E.x, f.pos.z - E.z) > 2.4) continue;
        away(E.x, E.z);
        if (!this.seen.has(E)) { this.seen.add(E); if (Math.random() < P.react) { this.reaction = 'dodge'; this.reactT = P.reactDelay * rand(0.6, 1); this.dodgeFrom = E; } }
      }
      // an expanding fire ring closing in: jump it
      for (const R of Wp.fireRings) {
        if (R.f !== foe || R.hit.has(f)) continue;
        const gap = Math.hypot(f.pos.x - R.x, f.pos.z - R.z) - R.r;
        if (gap > 0.3 && gap < 1.9 && f.onGround && !this.seen.has(R)) { this.seen.add(R); if (Math.random() < P.react) inp.jump = true; }
      }
      // Fire's stomp wave rolling out toward us: jump it as the front arrives
      for (const R of w.bending.rings) {
        if (!R.quiet || R.owner !== foe || R.done.has(f)) continue;
        const gap = Math.hypot(f.pos.x - R.center.x, f.pos.z - R.center.z) - R.r;
        if (gap > 0.2 && gap < 2.2 && f.onGround && !this.seen.has(R)) { this.seen.add(R); if (Math.random() < P.react) inp.jump = true; }
      }
      // a wave advancing on us: guard against it
      for (const V of Wp.waves) {
        if (V.f !== foe || this.seen.has(V)) continue;
        const along = (f.pos.x - V.pos.x) * V.dir.x + (f.pos.z - V.pos.z) * V.dir.z;
        if (along > 0 && along < 5) { this.seen.add(V); if (Math.random() < P.react) { this.reaction = 'guard'; this.reactT = P.reactDelay * rand(0.5, 0.9); } }
      }
      // whips reach far: read a whip strike at whip range, not only at punching range
      const whip = foe.action === 'tech' && foe.tech && (foe.el === 'water' || foe.el === 'air') && (foe.tech === foe.style.tech.hand || foe.tech.variantOf === foe.style.tech.hand);
      if (whip && foe.techN !== this.seenTech) {
        if (dist < 9 && foe.actionT < foe.tech.dur * 0.45) { this.seenTech = foe.techN; if (Math.random() < P.react) { this.reaction = Math.random() < P.guardBias + 0.2 ? 'guard' : 'dodge'; this.reactT = Math.min(P.reactDelay, 0.15); } }
      }
      // a surfer charging at us: step off the line
      if (foe.mob && foe.mob.kind === 'surf' && foe.mob.speed > 7 && dist < 6 && !this.reaction) {
        const toMe = ((f.pos.x - foe.pos.x) * Math.sin(foe.mob.heading) + (f.pos.z - foe.pos.z) * Math.cos(foe.mob.heading)) / dist;
        if (toMe > 0.8 && Math.random() < P.react * dt * 6) { this.reaction = 'dodge'; this.reactT = 0.05; }
      }
      // a heavy technique that missed leaves its user open: punish it
      if (foe.action === 'tech' && foe.tech && (foe.tech === foe.style.tech.stomp || foe.tech === foe.style.tech.charged) && foe.actionT / foe.tech.dur > 0.7 && dist < 6 && this.punishT <= 0 && f.hp > 0) { this.punishT = 0.5; inp.mx = tx; inp.mz = tz; }
    }
    if (this.reaction) {
      this.reactT -= dt;
      // a decision to evade is kept until the fighter can act (a stagger would otherwise use it up)
      if (this.reactT <= 0 && !(this.reaction === 'dodge' && !f.free('dodge') && (f.stunT > 0 || f.reacting()))) {
        if (this.reaction === 'dodge') {
          const s = Math.random() < 0.5 ? -1 : 1;
          inp.mx = -tz * s; inp.mz = tx * s; inp.dodge = true;
          // out of marked ground: dodge directly away from its centre
          if (this.dodgeFrom) { const ax = f.pos.x - this.dodgeFrom.x, az = f.pos.z - this.dodgeFrom.z, l = Math.hypot(ax, az) || 1; inp.mx = ax / l; inp.mz = az / l; this.dodgeFrom = null; }
          // Earth's DODGE is the rock slide: an Earth fighter evades with the roll (GUARD + DODGE) instead
          if (f.el === 'earth') { inp.dodge = false; inp.roll = true; }
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
      inp.mx = tx; inp.mz = tz;                            // follow the opponent the strikes have knocked back
      if (dist > 4.5) this.combo.length = 0;
      return;
    }
    if (f.action) return;
    const held = w.bending.held(f);
    if (this.d !== 'training') {
      // an opponent high in the air is out of reach for strikes: keep ranged attacks coming at their height
      if (foe.pos.y - f.pos.y > 2.2 && this.throwT > 0.7) this.throwT = 0.7;
      // heavy area techniques at mid range against a grounded opponent (stomp, tidal wave, air compression)
      this.heavyT = (this.heavyT ?? rand(5, 8)) - dt;
      if (this.heavyT <= 0 && dist > 3.5 && dist < 11 && foe.onGround && f.en > 35 && f.onGround) {
        inp.leg = true; this.holdKind = 'leg'; this.holdT = 1.0; this.heavyT = this.d === 'master' ? rand(4, 6) : rand(7, 11); return;
      }
      // now and then reposition with the element's own mobility (surf / flight / flame run), launching off the
      // surf when the opponent is close
      if (this.mobT <= 0 && dist > 6 && f.en > 50 && Math.random() < dt * (this.d === 'master' ? 0.12 : 0.06)) this.mobT = rand(1.2, 2.4);
      // Air takes off with JUMP; Earth starts its rock slide with a DODGE tap (and taps again to step off)
      if (this.mobT > 0 && !f.mob && f.onGround && f.el === 'air') inp.jump = true;
      if (this.mobT > 0 && !f.mob && f.onGround && f.el === 'earth' && !this.slid) { inp.dodge = true; this.slid = true; }
      if (this.mobT <= 0) { if (this.slid && f.mob && f.el === 'earth') inp.dodge = true; this.slid = false; }
      if (this.mobT > 0 && f.mob && f.mob.kind === 'surf' && dist < 5 && Math.random() < dt * 2) inp.jump = true;
    }
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
