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
import { ICE, iceClusterMesh } from './ice.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _q = new THREE.Quaternion();

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
function distPointSeg(p, a, b) {
  const ab = _s1.subVectors(b, a), t = clamp(_s2.subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return _s2.copy(a).addScaledVector(ab, t).distanceTo(p);
}

export class Weapons {
  constructor(B) {
    this.B = B; this.w = B.world;
    this.whips = []; this.waves = []; this.columns = []; this.erupts = []; this.fireRings = []; this.captures = []; this.grabs = [];
    this.trails = []; this.platforms = []; this.arcs = []; this.traps = []; this.whirls = []; this.spires = [];
    this.tubeMat = waterMaterial(-4); this.tubeMat.uniforms.uRise.value = 1;
    this.tubePool = [];
    // air: the same rope drawn as a pale, fast-turning translucent current (it has a body, not only streaks)
    // a cool blue-grey core with white streaks: readable against the pale floor and the sky alike
    this.airTubeMat = waterMaterial(-9); Object.assign(this.airTubeMat.uniforms, { uOpacity: { value: 0.58 } }); this.airTubeMat.uniforms.uRise.value = 1;
    this.airTubeMat.uniforms.uDeep.value.set(0x6f86c4); this.airTubeMat.uniforms.uLight.value.set(0xc6d3f5); this.airTubeMat.uniforms.uFoam.value.set(0xffffff);
    this.burst = new GroundBurst(this.w);   // earth's ground reaction (baked fracture simulation)
    this.iceTubeMat = iceMat;
    this.slabGeo = (() => { const g = new THREE.BoxGeometry(1.5, 0.35, 2.1, 3, 1, 3); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + rand(-0.06, 0.06), p.getY(i) + rand(-0.05, 0.05), p.getZ(i) + rand(-0.06, 0.06)); g.computeVertexNormals(); return g; })();
    // the ice the water bender rides: a thick, faceted floe (flat on top), not a flat disc
    this.iceSheetGeo = (() => { const g = new THREE.CylinderGeometry(0.85, 0.7, 0.22, 9, 1); g.translate(0, -0.11, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.01) p.setXYZ(i, p.getX(i) * rand(0.85, 1.1), p.getY(i) - rand(0, 0.08), p.getZ(i) * rand(0.85, 1.1)); g.computeVertexNormals(); return g; })();
    this.rampGeo = (() => { const g = new THREE.CylinderGeometry(0.75, 1.1, 2.4, 7, 1); g.translate(0, 1.2, 0); return g; })();   // ice pillar with a flat top
    this.ringGeo = (() => { const g = new THREE.TorusGeometry(1, 0.16, 6, 64); g.rotateX(Math.PI / 2); return g; })();
    this.markGeo = (() => { const g = new THREE.RingGeometry(0.6, 1.0, 32); g.rotateX(-Math.PI / 2); return g; })();
    this.waveGeo = (() => { const g = new THREE.PlaneGeometry(1, 1, 16, 6); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.5; p.setZ(i, Math.sin(y * Math.PI) * 0.35 - y * y * 0.4); p.setY(i, y); } g.computeVertexNormals(); return g; })();
    // a breaking wave, 1 m tall and 1 m wide: the back rises from the floor, the crest curls forward and over, the lip
    // hangs down in front. uv.y runs from the floor (0) to the lip (1), so the water shader's foam sits on the curl
    this.breakerGeo = (() => {
      const prof = [];
      for (let i = 0; i <= 22; i++) {
        const u = i / 22;
        // back slope (0..0.55), crest (0.55..0.75), curl over and down (0.75..1)
        const a = u < 0.55 ? u / 0.55 : 1;
        let z = -1.0 + 1.1 * Math.sin(a * Math.PI / 2), y = Math.pow(a, 1.35) * 0.92;   // a concave back face rising steeply to the crest
        if (u > 0.55) { const c = (u - 0.55) / 0.45, ang = c * Math.PI * 1.05; z = 0.15 + Math.sin(ang) * 0.42; y = 0.92 + (Math.cos(ang) - 1) * 0.25 + 0.08 * Math.sin(c * Math.PI); }
        prof.push([z, y]);
      }
      const W = 28, pos = [], uv = [], idx = [];
      for (let j = 0; j <= W; j++) for (let i = 0; i < prof.length; i++) {
        const x = j / W - 0.5, edge = 1 - Math.pow(Math.abs(x) * 2, 8);   // full height almost to the ends, which drop away
        pos.push(x, prof[i][1] * (0.15 + 0.85 * edge), prof[i][0] * (0.7 + 0.3 * edge)); uv.push(j / W, i / (prof.length - 1));
      }
      const P = prof.length;
      for (let j = 0; j < W; j++) for (let i = 0; i < P - 1; i++) { const a = j * P + i, b = a + P; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    })();
    // one sheet of an eruption: a curved strip of water, 1 m tall (uv.y up), opening outward
    this.surgeGeo = (() => { const g = new THREE.CylinderGeometry(0.55, 0.8, 1, 10, 6, true, -0.55, 1.1); g.translate(0, 0.5, 0); return g; })();
    this.surges = [];
    // the waves' water: more solid than the guard, foam all along the crest and over the curl
    this.waveMat = waterMaterial(-2.6); this.waveMat.uniforms.uRise.value = 1; this.waveMat.uniforms.uWobble.value = 0.8; this.waveMat.uniforms.uOpacity.value = 0.97; this.waveMat.uniforms.uFoamFrom.value = 0.6;
    this.rockMat = B.mat.stone;
    this.markMat = { earth: new THREE.MeshBasicMaterial({ color: 0x5b4632, transparent: true, opacity: 0.0, depthWrite: false }), water: new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.0, depthWrite: false }), air: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }) };
    this.fireRingMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthWrite: false });
    this.airWaveMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  }

  tube() { const t = this.tubePool.pop() || makeWaterTube(22, 7, this.tubeMat); t.mesh.material = this.tubeMat; t.mesh.visible = true; this.w.scene.add(t.mesh); return t; }
  freeTube(t) { if (!t) return; this.w.scene.remove(t.mesh); t.mesh.visible = false; if (this.tubePool.length < 12) this.tubePool.push(t); else t.mesh.geometry.dispose(); }

  // ============================================================ water whip: grab, lift and slam
  // The whip stays wrapped round the rival: a rope of water from the bender's hand to the rival's chest (redrawn every
  // frame, taut while lifting, sagging a little as it swings). The bender plays the two-handed raise-and-slam clip
  // (Mixamo Grab And Slam from its pull: the arms haul the whip back, lift it overhead and drive it down to one knee;
  // the grabbing is done by the whip, never the fists); the rival, held (thrashing, the struggle clip), is lifted to about 2.6 m and
  // carried over to the bender's front, then on the clip's slam frame driven down into the floor: a heavy knockdown.
  grabSlam(f, t, hand) {
    const T = f.style.tech.whipSlam;
    f.whipW = null; f.whipW2 = null;
    f.startTech(T, 1, true);
    const G = { f, t, hand: hand || 'R', T: 0, tube: this.tube(), start: t.pos.clone(), slamAt: Math.max(0.35, T.impactT || 0.6), slammed: false, slamT: 0 };
    this.grabs.push(G);
    t.restrainT = Math.max(t.restrainT, G.slamAt + 0.2); t.action = null; t.tech = null; t.vel.set(0, 0, 0); t.endMob && t.endMob();
    this.w.popup(f, 'WHIP GRAB', true); this.w.audio.splash(0.9);
  }
  updateGrabs(dt) {
    const w = this.w;
    for (const G of this.grabs) {
      const f = G.f, t = G.t; G.T += dt;
      if (t.dead || f.dead || (f.reacting() && !G.slammed)) { G.dead = true; t.restrainT = 0; continue; }
      const fw = f.forward(_a).setY(0).normalize(), gy = t.groundY;
      if (!G.slammed) {
        const u = Math.min(1, G.T / G.slamAt), e = smooth01(u);
        // up and over: from where the rival was caught to above a point 1.7 m in front of the bender
        const tx = G.start.x + (f.pos.x + fw.x * 1.7 - G.start.x) * e, tz = G.start.z + (f.pos.z + fw.z * 1.7 - G.start.z) * e;
        const ty = gy + 2.6 * Math.sin(Math.min(1, u * 1.25) * Math.PI / 2) + (G.start.y - gy) * (1 - e);
        t.pos.x += (tx - t.pos.x) * Math.min(1, dt * 10); t.pos.y += (ty - t.pos.y) * Math.min(1, dt * 10); t.pos.z += (tz - t.pos.z) * Math.min(1, dt * 10);
        t.vel.set(0, 0, 0); t.onGround = false; t.restrainT = Math.max(t.restrainT, 0.2);
        if (G.T >= G.slamAt) {
          G.slammed = true; t.restrainT = 0; t.slamFall = true;
          w.combat.damage(t, 16, fw.clone(), f, 'whipSlam', t.chestPos(new THREE.Vector3()), 3, 2);
          t.vel.set(fw.x * 2, -24, fw.z * 2); t.onGround = false; t.invuln = Math.max(t.invuln, 0.6);
          w.audio.splash(1.2);
        }
      } else {
        G.slamT += dt;
        if (t.onGround || G.slamT > 0.45) {
          G.dead = true; t.slamFall = false;
          const at = _b.set(t.pos.x, t.groundY, t.pos.z);
          w.fx.crater(at, 2.4); w.shake(0.45, at); w.audio.impact(1.3); w.popup(f, 'SLAM', true);
          this.ringBurst(at, 1.5, 2.1, 11); w.audio.splash(1.2, at);
          this.burst.spawn(at.x, at.y, at.z, 0.3);
        }
      }
      // the rope: hand to chest, taut while lifting (a slight sag), whipping straight on the slam
      const h = f.handPos(G.hand, _c), c = t.chestPos(_d), n = 12, pts = [];
      const sag = G.slammed ? 0.05 : 0.35 * (1 - Math.min(1, G.T / G.slamAt));
      for (let k = 0; k <= n; k++) { const s = k / n; pts.push(new THREE.Vector3(h.x + (c.x - h.x) * s, h.y + (c.y - h.y) * s - Math.sin(Math.PI * s) * sag + Math.sin(G.T * 18 + s * 9) * 0.04, h.z + (c.z - h.z) * s)); }
      G.tube.set(pts, (q) => 0.075 + 0.03 * Math.sin(Math.PI * q), G.T * 3);
    }
    this.grabs = this.grabs.filter(G => { if (G.dead) this.freeTube(G.tube); return !G.dead; });
  }

  // ============================================================ whips
  // A whip is a rope of 14 points hanging from the striking hand (or foot), simulated every frame:
  //   - the root is the hand bone itself; the rope's lay comes from the forearm direction (elbow to hand) and the
  //     hand's own velocity, so the arm motion of the clip is what swings it (each arm path gives its own whip path)
  //   - points carry momentum (verlet), so the far end lags behind the hand, coils when the arm turns, and catches up
  //   - on the technique's impact frame the rope is released: it extends to full length and the far end is thrown
  //     toward the target (the lash); hits are tested only from then on, along the paths the points travelled
  //   - when the technique ends the rope draws back into the hand
  // opts: { hand: 'L'|'R', foot: 'L'|'R', len, dmg, knock, level, released, frozen, tech, hitWin, life, tag }
  whipStrike(f, el, kind, opts = {}) {
    const side = opts.side ?? (f.techSide || 1);
    const limb = opts.foot ? 'foot' : 'hand', ls = opts.foot || opts.hand || (side > 0 ? 'L' : 'R');
    const t = f.target && !f.target.dead ? f.target : null;
    const dist = t ? Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) : 4;
    const N = 14, root = this.limbPos(f, limb, ls, new THREE.Vector3());
    const W = {
      f, el, kind, limb, ls, t: 0, tRel: -1, ext: 0, out: true, tech: opts.tech || null, life: opts.life || 1.6,
      len: Math.min(4.6, opts.len || clamp(dist + 0.4, 2.6, 4.6)), dmg: opts.dmg ?? 8, knock: opts.knock ?? 7, level: opts.level ?? 1,
      hitWin: opts.hitWin || 0.3, pts: Array.from({ length: N }, () => root.clone()), old: Array.from({ length: N }, () => root.clone()),
      prev: Array.from({ length: N }, () => root.clone()), rootPrev: root.clone(), vRoot: new THREE.Vector3(), dir: new THREE.Vector3(),
      hit: new Set(), frozen: !!opts.frozen, aim: this.B.aimDir(f, root, new THREE.Vector3()), tag: opts.tag || el + 'Whip', spin: kind === 'circle',
    };
    this.limbDir(f, limb, ls, W.dir);
    if (el === 'water') { W.tube = this.tube(); if (W.frozen) W.tube.mesh.material = iceMat; }
    if (el === 'air') { W.tube = this.tube(); W.tube.mesh.material = this.airTubeMat; }
    if (el === 'air') W.ribbons = [0, 1, 2].map(i => this.w.fx.ribbons.start({ color: i === 1 ? 0x8fa6e8 : 0xe8eeff, width: 0.2 - i * 0.04, life: 0.3, alpha: 0.95 }));
    this.whips.push(W);
    if (opts.released) this.releaseWhip(W);
    return W;
  }
  limbPos(f, limb, s, out) { return limb === 'foot' ? f.footPos(s, out) : f.handPos(s, out); }
  // the limb's pointing direction: elbow to hand, or knee to foot
  limbDir(f, limb, s, out) {
    const tip = this.limbPos(f, limb, s, _c), b = f.hero && f.hero.bones[limb === 'foot' ? 'DEF-shin' + s : 'DEF-forearm' + s];
    if (b) b.getWorldPosition(out); else f.chestPos(out);
    return out.subVectors(tip, out).normalize();
  }
  // the impact frame: full length, the lash thrown at the target, hits live
  releaseWhip(W) {
    if (W.tRel >= 0) return;
    const f = W.f; W.tRel = W.t;
    this.B.aimDir(f, this.limbPos(f, W.limb, W.ls, _a), W.aim);
    // the lash: the outer half of the rope is thrown along the aim and the hand's own motion
    const v = _b.copy(W.aim).multiplyScalar(W.spin ? 6 : 15).addScaledVector(W.vRoot, 0.4), dt = W.dtLast || 1 / 60;
    W.pts.forEach((p, k) => { const s = k / (W.pts.length - 1); W.old[k].addScaledVector(v, -s * s * dt); });
    if (W.el === 'water') this.w.audio.splash(0.55); else if (W.el === 'air') this.w.audio.gust(0.65); else this.w.audio.fireWhoosh(0.75);
  }
  updateWhips(dt) {
    for (const W of this.whips) {
      const f = W.f; W.t += dt;
      if (f.dead || f.reacting()) { W.dead = true; continue; }
      // the technique that owns the rope has ended (or the rope has lived its span): it draws back into the hand
      if (W.out && (W.t > W.life || (W.tech && (f.action !== 'tech' || f.tech !== W.tech)) || (!W.tech && W.tRel >= 0 && W.t - W.tRel > W.hitWin + 0.12))) W.out = false;
      this.stepWhip(W, dt);
      if (!W.out && W.ext <= 0.02) { W.dead = true; continue; }
      this.drawWhip(W);
      if (W.tRel >= 0 && W.t - W.tRel < W.hitWin) this.whipHits(W);
    }
    this.whips = this.whips.filter(W => { if (W.dead) this.dropWhip(W); return !W.dead; });
  }
  stepWhip(W, dt) {
    const f = W.f, N = W.pts.length, rel = W.tRel >= 0, tr = rel ? W.t - W.tRel : 0, n60 = dt * 60; W.dtLast = dt;
    const root = this.limbPos(f, W.limb, W.ls, _a);
    // hand velocity (smoothed): the arm's swing is what lays the rope
    W.vRoot.lerp(_b.subVectors(root, W.rootPrev).divideScalar(Math.max(dt, 1e-3)), 0.5); W.rootPrev.copy(root);
    // reach: a short coil around the hand during the wind-up, full length from the release, none when drawn back
    const want = !W.out ? 0 : rel ? 1 : 0.4;
    W.ext += (want - W.ext) * Math.min(1, dt * (rel && W.out ? 22 : W.out ? 9 : 11));
    const seg = W.len * W.ext / (N - 1);
    // lay direction: the forearm, the hand's motion and, around the release, the aim
    const fd = this.limbDir(f, W.limb, W.ls, _c), sp = W.vRoot.length();
    const D = _d.copy(fd).multiplyScalar(W.spin ? 0.4 : 1);
    if (sp > 0.3) D.addScaledVector(W.vRoot, Math.min(1, sp / 5) * 0.9 / sp);
    if (W.spin) { const out = _e.set(root.x - f.pos.x, 0, root.z - f.pos.z); if (out.lengthSq() > 1e-4) D.addScaledVector(out.normalize(), 1.2); }
    // around the release the aim dominates: whatever way the clip turned the body, the lash goes at the target
    else if (rel) D.addScaledVector(W.aim, (tr < 0.2 ? 6 : 3.2) * Math.max(0.25, 1 - tr / 0.32));
    // through the lash itself (0.2 s from the release) the rope lies along the aim alone, so the throw goes where
    // the bender aims whichever way the arm clip carried the hand; before and after it, the arm lays it
    if (rel && tr < 0.2 && !W.spin) D.copy(W.aim);
    D.normalize(); W.dir.lerp(D, Math.min(1, dt * (rel && tr < 0.2 ? 32 : 14))).normalize();
    const grav = W.el === 'water' && !W.frozen ? 5 : 0, gy = f.groundY + 0.06;
    const perp = _e.crossVectors(W.dir, UP); if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0); perp.normalize();
    for (let k = 0; k < N; k++) W.prev[k].copy(W.pts[k]);
    W.pts[0].copy(root); W.old[0].copy(root);
    for (let k = 1; k < N; k++) {
      const s = k / (N - 1), p = W.pts[k], o = W.old[k];
      const damp = Math.pow(0.9, n60), vx = (p.x - o.x) * damp, vy = (p.y - o.y) * damp, vz = (p.z - o.z) * damp;
      o.copy(p); p.x += vx; p.y += vy - grav * dt * dt; p.z += vz;
      // pulled toward the lay line; the root is stiff, the far end is loose and lags (ice is rigid)
      const stiff = 1 - Math.pow(1 - (W.frozen ? 0.55 : 0.4 * (1 - s) * (1 - s) + 0.05 + (rel ? 0.3 * Math.max(0, 1 - tr / 0.28) : 0)), n60);
      const coil = W.el === 'water' && !W.frozen ? Math.sin(W.t * 10 - s * 7) * 0.22 * s * (1 - W.ext * 0.6) : 0;
      const tx = root.x + W.dir.x * k * seg + perp.x * coil, ty = root.y + W.dir.y * k * seg + Math.cos(W.t * 10 - s * 7) * coil * 0.6, tz = root.z + W.dir.z * k * seg + perp.z * coil;
      p.x += (tx - p.x) * stiff; p.y += (ty - p.y) * stiff; p.z += (tz - p.z) * stiff;
    }
    // inextensible: each point stays within one segment of the one before it (slack is allowed, so it can coil)
    for (let it = 0; it < 2; it++) for (let k = 1; k < N; k++) {
      const a = W.pts[k - 1], p = W.pts[k], dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z, d = Math.hypot(dx, dy, dz);
      if (d > seg) { const m = seg / d; p.set(a.x + dx * m, a.y + dy * m, a.z + dz * m); }
      if (p.y < gy) p.y = gy;
    }
  }
  drawWhip(W) {
    const w = this.w, N = W.pts.length, tip = W.pts[N - 1], tv = _a.subVectors(tip, W.prev[N - 1]).multiplyScalar(60), ts = tv.length();
    if (W.tube) {
      // thick at the hand, tapering; a body of water that thins only when it is drawn back
      const fr = W.frozen, e = Math.max(0.35, W.ext);
      if (W.el === 'air') W.tube.set(W.pts.slice().reverse(), (s) => (0.06 + 0.16 * s) * e, W.t * 1.6);
      else W.tube.set(W.pts.slice().reverse(), (s) => ((fr ? 0.075 : 0.07) + (fr ? 0.06 : 0.1) * s) * e, W.t);
      if (W.el === 'water' && !fr && ts > 5 && Math.random() < 0.6) w.fx.splash(tip, 2);
    }
    if (W.ribbons) { W.ribbons[0].push(W.pts[N - 1]); W.ribbons[1].push(W.pts[N - 4]); W.ribbons[2].push(W.pts[N - 8]); if (ts > 4 && Math.random() < 0.6) w.fx.wind(tip, tv.multiplyScalar(0.5), 0.6, 0.3); }
    if (W.el === 'fire') for (let k = 2; k < N; k++) if (Math.random() < 0.75) w.fx.fire(W.pts[k], _b.subVectors(W.pts[k], W.prev[k]).multiplyScalar(20).add(_c.set(0, 1, 0)), (0.2 + 0.28 * k / N) * Math.max(0.4, W.ext), 0.2);
  }
  dropWhip(W) { this.freeTube(W.tube); W.tube = null; if (W.ribbons) for (const r of W.ribbons) r.release(); W.ribbons = null; }
  // tests the whip's segments against fighters, enemy projectiles (the whip swats them aside) and burning ground
  whipHits(W) {
    const w = this.w, B = this.B, f = W.f, N = W.pts.length;
    for (const t of w.fighters) {
      if (t === f || t.dead || W.hit.has(t) || t.invuln > 0) continue;
      const a = _a.set(t.pos.x, t.pos.y + 0.3, t.pos.z), b = _b.set(t.pos.x, t.pos.y + 1.65, t.pos.z);
      for (let k = 3; k < N; k++) {
        // a fast whip moves well over a body width per frame: test the path each point travelled, not only where it is
        let p = null;
        for (let q = 0; q <= 4 && !p; q++) { const c = _e.lerpVectors(W.prev[k], W.pts[k], q / 4); if (distPointSeg(c, a, b) < t.radius + 0.18) p = c.clone(); }
        if (p) {
          W.hit.add(t);
          // the push follows the whip's motion at the point of contact, mixed with the direction of the strike
          const v = _c.subVectors(W.pts[k], W.prev[k]); v.y = 0; if (v.lengthSq() < 1e-6) v.copy(W.aim);
          const dir = v.normalize().multiplyScalar(0.6).add(_d.set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize().multiplyScalar(0.7)).normalize();
          // a whip that catches a rival in the air drives them back down onto the floor with full force
          const airborne = !t.onGround && t.pos.y - t.groundY > 0.5;
          // Water's whip wraps the rival (airborne, or caught by the overhead lash on the ground): grab, lift, slam
          // (a raised guard facing the whip stops the grab: the lash is then resolved against the guard like any blow)
          const guarded = t.guarding && t.defense && w.bending.covers(t.defense, dir);
          if (W.el === 'water' && !W.frozen && !guarded && (airborne || W.kind === 'v') && f.style.tech.whipSlam && !this.grabs.length && t.hp > 0) { W.hit.add(t); this.grabSlam(f, t, W.ls); break; }
          w.combat.damage(t, Math.round((W.frozen ? 1.4 : 1) * (airborne ? 1.5 : 1) * W.dmg), dir.clone(), f, W.tag, p.clone(), W.knock, W.frozen || airborne ? 2 : W.level);
          if (airborne && !t.dead) { t.vel.y = -18; t.vel.x *= 0.3; t.vel.z *= 0.3; w.shake(0.3, p); w.popup(f, 'SLAM', true); }
          if (W.frozen) { w.fx.debrisBurst(p, 10, 3, 0.07, 0xe0f4ff); }
          else if (W.el === 'water') w.fx.splash(p, 14);
          if (W.el === 'fire' && Math.random() < 0.5) B.burn(t.pos.x, t.pos.z, t.groundY, f);
          break;
        }
      }
    }
    for (const o of B.objs) {
      if (o.state !== 'flying' || o.owner === f) continue;
      for (let k = 3; k < N; k += 2) if (W.pts[k].distanceTo(o.pos) < o.r + 0.35) {
        B.kill(o, W.el === 'water' && o.el === 'fire' ? 'steam' : undefined); w.popup(f, 'SWAT', false); break;
      }
    }
    if (W.el === 'water') B.extinguishNear(W.pts[N - 1], 1.2);
  }

  // Sustained whips (HAND held): a rope from each hand, laid by the arms of the held clip (cloud hands) and the
  // stick; the hands lash in turn. Called every frame by the hold; returns false when the hold should end.
  sustain(f, h, dt) {
    const w = this.w, el = f.el;
    if (!h.whips) {
      h.whips = ['L', 'R'].map((s, i) => { const W = this.whipStrike(f, el, 'hold', { hand: s, len: 4.6, dmg: 5, knock: el === 'air' ? 7 : 5, level: 0, life: 1e9, hitWin: 0.3 }); this.whips.splice(this.whips.indexOf(W), 1); W.side = i ? -1 : 1; W.cd = i * 0.3; return W; });
      h.sweep = 0;
    }
    if (h.frozen && el === 'water') for (const W of h.whips) if (W.tube && !W.frozen) { W.frozen = true; W.tube.mesh.material = iceMat; }
    // the stick sweeps the streams across (relative to the fighter's facing); the hands lash in turn
    const c = Math.cos(f.faceYaw), s0 = Math.sin(f.faceYaw), lx = f.input.mx * c - f.input.mz * s0;
    h.sweep += (clamp(lx, -1, 1) - h.sweep) * Math.min(1, dt * 5);
    // a rival just beyond the streams' reach is closed on at a walk while the hold goes on
    const tg = f.target && !f.target.dead ? f.target : null;
    if (tg && f.onGround) { const dx = tg.pos.x - f.pos.x, dz = tg.pos.z - f.pos.z, d = Math.hypot(dx, dz); if (d > 4.4 && d < 10) { f.pos.x += dx / d * 2.2 * dt; f.pos.z += dz / d * 2.2 * dt; } }
    for (const W of h.whips) {
      W.t += dt; W.cd -= dt;
      if (W.cd <= 0) { W.cd = 0.6; W.tRel = -1; W.hit.clear(); this.releaseWhip(W); }
      // the aim is swung by the stick, so the release throws the lash where the player steers
      if (W.tRel >= 0 && W.t - W.tRel < 0.05) W.aim.applyAxisAngle(UP, h.sweep * 0.9);
      this.stepWhip(W, dt); this.drawWhip(W);
      if (W.tRel >= 0 && W.t - W.tRel < W.hitWin) this.whipHits(W);
    }
    return true;
  }
  endSustain(h) { if (h.whips) for (const W of h.whips) this.dropWhip(W); h.whips = null; }

  // ============================================================ limb arcs
  // A kick or strike throws the element along the path the limb has just travelled: the last ~0.2 s of the foot (or
  // hand) positions become the arc's shape, so a crescent kick throws a crescent, a front kick a short upright arc, a
  // spinning kick a wide flat one. The arc then flies at the target, widening, and strikes along its whole length.
  // opts: { span, speed, life, dmg, knock, level, grow, tag }
  limbArc(f, el, limb, s, opts = {}) {
    let path = f.limbPath(limb, s, opts.span || 0.2);
    const N = 12, pts = [];
    if (path.length < 3) {   // no recorded motion (the fighter was just created): a short arc around the limb
      const c = this.limbPos(f, limb, s, new THREE.Vector3()), r = _a.crossVectors(f.forward(_b), UP).normalize();
      path = [-1, 0, 1].map(k => c.clone().addScaledVector(r, k * 0.5).add(_c.set(0, -Math.abs(k) * 0.15, 0)));
    }
    // resample evenly along the path's length
    const L = [0]; for (let i = 1; i < path.length; i++) L.push(L[i - 1] + path[i].distanceTo(path[i - 1]));
    const tot = Math.max(1e-3, L[L.length - 1]);
    for (let k = 0; k < N; k++) { const d = tot * k / (N - 1); let i = 1; while (i < L.length - 1 && L[i] < d) i++; const u = clamp((d - L[i - 1]) / Math.max(1e-4, L[i] - L[i - 1]), 0, 1); pts.push(new THREE.Vector3().lerpVectors(path[i - 1], path[i], u)); }
    // a path too short to read (a slow or blocked kick) is stretched around its middle to at least 1.2 m
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(N), span = pts[0].distanceTo(pts[N - 1]);
    const st = span < 1.2 ? 1.2 / Math.max(0.2, span) : 1;
    const off = pts.map(p => p.clone().sub(c).multiplyScalar(st));
    const aim = this.B.aimDir(f, c, new THREE.Vector3()); aim.y = clamp(aim.y, -0.15, 0.25); aim.normalize();
    const A = { f, el, c, off, v: aim.multiplyScalar(opts.speed || 15), t: 0, life: opts.life || 0.65, grow: opts.grow ?? 1.4,
      pts: off.map(o => o.clone().add(c)), prev: off.map(o => o.clone().add(c)), hit: new Set(), dmg: (opts.dmg ?? 8) + (el === 'air' ? 2 : 0), knock: opts.knock ?? 8, level: opts.level ?? 1, tag: opts.tag || el + 'Arc' };
    if (el === 'water' || el === 'air') { A.tube = this.tube(); if (el === 'air') A.tube.mesh.material = this.airTubeMat; }
    if (el === 'air') A.ribbons = [0, N - 1].map(() => this.w.fx.ribbons.start({ color: 0xb8c8f4, width: 0.18, life: 0.28, alpha: 0.95 }));
    this.arcs.push(A);
    if (el === 'water') this.w.audio.splash(0.8); else if (el === 'air') this.w.audio.gust(0.9); else this.w.audio.fireWhoosh(0.9);
    return A;
  }
  updateArcs(dt) {
    const w = this.w, B = this.B;
    for (const A of this.arcs) {
      A.t += dt; const u = A.t / A.life;
      if (u >= 1) { A.dead = true; continue; }
      A.c.addScaledVector(A.v, dt);
      const g = 1 + A.grow * u;
      for (let k = 0; k < A.pts.length; k++) { A.prev[k].copy(A.pts[k]); A.pts[k].copy(A.off[k]).multiplyScalar(g).add(A.c); }
      // stopped by walls and rock
      if (w.arena.solidAt(A.c, 0.2)) { A.dead = true; if (A.el === 'water') w.fx.splash(A.c, 12); continue; }
      const fade = 1 - smooth01((u - 0.7) / 0.3), N = A.pts.length;
      if (A.tube) A.tube.set(A.pts, (s) => (A.el === 'air' ? 0.22 : 0.19) * (0.35 + 0.65 * Math.sin(Math.PI * s)) * fade + 0.01, A.t * 2);
      if (A.ribbons) { A.ribbons[0].push(A.pts[0]); A.ribbons[1].push(A.pts[N - 1]); }
      // fire: EmberGen flame sprites laid along the whole curve every frame, so the kick throws one connected arc of
      // flame that follows the leg's path (thicker in the middle of the arc, thinning at its ends)
      if (A.el === 'fire') for (let k = 0; k < N; k++) if (Math.random() < 0.6 * fade * (1 - 0.6 * u)) { const mid = Math.sin(Math.PI * k / (N - 1)); w.fx.flip.spawn('fire_flames', { pos: A.pts[k], vel: _a.copy(A.v).multiplyScalar(0.3).add(_b.set(rand(-0.4, 0.4), 1.4, rand(-0.4, 0.4))), size: [0.45 + 0.5 * mid, 0.55 + 0.6 * mid], grow: 1.2, life: 0.22, f0: 10 + rand(0, 8), f1: 34, rise: 1.5, fadeIn: 0.02, rot: rand(-0.6, 0.6), alpha: 0.9 * fade }); }
      if (A.el === 'water' && Math.random() < 0.4) w.fx.splash(A.pts[(Math.random() * N) | 0], 1);
      if (A.el === 'air' && Math.random() < 0.5) w.fx.wind(A.pts[(Math.random() * N) | 0], _a.copy(A.v).multiplyScalar(0.3), 0.6, 0.25);
      for (const t of w.fighters) {
        if (t === A.f || t.dead || A.hit.has(t) || t.invuln > 0) continue;
        const a = _a.set(t.pos.x, t.pos.y + 0.2, t.pos.z), b = _b.set(t.pos.x, t.pos.y + 1.7, t.pos.z);
        for (let k = 0; k < N; k++) {
          let p = null; for (let q = 0; q <= 3 && !p; q++) { const cq = _e.lerpVectors(A.prev[k], A.pts[k], q / 3); if (distPointSeg(cq, a, b) < t.radius + 0.22) p = cq.clone(); }
          if (p) {
            A.hit.add(t);
            w.combat.damage(t, A.dmg, _c.copy(A.v).setY(0).normalize(), A.f, A.tag, p, A.knock, A.level);
            if (A.el === 'water') w.fx.splash(p, 14); else if (A.el === 'fire') { for (let i = 0; i < 8; i++) w.fx.fire(p, _d.set(rand(-2, 2), rand(0, 3), rand(-2, 2)), 0.5, 0.3); if (Math.random() < 0.5) B.burn(t.pos.x, t.pos.z, t.groundY, A.f); }
            break;
          }
        }
      }
      // what the arc meets in the air is destroyed: tested along the path the projectile covered this frame (the two
      // close at ~40 m/s, over a metre a frame), and wider for fire, which is meant as a defence
      for (const o of B.objs) {
        if (o.state !== 'flying' || o.owner === A.f) continue;
        const p0 = _d.copy(o.pos).addScaledVector(o.vel, -dt), reach = o.r + (A.el === 'fire' ? 0.7 : 0.4);
        if (A.pts.some(p => distPointSeg(p, p0, o.pos) < reach)) { B.kill(o, A.el === 'water' && o.el === 'fire' || A.el === 'fire' && o.el === 'water' ? 'steam' : undefined); if (o.el === 'earth') w.fx.debrisBurst(o.pos, 8, 3, 0.07, 0x7a7068); }
      }
      if (A.el === 'water') B.extinguishNear(A.c, 1.4);
    }
    this.arcs = this.arcs.filter(A => { if (A.dead) { this.freeTube(A.tube); A.tube = null; if (A.ribbons) A.ribbons.forEach(r => r.release()); A.ribbons = null; } return !A.dead; });
  }

  // ============================================================ waves
  // water: a wall of water advancing over the ground; air: a pressure wave. Both push, put out fire (water) and
  // sweep away projectiles; the water wave freezes into ice spikes where it stops if `freeze`
  wave(f, el, opts = {}) {
    const w = this.w, dir = this.B.aimDir(f, f.pos, new THREE.Vector3()).setY(0).normalize();
    // water: a breaking wave (default 3.4 m tall, about twice the bender) launched by an eruption of water in front
    const water = el === 'water', H = opts.h || (water ? 3.4 : 2.2);
    const mesh = new THREE.Mesh(water ? this.breakerGeo : this.waveGeo, water ? this.waveMat : this.airWaveMat);
    mesh.scale.set(opts.width || 6, H, water ? H * 0.75 : 1.6); mesh.renderOrder = 3;
    const pos = new THREE.Vector3(f.pos.x + dir.x * 1.2, f.groundY, f.pos.z + dir.z * 1.2);
    mesh.position.copy(pos); mesh.rotation.y = Math.atan2(dir.x, dir.z); w.scene.add(mesh);
    this.waves.push({ f, el, dir, pos, mesh, t: 0, life: opts.life || 1.1, speed: opts.speed || (el === 'water' ? 10 : 18), width: opts.width || 6, hit: new Set(), dmg: opts.dmg ?? (el === 'water' ? 10 : 6), knock: opts.knock ?? (el === 'water' ? 10 : 14), level: opts.level ?? 2, freeze: !!opts.freeze });
    this.waves[this.waves.length - 1].h = H;
    if (water) this.eruption(f, pos, dir, opts.width || 6, H * 1.15);
    if (el === 'water') w.audio.splash(1.2); else w.audio.gust(1.2);
  }
  // water bursts up out of the floor in a fan of sheets in front of the bender (staggered from the middle outwards),
  // rises past the bender's head and falls back: the burst that launches a wave
  eruption(f, at, dir, width = 5, h = 3.8) {
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize(), n = Math.max(5, Math.round(width / 0.9)), yaw = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1) - 0.5, m = new THREE.Mesh(this.surgeGeo, this.waveMat);
      m.position.set(at.x + side.x * u * width + dir.x * (0.2 - Math.abs(u) * 0.8), at.y, at.z + side.z * u * width + dir.z * (0.2 - Math.abs(u) * 0.8));
      m.rotation.set(0, yaw + Math.PI + u * 0.6, 0); m.renderOrder = 3; m.scale.set(1.3, 0.01, 1.3); this.w.scene.add(m);
      this.surges.push({ m, t: -Math.abs(u) * 0.12, life: 0.75, h: h * (1 - Math.abs(u) * 0.35) * rand(0.85, 1.1), lean: rand(-0.25, 0.25), tilt: rand(0.15, 0.35) });
    }
    this.w.shake(0.18, at);
  }
  // a ring of water bursting out round a point (the whip slam's impact)
  ringBurst(at, r = 1.2, h = 2.6, n = 9) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, m = new THREE.Mesh(this.surgeGeo, this.waveMat);
      m.position.set(at.x + Math.sin(a) * r, at.y, at.z + Math.cos(a) * r); m.rotation.set(0, a + Math.PI, 0); m.renderOrder = 3; m.scale.set(1.1, 0.01, 1.1);
      this.w.scene.add(m); this.surges.push({ m, t: -rand(0, 0.06), life: 0.65, h: h * rand(0.8, 1.15), lean: rand(-0.2, 0.2), tilt: rand(0.35, 0.6) });
    }
  }
  updateSurges(dt) {
    this.waveMat.uniforms.uTime.value += dt;
    for (const S of this.surges) {
      S.t += dt; if (S.t < 0) continue; const k = S.t / S.life;
      // shoots up fast (eased), hangs, then drops back and thins
      const up = k < 0.35 ? 1 - Math.pow(1 - k / 0.35, 3) : 1 - smooth01((k - 0.55) / 0.45);
      S.m.scale.set(1.3 * (1 + k * 0.5), Math.max(0.01, S.h * up), 1.3 * (1 + k * 0.5));
      S.m.rotation.x = -S.tilt * k; S.m.rotation.z = S.lean * k;
      if (S.t >= S.life) { S.dead = true; this.w.scene.remove(S.m); }
    }
    this.surges = this.surges.filter(S => !S.dead);
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
      V.mesh.scale.y = (V.h || 2.2) * Math.max(0.05, grow);
      // the water wave rears up as it travels: the curl deepens and the crest pitches forward, then it collapses
      if (V.el === 'water') { V.mesh.scale.z = (V.h || 2.2) * (0.6 + 0.35 * Math.min(1, k * 1.6)); V.mesh.rotation.x = 0.12 * Math.sin(Math.min(1, k * 1.3) * Math.PI); }
      if (V.el === 'air') for (let i = 0; i < 2; i++) w.fx.wind(_a.copy(V.pos).addScaledVector(_b.crossVectors(V.dir, UP), rand(-V.width / 2, V.width / 2)).setY(V.pos.y + rand(0.3, 1.8)), _c.copy(V.dir).multiplyScalar(14), 0.5, 0.3);
      const side = _b.crossVectors(V.dir, UP).normalize();
      for (const t of w.fighters) {
        if (t === V.f || t.dead || V.hit.has(t) || t.invuln > 0) continue;
        const rx = t.pos.x - V.pos.x, rz = t.pos.z - V.pos.z, along = rx * V.dir.x + rz * V.dir.z, lat = rx * side.x + rz * side.z;
        if (Math.abs(along) < 1.2 && Math.abs(lat) < V.width / 2 && t.pos.y - V.pos.y < (V.h || 1.8) * 0.9 * grow + 0.2) {
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
            if (!t.dead) { t.vel.y = C.lift; t.onGround = false; if (C.el === 'air') t.floatT = 1.2; }   // thrown up by wind: floats (hero.js)
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
  // Fire stomp: a fireball runs along the ground from the stamping foot to the opponent (or 9 m ahead), then spreads
  // into a ring of fire around that spot for 1.6 s: whoever is inside burns, and anything thrown into it is destroyed
  fireTrap(f, foot) {
    const w = this.w, t = f.target && !f.target.dead && f.target.pos.distanceTo(f.pos) < 11 ? f.target : null;
    const to = t ? new THREE.Vector3(t.pos.x, 0, t.pos.z) : new THREE.Vector3(f.pos.x + Math.sin(f.faceYaw) * 9, 0, f.pos.z + Math.cos(f.faceYaw) * 9);
    const ball = new THREE.Mesh(this.trapBallGeo || (this.trapBallGeo = new THREE.IcosahedronGeometry(0.28, 1)), this.trapBallMat || (this.trapBallMat = new THREE.MeshBasicMaterial({ color: 0xffb040 })));
    ball.position.copy(foot); w.scene.add(ball);
    this.traps.push({ f, ball, pos: foot.clone(), to, t: 0, phase: 'roll', hit: new Set(), tick: 0, R: 0 });
    w.audio.fireWhoosh(1.1);
  }
  updateTraps(dt) {
    const w = this.w;
    for (const T of this.traps) {
      T.t += dt;
      if (T.phase === 'roll') {
        const d = _a.set(T.to.x - T.pos.x, 0, T.to.z - T.pos.z), L = d.length();
        if (T.t > 0.05 && T.f.target && !T.f.target.dead && T.t < 0.5) { T.to.x = T.f.target.pos.x; T.to.z = T.f.target.pos.z; }   // follows a moving target briefly
        const step = 15 * dt;
        if (L <= step || T.t > 1.0) { T.pos.x = T.to.x; T.pos.z = T.to.z; T.phase = 'ring'; T.rt = 0; w.audio.fireWhoosh(1.3); w.fx.crater(_a.set(T.pos.x, T.gy || 0, T.pos.z), 1.4);
          T.mesh = new THREE.Mesh(this.ringGeo, this.fireRingMat.clone()); w.scene.add(T.mesh); }
        else T.pos.addScaledVector(d.normalize(), step);
        T.gy = w.arena.groundAt(T.pos.x, T.pos.z, T.pos.y + 1); T.pos.y = T.gy + 0.3;
        T.ball.position.copy(T.pos); if (Math.random() < 0.8) w.fx.fire(T.pos, _b.set(0, 1.2, 0), 0.35, 0.18);
        if (T.phase === 'ring') { w.scene.remove(T.ball); }
        continue;
      }
      // the ring: spreads to 1.9 m, burns for 1.6 s, then dies down
      T.rt += dt; const R = 1.9 * smooth01(Math.min(1, T.rt / 0.18)), fade = 1 - smooth01((T.rt - 1.4) / 0.3);
      T.mesh.position.set(T.pos.x, T.gy + 0.12, T.pos.z); T.mesh.scale.set(Math.max(0.05, R), 1.6, Math.max(0.05, R)); T.mesh.material.opacity = 0.85 * fade;
      // flames stand round the edge (kept sparse so the fighters stay visible)
      if (Math.random() < 0.7 * fade) { const a = rand(0, 6.28); w.fx.fire(_a.set(T.pos.x + Math.sin(a) * R, T.gy + 0.1, T.pos.z + Math.cos(a) * R), _b.set(0, rand(1.5, 2.8), 0), 0.42, 0.3); }
      T.tick -= dt;
      if (T.tick <= 0 && fade > 0.2) {
        T.tick = 0.3;
        for (const t of w.fighters) {
          if (t === T.f || t.dead || t.invuln > 0) continue;
          const d = Math.hypot(t.pos.x - T.pos.x, t.pos.z - T.pos.z);
          if (d < R + 0.3 && t.pos.y - T.gy < 1.2) {
            const first = !T.hit.has(t); T.hit.add(t);
            w.combat.damage(t, first ? 8 : 3, _b.set(t.pos.x - T.pos.x, 0, t.pos.z - T.pos.z).normalize().clone(), T.f, 'fireTrap', t.chestPos(new THREE.Vector3()), first ? 3 : 0, first ? 1 : -1);
          }
        }
      }
      for (const o of this.B.objs) if (o.state === 'flying' && o.owner !== T.f && Math.hypot(o.pos.x - T.pos.x, o.pos.z - T.pos.z) < R && o.pos.y - T.gy < 2) this.B.kill(o, o.el === 'water' ? 'steam' : undefined);
      if (T.rt > 1.75) { T.dead = true; w.scene.remove(T.mesh); T.mesh.material.dispose(); }
    }
    this.traps = this.traps.filter(T => !T.dead);
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
  // Air dodge: two bands of wind wound round the bender for the length of the dash, carried with them
  whirlwind(f, dur) {
    const tubes = [0, 1].map(() => { const t = this.tube(); t.mesh.material = this.airTubeMat; return t; });
    this.whirls.push({ f, tubes, t: 0, dur: dur + 0.15, pts: [0, 1].map(() => Array.from({ length: 18 }, () => new THREE.Vector3())) });
    this.w.fx.dust(f.pos, 8, 3); this.w.audio.gust(0.9);
  }
  updateWhirls(dt) {
    for (const W of this.whirls) {
      W.t += dt;
      if (W.dur > 1 && W.t > 0.3 && W.f.dodgeT <= 0 && W.dur > W.t + 0.12) W.dur = W.t + 0.12;   // the glide was cut short (a hit, a landing strike): the whirlwind fades out
      const f = W.f, k = Math.min(1, W.t / 0.08) * (1 - smooth01((W.t - W.dur + 0.12) / 0.12));
      W.tubes.forEach((tb, i) => {
        const P = W.pts[i];
        for (let j = 0; j < P.length; j++) { const s = j / (P.length - 1), a = -W.t * 22 + s * 9 + i * Math.PI, r = (0.55 + 0.35 * s) * k; P[j].set(f.pos.x + Math.cos(a) * r, f.pos.y + 0.1 + s * 1.9, f.pos.z + Math.sin(a) * r); }
        tb.set(P, (q) => (0.05 + 0.08 * Math.sin(Math.PI * q)) * k + 0.005, W.t * 3);
      });
      if (Math.random() < 0.6) this.w.fx.wind(_a.set(f.pos.x, f.pos.y + rand(0.2, 1.6), f.pos.z), _b.set(rand(-4, 4), 1, rand(-4, 4)), 0.5, 0.25);
      if (W.t > W.dur) { W.dead = true; W.tubes.forEach(t => this.freeTube(t)); }
    }
    this.whirls = this.whirls.filter(W => !W.dead);
  }
  surfTick(f, mob, dt) {
    const w = this.w;
    if (!mob.board) {
      mob.board = new THREE.Mesh(mob.el === 'water' ? this.iceSheetGeo : this.slabGeo, mob.el === 'water' ? iceMat : this.rockMat);
      mob.board.castShadow = true; w.scene.add(mob.board); mob.trailT = 0;
      // the support that holds the slab / ice sheet up off the floor: for water a sculpted crest of ice with crystals
      // growing from its base (the downloaded ice cluster); for earth a column of rock
      if (mob.el === 'water' && ICE.crestGeo) {
        mob.post = new THREE.Mesh(ICE.crestGeo, iceMat); mob.post.castShadow = true; w.scene.add(mob.post);
        mob.crystals = [[-0.72, -0.5, 0.75], [0.7, -0.9, 0.62], [-0.55, -1.5, 0.5], [0.5, 0.3, 0.55]].map(([x, z, k]) => { const c = iceClusterMesh(k, k * 0.8); c.userData.off = new THREE.Vector3(x, 0, z); c.rotation.y = rand(0, 6.28); w.scene.add(c); return c; });
      } else {
      mob.post = new THREE.Mesh(this.postGeo || (this.postGeo = (() => { const g = new THREE.CylinderGeometry(0.45, 0.75, 1, 7, 1); g.translate(0, -0.5, 0); return g; })()), mob.el === 'water' ? iceMat : this.rockMat);
      mob.post.castShadow = true; w.scene.add(mob.post);
      }
    }
    const gy = f.groundY, top = f.pos.y + (mob.el === 'water' ? -0.02 : -0.17);
    mob.board.position.set(f.pos.x, top, f.pos.z);
    mob.board.rotation.y = mob.heading;
    // the support: for water a ridge of ice rising from the floor, long along the direction of travel; for earth a
    // column of rock
    if (mob.crystals) {
      // the crest stands on the floor under the bender, its profile along the direction of travel; it grows up to
      // the full lift as the surf starts
      const h = Math.max(0.05, top - gy);
      // taller crests get longer and a little wider, so a high ride stays a wave of ice, not a thin wall
      mob.post.position.set(f.pos.x, gy, f.pos.z); mob.post.scale.set(1 + Math.max(0, h - 1.5) * 0.25, h, 1 + Math.max(0, h - 1.5) * 0.4); mob.post.rotation.y = mob.heading;
      const c = Math.cos(mob.heading), sn = Math.sin(mob.heading);
      for (const k of mob.crystals) { const o = k.userData.off; k.position.set(f.pos.x + o.x * c + o.z * sn, gy - 0.05, f.pos.z - o.x * sn + o.z * c); }
    } else {
    mob.post.position.set(f.pos.x, top - (mob.el === 'water' ? 0.18 : 0.15), f.pos.z); mob.post.scale.set(mob.el === 'water' ? 0.75 : 1, Math.max(0.05, top - 0.18 - gy), mob.el === 'water' ? 1.5 : 1); mob.post.rotation.y = mob.heading;
    }
    mob.trailT -= dt;
    if (mob.trailT <= 0 && mob.speed > 2) {
      mob.trailT = 0.07;
      // water leaves a frozen path: ice crystals (the downloaded cluster) of varied height and angle along the track
      if (mob.el === 'water') { const k = rand(0.35, 0.8); const m = iceClusterMesh(k, k * rand(0.7, 1.1)); m.position.set(f.pos.x + rand(-0.4, 0.4), f.groundY - 0.05, f.pos.z + rand(-0.4, 0.4)); m.rotation.set(rand(-0.25, 0.25), rand(0, 6.28), rand(-0.25, 0.25)); w.scene.add(m); this.trails.push({ m, t: 0, life: 3.0 }); mob.trailT = 0.11; }
      else w.fx.debrisBurst(_a.set(f.pos.x, f.pos.y, f.pos.z), 2, 1.5, 0.08, 0x7a6a58, 0.7);
    }
    if (mob.el === 'earth' && Math.random() < 0.5) w.fx.dust(f.pos, 1, 1.2);
  }
  // Water's ice arch dodge: the ice-surf board under the feet and the crest of ice from the floor up to it, with a frozen
  // path left behind; removed when the dodge ends (update)
  archTick(f, h, dt) {
    if (!f._arch) f._arch = { el: 'water', heading: f.faceYaw, speed: 8 };
    const A = f._arch; A.heading = Math.atan2(f.dodgeDir.x, f.dodgeDir.z); A.speed = Math.hypot(f.vel.x, f.vel.z);
    this.surfTick(f, A, dt);
  }
  surfEnd(mob) { if (mob && mob.board) { this.w.scene.remove(mob.board); mob.board = null; } if (mob && mob.post) { this.w.scene.remove(mob.post); mob.post = null; } if (mob && mob.crystals) { for (const c of mob.crystals) this.w.scene.remove(c); mob.crystals = null; } }
  // JUMP while surfing: the element itself launches the bender. Water raises an ice ramp under the feet and leaves
  // an ice platform; earth thrusts a slab up on a pillar that stays as a platform.
  surfLaunch(f, el) {
    const w = this.w;
    if (el === 'water') {
      const m = new THREE.Mesh(this.rampGeo, iceMat); m.position.set(f.pos.x, f.pos.y - 2.4, f.pos.z); m.rotation.y = f.faceYaw; m.scale.set(0.9, 1, 0.9); w.scene.add(m);
      const col = { kind: 'c', x: f.pos.x, z: f.pos.z, r: 0.7, top: f.pos.y + 1.6, walk: true, ice: true, mesh: m };
      w.arena.colliders.push(col);
      this.platforms.push({ m, col, t: 0, life: 5, y0: f.pos.y - 2.4, rise: 2.35, el });
      w.fx.debrisBurst(_a.set(f.pos.x, f.pos.y + 0.3, f.pos.z), 16, 4, 0.08, 0xe0f4ff); w.fx.splash(f.pos, 12); w.audio.splash(1);
    } else this.launchSpire(f);
  }
  // Earth's launch: a mountain of rock drives up out of the ground under the feet and throws the bender upward: a
  // cluster of tall faceted grey peaks of different heights on one broad base (as in the reference videos), the
  // tallest under the feet; it holds for a moment, then sinks back
  peakGeo(rng) {
    // one faceted peak: six sides, ridges jittered, the point a little off-centre
    const g = new THREE.CylinderGeometry(0, 1, 1, 6, 5, false), p = g.attributes.position, tip = [rand(-0.12, 0.12), rand(-0.12, 0.12)];
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5, k = 1 - y;   // 0 at the base, 1 at the point
      if (y > 0.999) p.setXYZ(i, tip[0], 1, tip[1]);
      else { const j = 0.75 + rng() * 0.5; p.setXYZ(i, p.getX(i) * j + tip[0] * y, y + (y > 0.01 ? rand(-0.04, 0.04) : 0), p.getZ(i) * j + tip[1] * y); }
    }
    const n = g.toNonIndexed(); n.computeVertexNormals(); return n;
  }
  launchSpire(f) {
    const w = this.w, x = f.pos.x, z = f.pos.z, gy = w.arena.groundAt(x, z, f.pos.y + 0.5);
    if (!this.peakGeos) this.peakGeos = [0, 1, 2, 3, 4].map(() => this.peakGeo(Math.random));
    const mat = this.peakMat || (this.peakMat = new THREE.MeshStandardMaterial({ color: 0x8e8d92, roughness: 0.95, flatShading: true })), m = new THREE.Group();   // light grey, faceted, as in the references
    // the tallest peak under the feet, the others crowded round it, leaning out a little
    const peaks = [[0, 0, 1.05, 3.6]];
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + rand(-0.3, 0.3), d = rand(0.7, 1.35); peaks.push([Math.cos(a) * d, Math.sin(a) * d, rand(0.55, 0.9), rand(1.5, 3.0)]); }
    for (const [px, pz, r, h] of peaks) {
      const k = new THREE.Mesh(this.peakGeos[(Math.random() * 5) | 0], mat); k.castShadow = k.receiveShadow = true;
      k.position.set(px, 0, pz); k.scale.set(r, h, r * rand(0.8, 1.15)); k.rotation.set(pz * 0.1, rand(0, 6), -px * 0.1);
      m.add(k);
    }
    m.position.set(x, gy - 3.8, z); m.rotation.y = rand(0, 6); w.scene.add(m);
    this.spires.push({ m, gy, t: 0 });
    this.burst.spawn(x, gy, z, 0.5); w.fx.debrisBurst(_a.set(x, gy + 0.1, z), 22, 4.5, 0.12, 0x6a6870); w.fx.dust(_a.set(x, gy, z), 12, 3); w.fx.crater(_a.set(x, gy, z), 2.4);
    w.audio.rumble(1.1); w.shake(0.3, f.pos);
  }
  updateSpires(dt) {
    for (const S of this.spires) {
      S.t += dt;
      // the point bursts up past where the feet were in 0.14 s, holds, then sinks back into the ground
      const up = S.t < 0.14 ? smooth01(S.t / 0.14) : S.t < 1.3 ? 1 : 1 - smooth01((S.t - 1.3) / 0.5);
      S.m.position.y = S.gy - 3.8 + up * 3.6;   // the main peak's point ends 3.4 m up, where the feet were thrown from
      if (S.t > 1.85) { S.dead = true; this.w.scene.remove(S.m); }
    }
    this.spires = this.spires.filter(S => !S.dead);
  }
  flyTick(f, dt) {
    const w = this.w;
    // the air currents carrying the flier: spirals under the feet and streaks along the path
    if (Math.random() < dt * 30) w.fx.wind(_a.set(f.pos.x + rand(-0.4, 0.4), f.pos.y - 0.1, f.pos.z + rand(-0.4, 0.4)), _b.set(rand(-2, 2), -6, rand(-2, 2)), 0.6, 0.35);
    if (Math.random() < dt * 12) w.fx.wind(_a.set(f.pos.x, f.pos.y + rand(0.3, 1.5), f.pos.z), _b.set(-f.vel.x * 0.6, 0, -f.vel.z * 0.6), 0.5, 0.3);
  }
  // a water-launched bender rides a column of water rising from the ground to the feet (alt < 0 hides it)
  selfColumn(f, alt) {
    if (alt < 0) { if (f._col) { this.freeTube(f._col); f._col = null; } if (f._wrap) { this.freeTube(f._wrap); f._wrap = null; } return; }
    if (!f._col) f._col = this.tube();
    // the water also winds round the body as it lifts (Falling Into Pool pose, hero.js): a stream spiralling from the
    // column at the feet up round the hips and chest, turning
    if (!f._wrap) f._wrap = this.tube();
    const wp = []; for (let k = 0; k <= 22; k++) { const s = k / 22, a = s * 11 - f.time * 9, r = 0.62 - 0.18 * Math.sin(s * Math.PI); wp.push(new THREE.Vector3(f.pos.x + Math.sin(a) * r, f.pos.y - 0.1 + s * 1.65, f.pos.z + Math.cos(a) * r)); }
    f._wrap.set(wp, (s) => 0.07 + 0.09 * Math.sin(Math.PI * s), f.time);
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
    for (const f of this.w.fighters) if (f._arch && !(f.dodgeKind === 'arch' && f.dodgeT > 0)) { this.surfEnd(f._arch); f._arch = null; }
    this.updateWhips(dt); this.updateGrabs(dt); this.updateArcs(dt); this.updateTraps(dt); this.updateWhirls(dt); this.updateSpires(dt); this.updateWaves(dt); this.updateSurges(dt); this.updateColumns(dt); this.updateErupts(dt); this.updateFireRings(dt); this.updateCaptures(dt); this.updateTrails(dt);
  }
  clear() {
    for (const W of this.whips) this.dropWhip(W);
    for (const A of this.arcs) { this.freeTube(A.tube); if (A.ribbons) A.ribbons.forEach(r => r.release()); }
    for (const W of this.whirls) W.tubes.forEach(t => this.freeTube(t));
    for (const S of this.spires) this.w.scene.remove(S.m);
    for (const T of this.traps) { this.w.scene.remove(T.ball); if (T.mesh) this.w.scene.remove(T.mesh); }
    this.burst.clear();
    for (const V of this.waves) this.w.scene.remove(V.mesh);
    for (const S of this.surges) this.w.scene.remove(S.m); this.surges = [];
    for (const C of this.columns) { this.w.scene.remove(C.mark); this.freeTube(C.tube); }
    for (const E of this.erupts) { this.w.scene.remove(E.mark); for (const s of E.spikes) this.w.scene.remove(s.m); }
    for (const R of this.fireRings) this.w.scene.remove(R.mesh);
    for (const C of this.captures) { this.freeTube(C.tube); if (C.t) C.t.captured = null; }
    for (const T of this.trails) this.w.scene.remove(T.m);
    for (const P of this.platforms) { this.w.scene.remove(P.m); P.col.dead = true; }
    this.w.arena.colliders = this.w.arena.colliders.filter(c => !this.platforms.some(P => P.col === c));
    for (const G of this.grabs || []) { this.freeTube(G.tube); if (G.t) G.t.restrainT = 0; }
    this.grabs = [];
    this.whips = []; this.waves = []; this.columns = []; this.erupts = []; this.fireRings = []; this.captures = []; this.trails = []; this.platforms = []; this.arcs = []; this.traps = []; this.whirls = []; this.spires = [];
  }
}
