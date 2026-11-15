// Stylised element effects matching the reference footage:
//   FlameBlobs  - opaque, cel-shaded puffs that swell, then cool from yellow through orange and red to smoke
//                 (the references' fire is solid toon "blobs", not additive glow)
//   WaterChunks - faceted light-blue cel-shaded chunks with gravity (spray, splashes, whips, streams)
//   Ribbons     - camera-facing tapered ribbon trails; Streaks are self-moving helical ribbons used for wind
// Everything is instanced or pooled so the cost stays flat on a phone.
import * as THREE from 'three';
import { TOON_RAMP } from './hero.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

const FIRE_RAMP = [[0, 0xfff4b0], [0.18, 0xffd84a], [0.42, 0xffa62b], [0.65, 0xf0601c], [0.85, 0x8a2c12], [1, 0x3e3330]].map(([k, h]) => [k, new THREE.Color(h)]);
function ramp(k) {
  for (let i = 1; i < FIRE_RAMP.length; i++) if (k <= FIRE_RAMP[i][0]) { const [a, ca] = FIRE_RAMP[i - 1], [b, cb] = FIRE_RAMP[i]; return _c.copy(ca).lerp(cb, (k - a) / (b - a)); }
  return _c.copy(FIRE_RAMP[FIRE_RAMP.length - 1][1]);
}

export class FlameBlobs {
  constructor(scene, max = 480) {
    this.max = max; this.items = [];
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: TOON_RAMP, emissive: 0x6a3000 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    scene.add(this.mesh);
  }
  spawn(pos, vel, r, life) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: pos.clone(), v: vel.clone(), r: r * rand(0.75, 1.25), life, max: life, sx: rand(0.85, 1.15), sy: rand(0.85, 1.25) });
  }
  update(dt) {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) { const b = it[i]; b.life -= dt; if (b.life <= 0) { it.splice(i, 1); continue; } b.v.y += 2.2 * dt; b.v.multiplyScalar(Math.exp(-1.8 * dt)); b.p.addScaledVector(b.v, dt); }
    for (let i = 0; i < it.length; i++) {
      const b = it[i], k = 1 - b.life / b.max;
      const grow = Math.min(1, k * 5) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 * 0.85 : 1);
      const r = b.r * (0.45 + 0.75 * grow) * (1 + k * 0.4);
      _m.compose(b.p, _q.identity(), _s.set(r * b.sx, r * b.sy, r * b.sx));
      this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, ramp(k));
    }
    this.mesh.count = it.length;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class WaterChunks {
  constructor(scene, max = 360) {
    this.max = max; this.items = [];
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: TOON_RAMP, transparent: true, opacity: 0.9, emissive: 0x0b2a45 });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    scene.add(this.mesh);
  }
  spawn(pos, vel, r, life, grav = 9, color = 0x7cc4f4) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: pos.clone(), v: vel.clone(), r: r * rand(0.6, 1.3), life, max: life, grav, rot: new THREE.Euler(rand(0, 6), rand(0, 6), 0), w: rand(-8, 8), col: new THREE.Color(color).offsetHSL(0, 0, rand(-0.05, 0.12)) });
  }
  update(dt, groundAt) {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const d = it[i]; d.life -= dt; if (d.life <= 0) { it.splice(i, 1); continue; }
      d.v.y -= d.grav * dt; d.p.addScaledVector(d.v, dt); d.rot.x += d.w * dt; d.rot.y += d.w * 0.7 * dt;
      if (groundAt && d.v.y < 0) { const g = groundAt(d.p.x, d.p.z, d.p.y); if (d.p.y < g + 0.03) { d.p.y = g + 0.03; d.v.set(d.v.x * 0.3, 0, d.v.z * 0.3); d.life = Math.min(d.life, 0.25); } }
    }
    for (let i = 0; i < it.length; i++) {
      const d = it[i], k = 1 - d.life / d.max, r = d.r * Math.min(1, (1 - k) * 2.5) * Math.min(1, k * 8 + 0.3);
      _m.compose(d.p, _q.setFromEuler(d.rot), _s.set(r, r * 0.85, r));
      this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, d.col);
    }
    this.mesh.count = it.length;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Pooled camera-facing ribbons, all drawn from ONE merged mesh (one draw call for every ribbon on screen).
