// The four SPECIAL techniques. Each one is driven by a full-body clip and anchored to the body that performs it:
//   Fire  - Dragon Descent: a leaping flying kick; flames stream from both feet through the leap and the kicking
//           foot detonates a large explosion where it lands (knocks down everyone within 3.2 m)
//   Earth - Ground Rupture: the bender sinks and drives both hands into the ground (gathering), then the ground
//           ruptures in a line racing to the opponent: fracture bursts and clusters of rock spikes, one after another
//   Water - Dragon Stream: water rises from the ground into both hands, then circulates as one thick stream that runs
//           through both hands and around the body (it catches projectiles and shoves attackers). HAND redirects it:
//           a two-handed push throws the whole stream at the opponent (it releases on its own after 4 s)
//   Air   - Tornado: a full-body spin winds a funnel up around the bender; the spin's end sends it at the opponent.
//           It drags in whoever it reaches, lifts and spins them, then throws them out
import * as THREE from 'three';
import { makeWaterTube } from './defence-fx.js';
import { smooth01, rand, clamp } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

export class Specials {
  constructor(B) {
    this.B = B; this.w = B.world; this.list = [];
    this.spikeGeo = (() => { const g = new THREE.ConeGeometry(0.34, 1.9, 5, 1); g.translate(0, 0.95, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 1.8) p.setXYZ(i, p.getX(i) * rand(0.85, 1.15), p.getY(i), p.getZ(i) * rand(0.85, 1.15)); g.computeVertexNormals(); return g; })();
    this.ballGeo = new THREE.IcosahedronGeometry(1, 2);
  }
  add(S) { this.list.push(S); return S; }
  find(f, kind) { return this.list.find(s => s.f === f && s.kind === kind && !s.dead); }
  ground(x, z, y) { return this.w.arena.groundAt(x, z, y); }

