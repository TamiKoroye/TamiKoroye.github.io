// Elemental weapons and mobility effects that are not plain projectiles:
//   whips      : a flexible stream (water / air / fire) that follows the hand and sweeps through a strike arc
//                (horizontal, vertical, diagonal or all the way round the body), or is held and steered
//   waves      : a broad wall advancing over the ground (water tidal wave, air pressure wave)
//   columns    : a marked spot that surges upward (water / air column) and launches whoever stands on it
//   eruptions  : earth stomp - the ground cracks under the opponent, then rock spikes burst up there
//   fire rings : fire stomp - a ring of flame expanding outward along the ground from the stamping foot
//   captures   : a water stream that coils round the opponent and holds them briefly
//   surf / flight: the ice or rock under a surfing bender, the ramp or slab that launches them, the wind under a flier
// Every one has real hit detection; the visuals follow the same points the hits are tested on.
import * as THREE from 'three';
import { makeWaterTube, waterMaterial, iceMat } from './defence-fx.js';
import { smooth01, rand, clamp } from './util.js';
import { GroundBurst } from './crack.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _q = new THREE.Quaternion();

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
function distPointSeg(p, a, b) {
  const ab = _s1.subVectors(b, a), t = clamp(_s2.subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return _s2.copy(a).addScaledVector(ab, t).distanceTo(p);
}

// strike shapes: which axis the whip swings about, and over what angles (radians, relative to the aim)
const SWINGS = {
  h:  { axis: 'up', from: 1.35, to: -1.35 },          // horizontal, right to left (mirrored for the other hand)
  v:  { axis: 'side', from: 1.25, to: -0.45 },        // overhead, straight down onto the target
  d:  { axis: 'diag', from: 1.3, to: -1.1 },          // diagonal, high to low
  lash: { axis: 'up', from: 0.25, to: -0.25 },        // short, fast straight lash
  circle: { axis: 'up', from: 0, to: -Math.PI * 2 },  // all the way round the body (spinning kicks)
};

export class Weapons {
  constructor(B) {
    this.B = B; this.w = B.world;
    this.whips = []; this.waves = []; this.columns = []; this.erupts = []; this.fireRings = []; this.captures = [];
    this.trails = []; this.platforms = [];
    this.tubeMat = waterMaterial(-4); this.tubeMat.uniforms.uRise.value = 1;
    this.tubePool = [];
    this.burst = new GroundBurst(this.w);   // earth's ground reaction (baked fracture simulation)
    this.iceTubeMat = iceMat;
    this.slabGeo = (() => { const g = new THREE.BoxGeometry(1.5, 0.35, 2.1, 3, 1, 3); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + rand(-0.06, 0.06), p.getY(i) + rand(-0.05, 0.05), p.getZ(i) + rand(-0.06, 0.06)); g.computeVertexNormals(); return g; })();
    this.iceSheetGeo = (() => { const g = new THREE.CircleGeometry(0.9, 9); g.rotateX(-Math.PI / 2); return g; })();
    this.rampGeo = (() => { const g = new THREE.CylinderGeometry(0.75, 1.1, 2.4, 7, 1); g.translate(0, 1.2, 0); return g; })();   // ice pillar with a flat top
    this.ringGeo = (() => { const g = new THREE.TorusGeometry(1, 0.16, 6, 64); g.rotateX(Math.PI / 2); return g; })();
    this.markGeo = (() => { const g = new THREE.RingGeometry(0.6, 1.0, 32); g.rotateX(-Math.PI / 2); return g; })();
    this.waveGeo = (() => { const g = new THREE.PlaneGeometry(1, 1, 16, 6); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.5; p.setZ(i, Math.sin(y * Math.PI) * 0.35 - y * y * 0.4); p.setY(i, y); } g.computeVertexNormals(); return g; })();
    this.rockMat = B.mat.stone;
    this.markMat = { earth: new THREE.MeshBasicMaterial({ color: 0x5b4632, transparent: true, opacity: 0.0, depthWrite: false }), water: new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.0, depthWrite: false }), air: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }) };
    this.fireRingMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthWrite: false });
    this.airWaveMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  }

  tube() { const t = this.tubePool.pop() || makeWaterTube(22, 7, this.tubeMat); t.mesh.material = this.tubeMat; t.mesh.visible = true; this.w.scene.add(t.mesh); return t; }
  freeTube(t) { if (!t) return; this.w.scene.remove(t.mesh); t.mesh.visible = false; if (this.tubePool.length < 12) this.tubePool.push(t); else t.mesh.geometry.dispose(); }

  // ============================================================ whips
  // kind: h / v / d / lash / circle; opts: { side (+1 left hand, -1 right hand, 0 body), len, dmg, knock, level, dur, frozen }
  whipStrike(f, el, kind, opts = {}) {
    const B = this.B, side = opts.side ?? (f.techSide || 1);
    const t = f.target && !f.target.dead ? f.target : null;
    const dist = t ? Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) : 5;
    const W = {
      f, el, kind, side, t: 0, dur: opts.dur || (kind === 'circle' ? 0.5 : kind === 'lash' ? 0.26 : 0.4),
      len: opts.len || (kind === 'circle' ? 3.0 : clamp(dist + 0.6, 3.2, 9)), dmg: opts.dmg ?? 8, knock: opts.knock ?? 7, level: opts.level ?? 1,
      mirror: kind === 'h' && side < 0 ? -1 : 1, pts: Array.from({ length: 14 }, () => new THREE.Vector3()), prev: Array.from({ length: 14 }, () => new THREE.Vector3()),
      hit: new Set(), frozen: !!opts.frozen, aim: B.aimDir(f, f.chestPos(_a), new THREE.Vector3()), tag: opts.tag || el + 'Whip',
    };
    if (el === 'water') { W.tube = this.tube(); if (W.frozen) W.tube.mesh.material = iceMat; }
    if (el === 'air') W.ribbons = [0, 1, 2].map(i => this.w.fx.ribbons.start({ color: i === 1 ? 0xdcd2ff : 0xffffff, width: 0.09 - i * 0.02, life: 0.22, alpha: 0.85 }));
    this.whips.push(W);
    if (el === 'water') this.w.audio.splash(0.5); else if (el === 'air') this.w.audio.gust(0.6); else this.w.audio.fireWhoosh(0.7);
    return W;
  }
  // the whip's shape at progress u: the tip lags behind the hand, so the stream curves through the swing
  shapeWhip(W, u) {
    const f = W.f, S = SWINGS[W.kind];
    const origin = W.kind === 'circle' ? _a.set(f.pos.x, f.pos.y + 0.75, f.pos.z) : (W.side === 0 ? f.chestPos(_a) : this.B.handPoint(f, W.side, _a));
    // keep tracking the target while the strike is young (the whip follows the hands, the hands follow the opponent)
    if (u < 0.35) this.B.aimDir(f, origin, W.aim);
    const D = W.kind === 'circle' ? f.forward(_b) : _b.copy(W.aim);
    const right = _c.crossVectors(D, UP).normalize();
    const axis = S.axis === 'up' ? UP : S.axis === 'side' ? right : _d.copy(UP).multiplyScalar(0.7).addScaledVector(right, 0.7).normalize();
    const ext = smooth01(u / 0.22) * (1 - smooth01((u - 0.8) / 0.2));
    const L = W.len * ext;
    const axisC = axis.clone(), Dc = D.clone(), ox = origin.x, oy = origin.y, oz = origin.z;
    for (let k = 0; k < W.pts.length; k++) {
      const s = k / (W.pts.length - 1);
      const uu = clamp(u - s * 0.16, 0, 1);
      const sw = smooth01(clamp((uu - 0.08) / 0.62, 0, 1));
      const ang = (S.from + (S.to - S.from) * sw) * W.mirror;
      _q.setFromAxisAngle(axisC, ang);
      const dir = _d.copy(Dc).applyQuaternion(_q);
      W.prev[k].copy(W.pts[k]);
      W.pts[k].set(ox + dir.x * s * L, oy + dir.y * s * L, oz + dir.z * s * L);
      // water sags a little and ripples; fire and air stay tighter
      if (W.el === 'water' && !W.frozen) W.pts[k].y += -0.18 * Math.sin(Math.PI * s) * s + Math.sin(s * 9 + W.t * 22) * 0.05 * s;
      if (W.kind === 'circle') W.pts[k].y += -0.25 * s;
    }
  }
  updateWhips(dt) {
    const w = this.w, B = this.B;
    for (const W of this.whips) {
      W.t += dt; const u = W.t / W.dur, f = W.f;
      if (f.dead || f.reacting() || u >= 1) { W.dead = true; continue; }
      this.shapeWhip(W, u);
      this.drawWhip(W, u);
      if (u > 0.14 && u < 0.86) this.whipHits(W, u);
    }
    this.whips = this.whips.filter(W => { if (W.dead) this.dropWhip(W); return !W.dead; });
  }
  drawWhip(W, u) {
    const w = this.w;
    if (W.tube) { const fr = W.frozen; W.tube.set(W.pts.slice().reverse(), (s) => (fr ? 0.1 : 0.13) * (0.45 + 0.55 * s) + 0.015, W.t); if (!fr && Math.random() < 0.5) w.fx.splash(W.pts[W.pts.length - 1], 1); }
    if (W.ribbons) { W.ribbons[0].push(W.pts[13]); W.ribbons[1].push(W.pts[9]); W.ribbons[2].push(W.pts[5]); if (Math.random() < 0.5) w.fx.wind(W.pts[13], _a.subVectors(W.pts[13], W.prev[13]).multiplyScalar(30), 0.45, 0.25); }
    if (W.el === 'fire') for (let k = 3; k < W.pts.length; k += 2) if (Math.random() < 0.7) w.fx.fire(W.pts[k], _a.subVectors(W.pts[k], W.prev[k]).multiplyScalar(8).add(_b.set(0, 1, 0)), 0.22 + 0.25 * k / 14, 0.18);
  }
  dropWhip(W) { this.freeTube(W.tube); if (W.ribbons) for (const r of W.ribbons) r.release(); }
  // tests the whip's segments against fighters, enemy projectiles (the whip swats them aside) and burning ground
  whipHits(W, u) {
    const w = this.w, B = this.B, f = W.f;
    for (const t of w.fighters) {
      if (t === f || t.dead || W.hit.has(t) || t.invuln > 0) continue;
      const a = _a.set(t.pos.x, t.pos.y + 0.3, t.pos.z), b = _b.set(t.pos.x, t.pos.y + 1.65, t.pos.z);
      for (let k = 2; k < W.pts.length; k++) {
        // a fast whip moves well over a body width per frame: test the path each point travelled, not only where it is
        let p = null;
        for (let q = 0; q <= 4 && !p; q++) { const c = _e.lerpVectors(W.prev[k], W.pts[k], q / 4); if (distPointSeg(c, a, b) < t.radius + 0.2) p = c.clone(); }
        if (p) {
          W.hit.add(t);
          // the push follows the whip's motion at the point of contact, mixed with the direction of the strike
          const v = _c.subVectors(W.pts[k], W.prev[k]); v.y = 0; if (v.lengthSq() < 1e-6) v.copy(W.aim);
          const dir = v.normalize().multiplyScalar(0.6).add(_d.set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize().multiplyScalar(0.7)).normalize();
          w.combat.damage(t, W.frozen ? Math.round(W.dmg * 1.4) : W.dmg, dir.clone(), f, W.tag, p.clone(), W.knock, W.frozen ? 2 : W.level);
          if (W.frozen) { w.fx.debrisBurst(p, 10, 3, 0.07, 0xbfe8ff); }
          else if (W.el === 'water') w.fx.splash(p, 10);
          if (W.el === 'fire' && Math.random() < 0.5) B.burn(t.pos.x, t.pos.z, t.groundY, f);
          break;
        }
      }
    }
    for (const o of B.objs) {
      if (o.state !== 'flying' || o.owner === f) continue;
      for (let k = 3; k < W.pts.length; k += 2) if (W.pts[k].distanceTo(o.pos) < o.r + 0.35) {
        B.kill(o, W.el === 'water' && o.el === 'fire' ? 'steam' : undefined); w.popup(f, 'SWAT', false); break;
      }
    }
    if (W.el === 'water') B.extinguishNear(W.pts[13], 1.2);
  }

  // Sustained whips (HAND held): one stream from each hand, lashing in turn and steered by the aim and the stick.
  // Called every frame by the hold; returns false when the hold should end.
  sustain(f, h, dt) {
    const w = this.w, B = this.B, el = f.el;
    if (!h.whips) {
      h.whips = [1, -1].map(side => ({ side, pts: Array.from({ length: 14 }, () => new THREE.Vector3()), prev: Array.from({ length: 14 }, () => new THREE.Vector3()), tube: el === 'water' ? this.tube() : null,
        ribbons: el === 'air' ? [0, 1].map(i => w.fx.ribbons.start({ color: i ? 0xdcd2ff : 0xffffff, width: 0.08, life: 0.25, alpha: 0.8 })) : null, cd: 0 }));
      h.sweep = 0;
    }
    if (h.frozen && el === 'water') for (const s of h.whips) if (s.tube) s.tube.mesh.material = iceMat;
    // the stick sweeps the streams across (relative to the fighter's facing), the lashes alternate between hands
    const c = Math.cos(f.faceYaw), s0 = Math.sin(f.faceYaw), lx = f.input.mx * c - f.input.mz * s0;
    h.sweep += (clamp(lx, -1, 1) * 1.1 - h.sweep) * Math.min(1, dt * 5);
    const t = f.target && !f.target.dead ? f.target : null;
    const reach = clamp(t ? Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) + 0.5 : 5.5, 3, 8.5);
    for (const S of h.whips) {
      const phase = h.t * 5.2 + (S.side > 0 ? 0 : Math.PI);      // alternate: one lashes while the other draws back
      const lash = Math.max(0, Math.sin(phase)), from = this.B.handPoint(f, S.side, _a);
      const aim = B.aimDir(f, from, _b);
      _q.setFromAxisAngle(UP, h.sweep + S.side * 0.35 * (1 - lash) + Math.cos(phase) * 0.55 * S.side);
      aim.applyQuaternion(_q);
      const L = reach * (0.45 + 0.55 * lash);
      for (let k = 0; k < 14; k++) {
        const sk = k / 13, bend = Math.sin(phase - sk * 1.6) * 0.9 * sk;
        S.prev[k].copy(S.pts[k]);
        S.pts[k].copy(from).addScaledVector(aim, sk * L).addScaledVector(_c.crossVectors(aim, UP).normalize(), bend * 0.6 * S.side);
        S.pts[k].y += Math.sin(sk * 7 + h.t * 11) * 0.08 * sk - 0.12 * Math.sin(Math.PI * sk);
      }
      if (S.tube) S.tube.set(S.pts.slice().reverse(), (q) => 0.12 * (0.5 + 0.5 * q) + 0.015, h.t);
      if (S.ribbons) { S.ribbons[0].push(S.pts[13]); S.ribbons[1].push(S.pts[8]); }
      if (el === 'fire') for (let k = 4; k < 14; k += 3) w.fx.fire(S.pts[k], _c.set(0, 1, 0), 0.25, 0.16);
      // each stream strikes at the height of its lash
      // while a lash is out its whole length is live (each target can be struck once per lash)
      if (lash < 0.3) { S.struck = null; S.sounded = false; }
      if (lash > 0.55) {
        S.struck = S.struck || new Set();
        for (const tt of w.fighters) {
          if (tt === f || tt.dead || tt.invuln > 0 || S.struck.has(tt)) continue;
          const a = _a.set(tt.pos.x, tt.pos.y + 0.3, tt.pos.z), b = _d.set(tt.pos.x, tt.pos.y + 1.65, tt.pos.z);
          let hit = false; for (let k = 3; k < 14 && !hit; k++) for (let q = 0; q <= 3 && !hit; q++) if (distPointSeg(_e.lerpVectors(S.prev[k], S.pts[k], q / 3), a, b) < tt.radius + 0.22) hit = true;
          if (hit) {
            S.struck.add(tt);
            const dir = _c.set(tt.pos.x - f.pos.x, 0, tt.pos.z - f.pos.z).normalize();
            w.combat.damage(tt, h.frozen ? 7 : 5, dir.clone(), f, el + 'Whip', tt.chestPos(new THREE.Vector3()), el === 'air' ? 7 : 5, h.frozen ? 1 : 0);
            if (el === 'water') w.fx.splash(tt.chestPos(_a), 8);
          }
        }
        for (const o of B.objs) if (o.state === 'flying' && o.owner !== f) for (let k = 4; k < 14; k += 3) if (S.pts[k].distanceTo(o.pos) < o.r + 0.4) { B.kill(o, el === 'water' && o.el === 'fire' ? 'steam' : undefined); break; }
        if (!S.sounded) { S.sounded = true; if (el === 'water') w.audio.splash(0.35); else if (el === 'air') w.audio.gust(0.35); else w.audio.fireWhoosh(0.3); }
      }
    }
    if (el === 'water') B.extinguishNear(h.whips[0].pts[13], 1.2);
    return true;
  }
  endSustain(h) { if (h.whips) for (const S of h.whips) { this.freeTube(S.tube); if (S.ribbons) for (const r of S.ribbons) r.release(); } h.whips = null; }

  // ============================================================ waves
  // water: a wall of water advancing over the ground; air: a pressure wave. Both push, put out fire (water) and
  // sweep away projectiles; the water wave freezes into ice spikes where it stops if `freeze`
  wave(f, el, opts = {}) {
    const w = this.w, dir = this.B.aimDir(f, f.pos, new THREE.Vector3()).setY(0).normalize();
    const mesh = new THREE.Mesh(this.waveGeo, el === 'water' ? this.B.waterSurf : this.airWaveMat);
    mesh.scale.set(opts.width || 6, el === 'water' ? 1.8 : 2.2, 1.6);
    const pos = new THREE.Vector3(f.pos.x + dir.x * 1.2, f.groundY, f.pos.z + dir.z * 1.2);
    mesh.position.copy(pos); mesh.rotation.y = Math.atan2(dir.x, dir.z); w.scene.add(mesh);
    this.waves.push({ f, el, dir, pos, mesh, t: 0, life: opts.life || 1.1, speed: opts.speed || (el === 'water' ? 10 : 18), width: opts.width || 6, hit: new Set(), dmg: opts.dmg ?? (el === 'water' ? 10 : 6), knock: opts.knock ?? (el === 'water' ? 10 : 14), level: opts.level ?? 2, freeze: !!opts.freeze });
    if (el === 'water') w.audio.splash(1.2); else w.audio.gust(1.2);
  }
  updateWaves(dt) {
    const w = this.w, B = this.B;
    for (const V of this.waves) {
      V.t += dt; const k = V.t / V.life;
      V.pos.addScaledVector(V.dir, V.speed * dt * (1 - 0.5 * k));
      // follows the ground; a solid obstacle stops the part of the wave that meets it
      const gy = w.arena.groundAt(V.pos.x, V.pos.z, V.pos.y + 1.5);
      V.pos.y = gy;
      if (w.arena.solidAt(_a.set(V.pos.x, gy + 0.6, V.pos.z), 0.2)) V.t = Math.max(V.t, V.life * 0.92);
      V.mesh.position.copy(V.pos);
      const grow = Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * (1 - smooth01((k - 0.75) / 0.25));
      V.mesh.scale.y = (V.el === 'water' ? 1.8 : 2.2) * Math.max(0.05, grow);
      if (V.el === 'water' && Math.random() < 0.8) w.fx.splash(_a.copy(V.pos).addScaledVector(_b.crossVectors(V.dir, UP), rand(-V.width / 2, V.width / 2)).setY(V.pos.y + 1), 2);
      if (V.el === 'air') for (let i = 0; i < 2; i++) w.fx.wind(_a.copy(V.pos).addScaledVector(_b.crossVectors(V.dir, UP), rand(-V.width / 2, V.width / 2)).setY(V.pos.y + rand(0.3, 1.8)), _c.copy(V.dir).multiplyScalar(14), 0.5, 0.3);
      const side = _b.crossVectors(V.dir, UP).normalize();
      for (const t of w.fighters) {
        if (t === V.f || t.dead || V.hit.has(t) || t.invuln > 0) continue;
        const rx = t.pos.x - V.pos.x, rz = t.pos.z - V.pos.z, along = rx * V.dir.x + rz * V.dir.z, lat = rx * side.x + rz * side.z;
        if (Math.abs(along) < 0.9 && Math.abs(lat) < V.width / 2 && t.pos.y - V.pos.y < 1.6 * grow + 0.2) {
          V.hit.add(t);
          w.combat.damage(t, V.dmg, V.dir.clone(), V.f, V.el + 'Wave', t.chestPos(new THREE.Vector3()), V.knock, V.level);
          t.ext.addScaledVector(V.dir, V.el === 'air' ? 9 : 6);
        }
      }
      for (const o of B.objs) if (o.state === 'flying' && o.owner !== V.f && Math.abs((o.pos.x - V.pos.x) * V.dir.x + (o.pos.z - V.pos.z) * V.dir.z) < 1 && o.pos.y - V.pos.y < 2) B.kill(o, V.el === 'water' && o.el === 'fire' ? 'steam' : undefined);
      if (V.el === 'water') B.extinguishNear(V.pos, V.width / 2);
      if (V.t >= V.life) {
        V.dead = true; w.scene.remove(V.mesh);
        if (V.freeze) for (let i = -2; i <= 2; i++) B.spikes.push({ owner: V.f, ice: true, t: -Math.abs(i) * 0.05, pos: new THREE.Vector3(V.pos.x + side.x * i * 1.1, V.pos.y, V.pos.z + side.z * i * 1.1), mesh: null, hit: new Set() });
      }
    }
    this.waves = this.waves.filter(V => !V.dead);
  }

  // ============================================================ columns (water / air) and eruptions (earth)
  // a marked spot on the ground (readable warning), then the surge; the target can step out of it
  column(f, el, at, opts = {}) {
    const w = this.w, gy = w.arena.groundAt(at.x, at.z, at.y + 1);
    const mark = new THREE.Mesh(this.markGeo, this.markMat[el]); mark.position.set(at.x, gy + 0.03, at.z); mark.scale.setScalar(opts.r || 1.1); w.scene.add(mark);
    this.columns.push({ f, el, x: at.x, z: at.z, gy, mark, t: 0, warn: opts.warn ?? 0.45, r: opts.r || 1.1, hit: new Set(), tube: null, dmg: opts.dmg ?? 8, lift: opts.lift ?? 10 });
  }
  updateColumns(dt) {
    const w = this.w;
    for (const C of this.columns) {
      C.t += dt; const after = C.t - C.warn;
      C.mark.material.opacity = after < 0 ? 0.25 + 0.35 * Math.abs(Math.sin(C.t * 18)) : Math.max(0, 0.5 - after);
      if (after < 0) { if (Math.random() < 0.5) { if (C.el === 'water') w.fx.splash(_a.set(C.x + rand(-C.r, C.r) * 0.7, C.gy + 0.1, C.z + rand(-C.r, C.r) * 0.7), 1); else w.fx.wind(_a.set(C.x, C.gy + 0.1, C.z), _b.set(rand(-2, 2), 1, rand(-2, 2)), 0.4, 0.3); } continue; }
      if (!C.started) {
        C.started = true;
        if (C.el === 'water') { C.tube = this.tube(); w.audio.splash(1); } else w.audio.gust(1);
        for (const t of w.fighters) {
          if (t === C.f || t.dead || t.invuln > 0 || C.hit.has(t)) continue;
          if (Math.hypot(t.pos.x - C.x, t.pos.z - C.z) < C.r + t.radius * 0.5 && t.pos.y - C.gy < 1.2) {
            C.hit.add(t); w.combat.damage(t, C.dmg, _a.set(0, 0, 0).set(t.pos.x - C.f.pos.x, 0, t.pos.z - C.f.pos.z).normalize().clone(), C.f, C.el + 'Column', t.chestPos(new THREE.Vector3()), 2, 1);
            if (!t.dead) { t.vel.y = C.lift; t.onGround = false; }
          }
        }
      }
      const h = Math.min(1, after / 0.18) * 4.5 * (1 - smooth01((after - 0.5) / 0.35));
      if (C.tube) { const pts = []; for (let k = 0; k <= 8; k++) pts.push(new THREE.Vector3(C.x + Math.sin(k + C.t * 9) * 0.12, C.gy + h * (1 - k / 8), C.z + Math.cos(k + C.t * 9) * 0.12)); C.tube.set(pts, (s) => 0.25 + 0.35 * s, C.t); if (Math.random() < 0.7) w.fx.splash(_a.set(C.x, C.gy + h, C.z), 3); }
      if (C.el === 'air') for (let i = 0; i < 3; i++) w.fx.wind(_a.set(C.x + rand(-0.5, 0.5), C.gy + rand(0, h), C.z + rand(-0.5, 0.5)), _b.set(rand(-1, 1), 12, rand(-1, 1)), 0.5, 0.3);
      if (after > 0.85) { C.dead = true; w.scene.remove(C.mark); this.freeTube(C.tube); }
    }
    this.columns = this.columns.filter(C => !C.dead);
  }

  // EARTH STOMP: the spot is taken from where the opponent is when the foot rises; the ground there cracks
  // (warning) and erupts on the stamp. Eruptions only come from walkable ground.
  eruptionMark(f) {
    const t = f.target && !f.target.dead ? f.target : null, w = this.w;
    const at = t ? new THREE.Vector3(t.pos.x + t.vel.x * 0.2, 0, t.pos.z + t.vel.z * 0.2) : this.B.forwardPoint(f, 5, 0);
    const d = Math.hypot(at.x - f.pos.x, at.z - f.pos.z); if (d > 14) at.set(f.pos.x + (at.x - f.pos.x) * 14 / d, 0, f.pos.z + (at.z - f.pos.z) * 14 / d);
    const gy = w.arena.groundAt(at.x, at.z, 50);
    const mark = new THREE.Mesh(this.markGeo, this.markMat.earth.clone()); mark.position.set(at.x, gy + 0.03, at.z); mark.scale.setScalar(1.5); w.scene.add(mark);
    const E = { f, x: at.x, z: at.z, gy, mark, t: 0, fired: false, hit: new Set(), spikes: [] };
    this.erupts.push(E); return E;
  }
  eruptionFire(f) {
    const E = this.erupts.find(e => e.f === f && !e.fired); if (!E) return;
    const w = this.w; E.fired = true; E.ft = 0;
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + rand(-0.2, 0.2), r = i === 0 ? 0 : rand(0.5, 1.4);
      const m = new THREE.Mesh(this.B.pillarGeo, this.rockMat); const s = i === 0 ? 0.55 : rand(0.28, 0.42);
      m.scale.set(s, rand(0.9, 1.4) * (i === 0 ? 1.3 : 1), s); m.rotation.set(rand(-0.35, 0.35), rand(0, 6), rand(-0.35, 0.35)); m.castShadow = true;
      m.position.set(E.x + Math.sin(a) * r, E.gy - 1.6, E.z + Math.cos(a) * r); w.scene.add(m); E.spikes.push({ m, delay: i * 0.025, y0: E.gy - 1.6 });
    }
    w.fx.debrisBurst(_a.set(E.x, E.gy + 0.2, E.z), 22, 4.5, 0.12, 0x7a6a58); w.fx.dust(_a.set(E.x, E.gy, E.z), 14, 3); w.fx.crater(_a.set(E.x, E.gy, E.z), 2.4);
    this.burst.spawn(E.x, E.gy, E.z, 0.6);
    w.audio.rumble(1.2); w.shake(0.35, _a.set(E.x, E.gy, E.z));
    for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0) continue;
      if (Math.hypot(t.pos.x - E.x, t.pos.z - E.z) < 1.7 && t.pos.y - E.gy < 1.3) {
        E.hit.add(t); w.combat.damage(t, 16, _b.set(t.pos.x - E.x, 0, t.pos.z - E.z).normalize().clone(), f, 'eruption', t.chestPos(new THREE.Vector3()), 4, 2);
        if (!t.dead) { t.vel.y = 9; t.onGround = false; }
      }
    }
  }
  updateErupts(dt) {
    const w = this.w;
    for (const E of this.erupts) {
      E.t += dt;
      if (!E.fired) {
        E.mark.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(E.t * 14));
        if (Math.random() < dt * 30) w.fx.debrisBurst(_a.set(E.x + rand(-1.2, 1.2), E.gy + 0.05, E.z + rand(-1.2, 1.2)), 1, 1.2, 0.05, 0x6e5e4c, 0.6);
        if (E.t > 2.5) { E.dead = true; w.scene.remove(E.mark); }   // the stamp never came (interrupted)
        continue;
      }
      E.ft += dt; E.mark.material.opacity = Math.max(0, 0.6 - E.ft);
      for (const s of E.spikes) { const k = E.ft < s.delay ? 0 : E.ft < s.delay + 0.12 ? smooth01((E.ft - s.delay) / 0.12) : E.ft > 1.6 ? 1 - smooth01((E.ft - 1.6) / 0.4) : 1; s.m.position.y = s.y0 + k * 1.75; }
      if (E.ft > 2.05) { E.dead = true; w.scene.remove(E.mark); for (const s of E.spikes) w.scene.remove(s.m); }
    }
    this.erupts = this.erupts.filter(E => !E.dead);
  }

  // FIRE STOMP: a ring of flame expanding from the stamping foot along the ground. A fighter is caught when the
  // front passes them on the ground (a jump clears it); walls stop the ring in their direction.
  fireRing(f, foot) {
    const w = this.w, gy = w.arena.groundAt(foot.x, foot.z, foot.y + 1);
    const mesh = new THREE.Mesh(this.ringGeo, this.fireRingMat); mesh.position.set(foot.x, gy + 0.15, foot.z); w.scene.add(mesh);
    this.fireRings.push({ f, x: foot.x, z: foot.z, gy, r: 0.4, maxR: 9.5, speed: 11, mesh, hit: new Set(), t: 0 });
    for (let i = 0; i < 26; i++) { const a = rand(0, Math.PI * 2); w.fx.fire(_a.set(foot.x, gy + 0.2, foot.z), _b.set(Math.sin(a) * 5, rand(1.5, 4), Math.cos(a) * 5), 0.7, 0.4); }
    w.audio.fireWhoosh(1.4); w.shake(0.3, foot); w.fx.crater(_a.set(foot.x, gy, foot.z), 1.6);
  }
  updateFireRings(dt) {
    const w = this.w;
    for (const R of this.fireRings) {
      R.t += dt; const prevR = R.r; R.r += R.speed * dt * (1 - 0.45 * R.r / R.maxR);
      R.mesh.scale.set(R.r, 1 + 2 * (1 - R.r / R.maxR), R.r);
      R.mesh.material.opacity = 0.85 * (1 - smooth01((R.r / R.maxR - 0.7) / 0.3));
      const n = Math.ceil(R.r * 2.2);
      for (let i = 0; i < n; i++) if (Math.random() < 0.5) { const a = rand(0, Math.PI * 2), x = R.x + Math.sin(a) * R.r, z = R.z + Math.cos(a) * R.r; w.fx.fire(_a.set(x, R.gy + 0.15, z), _b.set(Math.sin(a) * 2, rand(1.5, 3.5), Math.cos(a) * 2), 0.45 + 0.3 * (1 - R.r / R.maxR), 0.3); }
      for (const t of w.fighters) {
        if (t === R.f || t.dead || R.hit.has(t) || t.invuln > 0) continue;
        const d = Math.hypot(t.pos.x - R.x, t.pos.z - R.z);
        if (d < prevR - 0.6 || d > R.r + 0.4) continue;
        if (t.pos.y - w.arena.groundAt(t.pos.x, t.pos.z, t.pos.y + 0.5) > 0.7) continue;   // jumped over the flames
        // a wall between the origin and the target shields them
        let blocked = false; const steps = Math.ceil(d / 0.25); for (let i = 1; i < steps && !blocked; i++) { const s = i / steps; if (w.arena.solidAt(_a.set(R.x + (t.pos.x - R.x) * s, R.gy + 0.4, R.z + (t.pos.z - R.z) * s), 0)) blocked = true; }
        if (blocked) continue;
        R.hit.add(t);
        w.combat.damage(t, Math.round(14 - 6 * (R.r / R.maxR)), _b.set(t.pos.x - R.x, 0, t.pos.z - R.z).normalize().clone(), R.f, 'fireRing', t.chestPos(new THREE.Vector3()), 9, R.r < R.maxR * 0.5 ? 2 : 1);
        if (Math.random() < 0.6) this.B.burn(t.pos.x, t.pos.z, t.groundY, R.f);
      }
      if (R.r >= R.maxR * 0.97) { R.dead = true; w.scene.remove(R.mesh); }
    }
    this.fireRings = this.fireRings.filter(R => !R.dead);
  }

  // ============================================================ water capture and ice spear
  capture(f) {
    const t = f.target, w = this.w;
    if (!t || t.dead || Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) > 12 || t.invuln > 0) { w.popup(f, 'MISSED', false); return false; }
    if (t.dodgeT > 0) { w.popup(t, 'SLIPPED', false); return false; }
    const C = { f, t, time: 0, dur: 1.0, tube: this.tube(), pts: Array.from({ length: 18 }, () => new THREE.Vector3()) };
    this.captures.push(C); t.restrainT = Math.max(t.restrainT, C.dur); t.captured = C;
    w.combat.damage(t, 4, _a.set(0, 0, 0), f, 'capture', t.chestPos(new THREE.Vector3()), 0, -1);
    w.popup(t, 'CAPTURED', true); w.audio.splash(0.9);
    return true;
  }
  updateCaptures(dt) {
    const w = this.w;
    for (const C of this.captures) {
      C.time += dt; const t = C.t, from = this.B.handPoint(C.f, 1, _a);
      // a stream from the bender's hand that coils round the captive
      for (let k = 0; k < 18; k++) {
        const s = k / 17;
        if (s < 0.4) C.pts[k].lerpVectors(from, _b.set(t.pos.x, t.pos.y + 1.1, t.pos.z), s / 0.4);
        else { const a = (s - 0.4) * 22 + C.time * 6, h = 0.4 + (s - 0.4) * 2.0; C.pts[k].set(t.pos.x + Math.sin(a) * 0.55, t.pos.y + h, t.pos.z + Math.cos(a) * 0.55); }
      }
      C.tube.set(C.pts, () => 0.09, C.time);
      if (C.time >= C.dur || t.dead || C.f.dead || C.f.reacting()) { C.dead = true; this.freeTube(C.tube); t.captured = null; w.fx.splash(t.chestPos(_a), 14); }
    }
    this.captures = this.captures.filter(C => !C.dead);
  }

  // ============================================================ surfing and flight effects
  // the sheet of ice / slab of rock under the surfer, and the path of ice left behind
  surfTick(f, mob, dt) {
    const w = this.w;
    if (!mob.board) {
      mob.board = new THREE.Mesh(mob.el === 'water' ? this.iceSheetGeo : this.slabGeo, mob.el === 'water' ? iceMat : this.rockMat);
      mob.board.castShadow = true; w.scene.add(mob.board); mob.trailT = 0;
    }
    mob.board.position.set(f.pos.x, f.pos.y + (mob.el === 'water' ? 0.03 : -0.12), f.pos.z);
    mob.board.rotation.y = mob.heading;
    mob.trailT -= dt;
    if (mob.trailT <= 0 && mob.speed > 2) {
      mob.trailT = 0.07;
      if (mob.el === 'water') { const m = new THREE.Mesh(this.iceSheetGeo, iceMat); m.position.set(f.pos.x, f.pos.y + 0.02, f.pos.z); m.rotation.y = mob.heading; m.scale.set(0.8, 1, 1.1); w.scene.add(m); this.trails.push({ m, t: 0, life: 2.6 }); }
      else w.fx.debrisBurst(_a.set(f.pos.x, f.pos.y, f.pos.z), 2, 1.5, 0.08, 0x7a6a58, 0.7);
    }
    if (mob.el === 'water' && Math.random() < 0.6) w.fx.splash(_a.set(f.pos.x, f.pos.y + 0.05, f.pos.z), 1);
    if (mob.el === 'earth' && Math.random() < 0.5) w.fx.dust(f.pos, 1, 1.2);
  }
  surfEnd(mob) { if (mob && mob.board) { this.w.scene.remove(mob.board); mob.board = null; } }
  // JUMP while surfing: the element itself launches the bender. Water raises an ice ramp under the feet and leaves
  // an ice platform; earth thrusts a slab up on a pillar that stays as a platform.
  surfLaunch(f, el) {
    const w = this.w;
    if (el === 'water') {
      const m = new THREE.Mesh(this.rampGeo, iceMat); m.position.set(f.pos.x, f.pos.y - 2.4, f.pos.z); m.rotation.y = f.faceYaw; m.scale.set(0.9, 1, 0.9); w.scene.add(m);
      const col = { kind: 'c', x: f.pos.x, z: f.pos.z, r: 0.7, top: f.pos.y + 1.6, walk: true, ice: true, mesh: m };
      w.arena.colliders.push(col);
      this.platforms.push({ m, col, t: 0, life: 5, y0: f.pos.y - 2.4, rise: 2.35, el });
      w.fx.debrisBurst(_a.set(f.pos.x, f.pos.y + 0.3, f.pos.z), 16, 4, 0.08, 0xbfe8ff); w.fx.splash(f.pos, 12); w.audio.splash(1);
    } else {
      this.B.raisePillar(f, f.pos.x - Math.sin(f.faceYaw) * 0.2, f.pos.z - Math.cos(f.faceYaw) * 0.2);
    }
  }
  flyTick(f, dt) {
    const w = this.w;
    // the air currents carrying the flier: spirals under the feet and streaks along the path
    if (Math.random() < dt * 30) w.fx.wind(_a.set(f.pos.x + rand(-0.4, 0.4), f.pos.y - 0.1, f.pos.z + rand(-0.4, 0.4)), _b.set(rand(-2, 2), -6, rand(-2, 2)), 0.6, 0.35);
    if (Math.random() < dt * 12) w.fx.wind(_a.set(f.pos.x, f.pos.y + rand(0.3, 1.5), f.pos.z), _b.set(-f.vel.x * 0.6, 0, -f.vel.z * 0.6), 0.5, 0.3);
  }
  // a water-launched bender rides a column of water rising from the ground to the feet (alt < 0 hides it)
  selfColumn(f, alt) {
    if (alt < 0) { if (f._col) { this.freeTube(f._col); f._col = null; } return; }
    if (!f._col) f._col = this.tube();
    const gy = f.groundY, pts = []; for (let k = 0; k <= 8; k++) { const s = k / 8; pts.push(new THREE.Vector3(f.pos.x + Math.sin(s * 5 + f.time * 12) * 0.12 * s, f.pos.y - 0.05 - (f.pos.y - gy) * s, f.pos.z + Math.cos(s * 5 + f.time * 12) * 0.12 * s)); }
    f._col.set(pts, (s) => 0.22 + 0.3 * s, f.time);
    if (Math.random() < 0.5) this.w.fx.splash(_a.set(f.pos.x, gy + 0.05, f.pos.z), 2);
  }
  updateTrails(dt) {
    for (const T of this.trails) { T.t += dt; if (T.t > T.life) { this.w.scene.remove(T.m); T.dead = true; } else if (T.t > T.life - 0.5) T.m.scale.multiplyScalar(1 - dt * 3); }
    this.trails = this.trails.filter(T => !T.dead);
    for (const P of this.platforms) {
      P.t += dt;
      const k = P.t < 0.15 ? smooth01(P.t / 0.15) : P.t > P.life ? 1 - smooth01((P.t - P.life) / 0.4) : 1;
      P.m.position.y = P.y0 + k * P.rise; P.col.top = P.m.position.y + 2.4;
      // fire melts ice platforms, rock projectiles break them
      if (P.el === 'water' && P.t < P.life) for (const o of this.B.objs) if (o.state === 'flying' && (o.el === 'fire' || o.el === 'earth') && Math.hypot(o.pos.x - P.col.x, o.pos.z - P.col.z) < 1.1 && o.pos.y < P.col.top + 0.3) { P.t = P.life; this.B.kill(o, o.el === 'fire' ? 'steam' : undefined); break; }
      if (P.t > P.life + 0.4) { P.dead = true; this.w.scene.remove(P.m); P.col.dead = true; this.w.arena.colliders = this.w.arena.colliders.filter(c => c !== P.col); }
    }
    this.platforms = this.platforms.filter(P => !P.dead);
  }

  update(dt) {
    this.tubeMat.uniforms.uTime.value += dt;
    this.burst.update(dt);
    this.updateWhips(dt); this.updateWaves(dt); this.updateColumns(dt); this.updateErupts(dt); this.updateFireRings(dt); this.updateCaptures(dt); this.updateTrails(dt);
  }
  clear() {
    for (const W of this.whips) this.dropWhip(W);
    this.burst.clear();
    for (const V of this.waves) this.w.scene.remove(V.mesh);
    for (const C of this.columns) { this.w.scene.remove(C.mark); this.freeTube(C.tube); }
    for (const E of this.erupts) { this.w.scene.remove(E.mark); for (const s of E.spikes) this.w.scene.remove(s.m); }
    for (const R of this.fireRings) this.w.scene.remove(R.mesh);
    for (const C of this.captures) { this.freeTube(C.tube); if (C.t) C.t.captured = null; }
    for (const T of this.trails) this.w.scene.remove(T.m);
    for (const P of this.platforms) { this.w.scene.remove(P.m); P.col.dead = true; }
    this.w.arena.colliders = this.w.arena.colliders.filter(c => !this.platforms.some(P => P.col === c));
    this.whips = []; this.waves = []; this.columns = []; this.erupts = []; this.fireRings = []; this.captures = []; this.trails = []; this.platforms = [];
  }
}
