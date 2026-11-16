// Unified bending system for all four elements.
//   controlled objects  : rocks / flame orbs / water globes / vortices orbiting their bender (sustained control)
//   projectiles         : the same objects (or new ones) in flight, each element with its own physics
//   sustained techniques: fire stream, water draw + whip, wind push, boulder lift (while HAND is held)
//   defences            : earth wall, fire wall, water shield, air deflection (real collision + rules)
//   environment         : burning ground, stone pillars (walkable), seismic spikes, loose stones, water sources
//   interactions        : reusable rules for projectile-vs-projectile and projectile-vs-defence by element
import * as THREE from 'three';
import { jaggedRockGeometry, HALF } from './arena.js';
import { clamp, mulberry32, smooth01, rand } from './util.js';
import { TOON_RAMP } from './hero.js';
import { makeWaterWall, makeWaterRing, makeIceWall, makeWaterTube, waterMaterial, iceMat } from './defence-fx.js';
import { Weapons } from './weapons.js';
import { Specials } from './specials.js';

const SPEC = {
  rock:     { el: 'earth', r: 0.36, speed: 30, grav: 6,  dmg: 12, knock: 6.5, level: 1, life: 4 },
  rockKick: { el: 'earth', r: 0.36, speed: 37, grav: 5,  dmg: 15, knock: 8,   level: 1, life: 4 },
  boulder:  { el: 'earth', r: 0.48, speed: 28, grav: 6,  dmg: 17, knock: 9,   level: 2, life: 4 },
  pebble:   { el: 'earth', r: 0.2,  speed: 28, grav: 5,  dmg: 5,  knock: 3,   level: 0, life: 2 },
  fireball: { el: 'fire',  r: 0.28, speed: 34, grav: 0,  dmg: 7,  knock: 2.5, level: 0, life: 1.1 },
  fireOrb:  { el: 'fire',  r: 0.36, speed: 30, grav: 0,  dmg: 11, knock: 4,   level: 1, life: 1.5 },
  fireArc:  { el: 'fire',  r: 0.8,  speed: 24, grav: 0,  dmg: 9,  knock: 5,   level: 1, life: 0.7, wide: true },
  water:    { el: 'water', r: 0.34, speed: 26, grav: 4,  dmg: 7,  knock: 7,   level: 1, life: 2 },
  droplet:  { el: 'water', r: 0.22, speed: 28, grav: 3,  dmg: 4,  knock: 4,   level: 0, life: 1.4 },
  waterArc: { el: 'water', r: 0.9,  speed: 20, grav: 0,  dmg: 9,  knock: 8,   level: 1, life: 0.8, wide: true },
  sphere:   { el: 'water', r: 0.5,  speed: 19, grav: 2,  dmg: 4,  knock: 1,   level: 0, life: 2, restrain: 1.4 },
  gust:     { el: 'air',   r: 0.5,  speed: 40, grav: 0,  dmg: 4,  knock: 11,  level: 1, life: 0.55 },
  blade:    { el: 'air',   r: 0.85, speed: 32, grav: 0,  dmg: 7,  knock: 8,   level: 1, life: 0.6, wide: true },
  vortex:   { el: 'air',   r: 1.5,  speed: 13, grav: 0,  dmg: 12, knock: 3,   level: 2, life: 1.7, pull: true },
  orbVortex:{ el: 'air',   r: 0.45, speed: 30, grav: 0,  dmg: 8,  knock: 9,   level: 1, life: 0.9 },
  iceSpear: { el: 'water', r: 0.24, speed: 38, grav: 1,  dmg: 11, knock: 7,   level: 1, life: 1.3, ice: true },
  waterLance:{ el: 'water', r: 0.3, speed: 34, grav: 0,  dmg: 9,  knock: 8,   level: 1, life: 0.7 },
};
const MAX_HELD = 3;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function distPointSeg(p, a, b) {
  _v.subVectors(b, a); const l2 = _v.lengthSq();
  const t = l2 > 0 ? clamp(_v2.subVectors(p, a).dot(_v) / l2, 0, 1) : 0;
  return p.distanceTo(_v3.copy(a).addScaledVector(_v, t));
}