  // ------------------------------------------------------------------ FIRE
  fireStart(f) {
    this.add({ kind: 'fireTrail', f, t: 0, tech: f.tech }); this.w.audio.fireWhoosh(1.1);
    // the leap carries the bender at the rival (up to 9 m away), so the kicking foot comes down beside them
    const t = f.target && !f.target.dead ? f.target : null;
    if (t) {
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz), T = f.tech && f.tech.impactT ? f.tech.impactT : 0.3;
      if (d > 1.4 && d < 9) { f.lungeDir.set(dx / d, 0, dz / d).multiplyScalar(Math.min(18, (d - 1.2) / T)); f.lungeT = T; f.faceYaw = Math.atan2(dx, dz); }
    }
  }
  fireExplode(f, foot) {
    f.lungeT = 0; f.vel.x = f.vel.z = 0;   // the leap ends where the kicking foot comes down
    const w = this.w, gy = this.ground(foot.x, foot.z, foot.y + 0.5), c = new THREE.Vector3(foot.x, Math.max(gy + 0.6, Math.min(foot.y, gy + 1.4)), foot.z);
    const shell = (col, op) => { const m = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending })); m.position.copy(c); m.scale.setScalar(0.1); w.scene.add(m); return m; };
    const S = this.add({ kind: 'fireBlast', f, t: 0, c, gy, core: shell(0xffe08a, 0.6), mid: shell(0xff7a1a, 0.5), out: shell(0xb02a08, 0.4) });
    for (let i = 0; i < 26; i++) { const a = rand(0, 6.28), e = rand(-0.1, 1.1); w.fx.fire(c, _a.set(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.3, Math.sin(a) * Math.cos(e)).multiplyScalar(rand(4, 8)), rand(0.4, 0.7), rand(0.3, 0.5)); }
    w.fx.ring(_a.set(c.x, gy + 0.05, c.z), 7, 0xffa040, 0.5); w.fx.crater(_a.set(c.x, gy, c.z), 1.6);
    w.fx.debrisBurst(c, 14, 6, 0.1, 0x3a2a22);
    w.shake(0.55, c); w.audio.fireWhoosh(1.6); w.audio.rumble && w.audio.rumble(0.8);
    for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28 + rand(-0.3, 0.3), r = rand(1.2, 2.2); this.B.burn(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, gy, f); }
    for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0) continue;
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
      if (d < 3.2 && Math.abs(t.pos.y - gy) < 2.5) w.combat.damage(t, Math.round(20 - d * 3), _a.set(t.pos.x - c.x, 0, t.pos.z - c.z).normalize().clone(), f, 'fireBlast', t.chestPos(new THREE.Vector3()), 15, 2);
    }
    for (const o of this.B.objs) if (o.state === 'flying' && o.owner !== f && o.pos.distanceTo(c) < 3.5) this.B.kill(o);
  }

  // ------------------------------------------------------------------ EARTH
  earthStart(f) { this.add({ kind: 'earthGather', f, t: 0, tech: f.tech }); this.w.audio.rumble && this.w.audio.rumble(0.5); }
  earthRupture(f) {
    const w = this.w, t = f.target && !f.target.dead ? f.target : null;
    const dir = t ? _a.set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z) : f.forward(_a); dir.y = 0;
    const reach = t ? clamp(dir.length() + 1.5, 4, 10) : 8; dir.normalize();
    const n = Math.round(reach / 1.4), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const pts = []; for (let i = 0; i < n; i++) { const d = 1.3 + (reach - 1.3) * i / (n - 1); pts.push(new THREE.Vector3(f.pos.x + dir.x * d + side.x * rand(-0.35, 0.35), 0, f.pos.z + dir.z * d + side.z * rand(-0.35, 0.35))); }
    this.add({ kind: 'rupture', f, t: 0, pts, next: 0, hit: new Set(), spikes: [], dir: dir.clone() });
    w.shake(0.35, f.pos); w.fx.dust(f.pos, 14, 3);
  }

  // ------------------------------------------------------------------ WATER
  waterStart(f) {
    if (this.find(f, 'dragon')) return;
    // the loop is long (about 6 m round the body): its own finely divided tube, so it bends through the hands
    const tube = makeWaterTube(56, 9, this.B.weapons.tubeMat); this.w.scene.add(tube.mesh); const inner = this.B.weapons.tube();
    this.add({ kind: 'dragon', f, t: 0, phase: 'gather', tube, inner, pts: Array.from({ length: 44 }, () => new THREE.Vector3()), tick: 0, caught: 0, stung: new Set(), head: null });
    this.w.fx.splash(_a.set(f.pos.x, f.groundY + 0.1, f.pos.z), 16); this.w.audio.splash(0.9);
  }
  // the gathered water is thrown round the opponent: they are held inside a ball of water (drowning), it freezes
  // into jagged ice, then shatters for the damage
  waterEstablish(f) {
    const S = this.find(f, 'dragon'); if (S) this.dropDragon(S, false);
    const t = f.target && !f.target.dead && f.target.pos.distanceTo(f.pos) < 11 ? f.target : null;
    if (!t) { this.w.fx.splash(f.chestPos(_a), 20); return; }
    const mesh = new THREE.Mesh(this.ballGeo, this.B.weapons.tubeMat); mesh.renderOrder = 3; mesh.scale.setScalar(0.1); this.w.scene.add(mesh);
    const shards = new THREE.Group(); this.w.scene.add(shards); shards.visible = false;
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(this.B.iceShard, this.icy || (this.icy = this.B.weapons.iceTubeMat)); const u = new THREE.Vector3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize();
      m.position.copy(u).multiplyScalar(0.95); m.quaternion.setFromUnitVectors(UP, u); m.scale.setScalar(rand(0.55, 0.95)); shards.add(m);
    }
    this.add({ kind: 'drown', f, t: 0, tg: t, mesh, shards, phase: 'engulf' });
    this.w.audio.splash(1.2);
  }
  // HAND during the circulation: the two-handed push that throws the stream
  waterCanRelease(f) { return false; }   // the stream is no longer held and thrown: the SPECIAL engulfs the opponent itself
  waterRelease(f) {
    const S = this.find(f, 'dragon'); if (!S || S.phase === 'thrown') return;
    const w = this.w, h = _a.addVectors(f.handPos('L', _b), f.handPos('R', _c)).multiplyScalar(0.5);
    const aim = this.B.aimDir(f, h, new THREE.Vector3());
    S.phase = 'thrown'; S.tt = 0; S.head = h.clone(); S.hv = aim.multiplyScalar(19); S.trail = S.pts.map(p => p.clone()); S.hitDone = new Set();
    w.audio.splash(1.3); w.shake(0.25, f.pos);
  }

  // ------------------------------------------------------------------ AIR
  airStart(f) {
    if (this.find(f, 'tornado')) return;
    const tubes = [0, 1, 2].map(() => { const tb = this.B.weapons.tube(); tb.mesh.material = this.B.weapons.airTubeMat; return tb; });
    this.add({ kind: 'tornado', f, t: 0, c: new THREE.Vector3(f.pos.x, f.groundY, f.pos.z), free: false, tubes, pts: tubes.map(() => Array.from({ length: 24 }, () => new THREE.Vector3())), held: new Map(), tick: 0, life: 4.2, grow: 0 });
    this.w.audio.gust(1.2);
  }
  airSend(f) {
    const S = this.find(f, 'tornado'); if (!S || S.free) return;
    S.free = true; S.ft = 0; this.w.audio.gust(1.4);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const w = this.w;
    for (const S of this.list) {
      if (S.dead) continue;
      S.t += dt; const f = S.f;
      switch (S.kind) {
        case 'fireTrail': {
          // flames pour from both feet through the leap (they ride the bones, so they trace the kick)
          if (f.dead || f.reacting() || f.tech !== S.tech || S.t > 1.6) { S.dead = true; break; }
          // a thin trail from each foot only, so the kick itself stays readable through the flames
          for (const s of ['L', 'R']) if (Math.random() < 0.6) { const p = f.footPos(s, _a); w.fx.fire(p, _b.set(rand(-0.5, 0.5), rand(0.3, 1), rand(-0.5, 0.5)), 0.22, 0.2); }
          break;
        }
        case 'fireBlast': {
          const k = S.t;
          const sc = (m, r, T) => { const u = Math.min(1, k / T); m.scale.setScalar(0.2 + r * (1 - Math.pow(1 - u, 3))); m.material.opacity *= k > T * 0.6 ? Math.exp(-dt * 7) : 1; m.position.y = S.c.y + k * 0.8; };
          sc(S.core, 1.2, 0.16); sc(S.mid, 2.0, 0.26); sc(S.out, 2.8, 0.38);
          if (k < 0.35) for (let i = 0; i < 2; i++) w.fx.fire(_a.copy(S.c).add(_b.set(rand(-1.5, 1.5), rand(0, 1.8), rand(-1.5, 1.5))), _b.set(0, rand(2, 5), 0), rand(0.5, 0.8), 0.45);
          if (k > 0.3 && k < 1.2 && Math.random() < 0.4) w.fx.puff(_a.copy(S.c).add(_b.set(rand(-1, 1), k * 2, rand(-1, 1))), _b.set(0, 1.5, 0), 1.2, 1.2, 0x302824, 0.45);
          if (k > 1.3) { S.dead = true; for (const m of [S.core, S.mid, S.out]) { w.scene.remove(m); m.material.dispose(); } }
          break;
        }
        case 'earthGather': {
          // while the hands sink to the ground: grit and pebbles drawn up toward the hands, the ground trembling
          if (f.dead || f.reacting() || f.tech !== S.tech) { S.dead = true; break; }
          for (const s of ['L', 'R']) {
            const h = f.handPos(s, _a), gy = this.ground(h.x, h.z, h.y + 0.5);
            if (Math.random() < 0.5) w.fx.debrisBurst(_b.set(h.x + rand(-0.4, 0.4), gy + 0.05, h.z + rand(-0.4, 0.4)), 1, 1.5, 0.05, 0x7a6450, 2.5);
            if (h.y - gy < 0.5 && Math.random() < 0.3) w.fx.dust(_b.set(h.x, gy, h.z), 2, 1);
          }
          if (Math.random() < 0.15) w.shake(0.05, f.pos);
          break;
        }
        case 'rupture': {
          // the rupture races out: one burst and spike cluster every 0.08 s along the line
          while (S.next < S.pts.length && S.t > S.next * 0.08) {
            const p = S.pts[S.next], last = S.next === S.pts.length - 1, gy = this.ground(p.x, p.z, f.pos.y + 1); p.y = gy;
            this.B.weapons.burst.spawn(p.x, gy, p.z, last ? 1.0 : 0.42 + 0.06 * S.next);
            const n = last ? 9 : 4;
            for (let i = 0; i < n; i++) {
              const a = rand(0, 6.28), r = last ? rand(0.3, 1.5) : rand(0.1, 0.7), m = new THREE.Mesh(this.spikeGeo, this.B.mat.stone);
              m.position.set(p.x + Math.cos(a) * r, gy - 2, p.z + Math.sin(a) * r); m.castShadow = true;
              m.rotation.set(Math.sin(a) * rand(0.15, 0.5), rand(0, 6), -Math.cos(a) * rand(0.15, 0.5)); m.scale.setScalar((last ? 1.15 : 0.8) * rand(0.7, 1.2));
              w.scene.add(m); S.spikes.push({ m, gy, born: S.t, y0: gy - 1.9 * m.scale.y, life: rand(1.3, 1.7) });
            }
            w.fx.dust(p, 6, 2.5); w.fx.debrisBurst(_a.set(p.x, gy + 0.2, p.z), last ? 16 : 7, last ? 6 : 4, 0.11, 0x6e5a48);
            w.shake(last ? 0.45 : 0.15, p); if (w.audio.rumble) w.audio.rumble(last ? 1 : 0.4);
            for (const t of w.fighters) {
              if (t === f || t.dead || t.invuln > 0 || S.hit.has(t)) continue;
              if (Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < (last ? 2.2 : 1.5) && t.pos.y - gy < 1.5) {
                S.hit.add(t); w.combat.damage(t, 17, _a.copy(S.dir).add(_b.set(0, 0.2, 0)).normalize().clone(), f, 'rupture', t.chestPos(new THREE.Vector3()), 9, 2);
                if (!t.dead) { t.vel.y = 9; t.onGround = false; }
              }
            }
            S.next++;
          }
          for (const sp of S.spikes) {
            const a = S.t - sp.born, up = a < 0.12 ? smooth01(a / 0.12) * 1.08 : a < 0.2 ? 1.08 - 0.08 * (a - 0.12) / 0.08 : a > sp.life ? 1 - smooth01((a - sp.life) / 0.45) : 1;
            sp.m.position.y = sp.y0 - 0.15 + up * (sp.gy - sp.y0 + 0.15);
          }
          if (S.t > S.pts.length * 0.08 + 2.3) { S.dead = true; for (const sp of S.spikes) w.scene.remove(sp.m); }
          break;
        }
        case 'dragon': this.updateDragon(S, dt); break;
        case 'drown': {
          const t = S.tg, c = t.chestPos(_a).setY(t.pos.y + 1.0);
          if (S.phase === 'engulf') {
            // the ball closes round the opponent and holds them, lifted a little off the floor
            const k = smooth01(Math.min(1, S.t / 0.3)); S.mesh.position.copy(c); S.mesh.scale.setScalar(0.1 + 1.15 * k);
            if (!t.dead) { t.restrainT = Math.max(t.restrainT, 0.2); t.vel.set(0, Math.max(0, (S.c0 ?? (S.c0 = t.pos.y + 0.4)) - t.pos.y) * 4, 0); t.onGround = false; }
            if (Math.random() < 0.5) w.fx.splash(_b.copy(c).add(_d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).setLength(1.1)), 1);
            if (S.t > 1.05) { S.phase = 'freeze'; S.ft = 0; w.audio.splash(0.6); }
          } else if (S.phase === 'freeze') {
            // the water freezes outward into jagged ice
            S.ft += dt; const k = smooth01(Math.min(1, S.ft / 0.25));
            S.mesh.material = this.B.weapons.iceTubeMat; S.shards.visible = true; S.shards.position.copy(c); S.shards.scale.setScalar(0.4 + 0.8 * k); S.shards.rotation.y += dt * 0.5;
            if (!t.dead) { t.restrainT = Math.max(t.restrainT, 0.2); t.vel.set(0, 0, 0); }
            if (S.ft > 0.45) {
              // shatter: the damage, ice flying outward, the ball gone
              w.fx.debrisBurst(c, 36, 7, 0.1, 0xe0f4ff); w.fx.splash(c, 16); w.shake(0.35, c); w.audio.impact(1.2);
              if (!t.dead) { t.restrainT = 0; w.combat.damage(t, 22, _b.set(t.pos.x - S.f.pos.x, 0, t.pos.z - S.f.pos.z).normalize().clone(), S.f, 'drown', c.clone(), 10, 2); }
              S.dead = true; w.scene.remove(S.mesh); w.scene.remove(S.shards);
            }
          }
          if (S.t > 3) { S.dead = true; w.scene.remove(S.mesh); w.scene.remove(S.shards); }
          break;
        }
        case 'tornado': this.updateTornado(S, dt); break;
      }
    }
    this.list = this.list.filter(S => !S.dead);
  }

  updateDragon(S, dt) {
    const w = this.w, f = S.f, N = S.pts.length;
    if (S.phase !== 'thrown' && (f.dead || f.el !== 'water' || (f.reacting() && f.action === 'down'))) { this.dropDragon(S, true); return; }
    if (S.phase !== 'thrown' && S.t > 4.6) { this.waterRelease(f); if (S.phase !== 'thrown') return; }
    const hL = f.handPos('L', new THREE.Vector3()), hR = f.handPos('R', new THREE.Vector3()), fw = f.forward(_d), ch = f.chestPos(new THREE.Vector3());
    if (S.phase === 'gather') {
      // two streams rising from a pool on the ground into the hands, then joining in front of the chest
      const g = smooth01(Math.min(1, S.t / 0.55));
      for (let k = 0; k < N; k++) {
        const s = k / (N - 1), half = s < 0.5, u = half ? s * 2 : (s - 0.5) * 2, h = half ? hL : hR;
        const base = _a.set(f.pos.x + fw.x * 0.6 + (half ? -0.4 : 0.4) * fw.z, f.groundY + 0.05, f.pos.z + fw.z * 0.6 - (half ? -0.4 : 0.4) * fw.x);
        const top = _b.copy(base).lerp(h, g);
        S.pts[k].lerpVectors(base, top, half ? u : 1 - u).add(_c.set(Math.sin(S.t * 9 + k) * 0.06, 0, Math.cos(S.t * 9 + k) * 0.06));
      }
      S.tube.set(S.pts, (s) => 0.07 + 0.09 * Math.sin(Math.PI * s), S.t); S.inner.mesh.visible = false;
      if (Math.random() < 0.5) w.fx.splash(S.pts[0], 1);
      return;
    }
    if (S.phase === 'flow') {
      // one stream through both hands and round the body: hand L -> out in front -> hand R -> round the back -> hand L
      S.flowT += dt; const e = smooth01(Math.min(1, S.flowT / 0.35)), spin = S.t * 4.2;
      const side = _c.set(fw.z, 0, -fw.x);
      const ctrl = [hL.clone(), ch.clone().addScaledVector(fw, 1.0 * e + 0.4).setY(ch.y - 0.1 + Math.sin(spin) * 0.25), hR.clone(),
        ch.clone().addScaledVector(side, -1.0).addScaledVector(fw, -0.2).setY(ch.y - 0.35 + Math.sin(spin + 2) * 0.2),
        ch.clone().addScaledVector(fw, -0.95).setY(ch.y - 0.05 + Math.sin(spin + 3) * 0.2),
        ch.clone().addScaledVector(side, 1.0).addScaledVector(fw, -0.2).setY(ch.y - 0.35 + Math.sin(spin + 4) * 0.2)];
      const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
      const off = (S.t * 0.35) % 1;   // the water runs round the loop
      for (let k = 0; k < N; k++) curve.getPointAt((k / (N - 1) + off) % 1, S.pts[k]);   // a closed loop: the first and last points meet
      S.tube.set(S.pts, (s) => (0.13 + 0.05 * Math.sin(s * Math.PI * 6 + S.t * 8)) * (0.6 + 0.4 * e), S.t);
      // a thinner counter-current inside it, so the flow reads as moving water
      const inn = S.pts.map((p, k) => curve.getPointAt(((k / N) * 0.5 + 1 - (S.t * 0.6) % 1) % 1, new THREE.Vector3()).add(_a.set(0, 0.08, 0)));
      S.inner.mesh.visible = true; S.inner.set(inn, (s) => 0.05 * Math.sin(Math.PI * s), S.t * 1.3);
      if (Math.random() < 0.35) w.fx.splash(S.pts[(Math.random() * N) | 0], 1);
      // the stream catches what is thrown at the bender and shoves away anyone who closes in
      for (const o of this.B.objs) {
        if (o.state !== 'flying' || o.owner === f) continue;
        if (Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < 1.6 && o.pos.y > f.pos.y && o.pos.y < f.pos.y + 2) { S.caught++; this.B.kill(o, o.el === 'fire' ? 'steam' : undefined); w.popup(f, 'CAUGHT', false); }
      }
      S.tick -= dt;
      if (S.tick <= 0) {
        S.tick = 0.35;
        for (const t of w.fighters) {
          if (t === f || t.dead || t.invuln > 0) continue;
          const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz) || 1;
          if (d < 1.9 && Math.abs(t.pos.y - f.pos.y) < 1.5) { t.ext.x += dx / d * 6; t.ext.z += dz / d * 6; if (!S.stung.has(t)) { S.stung.add(t); w.combat.damage(t, 4, _a.set(dx / d, 0, dz / d).clone(), f, 'spiral', t.chestPos(new THREE.Vector3()), 2, 0); } }
        }
      }
      return;
    }
    // thrown: the head flies at the opponent and the whole stream pours after it from the hands
    S.tt += dt;
    const t = f.target && !f.target.dead ? f.target : null;
    if (t && S.tt < 0.35) { const want = _a.copy(t.chestPos(_b)).sub(S.head).normalize().multiplyScalar(19); S.hv.lerp(want, Math.min(1, dt * 4)); }
    S.head.addScaledVector(S.hv, dt);
    const root = _a.addVectors(hL, hR).multiplyScalar(0.5), pour = 1 - smooth01((S.tt - 0.45) / 0.3);
    for (let k = 0; k < N; k++) { const s = k / (N - 1); S.pts[k].lerpVectors(root, S.head, Math.pow(s, 0.8)).add(_b.set(0, Math.sin(Math.PI * s) * 0.4 + Math.sin(S.tt * 14 + k * 0.6) * 0.08, 0)); if (S.tt > 0.45) S.pts[k].lerp(S.head, 1 - pour); }
    S.tube.set(S.pts, (s) => (0.08 + 0.22 * s) * Math.max(0.2, pour) + 0.02, S.t); S.inner.mesh.visible = false;
    if (Math.random() < 0.8) w.fx.splash(S.head, 3);
    for (const tt of w.fighters) {
      if (tt === f || tt.dead || tt.invuln > 0 || S.hitDone.has(tt)) continue;
      const c = tt.chestPos(_b); if (c.distanceTo(S.head) < 1.1 || Math.hypot(tt.pos.x - S.head.x, tt.pos.z - S.head.z) < tt.radius + 0.6 && S.head.y - tt.pos.y < 2 && S.head.y > tt.pos.y - 0.2) {
        S.hitDone.add(tt); S.endAt = S.tt + 0.15; w.combat.damage(tt, 18 + Math.min(6, S.caught * 2), S.hv.clone().setY(0).normalize(), f, 'dragon', S.head.clone(), 15, 2); w.fx.splash(S.head, 30); w.shake(0.3, S.head);
      }
    }
    for (const o of this.B.objs) if (o.state === 'flying' && o.owner !== f && o.pos.distanceTo(S.head) < 1.2) this.B.kill(o, o.el === 'fire' ? 'steam' : undefined);
    this.B.extinguishNear(S.head, 1.6);
    if (S.tt > 0.8 || S.tt > (S.endAt ?? 9) || this.w.arena.solidAt(S.head, 0.2)) { w.fx.splash(S.head, 20); this.dropDragon(S, false); }
  }
  dropDragon(S, spill) { if (spill) this.w.fx.splash(S.f.chestPos(_a), 16); this.w.scene.remove(S.tube.mesh); S.tube.mesh.geometry.dispose(); this.B.weapons.freeTube(S.inner); S.tube = S.inner = null; S.dead = true; }

  updateTornado(S, dt) {
    const w = this.w, f = S.f, H = 5.6;
    if (!S.free && (f.dead || f.reacting())) { S.free = true; S.ft = 0; }
    if (!S.free) { S.c.set(f.pos.x, f.groundY, f.pos.z); S.grow = Math.min(1, S.grow + dt / 0.7); }
    else {
      S.ft += dt;
      const t = f.target && !f.target.dead ? f.target : null;
      const want = t ? _a.set(t.pos.x - S.c.x, 0, t.pos.z - S.c.z) : f.forward(_a);
      if (want.lengthSq() > 0.04) want.normalize();
      S.v = S.v || want.clone().multiplyScalar(6.5); S.v.lerp(want.multiplyScalar(6.5), Math.min(1, dt * 1.5));
      S.c.addScaledVector(S.v, dt); S.c.y = this.ground(S.c.x, S.c.z, S.c.y + 1);
      if (w.arena.solidAt(_b.set(S.c.x, S.c.y + 1, S.c.z), 0.3)) S.life = Math.min(S.life, S.t + 0.3);
    }
    const end = S.t > S.life, fade = end ? Math.max(0, 1 - (S.t - S.life) / 0.5) : 1, g = S.grow * fade;
    const R = (h) => (0.35 + 2.1 * Math.pow(h / H, 1.6)) * g;
    // three helical bands winding up the funnel, turning fast
    S.tubes.forEach((tb, i) => {
      const P = S.pts[i];
      for (let k = 0; k < P.length; k++) { const s = k / (P.length - 1), h = s * H * g, a = -S.t * (9 - s * 3) + i * 2.09 + s * 7.5; P[k].set(S.c.x + Math.cos(a) * R(h), S.c.y + h, S.c.z + Math.sin(a) * R(h)); }
      tb.set(P, (s) => (0.09 + 0.3 * s) * g + 0.01, S.t * 2);
    });
    if (g > 0.2) {
      for (let i = 0; i < 3; i++) { const h = rand(0, H) * g, a = rand(0, 6.28); w.fx.wind(_a.set(S.c.x + Math.cos(a) * R(h), S.c.y + h, S.c.z + Math.sin(a) * R(h)), _b.set(-Math.sin(a) * 8, 3, Math.cos(a) * 8), 0.7, 0.3); }
      if (Math.random() < 0.5) w.fx.dust(_a.set(S.c.x, S.c.y, S.c.z), 2, 3);
      if (Math.random() < 0.3) w.fx.debrisBurst(_a.set(S.c.x + rand(-1, 1), S.c.y + 0.1, S.c.z + rand(-1, 1)), 1, 3, 0.06, 0x8a7b6b, 3);
    }
    // what it reaches is dragged in, lifted and spun; when it dies away (or after 1.4 s) they are thrown out
    if (S.free && !end) for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0 && !S.held.has(t)) continue;
      const dx = S.c.x - t.pos.x, dz = S.c.z - t.pos.z, d = Math.hypot(dx, dz);
      if (!S.held.has(t) && d < 2.4 && t.pos.y - S.c.y < 3) { S.held.set(t, 0); w.combat.damage(t, 6, _a.set(-dx, 0, -dz).normalize().clone(), f, 'tornado', t.chestPos(new THREE.Vector3()), 3, 1); }
    }
    for (const [t, ht] of S.held) {
      const nt = ht + dt; S.held.set(t, nt);
      if (t.dead) { S.held.delete(t); continue; }
      const a = S.t * 7, r = 0.9;
      t.ext.x += ((S.c.x + Math.cos(a) * r - t.pos.x) * 6 - t.ext.x) * Math.min(1, dt * 6); t.ext.z += ((S.c.z + Math.sin(a) * r - t.pos.z) * 6 - t.ext.z) * Math.min(1, dt * 6);
      t.vel.y = Math.max(t.vel.y, (S.c.y + 2.6 - t.pos.y) * 3); t.onGround = false;
      t.restrainT = Math.max(t.restrainT, 0.15);   // caught in the funnel: the body thrashes (struggle clip), it does not hang in a pose
      if (nt > 1.4 || end) {
        S.held.delete(t);
        const out = _a.set(t.pos.x - S.c.x, 0, t.pos.z - S.c.z); if (out.lengthSq() < 1e-3) out.copy(S.v || f.forward(_b)); out.normalize();
        w.combat.damage(t, 10, out.clone(), f, 'tornado', t.chestPos(new THREE.Vector3()), 16, 2); t.vel.y = 7;
      }
    }
    for (const o of this.B.objs) if (o.state === 'flying' && o.owner !== f && Math.hypot(o.pos.x - S.c.x, o.pos.z - S.c.z) < 2.5 * g && o.pos.y < S.c.y + H) this.B.kill(o);
    if (S.t > S.life + 0.5) { S.dead = true; for (const tb of S.tubes) this.B.weapons.freeTube(tb); for (const [t] of S.held) t.vel.y = 4; }
  }

  clear() {
    for (const S of this.list) {
      if (S.kind === 'fireBlast') for (const m of [S.core, S.mid, S.out]) this.w.scene.remove(m);
      if (S.kind === 'rupture') for (const sp of S.spikes) this.w.scene.remove(sp.m);
      if (S.kind === 'dragon' && S.tube) { this.w.scene.remove(S.tube.mesh); S.tube.mesh.geometry.dispose(); this.B.weapons.freeTube(S.inner); }
      if (S.kind === 'tornado') for (const tb of S.tubes) this.B.weapons.freeTube(tb);
      if (S.kind === 'drown') { this.w.scene.remove(S.mesh); this.w.scene.remove(S.shards); if (S.tg) S.tg.restrainT = 0; }
    }
    this.list = [];
  }
}