// A ribbon keeps its recent head positions and fades its tail; Streaks are self-moving helical ribbons (wind).
const SEG = 16;
export class Ribbons {
  constructor(scene, camera, max = 140) {
    this.camera = camera; this.max = max; this.streaks = [];
    const nv = max * SEG * 2, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < max; r++) for (let i = 0; i < SEG - 1; i++) { const a = (r * SEG + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
    this.list = []; for (let i = 0; i < max; i++) this.list.push({ pts: [], free: true, active: false, lastPush: 0 });
  }
  // returns a handle: push(pos) each frame while alive, release() when done
  start({ color = 0xffffff, width = 0.12, life = 0.28, alpha = 0.85 } = {}) {
    let r = this.list.find(x => x.free);
    if (!r) r = this.list.reduce((a, b) => (a.lastPush < b.lastPush ? a : b));
    Object.assign(r, { free: false, active: true, color: new THREE.Color(color), width, life, alpha, lastPush: performance.now() }); r.pts.length = 0;
    return { push: (p) => { r.pts.unshift({ p: p.clone(), t: 0 }); if (r.pts.length > SEG) r.pts.length = SEG; r.lastPush = performance.now(); }, release: () => { r.active = false; } };
  }
  // a self-driving helical streak: moves from `pos` with `vel`, spiralling with `radius`, for `life` seconds
  streak(pos, vel, { radius = 0.3, spin = 14, life = 0.45, width = 0.08, color = 0xffffff, alpha = 0.8 } = {}) {
    const h = this.start({ color, width, life: 0.22, alpha });
    const dir = vel.clone().normalize(); const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); const w = new THREE.Vector3().crossVectors(dir, u);
    this.streaks.push({ h, c: pos.clone(), vel: vel.clone(), u, w, radius, spin, a: Math.random() * 6.28, life, max: life });
    return h;
  }
  update(dt) {
    for (const s of this.streaks) {
      s.life -= dt; s.c.addScaledVector(s.vel, dt); s.a += s.spin * dt;
      const k = 1 - s.life / s.max, rad = s.radius * (0.4 + k);
      _v.copy(s.c).addScaledVector(s.u, Math.cos(s.a) * rad).addScaledVector(s.w, Math.sin(s.a) * rad);
      if (s.life > 0) s.h.push(_v); else s.h.release();
    }
    this.streaks = this.streaks.filter(s => s.life > 0);
    const cam = this.camera.position, pos = this.mesh.geometry.attributes.position, col = this.mesh.geometry.attributes.color;
    for (let ri = 0; ri < this.max; ri++) {
      const r = this.list[ri], base = ri * SEG * 2;
      if (!r.free) { for (const p of r.pts) p.t += dt; while (r.pts.length && r.pts[r.pts.length - 1].t > r.life) r.pts.pop(); if (!r.active && r.pts.length < 2) r.free = true; }
      const n = r.free ? 0 : r.pts.length;
      for (let i = 0; i < SEG; i++) {
        const v = base + i * 2;
        if (n < 2) { pos.setXYZ(v, 0, -50, 0); pos.setXYZ(v + 1, 0, -50, 0); col.setW(v, 0); col.setW(v + 1, 0); continue; }
        const j = Math.min(i, n - 1), p = r.pts[j].p, q = r.pts[Math.min(j + 1, n - 1)].p, p0 = r.pts[Math.max(j - 1, 0)].p;
        _v.subVectors(p0, q); if (_v.lengthSq() < 1e-8) _v.set(0, 1, 0);
        _w.subVectors(cam, p); _w.crossVectors(_v, _w).normalize();
        const fade = Math.max(0, 1 - r.pts[j].t / r.life) * (i < n ? 1 : 0);
        const wd = r.width * Math.sin(Math.min(1, (j + 0.5) / Math.max(1, n - 0.5)) * Math.PI) * (0.4 + 0.6 * fade);
        pos.setXYZ(v, p.x + _w.x * wd, p.y + _w.y * wd, p.z + _w.z * wd);
        pos.setXYZ(v + 1, p.x - _w.x * wd, p.y - _w.y * wd, p.z - _w.z * wd);
        const a = r.alpha * fade * (1 - (j / SEG) * 0.6);
        col.setXYZW(v, r.color.r, r.color.g, r.color.b, a); col.setXYZW(v + 1, r.color.r, r.color.g, r.color.b, a);
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }
}