export class Bending {
  constructor(world) {
    this.world = world;
    this.objs = [];      // controlled objects and projectiles
    this.defs = [];      // defences
    this.burns = [];     // burning ground patches
    this.rings = [];     // expanding area attacks (spin fire, tidal sweep, cyclone)
    this.spikes = [];    // seismic spikes
    this.pillars = [];   // raised stone platforms
    this.spirals = [];   // water SPECIAL: streams circulating around the bender
    this.iceShard = (() => { const g = new THREE.OctahedronGeometry(0.5, 0); g.scale(0.7, 2.2, 0.6); g.translate(0, 0.55, 0); return g; })();
    this.holds = new Map(); // fighter -> sustained technique state
    const rng = mulberry32(99);
    this.rockGeos = [0, 1, 2, 3, 4].map(() => jaggedRockGeometry(rng, 1, 0.3, 0.9));
    // cel-shaded materials (the references draw every element as solid toon shapes, not additive glow)
    const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, ...o });
    this.mat = {
      rock: toon({ color: 0x8c8782 }),
      fireCore: toon({ color: 0xffd23f, emissive: 0x8a4a00 }),
      fireArc: toon({ color: 0xffa02a, emissive: 0x8a3a00, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
      water: toon({ color: 0x6fbaf2, emissive: 0x0d3050, transparent: true, opacity: 0.88 }),
      waterArc: toon({ color: 0x8fcaf5, emissive: 0x0d3050, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      air: new THREE.MeshBasicMaterial({ color: 0xf4f6ff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
      stream: new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.0, depthWrite: false }),
      streamCore: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.0, depthWrite: false }),
      windCone: new THREE.MeshBasicMaterial({ color: 0xeaf2ff, transparent: true, opacity: 0.0, depthWrite: false }),
      shieldWater: toon({ color: 0x7cc0f2, emissive: 0x0b2440, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
      stone: toon({ color: 0x8a7b6b }),
      bubble: toon({ color: 0x7cc0f2, transparent: true, opacity: 0.45, depthWrite: false }),
    };
    this.geo = {
      sphere: new THREE.SphereGeometry(1, 14, 10),
      sphereHi: new THREE.IcosahedronGeometry(1, 1),     // faceted, like the references' water
      ring: new THREE.TorusGeometry(1, 0.06, 6, 28),
      crescent: new THREE.TorusGeometry(1, 0.13, 6, 22, Math.PI * 0.95),
      flatRing: (() => { const g = new THREE.RingGeometry(0.85, 1, 48); g.rotateX(-Math.PI / 2); return g; })(),
      // unit-length open cone along +y from a narrow base (at y = 0) to a wide end (at y = 1)
      cone: (() => { const g = new THREE.CylinderGeometry(1, 0.12, 1, 18, 4, true); g.translate(0, 0.5, 0); return g; })(),
    };
    this.wallGeo = (() => {
      const g = new THREE.BoxGeometry(1.9, 2.0, 0.45, 5, 5, 2);
      const p = g.attributes.position, seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
        let d = seen.get(key); if (!d) { d = [(rng() - 0.5) * 0.14, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.18]; seen.set(key, d); }
        const taper = y > 0.9 ? 0.85 : 1;
        p.setXYZ(i, x * taper + d[0], y + d[1] + (y > 0.9 ? (rng() - 0.5) * 0.25 : 0), z + d[2]);
      }
      g.translate(0, 1.0, 0); g.computeVertexNormals(); return g;
    })();
    this.pillarGeo = (() => { const g = jaggedRockGeometry(rng, 1, 0.14, 1); g.translate(0, 0.35, 0); return g; })();
    this.light = new THREE.PointLight(0xff8a3a, 0, 9, 1.6); world.scene.add(this.light);
    this.waterSurf = waterMaterial(-2.2); this.waterSurf.uniforms.uRise.value = 1; this.waterSurf.uniforms.uWobble.value = 0.6;
    this.waterLight = 0;
    this.weapons = new Weapons(this);
    this.specials = new Specials(this);
    this.iceSpearGeo = (() => { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.22, 1.1, 0.22); return g; })();
  }

  // ================================================================== helpers
  held(f, el) { let n = 0; for (const o of this.objs) if (o.owner === f && o.state !== 'flying' && o.state !== 'dead' && o.el === (el || f.el)) n++; return n; }
  heldList(f, el) { return this.objs.filter(o => o.owner === f && (o.state === 'orbit' || o.state === 'rising' || o.state === 'drawing') && o.el === (el || f.el)); }
  aimDir(f, from, out = new THREE.Vector3()) {
    const t = f.input.aimPoint;
    out.subVectors(t, from); if (out.lengthSq() < 0.01) f.forward(out); return out.normalize();
  }
  forwardPoint(f, d, h = 1.3, out = new THREE.Vector3()) { const fw = f.forward(_v2); return out.set(f.pos.x + fw.x * d, f.pos.y + h, f.pos.z + fw.z * d); }
  // which whip the current arm clip throws (whip_h / whip_v / whip_d and their mirrors)
  whipKind(f) { const c = f.tech && f.tech.clip || ''; return c.startsWith('whip_v') ? 'v' : c.startsWith('whip_d') ? 'd' : 'h'; }
  whipRelease(f, el) {
    const W = f.whipW;
    if (W && !W.dead && W.tech === f.tech && W.f === f) { this.weapons.releaseWhip(W); return; }
    // no rope out yet (the technique started without energy for it, or was entered mid-way): thrown from the hand now
    const s = f.techSide || 1; f.whipW = this.weapons.whipStrike(f, el, this.whipKind(f), { hand: s > 0 ? 'R' : 'L', tech: f.tech, released: true, dmg: 7, knock: el === 'air' ? 10 : 7, level: 1 });
  }
  handPoint(f, side, out = new THREE.Vector3()) { return f.handPos(side > 0 ? 'L' : 'R', out); }
  footPoint(f, side, out = new THREE.Vector3()) { return f.footPos(side > 0 ? 'L' : 'R', out); }

  makeMesh(kind, scale) {
    const S = SPEC[kind], el = S.el;
    let m;
    if (el === 'earth') { m = new THREE.Mesh(this.rockGeos[Math.floor(Math.random() * 5)], this.mat.rock); m.scale.setScalar(S.r * 1.15); m.castShadow = true; }
    else if (el === 'fire') {
      if (S.wide) { m = new THREE.Mesh(this.geo.crescent, this.mat.fireArc); m.scale.set(S.r, S.r, S.r * 1.6); }
      else { m = new THREE.Mesh(this.geo.sphere, this.mat.fireCore); m.scale.setScalar(S.r * 0.6); m.visible = false; }   // the flame tongues are the fireball
    } else if (S.ice) { m = new THREE.Mesh(this.iceSpearGeo, iceMat); m.castShadow = true; }
    else if (el === 'water') {
      if (S.wide) { m = new THREE.Mesh(this.geo.crescent, this.mat.waterArc); m.scale.set(S.r, S.r, S.r * 2); }
      else { m = new THREE.Mesh(this.geo.sphereHi, this.mat.water); m.scale.setScalar(S.r); m.castShadow = true; }
    } else {
      m = new THREE.Group();
      const n = S.wide ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const r = new THREE.Mesh(S.wide ? this.geo.crescent : this.geo.ring, this.mat.air);
        r.rotation.x = Math.PI / 2; r.position.y = (i - 1) * S.r * 0.35; r.scale.setScalar(S.r * (1 - Math.abs(i - 1) * 0.3)); m.add(r);
      }
    }
    if (scale) m.scale.multiplyScalar(scale);
    this.world.scene.add(m);
    return m;
  }

  spawn(kind, owner, pos, state = 'flying', extra = {}) {
    const S = SPEC[kind];
    const o = { kind, el: S.el, owner, pos: pos.clone(), vel: new THREE.Vector3(), state, t: 0, life: S.life, r: S.r * (extra.scale || 1),
      dmg: S.dmg, knock: S.knock, level: S.level, mesh: extra.mesh || this.makeMesh(kind, extra.scale), spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
      slot: Math.random() * Math.PI * 2, from: null, src: extra.src || null, dmgMul: 1, hitSet: new Set(), ...extra };
    o.mesh.position.copy(o.pos);
    const R = this.world.fx.ribbons;
    if (o.el === 'water' && !S.wide && !S.ice) { o.tube = makeWaterTube(16, 8); this.world.scene.add(o.tube.mesh); o.hist = []; o.mesh.material = this.waterSurf; }
    if (o.el === 'air') {
      // air is drawn only as curved wind: five ribbons spiralling around the path, no solid shapes
      o.trails = [0, 1, 2, 3, 4].map(i => R.start({ color: i % 2 ? 0xdcd2ff : 0xffffff, width: 0.045 + o.r * 0.07, life: 0.32, alpha: 0.8 }));
      o.mesh.traverse(c => { if (c.isMesh) c.visible = false; });
    }
    this.objs.push(o);
    return o;
  }

  launch(o, f, speedMul = 1, target) {
    const S = SPEC[o.kind];
    o.state = 'flying'; o.t = 0; o.life = S.life;
    // a held object that has drifted inside an obstacle (orbiting through a boulder, say) is thrown from in front of
    // the bender's chest instead, so it is not destroyed on the spot
    const inside = this.world.arena.solidAt(o.pos, o.r * 0.6);
    if (inside) { f.chestPos(o.pos); o.pos.y = Math.max(o.pos.y, (inside.top ?? 0) + o.r * 0.6 + 0.05); }
    const aim = target || f.input.aimPoint;
    const tgt = _a.copy(aim); if (S.grav > 0) tgt.y += o.r * 0.6;
    const speed = S.speed * speedMul;
    o.vel.subVectors(tgt, o.pos);
    const dist = o.vel.length();
    o.vel.normalize().multiplyScalar(speed);
    if (S.grav > 0) o.vel.y += 0.5 * S.grav * (dist / speed);
    if (S.wide) o.vel.y = 0;                      // arcs and blades travel level, a little above the ground
    this.world.audio.whoosh(0.6 + 0.3 * speedMul);
    return o;
  }
  fire(kind, f, from, opts = {}) {
    const o = this.spawn(kind, f, from, 'flying', opts);
    this.launch(o, f, opts.speedMul || 1, opts.target);
    if (opts.dir) { o.vel.copy(opts.dir).multiplyScalar(SPEC[kind].speed * (opts.speedMul || 1)); }
    return o;
  }
  kill(o, how) {
    if (o.state === 'dead') return;
    o.state = 'dead';
    this.world.scene.remove(o.mesh);
    if (o.trails) for (const t of o.trails) t.release();
    if (o.tube) { this.world.scene.remove(o.tube.mesh); o.tube.mesh.geometry.dispose(); o.tube.mesh.material.dispose(); o.tube = null; }
    const fx = this.world.fx, w = this.world;
    if (how === 'silent') return;
    if (o.el === 'earth') { fx.debrisBurst(o.pos, 12, 3.5, 0.1, 0x6e665e); fx.dust(o.pos, 5, 2, 0x9f9282); w.audio.impact(0.6); }
    if (o.el === 'fire') { for (let i = 0; i < 10; i++) fx.fire(o.pos, _v.set(rand(-3, 3), rand(-1, 3), rand(-3, 3)), 0.5, 0.35); fx.smoke(o.pos); w.audio.fireHit(0.6); }
    if (o.el === 'water') { fx.splash(o.pos, 14); w.audio.splash(0.7); this.extinguishNear(o.pos, 1.8); }
    if (o.el === 'air') { for (let i = 0; i < 6; i++) fx.wind(o.pos, _v.set(rand(-4, 4), rand(-1, 2), rand(-4, 4)), 0.6, 0.35); }
    if (how === 'steam') fx.steam(o.pos, 10);
    if (o.src) o.src.respawnT = 18; // loose stone comes back later
  }
  dropAll(f, el) {
    for (const o of this.objs) if (o.owner === f && o.state !== 'flying' && o.state !== 'dead' && (!el || o.el === el)) {
      if (o.el === 'earth') { o.state = 'falling'; o.vel.set(0, 0, 0); } else this.kill(o);
    }
    this.holdEnd(f);
  }

  // ================================================================== technique events
  event(f, name, tech) {
    const w = this.world, s = f.techSide || 1, aim = f.input.aimPoint;
    const hand = this.handPoint(f, -s), foot = this.footPoint(f, s);
    switch (name) {
      // ---------------- earth
      case 'earth.hand': {
        const held = this.heldList(f, 'earth').filter(o => o.state === 'orbit');
        if (held.length) { const o = held[0]; this.launch(o, f, 1.05); w.fx.dust(o.pos, 3, 1); return; }
        // burst a stone from the ground in front and punch it straight out
        const p = this.forwardPoint(f, 1.1, 0); p.y = w.arena.groundAt(p.x, p.z, f.pos.y + 0.3) + 0.9;
        w.fx.debrisBurst(_v.set(p.x, p.y - 0.8, p.z), 8, 2, 0.08, 0x7a7068); w.fx.crater(_v.set(p.x, p.y - 0.9, p.z), 1);
        const o = this.fire('rock', f, p); o.dmg = 9; w.audio.rumble(0.4); return;
      }
      case 'earth.leg': {
        const held = this.heldList(f, 'earth').filter(o => o.state === 'orbit');
        if (held.length) { const o = held[0]; o.kind = o.kind === 'boulder' ? 'boulder' : 'rockKick'; this.launch(o, f, 1.2); w.shake(0.12, o.pos); return; }
        const p = this.forwardPoint(f, 1.2, 0); p.y = w.arena.groundAt(p.x, p.z, f.pos.y + 0.3) + 0.55;
        w.fx.debrisBurst(_v.set(p.x, p.y - 0.5, p.z), 10, 2.4, 0.09, 0x7a7068); w.fx.crater(_v.set(p.x, p.y - 0.55, p.z), 1.2);
        this.fire('rockKick', f, p); w.audio.rumble(0.5); return;
      }
      case 'earth.sweep': {
        const fw = f.forward(_v2), base = Math.atan2(fw.x, fw.z);
        for (const d of [-0.35, 0, 0.35]) {
          const dir = new THREE.Vector3(Math.sin(base + d), 0.05, Math.cos(base + d));
          const p = new THREE.Vector3(f.pos.x + dir.x * 0.9, f.pos.y + 0.35, f.pos.z + dir.z * 0.9);
          this.fire('pebble', f, p, { dir });
        }
        w.fx.dust(f.pos, 10, 3); w.audio.rumble(0.6); return;
      }
      case 'earth.seismic': {
        w.combat.slam(f);
        const fw = f.forward(_v2);
        for (let i = 1; i <= 5; i++) this.spikes.push({ owner: f, t: -i * 0.07, pos: new THREE.Vector3(f.pos.x + fw.x * (1.4 + i * 1.3), f.groundY, f.pos.z + fw.z * (1.4 + i * 1.3)), mesh: null, hit: new Set() });
        return;
      }
      case 'earth.pillar': {
        const t = f.target, locked = f.input.strafe && t && !t.dead && t.pos.distanceTo(f.pos) < 9;
        const at = locked ? t.pos.clone() : this.forwardPoint(f, 2.2, 0);
        this.raisePillar(f, at.x, at.z);
        return;
      }
      // ---------------- fire
      case 'fire.hand': {
        const orbs = this.heldList(f, 'fire').filter(o => o.state === 'orbit');
        if (orbs.length) { this.launch(orbs[0], f, 1); return; }
        // a compact fireball punched out of the striking fist (jab, cross or hook)
        const o = this.fire('fireball', f, hand, { scale: 0.72 }); o.dmg = 7; w.fx.fire(hand, _v2.set(0, 1, 0), 0.3, 0.12); w.audio.fireWhoosh(0.6); return;
      }
      case 'fire.knee': { this.ring(f, 'fire', 2.4, 10, { dmg: 6, knock: 7, level: 1 }); for (let i = 0; i < 10; i++) w.fx.fire(foot, _v.set(rand(-3, 3), rand(0, 3), rand(-3, 3)), 0.5, 0.3); w.audio.fireWhoosh(1); return; }
      case 'fire.stompMark': return;   // no flame before the foot comes down: the stomp ignites on the plant
      case 'fire.stomp': {
        // ignition on the foot plant: a short flare at the stamping foot, then a fireball runs along the ground to the
        // opponent and spreads into a ring of fire around them
        const ft = this.footPoint(f, -1, new THREE.Vector3());
        for (let i = 0; i < 8; i++) { const a = rand(0, 6.28); w.fx.fire(ft, _v2.set(Math.sin(a) * 2.5, rand(1, 2.5), Math.cos(a) * 2.5), 0.4, 0.25); }
        w.fx.crater(ft, 1); w.shake(0.2, ft); this.weapons.fireTrap(f, ft); return;
      }
      case 'fire.flip': case 'fire.flip2': {
        // the cartwheel's feet pass overhead: each throws flame along the path it travelled
        this.weapons.limbArc(f, 'fire', 'foot', name === 'fire.flip' ? 'R' : 'L', { span: 0.22, speed: 14, grow: 1.2, dmg: 7, knock: 6, level: 1 }); return;
      }
      case 'fire.airKick': case 'water.airKick': case 'air.airKick': {
        // a kick in the air throws the element along the kicking foot's path (it also intercepts what it meets)
        const el = name.split('.')[0], ft = f.airKickN % 2 ? 'R' : 'L';
        this.weapons.limbArc(f, el, 'foot', ft, { span: 0.2, speed: el === 'air' ? 20 : 15, grow: 1.1, dmg: 7, knock: el === 'air' ? 11 : 6, level: 1 }); return;
      }
      case 'earth.airKick': {
        // a rock knocked from the kicking foot
        const ft = f.footPos(f.airKickN % 2 ? 'R' : 'L', new THREE.Vector3());
        w.fx.debrisBurst(ft, 6, 2, 0.07, 0x7a7068); this.fire('rockKick', f, ft); w.audio.rumble(0.4); return;
      }
      case 'earth.stompMark': { this.weapons.eruptionMark(f); return; }
      case 'earth.stomp': { this.weapons.eruptionFire(f); w.fx.dust(f.pos, 8, 2); w.fx.crater(f.pos, 1.2); return; }
      // kicks throw fire along the path the foot travelled: the roundhouse a rising flame arc, the spinning kick a wide flat one
      case 'fire.leg': { this.weapons.limbArc(f, 'fire', 'foot', s > 0 ? 'L' : 'R', { span: 0.22, speed: 16, dmg: 8, knock: 6, level: 1 }); return; }
      case 'fire.spin': { this.ring(f, 'fire', 2.6, 9, { dmg: 7, knock: 6, level: 1 }); this.weapons.limbArc(f, 'fire', 'foot', s > 0 ? 'L' : 'R', { span: 0.3, speed: 13, grow: 1.9, dmg: 8, knock: 7, level: 1 }); return; }
      case 'fire.charged': {
        const o = this.fire('fireArc', f, this.forwardPoint(f, 0.8, 0.9), { scale: 1.5 }); o.dmg = 14; o.level = 2; this.orientArc(o);
        this.ring(f, 'fire', 2.6, 10, { dmg: 6, knock: 5, level: 1 }); w.audio.fireWhoosh(1.2); w.shake(0.2, f.pos); return;
      }
      case 'fire.specialStart': this.specials.fireStart(f); return;
      case 'fire.special': this.specials.fireExplode(f, foot.clone()); return;
      // ---------------- water
      case 'water.hand': {
        // the water whip: consecutive strikes go right-to-left, left-to-right, overhead, then diagonally
        const g = this.heldList(f, 'water').filter(o => o.state === 'orbit');
        if (g.length) { this.launch(g[0], f, 1); return; }
        // the water whip: the rope has hung from the striking hand since the wind-up (water.whipOut); the impact
        // frame throws it. The arm clip sets the direction: across the body, overhead, or high-to-low diagonal.
        this.whipRelease(f, 'water');
        return;
      }
      case 'water.whipOut': case 'air.whipOut': {
        const k = this.whipKind(f), el = name.split('.')[0];
        const stats = el === 'water' ? { h: [7, 7, 0], v: [9, 5, 1], d: [9, 7, 1] } : { h: [6, 11, 1], v: [6, 9, 1], d: [6, 11, 1] };
        const [dmg, knock, level] = stats[k] || stats.h;
        f.whipW = this.weapons.whipStrike(f, el, k, { hand: s > 0 ? 'R' : 'L', tech: f.tech, dmg, knock, level });
        if (el === 'water') w.fx.splash(this.handPoint(f, -s, _v), 4);
        return;
      }
      case 'water.leg': {
        // crescent kick: a broad, low arc of water sweeping out at leg height (takes the opponent's footing)
        const g = this.heldList(f, 'water').filter(o => o.state === 'orbit');
        // the water follows the kicking foot's path off the ground and is thrown on as one arc
        this.weapons.limbArc(f, 'water', 'foot', s > 0 ? 'L' : 'R', { span: 0.24, speed: 13, grow: g.length ? 1.8 : 1.4, dmg: g.length ? 10 : 8, knock: 7, level: 1 });
        if (g.length) this.kill(g[0], 'silent');
        w.fx.splash(this.forwardPoint(f, 1, 0.4, _v), 12); w.audio.splash(0.9); return;
      }
      case 'water.leg2': {
        // spinning kick: a water whip swung all the way round the body
        const g = this.heldList(f, 'water').filter(o => o.state === 'orbit'); if (g.length) this.kill(g[0], 'silent');
        this.weapons.whipStrike(f, 'water', 'circle', { foot: s > 0 ? 'L' : 'R', released: true, hitWin: 0.4, len: g.length ? 3.8 : 3.2, dmg: 9, knock: 8, level: 1 }); return;
      }
      case 'water.column': {
        // rising kick: the water surges up under the opponent
        const t = f.target, at = t && !t.dead && t.pos.distanceTo(f.pos) < 12 ? t.pos.clone() : this.forwardPoint(f, 4, 0);
        this.weapons.column(f, 'water', at, { warn: 0.32, dmg: 9, lift: 10 }); return;
      }
      case 'water.lance': {
        // running kick: a concentrated jet of water driven straight from the kick
        const o = this.fire('waterLance', f, this.forwardPoint(f, 0.8, 1.0)); w.fx.splash(o.pos, 8); w.audio.splash(0.8); return;
      }
      case 'water.charged': {
        const g = this.heldList(f, 'water'); g.forEach(o => this.kill(o, 'silent'));
        // Tidal Wave: a wall of water advancing over the ground; where it stops it freezes into a line of ice spikes
        this.weapons.wave(f, 'water', { freeze: true, width: 5.5 + g.length, dmg: 9 + g.length * 2 }); w.shake(0.2, f.pos);
        return;
      }
      case 'water.specialStart': this.specials.waterStart(f); return;
      case 'water.special': this.specials.waterEstablish(f); return;
      case 'water.specialRelease': this.specials.waterRelease(f); return;
      // ---------------- air
      case 'air.hand': {
        const v = this.heldList(f, 'air').filter(o => o.state === 'orbit');
        if (v.length) { v[0].kind = 'orbVortex'; this.launch(v[0], f, 1); return; }
        // in flight: a palm blast of compressed air driven down at the opponent
        if (f.mob && f.mob.kind === 'fly') { const o = this.fire('gust', f, hand); o.dmg = 6; o.knock = 12; w.audio.gust(0.8); return; }
        // the air whip: fast lashes alternating with sweeping strikes
        this.whipRelease(f, 'air');
        return;
      }
      // the air kick cuts a blade of wind shaped by the kick's path
      case 'air.leg': { this.weapons.limbArc(f, 'air', 'foot', s > 0 ? 'L' : 'R', { span: 0.2, speed: 21, grow: 1.1, dmg: 6, knock: 13, level: 1, life: 0.55 }); return; }
      case 'air.leg2': {
        // whirlwind kick: a low gust racing along the ground that knocks the opponent off their feet
        this.weapons.wave(f, 'air', { width: 3.6, life: 0.55, speed: 22, dmg: 5, knock: 12, level: 1 }); return;
      }
      case 'air.column': {
        const t = f.target, at = t && !t.dead && t.pos.distanceTo(f.pos) < 12 ? t.pos.clone() : this.forwardPoint(f, 4, 0);
        this.weapons.column(f, 'air', at, { warn: 0.28, dmg: 6, lift: 12 }); return;
      }
      case 'air.charged': {
        // Air Compression: the gathered air released as one broad pressure wave
        this.weapons.wave(f, 'air', { width: 7, life: 0.75, speed: 22, dmg: 8, knock: 18, level: 2 }); w.shake(0.2, f.pos); return;
      }
      case 'air.specialStart': this.specials.airStart(f); return;
      case 'air.special': this.specials.airSend(f); return;
      case 'earth.specialStart': this.specials.earthStart(f); return;
      case 'earth.special': this.specials.earthRupture(f); return;
    }
  }
  orientArc(o) { o.mesh.rotation.set(Math.PI / 2, 0, 0); o.mesh.rotation.order = 'YXZ'; o.mesh.rotation.y = Math.atan2(o.vel.x, o.vel.z) - Math.PI / 2; }

  ring(owner, el, maxR, speed, hit) {
    const mesh = new THREE.Mesh(this.geo.flatRing, el === 'fire' ? this.mat.fireArc : el === 'water' ? this.mat.waterArc : this.mat.air);
    mesh.position.set(owner.pos.x, owner.pos.y + 0.25, owner.pos.z); mesh.scale.setScalar(0.5);
    this.world.scene.add(mesh);
    this.rings.push({ owner, el, r: 0.5, maxR, speed, mesh, hit, done: new Set(), center: owner.pos.clone() });
    // projectiles caught inside an air or water ring are thrown outward / extinguished
  }

  raisePillar(f, x, z) {
    const w = this.world;
    const mine = this.pillars.filter(p => p.owner === f);
    if (mine.length >= 3) this.lowerPillar(mine[0]);
    const gy = w.arena.groundAt(x, z, 10);
    const mesh = new THREE.Mesh(this.pillarGeo, this.mat.stone);
    mesh.scale.set(0.75, 1.05, 0.75); mesh.position.set(x, gy - 1.6, z); mesh.castShadow = mesh.receiveShadow = true;
    w.scene.add(mesh);
    const col = { kind: 'b', x, z, hx: 0.6, hz: 0.6, top: gy + 1.45, walk: true, mesh, pillar: true };
    w.arena.colliders.push(col); w.arena.cameraBlockers.push(mesh);
    const p = { owner: f, mesh, col, t: 0, life: 14, gy };
    this.pillars.push(p);
    w.fx.debrisBurst(new THREE.Vector3(x, gy + 0.1, z), 18, 3, 0.12, 0x7a6a58); w.fx.dust(new THREE.Vector3(x, gy, z), 10, 2.5); w.fx.crater(new THREE.Vector3(x, gy, z), 2.2);
    this.weapons.burst.spawn(x, gy, z, 0.38);   // the ground breaks open around the rising pillar
    w.audio.rumble(1); w.shake(0.2, mesh.position);
    // anyone standing on the spot is launched
    for (const t of w.fighters) {
      if (Math.abs(t.pos.x - x) < 0.9 && Math.abs(t.pos.z - z) < 0.9 && t.pos.y < gy + 0.8) {
        t.vel.y = 9.5; t.onGround = false;
        if (t !== f && !t.dead) w.combat.damage(t, 8, new THREE.Vector3(0, 0, 0).set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize(), f, 'pillar', t.chestPos(new THREE.Vector3()), 2, 2);
      }
    }
  }
  lowerPillar(p) { p.life = Math.min(p.life, 0.01); }

  // ================================================================== sustained techniques (HAND held)
  holdStart(f) {
    const h = { el: f.el, t: 0, tick: 0, whip: null };
    this.holds.set(f, h);
    if (f.el === 'water' || f.el === 'air') h.mode = 'twin';   // two sustained streams, one from each hand
  }
  // a visible body for sustained streams: a cone from the hands along the aim
  streamMesh(h, key, mats, from, dir, len, radius) {
    if (!h[key]) { h[key] = mats.map(m => { const c = new THREE.Mesh(this.geo.cone, m); this.world.scene.add(c); return c; }); (h.streams = h.streams || []).push(...h[key]); }
    h[key].forEach((c, i) => {
      const r = radius * (i ? 0.45 : 1) * (0.9 + Math.random() * 0.2);
      c.position.copy(from); c.quaternion.setFromUnitVectors(_up, dir); c.scale.set(r, len, r);
      c.rotateY(h.t * (i ? -9 : 6));
    });
  }
  holdEnd(f) {
    const h = this.holds.get(f); if (!h) return;
    if (h.whip) { this.world.scene.remove(h.whip.mesh); h.whip.mesh.geometry.dispose(); h.whip = null; }
    this.weapons.endSustain(h);
    if (h.streams) { for (const m of h.streams) this.world.scene.remove(m); }
    this.holds.delete(f);
  }
  holdTick(f, dt) {
    const h = this.holds.get(f); if (!h) return;
    const w = this.world; h.t += dt; h.tick -= dt;
    const aim = f.input.aimPoint;
    if (h.el === 'earth') {
      // Boulder Lift: one rock (or a nearby loose stone) every 0.35 s up to three
      // the bender reaches down to the ground for each one (PickUp_Table), and the rock breaks out of the ground as the
      // hands come back up
      f.gatherT = Math.max(0, (f.gatherT || 0) - dt);
      if (h.tick <= 0 && this.held(f, 'earth') < MAX_HELD && f.en >= 8) {
        h.tick = 0.42; f.en -= 8; f.gatherT = 0.42; f.gatherN = (f.gatherN || 0) + 1;
        const stone = w.arena.nearestLooseStone(f.pos, 8);
        let o;
        if (stone) {
          stone.col.dead = true; stone.mesh.visible = false; stone.taken = true;
          o = this.spawn('boulder', f, stone.mesh.position.clone().setY(stone.mesh.position.y + 0.3), 'rising', { src: stone });
          o.start = o.pos.clone();
          w.fx.dust(stone.mesh.position, 8, 2);
        } else {
          const p = this.forwardPoint(f, 1.2 + Math.random() * 0.6, 0);
          p.x += rand(-0.8, 0.8); p.z += rand(-0.8, 0.8); p.y = w.arena.groundAt(p.x, p.z, f.pos.y + 0.3) - 0.4;
          o = this.spawn('rock', f, p, 'rising'); o.start = p.clone();
          this.weapons.burst.spawn(p.x, p.y + 0.4, p.z, 0.32);   // the ground breaks open where it comes out
          w.fx.debrisBurst(_v.set(p.x, p.y + 0.45, p.z), 10, 2.2, 0.09, 0x7a7068, 0.8); w.fx.crater(_v.set(p.x, p.y + 0.42, p.z), 1.3);
        }
        o.slot = this.held(f, 'earth') * 2.1;
        w.audio.rumble(0.5);
      }
    } else if (h.el === 'fire') {
      // Fire Stream: continuous jet from both palms toward the aim point
      const from = _a.copy(this.handPoint(f, 1)).add(this.handPoint(f, -1, _b)).multiplyScalar(0.5);
      const dir = this.aimDir(f, from, _b);
      let len = Math.min(9, from.distanceTo(aim) + 0.5);
      // defences and walls cut the stream short
      const blocker = this.rayDefence(f, from, dir, len);
      if (blocker) { len = blocker.d; if (h.tick <= 0) this.hitDefence(blocker.def, 4, from.clone().addScaledVector(dir, len), 'fire', null); }
      for (let i = 0; i < 7; i++) { const k = Math.random(); this.world.fx.fire(from.clone().addScaledVector(dir, 0.3 + k * 0.6), dir.clone().multiplyScalar(len * 2.2 + rand(-1, 1)).add(_v.set(rand(-0.8, 0.8), rand(-0.4, 0.8), rand(-0.8, 0.8))), 0.35 + k * 0.4, 0.42); }
      if (h.tick <= 0) {
        h.tick = 0.15;
        for (const t of w.fighters) {
          if (t === f || t.dead || t.invuln > 0) continue;
          const c = t.chestPos(_v3); c.y -= 0.3;
          const along = _v.subVectors(c, from).dot(dir);
          if (along < 0 || along > len + 0.4) continue;
          const off = c.distanceTo(_v2.copy(from).addScaledVector(dir, along));
          if (off < 0.6 + along * 0.06) w.combat.damage(t, 2, dir.clone().setY(0).normalize(), f, 'fireStream', c.clone(), 1.2, (h.t % 0.6) < 0.16 ? 0 : -1);
        }
        const end = _v.copy(from).addScaledVector(dir, len);
        const gy = w.arena.groundAt(end.x, end.z, end.y + 0.5);
        if (end.y - gy < 1.0) this.burn(end.x, end.z, gy, f);
        this.deflectInCone(f, from, dir, len, 'fire');
        w.audio.fireWhoosh(0.25);
      }
      this.light.position.copy(from).addScaledVector(dir, len * 0.5); this.lightBoost = 1;
    } else if (h.el === 'water') {
      // Twin Water Whips: one stream from each hand, lashing in turn, following the hands, swept by the stick
      this.weapons.sustain(f, h, dt);
    } else if (h.el === 'air') {
      // Twin Air Streams (sustained air whips) over a steady pushing current
      this.weapons.sustain(f, h, dt);
      // Wind Push: a sustained cone that shoves fighters, loose rocks and projectiles away
      const from = this.forwardPoint(f, 0.6, 1.3, _a);
      const dir = this.aimDir(f, from, _b); dir.y *= 0.3; dir.normalize();
      for (let i = 0; i < 2; i++) { const p = w.fx.wind(from.clone().add(_v.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))), dir.clone().multiplyScalar(rand(12, 18)), 0.5, 0.5); p.alpha = 0.45; }
      for (const t of w.fighters) {
        if (t === f || t.dead) continue;
        const c = t.chestPos(_v3), to = _v.subVectors(c, from), d = to.length();
        if (d > 10 || to.dot(dir) / d < 0.86) continue;
        // a steady external push the target's footwork cannot cancel (it can still walk against it slowly)
        const k = (1 - d / 10) * 34 * dt;
        t.ext.x += dir.x * k; t.ext.z += dir.z * k;
        const e = Math.hypot(t.ext.x, t.ext.z); if (e > 7) { t.ext.x *= 7 / e; t.ext.z *= 7 / e; }
        if (h.tick <= 0) w.combat.damage(t, 1, dir.clone().setY(0).normalize(), f, 'wind', c.clone(), 0, -1);
      }
      if (h.tick <= 0) h.tick = 0.3;
      this.deflectInCone(f, from, dir, 9, 'air');
    }
  }

  whipTick(f, h, dt) {
    const w = this.world;
    // Water Whip: a lashing stream of water, consuming held water over time
    if (!h.whip) {
      h.whip = makeWaterTube(28, 8); w.scene.add(h.whip.mesh); h.whipPts = Array.from({ length: 16 }, () => new THREE.Vector3());
      h.whipUse = 2.5;
    }
    h.whipUse -= dt;
    if (h.whipUse <= 0) { const g = this.heldList(f, 'water'); if (g.length) this.kill(g[0], 'silent'); h.whipUse = 2.5; if (!this.held(f, 'water')) { this.holdEnd(f); return; } }
    const from = _a.copy(this.handPoint(f, -1));
    const dir = this.aimDir(f, from, _b);
    const len = Math.min(6.5, from.distanceTo(f.input.aimPoint));
    const lash = Math.sin(h.t * 7.5);
    const side = _v2.set(-dir.z, 0, dir.x);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const tip = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const k = i / 15;
      const p = _v.copy(from).addScaledVector(dir, k * len).addScaledVector(side, Math.sin(k * Math.PI) * lash * 1.6 * k).add(_v3.set(0, Math.sin(k * 6 + h.t * 9) * 0.12, 0));
      h.whipPts[i].copy(p);
      if (i === 15) tip.copy(p);
      if (Math.random() < 0.15) w.fx.splash(p, 1);
    }
    h.whip.set(h.whipPts, (t) => 0.17 * (1 - t * 0.6), h.t);
    if (h.tick <= 0) {
      h.tick = 0.42;
      for (const t of w.fighters) {
        if (t === f || t.dead || t.invuln > 0) continue;
        if (distPointSeg(t.chestPos(_v3), from, tip) < 1.0) w.combat.damage(t, 6, dir.clone().setY(0).normalize(), f, 'whip', t.chestPos(new THREE.Vector3()), 4, 0);
      }
      this.extinguishNear(tip, 1.5);
      w.audio.splash(0.4);
    }
  }

  deflectInCone(f, from, dir, len, el) {
    for (const o of this.objs) {
      if (o.state !== 'flying' || o.owner === f) continue;
      const to = _v.subVectors(o.pos, from), d = to.length();
      if (d > len || to.dot(dir) / d < 0.85) continue;
      if (el === 'air') {
        // wind turns projectiles aside and blows light ones back
        const heavy = o.el === 'earth';
        o.vel.lerp(_v2.copy(dir).multiplyScalar(o.vel.length()), heavy ? 0.06 : 0.25);
        if (!heavy && !o.blown) { o.blown = true; o.owner = f; }
      } else if (el === 'fire' && (o.el === 'air')) this.kill(o);
      else if (el === 'fire' && o.el === 'water') { this.kill(o, 'steam'); }
    }
  }

  // ================================================================== defences (GUARD)
  // Every defence has a shape that matches what is drawn, a durability (hp), an energy cost while held (fighter.js)
  // and element rules. Projectiles are resolved physically as they fly (defend); every other kind of damage
  // (melee, streams, wind, burning ground) goes through resolveDefence() before any damage is applied.
  //   earth : stone wall in front (box)             fire  : flame curtain in front (box)
  //   water : flowing water wall, a curved curtain in front (arc); with held water it becomes two streams
  //           circling the body (ring, all round, head clear); held for 0.8 s the wall freezes into ice
  //   air   : deflecting air shell (sphere, front 300 degrees)
  guardStart(f) {
    const w = this.world, el = f.el;
    const d = { el, owner: f, t: 0, hp: el === 'earth' ? 70 : el === 'fire' ? 55 : el === 'water' ? 60 : 50, rise: 0, sink: 0, dead: false, yaw: f.faceYaw, pos: new THREE.Vector3(), flash: 0 };
    if (el === 'earth') {
      d.mesh = new THREE.Mesh(this.wallGeo, this.mat.stone); d.mesh.castShadow = d.mesh.receiveShadow = true; d.box = { hw: 0.95, hh: 2.0, hd: 0.3 };
      this.placeDef(d, 1);
      w.fx.debrisBurst(d.pos.clone().setY(d.pos.y + 0.1), 14, 2.6, 0.1, 0x7a6a58, 0.9); w.fx.dust(d.pos, 8, 2.2); w.fx.crater(d.pos, 2); w.audio.rumble(0.8);
    } else if (el === 'fire') {
      d.mesh = new THREE.Group(); d.box = { hw: 1.25, hh: 1.9, hd: 0.35 };
      this.placeDef(d, 1); w.audio.fireWhoosh(0.9);
    } else if (el === 'water') {
      const globes = this.heldList(f, 'water');
      if (globes.length) {
        // rotating streams made from the water already being held
        d.fx = makeWaterRing(); d.ring = { r0: 0.45, r1: 1.4, y0: 0.2, y1: 1.75 }; d.hp = 40 + globes.length * 15;
        for (const g of globes) this.kill(g, 'silent');
      } else { d.fx = makeWaterWall(1.2, 1.15, 2.3); d.arc = { r: 1.2, band: 0.5, half: 1.15, h: 2.3 }; }
      d.mesh = d.fx.mesh; this.placeDef(d, 1); w.fx.splash(_v.copy(f.pos).setY(f.pos.y + 0.4), 14); w.audio.splash(0.8);
    } else {
      d.mesh = new THREE.Group();
      /* drawn as circling wind streaks (updateDefences), no solid rings */
      d.sphere = 1.9; this.placeDef(d, 1); w.audio.gust(0.7);
    }
    d.maxHp = d.hp;
    w.scene.add(d.mesh);
    this.defs.push(d);
    f.defense = d;
  }
  guardEnd(f) {
    const d = f.defense; f.defense = null;
    if (!d || d.dead) return;
    if (d.ice) { d.free = true; return; }   // ice stays standing where it was raised
    d.sink = 0.001;
  }
  placeDef(d, snap) {
    const f = d.owner;
    d.yaw = snap >= 1 ? f.faceYaw : d.yaw + Math.atan2(Math.sin(f.faceYaw - d.yaw), Math.cos(f.faceYaw - d.yaw)) * snap;
    if (d.box) {
      const off = d.el === 'earth' ? 1.0 : 1.1;
      const gx = f.pos.x + Math.sin(d.yaw) * off, gz = f.pos.z + Math.cos(d.yaw) * off;
      d.pos.set(gx, this.world.arena.groundAt(gx, gz, f.pos.y + 0.3), gz);
    } else if (d.arc || d.ring) d.pos.set(f.pos.x, f.pos.y, f.pos.z);
    else d.pos.set(f.pos.x, f.pos.y + 1.1, f.pos.z);
  }
  // is a point inside the defence's volume?
  defContains(d, p, pad) {
    if (d.rise < 0.3) return false;
    if (d.box) {
      const dx = p.x - d.pos.x, dz = p.z - d.pos.z, c = Math.cos(d.yaw), s = Math.sin(d.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = p.y - d.pos.y;
      return Math.abs(lx) < d.box.hw + pad && Math.abs(lz) < d.box.hd + pad && ly > -pad && ly < d.box.hh * d.rise + pad;
    }
    if (d.arc) {
      const dx = p.x - d.pos.x, dz = p.z - d.pos.z, r = Math.hypot(dx, dz), ly = p.y - d.pos.y;
      if (ly < -pad || ly > d.arc.h * d.rise + pad) return false;
      if (Math.abs(r - d.arc.r) > d.arc.band + pad) return false;
      const a = Math.atan2(dx, dz) - d.yaw, da = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      return da < d.arc.half + pad / Math.max(0.5, d.arc.r);
    }
    if (d.ring) {
      const dx = p.x - d.pos.x, dz = p.z - d.pos.z, r = Math.hypot(dx, dz), ly = p.y - d.pos.y;
      return r > d.ring.r0 - pad && r < d.ring.r1 * d.rise + pad && ly > d.ring.y0 - pad && ly < d.ring.y1 + pad;
    }
    // spherical shells protect the front 300 degrees
    const to = _v.subVectors(p, d.pos), dist = to.length();
    if (dist > d.sphere * d.rise + pad) return false;
    const fw = _v2.set(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    return (to.x * fw.x + to.z * fw.z) / (Math.hypot(to.x, to.z) || 1) > -0.85;
  }
  // does the defence cover an attack arriving along `dir` (direction of travel)?
  covers(d, dir) {
    if (d.ring) return true;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), l = Math.hypot(dir.x, dir.z);
    if (l < 1e-3) return !!d.sphere;
    const c = -(dir.x * fx + dir.z * fz) / l;          // 1 = straight at the front
    if (d.arc) return c > Math.cos(d.arc.half + 0.15);
    if (d.box) return c > 0.25;
    return c > -0.85;
  }
  rayDefence(f, from, dir, len) {
    for (const d of this.defs) {
      if (d.owner === f || d.dead) continue;
      for (let s = 0.5; s < len; s += 0.3) if (this.defContains(d, _v3.copy(from).addScaledVector(dir, s), 0.2)) return { def: d, d: s };
    }
    return null;
  }
  // Non-projectile attacks against a fighter who has a defence up. Returns null (not covered), or { mul } where
  // mul is the share of damage that gets through (0 = fully stopped).
  resolveDefence(t, a) {
    const d = t.defense, w = this.world;
    if (!d || d.dead || d.rise < 0.3) return null;
    if (['spike', 'slam', 'pillar'].includes(a.kind)) return null;               // ground eruptions come from below
    if (a.kind === 'burn') {                                                     // burning ground under the feet
      if (d.el === 'water') { this.extinguishNear(t.pos, 1.4); return { mul: 0 }; }
      return null;
    }
    if (!this.covers(d, a.dir)) return null;
    const el = a.el || 'phys', heavy = a.dmg >= 10 || a.level >= 2;
    let mul = 0, wall = a.dmg, label = 'BLOCK';
    if (d.el === 'water') {
      if (d.ice) { wall *= el === 'fire' ? 1.6 : el === 'earth' ? 1.3 : 0.8; }
      else if (el === 'fire') { wall *= 0.3; label = 'DOUSED'; w.fx.steam(a.at, 6); }
      else if (el === 'earth' && heavy) { mul = 0.5; wall *= 1.5; label = 'BREAKS THROUGH'; }
      else if (el === 'earth') wall *= 1.2;
      else if (el === 'air') wall *= 0.6;
      w.fx.splash(a.at, 6);
    } else if (d.el === 'fire') {
      if (el === 'water') { wall *= 2.5; label = 'DOUSED'; }
      else if (el === 'earth' && heavy) { mul = 0.5; label = 'BREAKS THROUGH'; }
    } else if (d.el === 'earth') { if (el === 'water') wall *= 0.6; if (el === 'earth') wall *= 1.3; }
    else if (d.el === 'air') {
      // air turns blows aside rather than stopping them: some damage still lands, the attacker is shoved away
      mul = el === 'earth' && heavy ? 0.5 : 0.25; label = 'DEFLECT';
      if (a.from && a.from.ext) a.from.ext.addScaledVector(_v.set(a.dir.x, 0, a.dir.z).normalize(), -6);
    }
    if (a.kind === 'fireStream' || a.kind === 'wind') wall *= 0.5;
    this.hitDefence(d, wall, a.at, el);
    if (a.level >= 0 && (t.blockPopT || 0) <= 0) { w.popup(t, label, true); t.blockPopT = 0.3; }
    t.stats.blocks++;
    return { mul };
  }
  hitDefence(d, dmg, at, el, proj) {
    const w = this.world;
    if (d.el === 'fire' && el === 'water') dmg *= 2.5;   // water douses fire walls
    if (d.el === 'water' && !d.ice && el === 'fire') { dmg *= 0.3; w.fx.steam(at, 6); }
    d.hp -= dmg; d.shake = 0.15; d.flash = 1;
    if (d.el === 'earth') { w.fx.debrisBurst(at, 6, 2.4, 0.08, 0x7a6a58); }
    if (d.el === 'water') { w.fx.splash(at, d.ice ? 3 : 10); if (d.ice) w.fx.debrisBurst(at, 5, 2.2, 0.06, 0xcdefff); }
    if (d.hp <= 0) this.breakDefence(d);
  }
  breakDefence(d) {
    const w = this.world; d.dead = true; w.scene.remove(d.mesh);
    if (d.cols) for (const c of d.cols) { c.dead = true; } w.arena.colliders = w.arena.colliders.filter(c => !c.dead);
    if (d.el === 'earth') { w.fx.debrisBurst(d.pos.clone().setY(d.pos.y + 1), 24, 4, 0.15, 0x7a6a58); w.audio.impact(1.1); }
    if (d.el === 'water' && d.ice) { w.fx.debrisBurst(_v.copy(d.pos).add(_v2.set(Math.sin(d.yaw) * 1.2, 1, Math.cos(d.yaw) * 1.2)), 34, 4.5, 0.13, 0xcdefff); w.audio.impact(1.0); w.popup(d.owner, 'ICE SHATTERS', true); }
    else if (d.el === 'water') { w.fx.splash(_v.copy(d.pos).setY(d.pos.y + 1), 26); w.audio.splash(1); }
    if (d.el === 'fire') { for (let i = 0; i < 16; i++) w.fx.fire(d.pos.clone().setY(d.pos.y + 1), _v.set(rand(-3, 3), rand(0, 3), rand(-3, 3))); w.fx.smoke(d.pos); }
    const o = d.owner; if (o && o.defense === d) { o.defense = null; o.guarding = false; o.guardCd = 1.1; o.stunT = 0.3; w.popup(o, 'GUARD BROKEN', true); }
  }
  // icebending (GUARD + SPECIAL with the water wall up, once unlocked): the wall freezes into a solid ice wall: real colliders, high durability; it stays
  // standing after the guard is released and can be climbed onto
  freeze(d) {
    const w = this.world, f = d.owner;
    d.ice = true; d.hp = 150; d.maxHp = 150; d.life = 9; d.arc = { r: 1.25, band: 0.55, half: 0.95, h: 2.1 };
    w.scene.remove(d.mesh); d.fx = makeIceWall(1.25, 0.95, 7); d.mesh = d.fx.mesh; w.scene.add(d.mesh);
    d.mesh.position.copy(d.pos); d.mesh.rotation.y = d.yaw;
    d.cols = [];
    for (let i = 0; i < 5; i++) {
      const a = d.yaw - 0.95 + 1.9 * i / 4, x = d.pos.x + Math.sin(a) * 1.25, z = d.pos.z + Math.cos(a) * 1.25;
      const c = { kind: 'c', x, z, r: 0.42, top: d.pos.y + 1.7, walk: true, ice: true }; d.cols.push(c); w.arena.colliders.push(c);
    }
    w.fx.debrisBurst(_v.copy(d.pos).add(_v2.set(Math.sin(d.yaw) * 1.2, 0.6, Math.cos(d.yaw) * 1.2)), 16, 2.5, 0.08, 0xdff6ff);
    w.audio.impact(0.6); w.popup(f, 'ICE WALL', true);
  }
  // what a defence does to a projectile that enters it. Returns true if the projectile stops.
  defend(d, o) {
    const w = this.world, owner = d.owner, perfect = !d.free && owner.guarding && owner.guardT < 0.25;
    const sendBack = () => {
      const back = o.owner.chestPos(_a);
      const sp = Math.max(18, o.vel.length());
      o.vel.subVectors(back, o.pos).normalize().multiplyScalar(sp);
      if (SPEC[o.kind].grav) o.vel.y += 0.5 * SPEC[o.kind].grav * (o.pos.distanceTo(back) / sp);
      o.owner = owner; o.deflected = true; owner.counterT = 0.9; owner.stats.perfect++; owner.perfectT = 0.5;
      o.pos.addScaledVector(o.vel, 0.03);
      w.popup(owner, d.el === 'water' ? 'REDIRECT' : 'DEFLECT', true); w.hitStop(0.05);
    };
    if (perfect && !o.deflected && o.owner !== owner && (d.el !== 'fire' || o.el === 'earth' || o.el === 'fire')) { sendBack(); return false; }
    if (owner.stats) owner.stats.blocks++;
    const heavy = o.kind === 'boulder' || o.kind === 'rockKick' || (o.dmg || 0) >= 14;
    if (d.el === 'earth') { this.hitDefence(d, o.dmg * (o.el === 'water' ? 0.6 : 1.4), o.pos.clone(), o.el, o); this.kill(o); w.popup(owner, 'BLOCK', true); return true; }
    if (d.el === 'fire') {
      if (o.el === 'earth') { if (!o.passedFire) { o.passedFire = true; o.dmgMul *= 0.5; this.hitDefence(d, 12, o.pos.clone(), 'earth'); } return false; }
      this.hitDefence(d, o.el === 'water' ? 22 : o.dmg * 0.5, o.pos.clone(), o.el); this.kill(o, o.el === 'water' ? 'steam' : undefined); w.popup(owner, 'BURNED', true); return true;
    }
    if (d.el === 'water') {
      if (d.ice) { this.hitDefence(d, (o.dmg || 8) * (o.el === 'fire' ? 1.6 : heavy ? 2 : 1), o.pos.clone(), o.el); this.kill(o, o.el === 'fire' ? 'steam' : undefined); return true; }
      if (o.el === 'fire') { this.hitDefence(d, 4, o.pos.clone(), 'fire'); this.kill(o, 'steam'); w.popup(owner, 'DOUSED', true); return true; }
      if (o.el === 'earth' && heavy) {
        // a boulder smashes through a water wall: slowed, half damage, and the wall takes a heavy hit
        if (!o.slowed) { o.slowed = true; o.vel.multiplyScalar(0.6); o.dmgMul *= 0.5; this.hitDefence(d, 28, o.pos.clone(), 'earth'); w.popup(owner, 'BREAKS THROUGH', true); }
        return false;
      }
      this.hitDefence(d, o.el === 'earth' ? 14 : 6, o.pos.clone(), o.el); this.kill(o, 'silent'); w.popup(owner, 'BLOCK', true); return true;
    }
    // air: everything is turned aside
    if (!o.airTurned) {
      o.airTurned = true;
      const away = _a.subVectors(o.pos, owner.chestPos(_b)).setY(0).normalize();
      const sp = o.vel.length() * (o.el === 'earth' ? 0.8 : 1);
      o.vel.copy(away.multiplyScalar(0.7).add(_b.set(-o.vel.z, 0, o.vel.x).normalize().multiplyScalar(0.7))).normalize().multiplyScalar(sp);
      this.hitDefence(d, o.el === 'earth' ? 14 : 4, o.pos.clone(), o.el);
      w.popup(owner, 'DEFLECT', true); w.audio.gust(0.6);
    }
    return false;
  }

  // ================================================================== environment
  burn(x, z, gy, owner) {
    // burning ground lasts under two seconds and at most six patches burn at once, so the fighters stay visible
    for (const b of this.burns) if (Math.hypot(b.x - x, b.z - z) < 0.9) { b.t = Math.max(b.t, 1.8); return; }
    if (this.burns.length > 5) this.burns.shift();
    this.burns.push({ x, z, y: gy, t: 1.8, r: 1.1, owner, tick: 0 });
  }
  extinguishNear(p, r) {
    const before = this.burns.length;
    this.burns = this.burns.filter(b => { const keep = Math.hypot(b.x - p.x, b.z - p.z) > r + b.r * 0.5; if (!keep) this.world.fx.steam(new THREE.Vector3(b.x, b.y + 0.2, b.z), 5); return keep; });
    return before - this.burns.length;
  }

  // ================================================================== projectile vs projectile rules
  clash(a, b) {
    const w = this.world;
    if (a.el === b.el) { this.kill(a); this.kill(b); return; }
    // fire is a defence as well as an attack: a fireball or a kicked flame destroys whatever it meets and burns out
    // doing it (water turns to steam, rock is shattered, wind is burnt through)
    if (a.el === 'fire' || b.el === 'fire') { const o = a.el === 'fire' ? b : a; this.kill(o, o.el === 'water' ? 'steam' : undefined); this.kill(a.el === 'fire' ? a : b); if (o.el === 'earth') w.fx.debrisBurst(o.pos, 8, 3, 0.07, 0x7a7068); return; }
    const pair = (x, y) => (a.el === x && b.el === y) ? [a, b] : (a.el === y && b.el === x) ? [b, a] : null;
    let p;
    if ((p = pair('water', 'fire'))) { this.kill(p[1], 'steam'); p[0].dmgMul *= 0.7; return; }        // water douses fire
    if ((p = pair('earth', 'fire'))) { this.kill(p[1]); return; }                                      // rock smothers fire
    if ((p = pair('earth', 'water'))) { p[0].vel.multiplyScalar(0.55); this.kill(p[1]); return; }        // water slows rock
    if ((p = pair('air', 'earth'))) {                                                                   // wind nudges rock
      const g = p[0], r = p[1]; r.vel.lerp(_v.copy(g.vel).setLength(r.vel.length()), 0.25); this.kill(g); return; }
    if ((p = pair('air', 'fire')) || (p = pair('air', 'water'))) {                                      // wind blows light elements back
      const g = p[0], x = p[1]; x.vel.copy(g.vel).setLength(Math.max(x.vel.length(), 20)); x.owner = g.owner; this.kill(g); w.fx.wind(x.pos, x.vel.clone().multiplyScalar(0.3)); return; }
  }

  // ================================================================== update
  update(dt) {
    const w = this.world;
    this.lightBoost = 0;
    this.waterSurf.uniforms.uTime.value += dt;
    this.updateDefences(dt);   // first, so a defence raised this frame is already in place for projectiles
    this.updateObjects(dt);
    this.updateRings(dt);
    this.updateSpirals(dt);
    this.specials.update(dt);
    this.weapons.update(dt);
    this.updateEnvironment(dt);
    // one shared flickering light makes fire read as a light source without per-flame lights
    let fireN = 0; for (const o of this.objs) if (o.el === 'fire' && o.state !== 'dead') { fireN++; if (!this.lightBoost) this.light.position.copy(o.pos); }
    // the fire light is kept modest so big fire attacks tint the scene instead of bleaching it white
    const want = (this.lightBoost ? 1.5 : fireN ? 1.1 : this.burns.length ? 0.7 : 0) * (0.85 + Math.random() * 0.3);
    if (!fireN && !this.lightBoost && this.burns.length) { const b = this.burns[this.burns.length - 1]; this.light.position.set(b.x, b.y + 0.6, b.z); }
    this.light.intensity += (want - this.light.intensity) * Math.min(1, dt * 12);
  }

  updateObjects(dt) {
    const w = this.world;
    for (const o of this.objs) {
      if (o.state === 'dead') continue;
      o.t += dt;
      const f = o.owner, S = SPEC[o.kind];
      if (o.state === 'rising' || o.state === 'drawing' || o.state === 'orbit') {
        if (f.dead) { this.kill(o); continue; }
        const list = this.heldList(f, o.el), n = list.length, i = list.indexOf(o);
        const guard = f.guarding && f.el === o.el;
        let ang, rad, h;
        if (guard) { ang = f.faceYaw + (n > 1 ? (i / (n - 1) - 0.5) * 1.6 : 0); rad = 1.05; h = 1.25 + (i % 2) * 0.35; }    // defensive formation in front
        else {
          const rate = { earth: 0.9, fire: 2.2, water: 1.3, air: 3.2 }[o.el];
          ang = f.time * rate + i * (Math.PI * 2 / Math.max(n, 1)); rad = o.el === 'air' ? 1.15 : 1.25; h = 1.3 + Math.sin(f.time * 2 + i) * 0.12;
        }
        const anchor = _a.set(f.pos.x + Math.sin(ang) * rad, f.pos.y + h, f.pos.z + Math.cos(ang) * rad);
        if (o.state === 'rising' || o.state === 'drawing') {
          const dur = o.state === 'rising' ? 0.32 : 0.45, k = smooth01(o.t / dur);
          o.pos.lerpVectors(o.start, anchor, k); o.pos.y += Math.sin(k * Math.PI) * (o.state === 'drawing' ? 1.4 : 0.35);
          if (o.state === 'drawing' && Math.random() < 0.6) w.fx.splash(o.pos, 1);
          if (o.t >= dur) o.state = 'orbit';
        } else o.pos.lerp(anchor, 1 - Math.exp(-10 * dt));
        this.animateObj(o, dt);
        // held objects intercept enemy projectiles (defensive formations)
        for (const p of this.objs) {
          if (p.state !== 'flying' || p.owner === f || p.state === 'dead') continue;
          if (p.pos.distanceTo(o.pos) < p.r + o.r + 0.1) { this.clash(o, p); if (p.state !== 'dead' && o.el === 'earth') this.kill(p); break; }
        }
        continue;
      }
      if (o.state === 'falling') {
        o.vel.y -= 18 * dt; o.pos.addScaledVector(o.vel, dt);
        const gy = w.arena.groundAt(o.pos.x, o.pos.z, o.pos.y + 1);
        if (o.pos.y < gy + o.r * 0.6) this.kill(o);
        o.mesh.position.copy(o.pos); continue;
      }
      // ---- flying
      o.life -= dt;
      const steps = 3, hstep = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        o.vel.y -= (S.grav || 0) * hstep;
        if (o.restrainPull) {}
        if (S.pull) {   // vortex drags nearby fighters in and up
          for (const t of w.fighters) {
            if (t === o.owner || t.dead) continue;
            const to = _v.subVectors(o.pos, t.pos); to.y = 0; const d = to.length();
            if (d < 4.5 && d > 0.3) { t.vel.x += to.x / d * 18 * hstep; t.vel.z += to.z / d * 18 * hstep; }
          }
        }
        o.pos.addScaledVector(o.vel, hstep);
        // defences
        for (const d of this.defs) {
          if (d.dead || d.owner === o.owner) continue;
          if (this.defContains(d, o.pos, o.r * 0.6) && this.defend(d, o)) { done = true; break; }
        }
        if (done) break;
        // other projectiles
        for (const p of this.objs) {
          if (p === o || p.state !== 'flying' || p.owner === o.owner) continue;
          if (p.pos.distanceTo(o.pos) < p.r + o.r) { this.clash(o, p); if (o.state === 'dead') { done = true; break; } }
        }
        if (done) break;
        // fighters
        for (const t of w.fighters) {
          if (t === o.owner || t.dead || o.hitSet.has(t)) continue;
          const a = _a.set(t.pos.x, t.pos.y + 0.35, t.pos.z), b = _b.set(t.pos.x, t.pos.y + 1.6, t.pos.z);
          if (distPointSeg(o.pos, a, b) < o.r + t.radius) {
            if (t.invuln > 0) continue;
            o.hitSet.add(t);
            const dir = new THREE.Vector3(o.vel.x, 0, o.vel.z).normalize();
            w.combat.damage(t, Math.round(o.dmg * o.dmgMul), dir, o.owner, 'proj', o.pos.clone(), o.knock, o.level);
            if (S.restrain && !t.dead) this.restrain(t, S.restrain);
            if (o.el === 'fire' && Math.random() < 0.6) this.burn(t.pos.x, t.pos.z, t.groundY, o.owner);
            if (!S.wide && o.kind !== 'vortex') { this.kill(o); done = true; break; }
          }
        }
        if (done) break;
        // geometry
        const c = w.arena.solidAt(o.pos, S.wide ? 0.2 : o.r * 0.6);   // sweeping arcs ride over low steps, walls still stop them
        const gy = w.arena.groundAt(o.pos.x, o.pos.z, o.pos.y + 1);
        const low = o.pos.y < gy + o.r * 0.6;
        if (S.wide && low) o.pos.y = gy + o.r * 0.6;  // arcs skim the floor
        if ((c && !(S.wide && o.el === 'air')) || (low && !S.wide) || Math.abs(o.pos.x) > HALF + 1 || Math.abs(o.pos.z) > HALF + 1 || o.life <= 0) {
          if (low && o.el === 'earth') { w.fx.crater(_v.set(o.pos.x, gy, o.pos.z), 1.1); if (o.kind === 'boulder' || o.kind === 'rockKick') this.weapons.burst.spawn(o.pos.x, gy, o.pos.z, o.kind === 'boulder' ? 0.3 : 0.22); }
          if (low && o.el === 'fire') this.burn(o.pos.x, o.pos.z, gy, o.owner);
          if (o.el === 'water') this.extinguishNear(o.pos, 2);
          if (o.el === 'earth' && w.shake) w.shake(0.1, o.pos);
          this.kill(o); done = true;
        }
      }
      if (!done) {
        // water and wind put out fires they pass over
        if (o.el === 'water' && o.pos.y < 2) this.extinguishNear(o.pos, S.wide ? 1.2 : 0.7);
        this.animateObj(o, dt);
      }
    }
    this.objs = this.objs.filter(o => o.state !== 'dead');
  }

  animateObj(o, dt) {
    const w = this.world, m = o.mesh;
    m.position.copy(o.pos);
    if (SPEC[o.kind].ice) { if (o.vel.lengthSq() > 1) m.quaternion.setFromUnitVectors(_up, _v.copy(o.vel).normalize()); return; }
    if (o.trails) {
      if (o.el === 'water') o.trails[0].push(o.pos);
      else {
        // three ribbons spiralling around the direction of travel (or around the vertical while orbiting)
        const ax = o.state === 'flying' && o.vel.lengthSq() > 1 ? _v3.copy(o.vel).normalize() : _v3.set(0, 1, 0);
        const u = _a.crossVectors(ax, Math.abs(ax.y) < 0.9 ? _up : _v.set(1, 0, 0)).normalize(), ww = _b.crossVectors(ax, u);
        const rad = o.r * (SPEC[o.kind].wide ? 0.9 : 0.75);
        o.trails.forEach((t, i) => { const a = o.t * 15 + i * (Math.PI * 2 / o.trails.length); t.push(_v2.copy(o.pos).addScaledVector(u, Math.cos(a) * rad).addScaledVector(ww, Math.sin(a) * rad).addScaledVector(ax, (i - (o.trails.length - 1) / 2) * 0.12)); });
      }
    }
    if (o.el === 'earth') { m.rotation.x += o.spin.x * dt * (o.state === 'flying' ? 1 : 0.15); m.rotation.y += o.spin.y * dt * (o.state === 'flying' ? 1 : 0.15); if (o.state === 'flying' && Math.random() < dt * 25) w.fx.puff(o.pos.clone(), _v.set(0, 0.2, 0), 0.3, 0.35, 0xb0a290, 0.3, 1.2); }
    else if (o.el === 'fire') {
      // held orbs circle close to the body, so they burn smaller than a thrown one
      const held = o.state !== 'flying', big = SPEC[o.kind].wide ? 6 : held ? 1 : 3;
      for (let i = 0; i < big; i++) w.fx.fire(o.pos.clone().add(_v.set(rand(-0.15, 0.15) * o.r * 3, rand(-0.1, 0.1), rand(-0.15, 0.15) * o.r * 3)), _v2.copy(o.vel).multiplyScalar(-0.35).add(_v3.set(rand(-0.6, 0.6), rand(0, 1.2), rand(-0.6, 0.6))), o.r * (held ? 1.0 : 1.9), 0.3);
      m.scale.setScalar((SPEC[o.kind].wide ? o.r : o.r * 0.6) * (0.9 + Math.random() * 0.2)); if (SPEC[o.kind].wide) m.scale.z = o.r * 1.6;
    } else if (o.el === 'water') {
      if (!SPEC[o.kind].wide) { const t = o.t * 9; m.scale.set(o.r * (1 + 0.12 * Math.sin(t)), o.r * (1 + 0.12 * Math.sin(t + 2)), o.r * (1 + 0.12 * Math.sin(t + 4))); }
      if (o.tube) {
        // the body of water streams behind the leading globe as one continuous, wobbling tube
        o.hist.unshift(o.pos.clone()); if (o.hist.length > (o.state === 'flying' ? 9 : 5)) o.hist.pop();
        o.tube.set(o.hist, (t) => o.r * (0.8 - t * 0.55), o.t);
      }
      if (Math.random() < (o.state === 'flying' ? 0.7 : 0.08)) w.fx.puff(o.pos.clone(), _v.set(rand(-0.5, 0.5), -0.5, rand(-0.5, 0.5)), 0.12, 0.4, 0x8cc8f2, 0.7, 0.4);
    } else {
      m.rotation.y += dt * 14; if (m.children.length > 1) m.children.forEach((c, i) => c.rotation.z += dt * (8 + i * 3));
      if (Math.random() < 0.6) w.fx.wind(o.pos.clone().add(_v.set(rand(-0.4, 0.4), rand(-0.3, 0.3), rand(-0.4, 0.4)).multiplyScalar(o.r * 2)), _v2.copy(o.vel).multiplyScalar(0.2), 0.35 * o.r * 2, 0.35);
    }
  }

  restrain(t, dur) {
    t.restrainT = dur; t.vel.set(0, Math.min(t.vel.y, 0), 0);
    if (!t.bubble) { t.bubble = new THREE.Mesh(this.geo.sphereHi, this.mat.bubble); t.bubble.scale.setScalar(1.05); this.world.scene.add(t.bubble); }
    this.world.popup(t, 'RESTRAINED', true);
  }

  updateRings(dt) {
    const w = this.world;
    for (const r of this.rings) {
      r.r += r.speed * dt;
      const k = r.r / r.maxR;
      r.mesh.scale.setScalar(r.r); r.mesh.position.set(r.center.x, r.center.y + 0.3 + (r.el === 'air' ? k * 0.8 : 0), r.center.z);
      r.mesh.material = r.el === 'fire' ? this.mat.fireArc : r.el === 'water' ? this.mat.waterArc : this.mat.air;
      const n = r.el === 'fire' ? 10 : 6;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, p = _v.set(r.center.x + Math.cos(a) * r.r, r.center.y + 0.3 + Math.random() * 0.6, r.center.z + Math.sin(a) * r.r);
        if (r.el === 'fire') w.fx.fire(p, _v2.set(Math.cos(a) * 2, 1.5, Math.sin(a) * 2), 0.6, 0.3);
        else if (r.el === 'water') w.fx.splash(p, 1);
        else w.fx.wind(p, _v2.set(-Math.sin(a) * 9, 2, Math.cos(a) * 9), 0.6, 0.3);
      }
      for (const t of w.fighters) {
        if (t === r.owner || t.dead || r.done.has(t) || t.invuln > 0) continue;
        const d = Math.hypot(t.pos.x - r.center.x, t.pos.z - r.center.z);
        if (Math.abs(d - r.r) < 0.7 && t.pos.y - r.center.y < 1.6) {
          r.done.add(t);
          const dir = new THREE.Vector3(t.pos.x - r.center.x, 0, t.pos.z - r.center.z).normalize();
          w.combat.damage(t, r.hit.dmg, dir, r.owner, r.el + 'Ring', t.chestPos(new THREE.Vector3()), r.hit.knock, r.hit.level);
          if (r.hit.lift) t.vel.y = Math.max(t.vel.y, r.hit.lift);
        }
      }
      for (const o of this.objs) {
        if (o.state !== 'flying' || o.owner === r.owner) continue;
        const d = Math.hypot(o.pos.x - r.center.x, o.pos.z - r.center.z);
        if (Math.abs(d - r.r) < 0.8) {
          if (r.el === 'air') { o.vel.set(o.pos.x - r.center.x, 0.1, o.pos.z - r.center.z).setLength(Math.max(o.vel.length(), 18)); o.owner = r.owner; }
          else this.clash(o, { el: r.el, vel: new THREE.Vector3(), pos: o.pos, kill() {}, state: 'ring', r: 0, dmgMul: 1, owner: r.owner, mesh: new THREE.Object3D() });
        }
      }
      if (r.el === 'water') this.extinguishNear(_v.set(r.center.x, 0, r.center.z), r.r);
      r.mesh.material.opacity = 0.85 * (1 - k * 0.7);
      if (r.r >= r.maxR) { r.dead = true; w.scene.remove(r.mesh); }
    }
    this.rings = this.rings.filter(r => !r.dead);
  }

  updateDefences(dt) {
    const w = this.world;
    for (const d of this.defs) {
      if (d.dead) continue;
      d.t += dt;
      if (d.sink > 0) {
        d.sink += dt; d.rise = 1 - smooth01(d.sink / 0.3);
        if (d.sink > 0.3) { d.dead = true; w.scene.remove(d.mesh); continue; }
      } else {
        d.rise = smooth01(d.t / (d.el === 'earth' ? 0.16 : 0.12));
        if (!d.ice) this.placeDef(d, 1 - Math.exp(-10 * dt));
        if (d.el === 'earth' && d.t < 0.2 && Math.random() < 0.5) w.fx.debrisBurst(d.pos.clone().setY(d.pos.y + 0.05), 1, 1.5, 0.07, 0x7a6a58, 0.6);
      }
      let shk = 0; if (d.shake > 0) { d.shake -= dt; shk = (Math.random() - 0.5) * 0.08; }
      if (d.el === 'earth') { d.mesh.position.set(d.pos.x + shk, d.pos.y - (1 - d.rise) * 2.1, d.pos.z); d.mesh.rotation.set(0, d.yaw, 0); }
      else if (d.el === 'fire') {
        // a curtain of flame: emitted along the wall's width every frame
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
        for (let i = 0; i < 9; i++) { const lx = rand(-1.2, 1.2); w.fx.fire(_v.set(d.pos.x + lx * c, d.pos.y + rand(0, 0.5) * d.rise, d.pos.z - lx * s), _v2.set(0, rand(2, 4) * d.rise, 0), 0.55, 0.45); }
        this.lightBoost = 1; this.light.position.set(d.pos.x, d.pos.y + 1, d.pos.z);
        // melee attackers touching the flames get burned
        for (const t of w.fighters) if (t !== d.owner && !t.dead && this.defContains(d, t.chestPos(_v3).setY(t.pos.y + 0.8), 0.4) && (d.burnTick = (d.burnTick || 0) - dt) < 0) { d.burnTick = 0.4; w.combat.damage(t, 3, new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)), d.owner, 'fireWall', t.chestPos(new THREE.Vector3()), 3, 0); }
      } else if (d.el === 'water') {
        d.flash = Math.max(0, d.flash - dt * 5);
        d.fx.update(d.t, d.rise, d.flash);
        if (!d.ice) {
          d.mesh.position.copy(d.pos); d.mesh.rotation.y = d.yaw;
          // spray along the top of the curtain / the streams
          if (Math.random() < 0.6) { const a = d.yaw + (Math.random() - 0.5) * 2 * (d.arc ? d.arc.half : Math.PI), r = d.arc ? d.arc.r : 0.9; w.fx.splash(_v.set(d.pos.x + Math.sin(a) * r, d.pos.y + (d.arc ? d.arc.h * d.rise * 0.93 : rand(0.6, 1.3)), d.pos.z + Math.cos(a) * r), 1); }
          this.extinguishNear(_v.set(d.pos.x, d.pos.y, d.pos.z), 1.3);
        } else if (d.free) {
          d.life -= dt;
          if (d.life <= 0) this.breakDefence(d);
        }
      } else {
        d.mesh.position.copy(d.pos); d.mesh.scale.setScalar(d.rise); d.mesh.rotation.y += dt * 9;
        for (let k = 0; k < 2; k++) { const a = Math.random() * 6.28; w.fx.wind(_v.set(d.pos.x + Math.cos(a) * d.sphere, d.pos.y + rand(-0.8, 0.8), d.pos.z + Math.sin(a) * d.sphere), _v2.set(-Math.sin(a) * 8, 0, Math.cos(a) * 8), 0.5, 0.3); }
      }
      if (!d.ice && !d.owner.guarding && d.sink === 0) d.sink = 0.001;
    }
    this.defs = this.defs.filter(d => !d.dead);
  }

  updateEnvironment(dt) {
    const w = this.world;
    // burning ground: hurts anyone standing in it, spreads flame particles
    for (const b of this.burns) {
      b.t -= dt;
      if (Math.random() < dt * 9) w.fx.fire(_v.set(b.x + rand(-b.r, b.r) * 0.7, b.y + 0.05, b.z + rand(-b.r, b.r) * 0.7), _v2.set(0, rand(1.5, 3), 0), 0.42, 0.4);
      b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = 0.4;
        for (const t of w.fighters) if (!t.dead && t.onGround && Math.hypot(t.pos.x - b.x, t.pos.z - b.z) < b.r && Math.abs(t.pos.y - b.y) < 0.4 && t !== b.owner) w.combat.damage(t, 2, new THREE.Vector3(0, 0, 0), b.owner, 'burn', t.chestPos(new THREE.Vector3()), 0, -1);
      }
    }
    this.burns = this.burns.filter(b => b.t > 0);
    // seismic spikes erupt one after another
    for (const s of this.spikes) {
      s.t += dt;
      if (s.t >= 0 && !s.mesh) {
        s.mesh = s.ice ? new THREE.Mesh(this.iceShard, iceMat) : new THREE.Mesh(this.pillarGeo, this.mat.stone);
        if (s.ice) { s.mesh.rotation.set(rand(-0.25, 0.25), rand(0, 6), rand(-0.25, 0.25)); s.mesh.scale.setScalar(0.8 + Math.random() * 0.3); } else s.mesh.scale.set(0.35, 0.9, 0.35);
        s.mesh.castShadow = true;
        s.mesh.position.copy(s.pos).setY(s.pos.y - 1); w.scene.add(s.mesh);
        if (s.ice) { w.fx.splash(s.pos.clone().setY(s.pos.y + 0.2), 6); w.audio.splash(0.4); } else { w.fx.debrisBurst(s.pos.clone().setY(s.pos.y + 0.1), 8, 3, 0.1, 0x7a6a58); w.audio.rumble(0.4); }
        for (const t of w.fighters) if (t !== s.owner && !t.dead && !s.hit.has(t) && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < 1.0 && t.pos.y - t.groundY < 0.6 && t.invuln <= 0) {
          s.hit.add(t); w.combat.damage(t, 9, new THREE.Vector3(t.pos.x - s.owner.pos.x, 0, t.pos.z - s.owner.pos.z).normalize(), s.owner, 'spike', t.chestPos(new THREE.Vector3()), 3, 2); t.vel.y = 7;
        }
      }
      if (s.mesh) { const k = s.t < 0.15 ? smooth01(s.t / 0.15) : s.t > 1.3 ? 1 - smooth01((s.t - 1.3) / 0.3) : 1; s.mesh.position.y = s.pos.y - 1 + k * 1.15; }
      // ice reacts to the other elements: fire melts it (steam), rock projectiles shatter it
      if (s.ice && s.mesh && s.t < 1.3) for (const o of this.objs) {
        if (o.state !== 'flying' || (o.el !== 'fire' && o.el !== 'earth') || Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z) > 0.9 || o.pos.y > s.pos.y + 1.6) continue;
        s.t = 1.3; if (o.el === 'fire') { w.fx.steam(s.pos.clone().setY(s.pos.y + 0.6), 10); this.kill(o, 'steam'); } else { w.fx.debrisBurst(s.pos.clone().setY(s.pos.y + 0.6), 12, 3, 0.08, 0xbfe8ff); this.kill(o); }
        break;
      }
      if (s.t > 1.6) { if (s.mesh) w.scene.remove(s.mesh); s.dead = true; }
    }
    this.spikes = this.spikes.filter(s => !s.dead);
    // pillars rise, stand for a while, then sink back
    for (const p of this.pillars) {
      p.t += dt; p.life -= dt;
      const k = p.life > 0 ? smooth01(p.t / 0.22) : 1 - smooth01(-p.life / 0.4);
      p.mesh.position.y = p.gy - 1.6 + k * 1.6; p.col.top = p.gy + 1.45 * Math.max(0.05, k);
      if (p.life < -0.4) { p.dead = true; w.scene.remove(p.mesh); p.col.dead = true; w.arena.colliders = w.arena.colliders.filter(c => c !== p.col); w.arena.cameraBlockers = w.arena.cameraBlockers.filter(m => m !== p.mesh); }
    }
    this.pillars = this.pillars.filter(p => !p.dead);
    // restraint bubbles follow their captives
    for (const t of w.fighters) {
      if (t.restrainT > 0) { t.restrainT -= dt; if (t.bubble) { t.bubble.position.set(t.pos.x, t.pos.y + 1.0, t.pos.z); t.bubble.visible = true; } if (t.restrainT <= 0 || t.dead) { if (t.bubble) { w.scene.remove(t.bubble); t.bubble = null; } w.fx.splash(t.chestPos(_v), 16); } }
    }
    w.arena.updateLoose(dt, w.fx);
  }

  // water GUARD + HAND: an ice spear formed from the guard and thrown at the opponent
  iceSpear(f) { const o = this.fire('iceSpear', f, this.handPoint(f, 1).setY(f.pos.y + 1.35)); this.world.fx.debrisBurst(o.pos, 6, 2, 0.05, 0xbfe8ff); this.world.audio.splash(0.6); return o; }
  // HAND during the circulation releases the streams early; returns true if it did
  spiralRelease(f) {
    // the Dragon Stream: HAND is the two-handed push that throws it
    if (this.specials.waterCanRelease(f) && f.style.tech.release) { f.startTech(f.style.tech.release, f.handSide || 1); return true; }
    const sp = this.spirals.find(s => s.owner === f && s.t > 0.45 && s.released < 0);
    if (!sp) return false;
    // each HAND redirects one stream at the opponent; the last one ends the spiral
    sp.sent = (sp.sent || 0);
    const o = this.fire('water', f, sp.pts[sp.sent][0].clone(), { scale: 1.25 }); o.dmg = 6 + sp.boost * 2; o.knock = 7; o.level = 1;
    sp.streams[sp.sent].mesh.visible = false; sp.gone = sp.gone || new Set(); sp.gone.add(sp.sent);
    sp.sent++; this.world.audio.splash(0.7);
    if (sp.sent >= 3) { sp.released = 99; }
    return true;
  }
  updateSpirals(dt) {
    const w = this.world;
    for (const sp of this.spirals) {
      const f = sp.owner; sp.t += dt; sp.tick -= dt;
      if (f.dead || f.el !== 'water' || f.reacting() && f.action === 'down') sp.released = sp.released < 0 ? 99 : sp.released;   // knocked down: the water collapses
      if (sp.released < 0 && sp.t > 2.6) sp.released = 0;
      const gather = smooth01(Math.min(1, sp.t / 0.45)), R = 0.75 + 0.35 * gather;
      sp.streams.forEach((tb, i) => {
        const gone = (sp.released >= 0 && sp.released > i * 0.12) || (sp.gone && sp.gone.has(i));
        if (gone) { tb.mesh.visible = false; return; }
        const pts = sp.pts[i], base = sp.t * 5.2 + i * Math.PI * 2 / 3;
        for (let k = 0; k < 12; k++) {
          const a = base - k * 0.2, hh = 0.45 + 0.42 * Math.sin(sp.t * 2.3 + i * 2.1 - k * 0.12) + 0.25;   // between 0.3 m and 1.35 m: the head stays clear
          pts[k].set(f.pos.x + Math.sin(a) * R, f.pos.y + 0.1 + (hh - 0.1) * gather, f.pos.z + Math.cos(a) * R);
        }
        tb.set(pts, (t) => (0.13 + 0.03 * sp.boost) * (1 - t * 0.7) * (0.3 + 0.7 * gather), sp.t);
        if (Math.random() < dt * 8) w.fx.splash(pts[0], 1);
      });
      if (sp.released < 0) {
        // circulating: intercept projectiles and push attackers out
        for (const o of this.objs) {
          if (o.state !== 'flying' || o.owner === f) continue;
          if (Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) > R + 0.5 || o.pos.y < f.pos.y - 0.2 || o.pos.y > f.pos.y + 1.7) continue;
          sp.caught++; this.kill(o, o.el === 'fire' ? 'steam' : undefined);
          if (sp.caught === 1 || Math.random() < 0.3) w.popup(f, o.el === 'water' ? 'ABSORBED' : 'CAUGHT', false);
        }
        if (sp.tick <= 0) {
          sp.tick = 0.35;
          for (const t of w.fighters) {
            if (t === f || t.dead || t.invuln > 0) continue;
            const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz) || 1;
            if (d < R + 0.7 && Math.abs(t.pos.y - f.pos.y) < 1.5) {
              // the circling water shoves attackers out; it stings once, it does not grind them down
              t.ext.x += dx / d * 5; t.ext.z += dz / d * 5;
              if (!(sp.stung ||= new Set()).has(t)) { sp.stung.add(t); w.combat.damage(t, 3, _v.set(dx / d, 0, dz / d), f, 'spiral', t.chestPos(new THREE.Vector3()), 1, 0); }
            }
          }
          w.audio.splash(0.25);
        }
      } else if (sp.released < 99) {
        // release: each stream leaves from its head toward the opponent, 0.12 s apart
        const prev = sp.released; sp.released += dt;
        for (let i = 0; i < 3; i++) if (prev <= i * 0.12 && sp.released > i * 0.12 && !(sp.gone && sp.gone.has(i))) {
          const o = this.fire('water', f, sp.pts[i][0].clone(), { scale: 1.25 }); o.dmg = 6 + sp.boost * 2; o.knock = 7; o.level = 1;
          w.audio.splash(0.7);
        }
      }
      if (sp.released > 0.5) { sp.dead = true; for (const tb of sp.streams) { w.scene.remove(tb.mesh); tb.mesh.geometry.dispose(); tb.mat.dispose(); } }
    }
    this.spirals = this.spirals.filter(s => !s.dead);
  }

  clear() {
    for (const sp of this.spirals) for (const tb of sp.streams) this.world.scene.remove(tb.mesh);
    this.spirals = [];
    this.weapons.clear(); this.specials.clear();
    // projectiles leave nothing behind: their mesh and, for water, the stream drawn behind them
    for (const o of this.objs) { this.world.scene.remove(o.mesh); if (o.tube) { this.world.scene.remove(o.tube.mesh); o.tube.mesh.geometry.dispose(); o.tube.mesh.material.dispose(); o.tube = null; } }
    for (const d of this.defs) this.world.scene.remove(d.mesh);
    this.world.arena.colliders = this.world.arena.colliders.filter(c => !c.ice);
    for (const r of this.rings) this.world.scene.remove(r.mesh);
    for (const s of this.spikes) if (s.mesh) this.world.scene.remove(s.mesh);
    for (const p of this.pillars) { this.world.scene.remove(p.mesh); p.col.dead = true; }
    this.world.arena.colliders = this.world.arena.colliders.filter(c => !c.pillar);
    this.world.arena.cameraBlockers = this.world.arena.cameraBlockers.filter(m => !this.pillars.some(p => p.mesh === m));
    for (const [f] of this.holds) this.holdEnd(f);
    for (const f of this.world.fighters) { if (f.bubble) { this.world.scene.remove(f.bubble); f.bubble = null; } f.restrainT = 0; f.defense = null; }
    this.objs = []; this.defs = []; this.rings = []; this.spikes = []; this.pillars = []; this.burns = [];
    this.world.arena.resetLoose();
  }
}
export { SPEC };
