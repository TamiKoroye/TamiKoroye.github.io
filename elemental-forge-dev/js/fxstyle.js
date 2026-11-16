// Stylised element effects matching the reference footage:
//   FlameBlobs  - pointed, flickering flame tongues (shader-eroded tips) cooling from yellow through orange
//                 and red to smoke; opaque cut-out so large attacks stay readable
//   WaterChunks - faceted light-blue cel-shaded chunks with gravity (spray, splashes, whips, streams)
//   Ribbons     - camera-facing tapered ribbon trails; Streaks are self-moving helical ribbons used for wind
// Everything is instanced or pooled so the cost stays flat on a phone.
import * as THREE from 'three';
import { TOON_RAMP } from './hero.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3();


// Flame tongues: pointed, flickering flames instead of round blobs. Each instance is a teardrop that tapers to a
// tip; the tip sways and splits (noise erosion), the colour runs from a pale yellow core through orange to red at
// the edges and darkens into smoke as the flame dies. Flames trail away from their direction of travel and rise.
// Opaque cut-out rendering keeps large attacks readable instead of washing out to white.
const flameVS = /* glsl */`
  attribute float aLife; attribute float aSeed;
  uniform float uTime;
  varying float vY; varying float vLife; varying float vSeed; varying vec2 vUv; varying float vR;
  void main() {
    vec3 p = position;
    float y = clamp(p.y, 0.0, 1.0);
    // sway grows towards the tip; two frequencies so neighbouring flames never move in step
    float sway = sin(uTime * 17.0 + aSeed * 31.0 + y * 5.0) * 0.16 + sin(uTime * 29.0 + aSeed * 7.0 + y * 9.0) * 0.07;
    p.x += sway * y * y; p.z += cos(uTime * 13.0 + aSeed * 11.0 + y * 4.0) * 0.1 * y * y;
    p.y *= 1.0 + sin(uTime * 23.0 + aSeed * 5.0) * 0.12;
    vY = y; vLife = aLife; vSeed = aSeed; vUv = uv; vR = length(position.xz);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }`;
const flameFS = /* glsl */`
  uniform float uTime;
  varying float vY; varying float vLife; varying float vSeed; varying vec2 vUv; varying float vR;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    // erosion: noise scrolling up the flame eats into the tip and the edges, more as the flame ages
    float n = noise(vec2(vUv.x * 7.0 + vSeed * 13.0, vY * 4.0 - uTime * 5.0 + vSeed * 3.0));
    float cut = vY * 0.75 + vLife * 0.55;
    if (n < cut - 0.35) discard;
    // heat: hottest at the base core, cooling towards the tip and over the flame's life
    float heat = (1.0 - vY * 0.85) * (1.0 - vLife * 0.8) + (n - 0.5) * 0.25;
    vec3 col = heat > 0.78 ? vec3(1.0, 0.95, 0.72) : heat > 0.55 ? vec3(1.0, 0.8, 0.22) : heat > 0.33 ? vec3(1.0, 0.5, 0.1) : heat > 0.15 ? vec3(0.86, 0.22, 0.07) : vec3(0.32, 0.26, 0.25);
    gl_FragColor = vec4(col, 1.0);
  }`;
function flameGeometry() {
  // teardrop profile: rounded base, widest a little above it, long taper to a point
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, y = t * 1.25 - 0.22;
    const r = t < 0.22 ? Math.sin((t / 0.22) * Math.PI / 2) * 0.42 : 0.42 * Math.pow(1 - (t - 0.22) / 0.78, 1.35);
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const g = new THREE.LatheGeometry(pts, 10);
  g.computeVertexNormals();
  return g;
}
export class FlameBlobs {
  constructor(scene, max = 560) {
    this.max = max; this.items = [];
    this.mat = new THREE.ShaderMaterial({ vertexShader: flameVS, fragmentShader: flameFS, uniforms: { uTime: { value: 0 } }, side: THREE.DoubleSide });
    const g = flameGeometry();
    this.aLife = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); this.aLife.setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); this.aSeed.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLife', this.aLife); g.setAttribute('aSeed', this.aSeed);
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.t = 0;
  }
  spawn(pos, vel, r, life) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: pos.clone(), v: vel.clone(), r: r * rand(0.8, 1.3), life, max: life, seed: Math.random(), stretch: rand(1.1, 1.7) });
  }
  update(dt) {
    this.t += dt; this.mat.uniforms.uTime.value = this.t;
    const it = this.items, up = _w.set(0, 1, 0);
    for (let i = it.length - 1; i >= 0; i--) { const b = it[i]; b.life -= dt; if (b.life <= 0) { it.splice(i, 1); continue; } b.v.y += 2.6 * dt; b.v.multiplyScalar(Math.exp(-2.0 * dt)); b.p.addScaledVector(b.v, dt); }
    for (let i = 0; i < it.length; i++) {
      const b = it[i], k = 1 - b.life / b.max;
      // flames lean away from their motion and rise
      _v.copy(b.v).multiplyScalar(-0.22).add(up).normalize();
      _q.setFromUnitVectors(up, _v);
      const grow = Math.min(1, k * 6) * (1 - k * 0.45);
      const r = b.r * (0.6 + 0.7 * grow);
      _m.compose(b.p, _q, _s.set(r, r * b.stretch * (1 + Math.min(1, b.v.length() * 0.04)), r));
      this.mesh.setMatrixAt(i, _m); this.aLife.array[i] = k; this.aSeed.array[i] = b.seed;
    }
    this.mesh.count = it.length;
    this.mesh.instanceMatrix.needsUpdate = true; this.aLife.needsUpdate = true; this.aSeed.needsUpdate = true;
  }
}

const _up = new THREE.Vector3(0, 1, 0), _dv = new THREE.Vector3();
export class WaterChunks {
  constructor(scene, max = 360) {
    this.max = max; this.items = [];
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: TOON_RAMP, transparent: true, opacity: 0.9, emissive: 0x0b2a45 });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, max);   // rounded drops
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    scene.add(this.mesh);
  }
  spawn(pos, vel, r, life, grav = 9, color = 0x7cc4f4) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: pos.clone(), v: vel.clone(), r: r * rand(0.45, 0.95), life, max: life, grav, rot: new THREE.Euler(rand(0, 6), rand(0, 6), 0), w: rand(-8, 8), col: new THREE.Color(color).offsetHSL(0, 0, rand(-0.05, 0.12)) });
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
      // a drop is drawn out along its flight (a falling stream of water, not a tumbling block)
      const sp = d.v.length();
      if (sp > 0.5) _q.setFromUnitVectors(_up, _dv.copy(d.v).divideScalar(sp)); else _q.setFromEuler(d.rot);
      _m.compose(d.p, _q, _s.set(r * 0.8, r * Math.min(3, 1 + sp * 0.18), r * 0.8));
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
