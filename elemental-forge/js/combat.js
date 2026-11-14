// Combat: earth rocks (raise / suspend / throw), stone shields, melee resolution, damage.
import * as THREE from 'three';
import { jaggedRockGeometry, HALF } from './arena.js';
import { clamp, mulberry32, smooth01 } from './util.js';

const ROCK_SPEED = 30;
const ROCK_GRAV = 6;
const ROCK_R = 0.36;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// closest distance between point p and segment a-b
function distPointSeg(p, a, b) {
  _v.subVectors(b, a); const l2 = _v.lengthSq();
  let t = l2 > 0 ? _v2.subVectors(p, a).dot(_v) / l2 : 0; t = clamp(t, 0, 1);
  _v3.copy(a).addScaledVector(_v, t);
  return p.distanceTo(_v3);
}

export class Combat {
  constructor(world) {
    this.world = world;
    this.rocks = [];
    this.shields = [];
    const rng = mulberry32(99);
    this.rockGeos = [0, 1, 2, 3, 4].map(() => jaggedRockGeometry(rng, 1, 0.3, 0.9));
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x6b625c, roughness: 0.95, flatShading: true });
    this.shieldGeo = (() => {
      const g = new THREE.BoxGeometry(1.9, 2.0, 0.45, 5, 5, 2);
      const p = g.attributes.position, seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
        let d = seen.get(key); if (!d) { d = [(rng() - 0.5) * 0.14, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.18]; seen.set(key, d); }
        const topTaper = y > 0.9 ? 0.85 : 1;
        p.setXYZ(i, x * topTaper + d[0], y + d[1] + (y > 0.9 ? (rng() - 0.5) * 0.25 : 0), z + d[2]);
      }
      g.translate(0, 1.0, 0); g.computeVertexNormals(); return g;
    })();
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.95, flatShading: true });
  }

  // ---------------------------------------------------------------- rocks
  summonRock(f) {
    if (this.rocks.some(r => r.owner === f && (r.state === 'rising' || r.state === 'held'))) return false;
    f.en -= 16;
    const fwd = f.forward(_v2);
    const gy = this.world.arena.groundAt(f.pos.x + fwd.x * 1.2, f.pos.z + fwd.z * 1.2, f.pos.y + 0.2);
    const mesh = new THREE.Mesh(this.rockGeos[Math.floor(Math.random() * this.rockGeos.length)], this.rockMat);
    mesh.scale.setScalar(ROCK_R * 1.15);
    mesh.castShadow = true;
    const start = new THREE.Vector3(f.pos.x + fwd.x * 1.2, gy - 0.4, f.pos.z + fwd.z * 1.2);
    mesh.position.copy(start);
    this.world.scene.add(mesh);
    const r = { mesh, owner: f, state: 'rising', t: 0, start, pos: start.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 4, dmg: 13 };
    this.rocks.push(r);
    f.heldRock = r;
    const fx = this.world.fx;
    fx.debrisBurst(new THREE.Vector3(start.x, gy + 0.05, start.z), 10, 2.2, 0.09, 0x7a7068, 0.8);
    fx.dust(new THREE.Vector3(start.x, gy, start.z), 5, 1.5);
    fx.crater(new THREE.Vector3(start.x, gy, start.z), 1.3);
    this.world.audio.rumble(0.5);
    return true;
  }

  heldAnchor(f, out) {
    const fwd = f.forward(_v2);
    const right = _v3.set(-fwd.z, 0, fwd.x); // character's right? (-x when facing +z)
    return out.set(f.pos.x + fwd.x * 1.05 - right.x * 0.25, f.pos.y + 1.35 + Math.sin(f.time * 4) * 0.05, f.pos.z + fwd.z * 1.05 - right.z * 0.25);
  }

  release(f) {
    const r = f.heldRock;
    if (!r || (r.state !== 'held' && r.state !== 'rising')) return;
    f.heldRock = null;
    r.state = 'flying'; r.t = 0;
    const target = f.input.aimPoint;
    const from = r.pos;
    const dist = from.distanceTo(target);
    const tFlight = dist / ROCK_SPEED;
    r.vel.subVectors(target, from).normalize().multiplyScalar(ROCK_SPEED);
    r.vel.y += 0.5 * ROCK_GRAV * tFlight;         // compensate gravity so the rock lands on the reticle point
    r.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
    this.world.audio.whoosh(0.9);
    this.world.fx.dust(from, 3, 1.0, 0xa89a88);
  }

  dropRock(f) {
    const r = f.heldRock; f.heldRock = null;
    if (r) { r.state = 'falling'; r.vel.set(0, 0, 0); }
  }

  shatter(r, hitFighter) {
    r.state = 'dead';
    this.world.scene.remove(r.mesh);
    const fx = this.world.fx;
    fx.debrisBurst(r.pos, 14, 3.5, 0.11, 0x6e665e);
    fx.dust(r.pos, 6, 2.2, 0x9f9282);
    fx.ring(new THREE.Vector3(r.pos.x, this.world.arena.groundAt(r.pos.x, r.pos.z, r.pos.y), r.pos.z), 2.2, 0xd8cbb5, 0.35);
    this.world.audio.impact(hitFighter ? 1 : 0.7);
    this.world.shake(hitFighter ? 0.25 : 0.12, r.pos);
  }

  updateRocks(dt) {
    const w = this.world;
    for (const r of this.rocks) {
      if (r.state === 'dead') continue;
      const f = r.owner;
      if (r.state === 'rising' || r.state === 'held') {
        r.t += dt;
        const anchor = this.heldAnchor(f, _v);
        if (r.state === 'rising') {
          const k = smooth01(r.t / 0.3);
          r.pos.lerpVectors(r.start, anchor, k);
          // pop slightly above anchor mid-way for a heavier lift arc
          r.pos.y += Math.sin(k * Math.PI) * 0.35;
          if (r.t >= 0.3) r.state = 'held';
        } else {
          r.pos.lerp(anchor, 1 - Math.exp(-14 * dt));
          if (!f.holding && f.action !== 'throw') this.release(f); // tap: auto-throw after raise
        }
        r.mesh.rotation.y += dt * 1.5; r.mesh.rotation.x += dt * 0.6;
        r.mesh.position.copy(r.pos);
        if (Math.random() < dt * 8) w.fx.puff(r.pos.clone().add(_v2.set(0, -0.3, 0)), _v3.set(0, -0.6, 0), 0.25, 0.5, 0x9d8f7e, 0.35, 1.5);
        continue;
      }
      // flying / falling
      r.life -= dt;
      const steps = 3, h = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        r.vel.y -= (r.state === 'falling' ? 18 : ROCK_GRAV) * h;
        r.pos.addScaledVector(r.vel, h);
        // fighters
        if (r.state === 'flying') for (const t of w.fighters) {
          if (t === r.owner || t.dead) continue;
          const a = _a.set(t.pos.x, t.pos.y + 0.35, t.pos.z), b = _b.set(t.pos.x, t.pos.y + 1.55, t.pos.z);
          if (distPointSeg(r.pos, a, b) < ROCK_R + t.radius) {
            if (t.invuln > 0) continue; // rolled through it
            const dir = _d.set(r.vel.x, 0, r.vel.z).normalize();
            this.damage(t, r.dmg, dir, r.owner, 'rock', r.pos.clone(), 6.5, true);
            this.shatter(r, true); done = true; break;
          }
        }
        if (done) break;
        // shields
        for (const sh of this.shields) {
          if (sh.dead || (sh.owner === r.owner && r.state === 'flying')) continue;
          if (this.pointInShield(sh, r.pos, ROCK_R)) {
            this.hitShield(sh, r.dmg * 1.4, r.pos);
            if (sh.owner) w.popup(sh.owner, 'BLOCK', true);
            this.shatter(r, false); done = true; break;
          }
        }
        if (done) break;
        // arena geometry
        const c = w.arena.solidAt(r.pos, ROCK_R * 0.6);
        const gy = w.arena.groundAt(r.pos.x, r.pos.z, r.pos.y + 1);
        if (c || r.pos.y < gy + ROCK_R * 0.6 || Math.abs(r.pos.x) > HALF + 1 || Math.abs(r.pos.z) > HALF + 1 || r.life <= 0) {
          if (r.pos.y < gy + ROCK_R) { r.pos.y = gy + 0.1; w.fx.crater(r.pos, 1.1); }
          this.shatter(r, false); done = true;
        }
      }
      if (!done) {
        r.mesh.position.copy(r.pos);
        r.mesh.rotation.x += r.spin.x * dt; r.mesh.rotation.y += r.spin.y * dt; r.mesh.rotation.z += r.spin.z * dt;
        if (r.state === 'flying' && Math.random() < dt * 30) w.fx.puff(r.pos.clone(), _v3.set(0, 0.2, 0), 0.3, 0.35, 0xb0a290, 0.35, 1.2);
      }
    }
    this.rocks = this.rocks.filter(r => r.state !== 'dead');
  }

  // ---------------------------------------------------------------- shields
  raiseShield(f) {
    const mesh = new THREE.Mesh(this.shieldGeo, this.shieldMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.world.scene.add(mesh);
    const sh = { mesh, owner: f, hp: 70, t: 0, sink: 0, dead: false, yaw: f.faceYaw, pos: new THREE.Vector3(), hw: 0.95, hh: 2.0, hd: 0.3, rise: 0 };
    this.placeShield(sh, 1);
    this.shields.push(sh);
    f.shield = sh;
    const fx = this.world.fx;
    fx.debrisBurst(sh.pos.clone().setY(sh.pos.y + 0.1), 14, 2.6, 0.1, 0x7a6a58, 0.9);
    fx.dust(sh.pos, 8, 2.2);
    fx.crater(sh.pos, 2.0);
    this.world.audio.rumble(0.8);
  }
  placeShield(sh, snap) {
    const f = sh.owner;
    sh.yaw = snap ? f.faceYaw : sh.yaw + Math.atan2(Math.sin(f.faceYaw - sh.yaw), Math.cos(f.faceYaw - sh.yaw)) * snap;
    const gx = f.pos.x + Math.sin(sh.yaw) * 1.0, gz = f.pos.z + Math.cos(sh.yaw) * 1.0;
    sh.pos.set(gx, this.world.arena.groundAt(gx, gz, f.pos.y + 0.3), gz);
  }
  dropShield(f) {
    const sh = f.shield; f.shield = null;
    if (sh && !sh.dead) sh.sink = 0.001;
  }
  hitShield(sh, dmg, at) {
    sh.hp -= dmg;
    this.world.fx.debrisBurst(at, 8, 2.5, 0.09, 0x7a6a58);
    this.world.fx.spark(at, 0xe8d6b0, 4);
    sh.shake = 0.15;
    if (sh.hp <= 0) this.breakShield(sh);
  }
  breakShield(sh) {
    sh.dead = true; this.world.scene.remove(sh.mesh);
    this.world.fx.debrisBurst(sh.pos.clone().setY(sh.pos.y + 1), 26, 4, 0.16, 0x7a6a58);
    this.world.fx.dust(sh.pos, 10, 3);
    this.world.audio.impact(1.2);
    if (sh.owner && sh.owner.shield === sh) { sh.owner.shield = null; sh.owner.guarding = false; sh.owner.guardCd = 1.2; sh.owner.stunT = 0.3; }
  }
  pointInShield(sh, p, pad) {
    if (sh.rise < 0.5) return false;
    const dx = p.x - sh.pos.x, dz = p.z - sh.pos.z;
    const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ly = p.y - sh.pos.y;
    return Math.abs(lx) < sh.hw + pad && Math.abs(lz) < sh.hd + pad && ly > -pad && ly < sh.hh * sh.rise + pad;
  }
  updateShields(dt) {
    for (const sh of this.shields) {
      if (sh.dead) continue;
      sh.t += dt;
      if (sh.sink > 0) {
        sh.sink += dt;
        sh.rise = 1 - smooth01(sh.sink / 0.3);
        if (sh.sink > 0.3) { sh.dead = true; this.world.scene.remove(sh.mesh); continue; }
      } else {
        sh.rise = smooth01(sh.t / 0.16); // fast: immediate defence
        this.placeShield(sh, 1 - Math.exp(-10 * dt)); // rotates to follow where the owner faces
        if (sh.t < 0.2 && Math.random() < 0.5) this.world.fx.debrisBurst(sh.pos.clone().setY(sh.pos.y + 0.05), 1, 1.5, 0.07, 0x7a6a58, 0.6);
      }
      let shk = 0;
      if (sh.shake > 0) { sh.shake -= dt; shk = (Math.random() - 0.5) * 0.08; }
      sh.mesh.position.set(sh.pos.x + shk, sh.pos.y - (1 - sh.rise) * 2.1, sh.pos.z);
      sh.mesh.rotation.set(0, sh.yaw, 0);
    }
    this.shields = this.shields.filter(s => !s.dead);
  }

  // ---------------------------------------------------------------- melee
  lunge(f, A) {
    const t = f.target;
    if (!t || t.dead) return;
    _d.subVectors(t.pos, f.pos); _d.y = 0;
    const d = _d.length();
    const fwd = f.forward(_v2);
    const facing = _d.dot(fwd) / (d || 1);
    if (d < 5 && d > 1.1 && (facing > 0.3 || f.input.strafe)) {
      _d.normalize();
      f.lungeDir.copy(_d).multiplyScalar(Math.min(A.lunge, (d - 1.0) / 0.14));
      f.lungeT = 0.14;
      f.faceYaw = Math.atan2(_d.x, _d.z);
    }
  }

  meleeCheck(f, name) {
    const def = MELEE[name];
    for (const t of this.world.fighters) {
      if (t === f || t.dead) continue;
      _d.subVectors(t.pos, f.pos); const dy = _d.y; _d.y = 0;
      const d = _d.length();
      if (d > def.range + t.radius * 0.5 || Math.abs(dy) > 1.4) continue;
      const fwd = f.forward(_v2);
      // kick spins: test against facing yaw (pre-spin) with a wide arc
      const fy = f.faceYaw; fwd.set(Math.sin(fy), 0, Math.cos(fy));
      if (d > 0.3 && _d.dot(fwd) / d < (def.arc)) continue;
      if (t.invuln > 0) continue;
      _d.normalize();
      const hitPt = t.chestPos(new THREE.Vector3()).addScaledVector(_d, -0.3);
      this.damage(t, def.dmg, _d.clone(), f, name, hitPt, def.knock, name === 'kick');
      return true;
    }
    // melee also chips enemy shields
    for (const sh of this.shields) {
      if (sh.owner === f || sh.dead) continue;
      if (sh.pos.distanceTo(f.pos) < def.range + 0.6) { this.hitShield(sh, def.dmg, sh.pos.clone().setY(sh.pos.y + 1.2)); this.world.audio.impact(0.6); return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------- damage
  damage(t, dmg, dir, from, kind, at, knock, heavy) {
    const w = this.world;
    // stone shield in front blocks melee (projectiles are blocked physically)
    if (t.guarding && t.shield && kind !== 'rock') {
      const fwd = t.forward(_v2);
      if (-dir.dot(fwd) > 0.2) {
        this.hitShield(t.shield, dmg, at);
        w.popup(t, 'BLOCK', true);
        from.vel.x -= dir.x * 4; from.vel.z -= dir.z * 4;
        w.audio.impact(0.5);
        return;
      }
    }
    t.takeHit(dmg, dir, knock, heavy);
    w.popup(t, String(Math.round(dmg)));
    w.fx.spark(at, kind === 'rock' ? 0xffe0a0 : 0xfff2d0, kind === 'rock' ? 8 : 5);
    w.audio.hit(heavy ? 1 : 0.6);
    w.hitStop(heavy ? 0.09 : 0.05);
    w.shake(heavy ? 0.3 : 0.15, at);
    if (w.onHit) w.onHit(t, from, kind);
  }

  clear() {
    for (const r of this.rocks) this.world.scene.remove(r.mesh);
    for (const s of this.shields) this.world.scene.remove(s.mesh);
    this.rocks = []; this.shields = [];
  }
  update(dt) { this.updateRocks(dt); this.updateShields(dt); }
}
const MELEE = {
  jab: { dmg: 6, range: 1.75, knock: 2.5, arc: 0.35 },
  cross: { dmg: 7, range: 1.8, knock: 3, arc: 0.35 },
  kick: { dmg: 11, range: 2.15, knock: 8, arc: -0.2 },
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
