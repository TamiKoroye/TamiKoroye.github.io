// Pooled visual effects: rock debris, dust clouds, shockwave rings, craters, hit sparks.
import * as THREE from 'three';
import { rand } from './util.js';
import { FlameBlobs, WaterChunks, Ribbons } from './fxstyle.js';
import { FlipFX } from './flipfx.js';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function craterTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(20,14,12,0.85)'); g.addColorStop(0.55, 'rgba(40,30,25,0.55)'); g.addColorStop(0.8, 'rgba(60,45,35,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(15,10,8,0.6)'; x.lineWidth = 2;
  for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28; x.beginPath(); x.moveTo(64 + Math.cos(a) * 20, 64 + Math.sin(a) * 20); x.lineTo(64 + Math.cos(a + 0.2) * 55, 64 + Math.sin(a + 0.2) * 55); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    // stylised element primitives (toon fire blobs, faceted water chunks, wind ribbons)
    this.flames = new FlameBlobs(scene); this.water = new WaterChunks(scene); this.ribbons = new Ribbons(scene, camera);
    this.flip = new FlipFX(scene);   // flipbook sheets: EmberGen fire and explosion, KanaWorks water and ice
    // --- debris (instanced chunks)
    this.debrisMax = 320;
    const dg = new THREE.DodecahedronGeometry(1, 0);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    this.debris = new THREE.InstancedMesh(dg, this.debrisMat, this.debrisMax);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.castShadow = true; this.debris.frustumCulled = false;
    this.debris.count = 0;
    this.dItems = [];
    const c = new THREE.Color(0x666066);
    for (let i = 0; i < this.debrisMax; i++) this.debris.setColorAt(i, c);
    scene.add(this.debris);

    // --- dust / spark sprites
    this.soft = softTexture();
    this.sprites = [];
    for (let i = 0; i < 260; i++) {
      const m = new THREE.SpriteMaterial({ map: this.soft, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      this.sprites.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, base: 1, alpha: 1 });
    }
    // --- rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.75, 1, 40); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; scene.add(m); this.rings.push({ m, life: 0, max: 1, size: 1 });
    }
    // --- craters
    this.craterTex = craterTexture();
    this.craters = [];
    const cg = new THREE.PlaneGeometry(1, 1); cg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ map: this.craterTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false; m.renderOrder = 1; scene.add(m); this.craters.push({ m, life: 0 });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3();
    this._col = new THREE.Color();
  }

  debrisBurst(pos, n, speed, size = 0.12, color = 0x6a6670, up = 1) {
    for (let i = 0; i < n; i++) {
      if (this.dItems.length >= this.debrisMax) this.dItems.shift();
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.dItems.push({
        p: pos.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(0, 0.2), rand(-0.2, 0.2))),
        v: new THREE.Vector3(Math.cos(a) * s, (2 + Math.random() * 4) * up, Math.sin(a) * s),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: rand(-12, 12),
        size: size * (0.5 + Math.random()), life: 1.4 + Math.random() * 1.2,
        col: color, shade: 0.75 + Math.random() * 0.4,
      });
    }
  }

  puff(pos, vel, size, life, color, alpha = 0.6, grow = 2.5, additive = false, rise = 0) {
    // ring-buffer allocation: O(1) and recycles the oldest sprite when the pool is saturated
    this._ix = ((this._ix || 0) + 1) % this.sprites.length;
    const sp = this.sprites[this._ix];
    sp.s.position.copy(pos); sp.vel.copy(vel); sp.base = size; sp.grow = grow; sp.life = sp.max = life; sp.alpha = alpha; sp.rise = rise;
    sp.s.material.color.setHex(color); sp.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending; sp.s.visible = true;
    return sp;
  }
  // element particles
  // fire: solid cel-shaded flame blobs
  // every flame in the game is now a sprite of the EmberGen fire sheet (the old low-poly flame blobs are retired)
  fire(pos, vel, size = 0.45, life = 0.35) { this.flip.spawn('fire_flames', { pos, vel, size: [size * 1.5, size * 1.8], grow: 1.8, life: life * 1.1, f0: 10 + rand(0, 8), f1: 34, rise: 2, drag: 1.5, fadeIn: 0.02, rot: rand(-0.6, 0.6) }); return { alpha: 1 }; }
  smoke(pos, size = 0.5) { return this.puff(pos, new THREE.Vector3(rand(-0.3, 0.3), 1.2, rand(-0.3, 0.3)), size, 0.9, 0x55504c, 0.35, 2.2); }
  steam(pos, n = 8) { for (let i = 0; i < n; i++) this.puff(pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.3), rand(-0.3, 0.3))), new THREE.Vector3(rand(-1, 1), rand(1.5, 3), rand(-1, 1)), 0.5, 0.9, 0xe8eef2, 0.55, 2.5); }
  // water: faceted light-blue chunks with gravity
  // Water throws no droplets (whips, balls and streams are the water); kept as a no-op so callers need no change
  splash() {}
  splashDrops(pos, n = 10, color = 0x7cc4f4) { for (let i = 0; i < n; i++) { const v = new THREE.Vector3(rand(-1, 1), rand(0.6, 2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5)); this.water.spawn(pos, v, 0.09, 0.6, 9, color); } }
  // air: curving white / lavender ribbon streaks
  wind(pos, vel, size = 0.5, life = 0.4) { this.ribbons.streak(pos, vel.lengthSq() > 0.01 ? vel : new THREE.Vector3(0, 1, 0), { radius: size * 0.45, life, width: 0.035 + size * 0.04, color: Math.random() < 0.3 ? 0xd8ccff : 0xffffff, alpha: 0.75 }); return { alpha: 1 }; }
  dust(pos, n = 8, spread = 2, color = 0xb5a48e) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      this.puff(new THREE.Vector3(pos.x + Math.cos(a) * 0.3, pos.y + 0.15, pos.z + Math.sin(a) * 0.3),
        new THREE.Vector3(Math.cos(a) * spread, 0.4 + Math.random() * 0.6, Math.sin(a) * spread), 0.6 + Math.random() * 0.4, 0.7 + Math.random() * 0.4, color, 0.5);
    }
  }
  spark(pos, color = 0xffd27a, n = 6) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7));
      const sp = this.puff(pos, v, 0.25, 0.25, color, 1, 0.3);
      sp.s.material.blending = THREE.AdditiveBlending;
    }
    const f = this.puff(pos, new THREE.Vector3(), 1.2, 0.12, 0xffffff, 0.9, 1.2);
    f.s.material.blending = THREE.AdditiveBlending;
  }
  ring(pos, size, color = 0xffffff, life = 0.45) {
    let r = this.rings.find(x => x.life <= 0) || this.rings[0];
    r.m.position.set(pos.x, pos.y + 0.05, pos.z); r.size = size; r.life = r.max = life; r.m.visible = true;
    r.m.material.color.setHex(color);
  }
  crater(pos, size) {
    let c = this.craters.find(x => x.life <= 0);
    if (!c) c = this.craters.reduce((a, b) => (a.life < b.life ? a : b));
    c.m.position.set(pos.x, pos.y + 0.012, pos.z); c.m.scale.set(size, 1, size); c.m.rotation.y = Math.random() * 6;
    c.life = 9; c.m.visible = true;
  }

  update(dt, groundAt) {
    this.flames.update(dt); this.water.update(dt, groundAt); this.ribbons.update(dt); this.flip.update(dt);
    // debris
    const items = this.dItems;
    for (let i = items.length - 1; i >= 0; i--) {
      const d = items[i];
      d.life -= dt;
      if (d.life <= 0) { items.splice(i, 1); continue; }
      d.v.y -= 18 * dt;
      d.p.addScaledVector(d.v, dt);
      const g = groundAt ? groundAt(d.p.x, d.p.z, d.p.y) : 0;
      if (d.p.y < g + d.size * 0.5) { d.p.y = g + d.size * 0.5; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w *= 0.6; }
      d.r.x += d.w * dt; d.r.y += d.w * 0.7 * dt;
    }
    const n = items.length;
    for (let i = 0; i < n; i++) {
      const d = items[i];
      const s = d.size * Math.min(1, d.life * 2);
      this._q.setFromEuler(d.r); this._s.set(s, s * 0.8, s);
      this._m.compose(d.p, this._q, this._s);
      this.debris.setMatrixAt(i, this._m);
      this.debris.setColorAt(i, this._col.setHex(d.col).multiplyScalar(d.shade));
    }
    this.debris.count = n;
    this.debris.instanceMatrix.needsUpdate = true;
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
    // sprites
    for (const sp of this.sprites) {
      if (sp.life <= 0) continue;
      sp.life -= dt;
      if (sp.life <= 0) { sp.s.visible = false; continue; }
      const k = 1 - sp.life / sp.max;
      sp.s.position.addScaledVector(sp.vel, dt); if (sp.rise) sp.vel.y += sp.rise * dt;
      sp.vel.multiplyScalar(Math.exp(-2.5 * dt));
      const sc = sp.base * (1 + k * sp.grow);
      sp.s.scale.set(sc, sc, 1);
      sp.s.material.opacity = sp.alpha * (1 - k) * Math.min(1, k * 8 + 0.3);
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.life / r.max;
      const s = r.size * (0.3 + k);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = 0.8 * (1 - k);
    }
    for (const c of this.craters) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.m.material.opacity = Math.min(1, c.life / 2) * 0.85;
      if (c.life <= 0) c.m.visible = false;
    }
  }
}
