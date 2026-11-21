// Earth's new skills (20 Nov, Earth phase one, the user's brief): Dust Cloud, Earth Sinking, Quicksand and Rock Armour.
// Each is started by a technique event (elements.js: earth.dust, earth.sink, earth.quicksand, earth.armour) and lives
// here until it ends. EarthSkills.update(dt) runs every frame from Bending.update.
import * as THREE from 'three';
import { jaggedRockGeometry } from './arena.js';
import { mulberry32, rand, clamp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _c1 = new THREE.Color();
const DUST_COLS = [0x9c8466, 0xb39b7a, 0x7d6a52, 0xa88f6c, 0x8a7458];

export class EarthSkills {
  constructor(B) {
    this.B = B; this.world = B.world;
    this.blasts = []; this.clouds = []; this.pits = []; this.sands = []; this.armours = []; this.tremors = []; this.storming = null; this.gaunts = []; this.hands = []; this.shifts = []; this.shackled = []; this.breakers = [];
    const rng = mulberry32(4242);
    this.rockGeos = [0, 1, 2, 3, 4, 5].map(() => jaggedRockGeometry(rng, 1, 0.34, 1));
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x7a6f66, roughness: 0.95, flatShading: true });
    this.armourMat = new THREE.MeshStandardMaterial({ color: 0x6f665e, roughness: 0.92, flatShading: true });
    this.gritMat = new THREE.MeshStandardMaterial({ color: 0x6a5d50, roughness: 1, flatShading: true });
    this.soft = this.world.fx.soft;
    this.sandMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // swirling sand: a spiral of light and dark bands turning inwards, ragged at the rim
      fragmentShader: `uniform float uTime, uAlpha; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){ vec2 c = vUv - 0.5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
          float sw = sin(a * 3.0 + r * 9.0 - uTime * 2.6 + n(c * 6.0 + uTime * 0.3) * 2.0);
          float g = n(vec2(a * 4.0, r * 14.0 - uTime * 1.5));
          vec3 col = mix(vec3(0.42, 0.33, 0.22), vec3(0.72, 0.6, 0.42), 0.5 + 0.5 * sw); col *= 0.8 + 0.35 * g; col = mix(col, vec3(0.25, 0.19, 0.12), smoothstep(0.35, 0.0, r));
          float rim = 1.0 - smoothstep(0.82 + 0.12 * n(vec2(a * 5.0, uTime * 0.2)), 1.0, r);
          gl_FragColor = vec4(col, rim * uAlpha); }`,
    });
  }

  // a dust sprite of our own (the shared pool recycles too quickly for a cloud that lingers)
  sprite(col, op) {
    const m = new THREE.SpriteMaterial({ map: this.soft, color: col, transparent: true, depthWrite: false, opacity: op });
    const s = new THREE.Sprite(m); s.renderOrder = 3; this.world.scene.add(s); return s;
  }
  rock(scale, mat = this.rockMat) { const m = new THREE.Mesh(this.rockGeos[Math.floor(Math.random() * this.rockGeos.length)], mat); m.scale.setScalar(scale); m.castShadow = true; return m; }

  // ---------------------------------------------------------------- Dust Cloud
  // (brief) the stamp drags dust and loose earth up, the palm thrust drives a violent storm of earth at the rival: a front
  // of fast grit and small stones, then thick rolling dust that expands, swirls and thins; a direct hit does moderate
  // damage, pushes the rival back into a recoil or stagger (not a knockdown), and blinds them for a moment; the cloud
  // left behind hangs over that part of the arena. Charged (HAND kept held through the thrust): wider, harder, bigger.
  dust(f, charged) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    const from = f.handPos(f.techSide > 0 ? 'R' : 'L', new THREE.Vector3());
    const dir = t ? _v.set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize().clone() : f.forward(new THREE.Vector3()).setY(0).normalize();
    from.addScaledVector(dir, 0.3); from.y = Math.min(from.y, f.groundY + 1.05);   // (the storm rolls at chest height and below)
    const B = { f, t: 0, pos: from.clone(), dir, speed: charged ? 17 : 15, range: charged ? 11 : 9, r0: charged ? 1.0 : 0.7, r1: charged ? 3.0 : 2.0,
      dmg: charged ? 14 : 9, knock: charged ? 9 : 5.5, hit: new Set(), charged, sprites: [], grit: [] };
    this.blasts.push(B);
    // the stamp: loose earth and dust kicked up at the feet
    w.fx.dust(_v2.set(f.pos.x, f.groundY, f.pos.z), 10, 2.5, 0xa08a6c); w.fx.debrisBurst(_v2.set(f.pos.x, f.groundY + 0.1, f.pos.z), 8, 2.5, 0.07, 0x6a5d50, 1.4); w.fx.crater(_v2, 1.3);
    w.audio.rumble(charged ? 1.0 : 0.7); w.audio.whoosh(charged ? 1.3 : 1.0); w.shake(charged ? 0.25 : 0.15, f.pos);
    // grit: small stones thrown ahead of the dust
    for (let i = 0; i < (charged ? 26 : 18); i++) {
      const m = this.rock(rand(0.04, 0.11), this.gritMat); m.position.copy(from).add(_v2.set(rand(-0.3, 0.3), rand(-0.25, 0.3), rand(-0.3, 0.3)));
      const sp = rand(16, 24) * (charged ? 1.1 : 1), spread = charged ? 0.32 : 0.22;
      const v = dir.clone().multiplyScalar(sp).add(_v2.set(rand(-1, 1) * sp * spread, rand(-0.1, 0.35) * sp * spread, rand(-1, 1) * sp * spread));
      w.scene.add(m); B.grit.push({ m, v, life: rand(0.5, 0.8), spin: new THREE.Vector3(rand(-15, 15), rand(-15, 15), rand(-15, 15)) });
    }
  }
  updateBlasts(dt) {
    const w = this.world;
    for (const B of this.blasts) {
      B.t += dt;
      const travelled = Math.min(B.range, B.speed * (1 - Math.exp(-1.3 * B.t)) / 1.3);   // fast off the palm, slowing as it spreads (about 6 m in 0.5 s)
      const head = _v.copy(B.pos).addScaledVector(B.dir, travelled), k = travelled / B.range, r = B.r0 + (B.r1 - B.r0) * k;
      // the rolling body of dust: puffs born at the head, each turning and swelling as it slows
      if (B.t < 0.75) for (let i = 0; i < (B.charged ? 8 : 6); i++) {
        const s = this.sprite(DUST_COLS[Math.floor(Math.random() * DUST_COLS.length)], 0);
        s.position.copy(head).add(_v2.set(rand(-r, r) * 0.6, rand(-0.5, 0.45) * r * 0.5, rand(-r, r) * 0.6)); s.position.y = Math.max(s.position.y, B.f.groundY + 0.25);
        B.sprites.push({ s, v: B.dir.clone().multiplyScalar(rand(4, 9)).add(_v2.set(rand(-1.5, 1.5), rand(0, 1.2), rand(-1.5, 1.5))), age: 0, life: rand(1.0, 1.6), size: rand(0.9, 1.4) * (B.charged ? 1.3 : 1), spin: rand(-2, 2), op: rand(0.65, 0.9) });
      }
      for (const P of B.sprites) {
        P.age += dt; const a = P.age / P.life;
        P.v.multiplyScalar(Math.exp(-2.6 * dt)); P.s.position.addScaledVector(P.v, dt); P.s.position.y += dt * 0.25;
        P.s.material.rotation += P.spin * dt; P.s.scale.setScalar(P.size * (1 + a * 2.4));
        P.s.material.opacity = P.op * (a < 0.12 ? a / 0.12 : 1 - (a - 0.12) / 0.88);
        if (a >= 1) { w.scene.remove(P.s); P.s.material.dispose(); P.dead = true; }
      }
      B.sprites = B.sprites.filter(P => !P.dead);
      for (const G of B.grit) {
        G.life -= dt; G.v.y -= 9 * dt; G.m.position.addScaledVector(G.v, dt); G.m.rotation.x += G.spin.x * dt; G.m.rotation.y += G.spin.y * dt;
        const gy = w.arena.groundAt(G.m.position.x, G.m.position.z, G.m.position.y + 1);
        if (G.m.position.y < gy + 0.03) { G.m.position.y = gy + 0.03; G.v.multiplyScalar(0.3); G.v.y = Math.abs(G.v.y) * 0.3; }
        if (G.life <= 0) { w.scene.remove(G.m); G.dead = true; }
      }
      B.grit = B.grit.filter(G => !G.dead);
      // the hit: anyone inside the advancing front (once)
      if (B.t < 1.0) for (const t of w.fighters) {
        if (t === B.f || t.dead || B.hit.has(t)) continue;
        const c = t.chestPos(_v3), along = _v2.copy(c).sub(B.pos).dot(B.dir);
        if (along < 0 || along > travelled + 0.6) continue;
        const lat = _v2.copy(c).sub(B.pos).addScaledVector(B.dir, -along).length();
        if (lat > r + t.radius) continue;
        B.hit.add(t);
        if (t.invuln > 0) continue;
        // a hit: moderate damage, a push back into a recoil or stagger; guarded, the guard takes it (combat.damage)
        w.combat.damage(t, B.dmg, B.dir.clone(), B.f, 'dustCloud', c.clone(), B.knock, B.charged ? 1 : (along < 4 ? 1 : 0));
        t.blindT = Math.max(t.blindT || 0, B.charged ? 2.4 : 1.6);
        w.fx.debrisBurst(c, 8, 3, 0.05, 0x6a5d50);
        w.popup(B.f, B.charged ? 'DUST STORM' : 'DUST CLOUD', true);
      }
      if (B.t > 0.8 && !B.cloud) {
        // what is left hangs in the air: a lingering cloud around where the storm ran out or struck
        B.cloud = true; const at = head.clone(); const hitT = [...B.hit][0]; if (hitT) at.copy(hitT.pos).setY(hitT.groundY + 1);
        this.cloud(at, B.charged ? 4.2 : 3.0, B.charged ? 6 : 4.5);
      }
      if (B.t > 1.8 && !B.sprites.length && !B.grit.length) B.dead = true;
    }
    this.blasts = this.blasts.filter(B => !B.dead);
  }
  // a lingering dust cloud: large slow puffs churning in place; inside it fighters are hard to see (cloud alpha) and the
  // computer opponent loses sight of a rival standing in it (obscured())
  cloud(at, R, life, n = 22) {
    const C = { pos: at.clone(), R, life, t: 0, sprites: [] };
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), rr = Math.sqrt(Math.random()) * R * 0.85;
      const s = this.sprite(DUST_COLS[i % DUST_COLS.length], 0);
      C.sprites.push({ s, a, rr, y: rand(0.2, 2.2), ph: rand(0, 6.28), size: rand(1.6, 2.8) * R / 3, spin: rand(-0.6, 0.6), op: rand(0.45, 0.7), drift: rand(0.2, 0.5) });
    }
    this.clouds.push(C);
  }
  updateClouds(dt) {
    const w = this.world;
    for (const C of this.clouds) {
      C.t += dt; const fadeIn = Math.min(1, C.t / 0.4), fadeOut = Math.min(1, (C.life - C.t) / 1.5), A = Math.max(0, Math.min(fadeIn, fadeOut));
      for (const P of C.sprites) {
        P.a += P.drift * dt / Math.max(0.5, P.rr);
        P.s.position.set(C.pos.x + Math.cos(P.a) * P.rr, w.arena.groundAt(C.pos.x, C.pos.z, C.pos.y + 1) + P.y + Math.sin(C.t * 0.8 + P.ph) * 0.15, C.pos.z + Math.sin(P.a) * P.rr);
        P.s.material.rotation += P.spin * dt; P.s.scale.setScalar(P.size * (1 + C.t * 0.05)); P.s.material.opacity = P.op * A;
      }
      if (C.t >= C.life) { for (const P of C.sprites) { w.scene.remove(P.s); P.s.material.dispose(); } C.dead = true; }
    }
    this.clouds = this.clouds.filter(C => !C.dead);
  }
  obscured(p) { return this.clouds.some(C => C.t > 0.3 && C.t < C.life - 1 && Math.hypot(p.x - C.pos.x, p.z - C.pos.z) < C.R * 0.8); }

  // ---------------------------------------------------------------- Dust Storm (SPECIAL tap)
  // (20 Nov, after review: "the dust attack is meant to be powerful, not just a brown mist ... fill up the whole arena
  // so the opponent cannot see where the earth bender is ... the earth bender feels the person through the ground")
  // The stamp and palm thrust send the charged storm of grit at the rival (it strikes and staggers, as Dust Cloud), and
  // the dust boils out over the whole arena for 8 s: the air thickens to a brown wall a dozen metres off (fog and sky
  // turn to dust), clouds churn round the fighters, and the rival is blinded for as long as it lasts (the computer
  // opponent loses track of the bender and swings wild; a human rival's screen is veiled). The bender is not blinded:
  // he feels the rival through the ground, shown as tremor rings pulsing under the rival's feet, seen through the dust.
  storm(f) {
    this.dust(f, true);
    const w = this.world, sc = w.scene;
    if (!this.stormS) this.stormS = { fogC: sc.fog.color.clone(), near: sc.fog.near, far: sc.fog.far, bg: sc.background && sc.background.isColor ? sc.background.clone() : null };
    this.storming = { f, t: 0, life: 8, ringT: 0 };
    // (21 Nov) 10 larger clouds of 10 puffs (was 26 of 22: 572 sprites, each its own draw call, over 300 draw calls a frame
    // on a phone); the fog does most of the hiding
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28 + rand(-0.3, 0.3), r = rand(3, 22); this.cloud(new THREE.Vector3(Math.cos(a) * r, f.groundY, Math.sin(a) * r), rand(6, 9), 8, 10); }
    w.audio.rumble(1.3); w.shake(0.4, f.pos); w.popup(f, 'DUST STORM', true);
  }
  updateStorm(dt) {
    const S = this.storming, w = this.world, sc = w.scene, O = this.stormS;
    if (!O) return;
    let k = 0;
    if (S) {
      S.t += dt; k = Math.min(1, S.t / 0.8) * Math.min(1, (S.life - S.t) / 1.5);
      for (const t of w.fighters) if (t !== S.f && !t.dead) t.blindT = Math.max(t.blindT || 0, 0.25);
      // the bender's tremor sense: rings pulse out under the rival, drawn over the dust
      if ((S.ringT -= dt) <= 0) {
        S.ringT = 0.5;
        const t = S.f.target; if (t && !t.dead) this.tremor(t);
      }
      if (S.t >= S.life || S.f.dead) this.storming = null;
    }
    // fog and sky ease toward dust and back
    const dustC = _c1.setHex(0x9c8466);
    // the player's own storm: thick enough to hide the rival beyond a few metres, thin enough to keep the bender in view
    // on the follow camera; the rival's storm round the player: a blinding wall (and the dust veil, main.js)
    const mine = !S || S.f === w.fighters[0], near = mine ? 4 : 1, far = mine ? 15 : 9;
    sc.fog.color.copy(O.fogC).lerp(dustC, k); sc.fog.near = O.near + (near - O.near) * k; sc.fog.far = O.far + (far - O.far) * k;
    if (O.bg && sc.background && sc.background.isColor) sc.background.copy(O.bg).lerp(dustC, k);
    if (!S && k === 0) { sc.fog.color.copy(O.fogC); sc.fog.near = O.near; sc.fog.far = O.far; if (O.bg) sc.background.copy(O.bg); this.stormS = null; }
  }
  tremor(t) {
    const w = this.world;
    const m = new THREE.Mesh(this.ringGeo || (this.ringGeo = (() => { const g = new THREE.RingGeometry(0.8, 1, 40); g.rotateX(-Math.PI / 2); return g; })()), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false }));
    m.position.set(t.pos.x, t.groundY + 0.05, t.pos.z); m.renderOrder = 20; w.scene.add(m);
    this.tremors.push({ m, t: 0 });
  }
  updateTremors(dt) {
    for (const R of this.tremors) { R.t += dt; R.m.scale.setScalar(0.4 + R.t * 2.6); R.m.material.opacity = 0.9 * Math.max(0, 1 - R.t / 0.7); if (R.t > 0.7) { this.world.scene.remove(R.m); R.m.material.dispose(); R.dead = true; } }
    this.tremors = this.tremors.filter(R => !R.dead);
  }

  // ---------------------------------------------------------------- Earth Sinking
  // (brief) the bender bends the knees and drives both palms down; the ground under the rival loosens and pulls the feet
  // in: the rival drops to the shins into a churned pit (a hole is opened in the look of the floor: a dark pit, broken
  // rim stones round the legs), cannot step out, bends the knees and struggles. The rock holds them 2.2 s and they
  // cannot dodge or jump out of it. The bender can follow up while the rival is held.
  sink(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    if (!t || Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) > 11 || !t.onGround || t.invuln > 0) {
      // nothing to catch: the ground in front still churns and drops
      const p = f.pos.clone().addScaledVector(f.forward(_v), 4); w.fx.crater(p.setY(w.arena.groundAt(p.x, p.z, f.pos.y + 1)), 1.6); w.fx.dust(p, 8, 1.5, 0xa08a6c); w.audio.rumble(0.6); return;
    }
    const at = new THREE.Vector3(t.pos.x, t.groundY, t.pos.z);
    const P = { f, t: t, at, time: 0, dur: 2.2, rim: [] };
    // the rim: broken stones pushed up round the legs
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28 + rand(-0.2, 0.2), m = this.rock(rand(0.16, 0.26)); m.position.set(at.x + Math.cos(a) * 0.48, at.y - 0.3, at.z + Math.sin(a) * 0.48); m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); w.scene.add(m); P.rim.push({ m, y: rand(0.02, 0.12) }); }
    P.pit = new THREE.Mesh(this.pitGeo || (this.pitGeo = (() => { const g = new THREE.CircleGeometry(0.62, 18); g.rotateX(-Math.PI / 2); return g; })()), new THREE.MeshBasicMaterial({ color: 0x2c2117, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    P.pit.position.set(at.x, at.y + 0.015, at.z); P.pit.renderOrder = 2; w.scene.add(P.pit);
    w.fx.crater(at, 2.2); w.fx.dust(at, 12, 2.2, 0x9a8466); w.fx.debrisBurst(_v.copy(at).setY(at.y + 0.1), 12, 2.2, 0.08, 0x6a5d50, 1.2);
    w.combat.damage(t, 6, _v.set(0, 0, 0), f, 'earthSink', t.chestPos(new THREE.Vector3()), 0, -1);
    t.sinkP = P; t.restrainT = Math.max(t.restrainT || 0, P.dur); t.vel.set(0, 0, 0);
    w.audio.rumble(1.0); w.shake(0.25, at); w.popup(f, 'EARTH SINKING', true);
    this.pits.push(P);
  }
  updatePits(dt) {
    const w = this.world;
    for (const P of this.pits) {
      const t = P.t; P.time += dt;
      // (20 Nov, after review: "for the rock trap the victim cannot apply the option of dodge") the rock holds the legs for
      // the full 2.2 s: no dodge, no jump, no struggling out (a restrained fighter cannot dodge, fighter.free)
      const free = t.dead || P.time >= P.dur || t.action === 'down';
      const k = free ? 0 : Math.min(1, P.time / 0.22);
      t.sinkY = 0.42 * k * (1 - 0.06 * Math.sin(P.time * 9) * (P.time > 0.3 ? 1 : 0));   // a little heave as they strain
      if (!free) { t.pos.x += (P.at.x - t.pos.x) * Math.min(1, dt * 12); t.pos.z += (P.at.z - t.pos.z) * Math.min(1, dt * 12); t.vel.x = t.vel.z = 0; t.restrainT = Math.max(t.restrainT, 0.05); }
      for (const r of P.rim) r.m.position.y = P.at.y - 0.3 + (0.3 + r.y) * Math.min(1, P.time / 0.18) * (free ? 0 : 1);
      if (free) {
        // torn free: the legs come out in a spray of loose earth
        t.sinkY = 0; t.sinkP = null; t.restrainT = Math.min(t.restrainT, 0.05);
        w.fx.debrisBurst(_v.copy(P.at).setY(P.at.y + 0.2), 10, 2.5, 0.07, 0x6a5d50, 1.5); w.fx.dust(P.at, 8, 1.8, 0xa08a6c);
        for (const r of P.rim) w.scene.remove(r.m); w.scene.remove(P.pit); P.pit.material.dispose(); P.dead = true;
      }
    }
    this.pits = this.pits.filter(P => !P.dead);
  }

  // ---------------------------------------------------------------- Quicksand
  // (20 Nov, after review: "the purpose of quicksand is to sink ... in quicksand the victim sinks to their head") from a
  // stable stance the hands circle downwards and the ground under the rival turns to swirling sand. A rival standing
  // in it is caught: drawn to the middle and swallowed, steadily deeper (knees, waist, chest) towards the head, over
  // about 3.5 s, struggling with the arms above the sand. Struggling (each JUMP press) heaves them up 0.14 m; if they
  // fight their way back out before it closes over them they climb free. If the sand reaches the chin it crushes them
  // (20 damage) and spits them out onto the ground (a knockdown). Sinking deeper also costs 4 health a second once past
  // the waist. The pool lasts 5 s; whoever walks into it while it lasts is caught the same way.
  quicksand(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    const at = t && Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) < 12 ? new THREE.Vector3(t.pos.x, 0, t.pos.z) : f.pos.clone().addScaledVector(f.forward(_v).setY(0).normalize(), 4.5);
    at.y = w.arena.groundAt(at.x, at.z, (t ? t.pos.y : f.pos.y) + 1);
    const m = new THREE.Mesh(this.sandGeo || (this.sandGeo = (() => { const g = new THREE.CircleGeometry(1, 40); g.rotateX(-Math.PI / 2); return g; })()), this.sandMat.clone());
    const R = 2.4; m.scale.set(R, 1, R); m.position.set(at.x, at.y + 0.02, at.z); m.renderOrder = 2; w.scene.add(m);
    this.sands.push({ f, at, R, m, t: 0, life: 5.0, caught: new Map() });
    w.fx.dust(at, 14, 3, 0xb39b7a); w.audio.rumble(0.8); w.popup(f, 'QUICKSAND', true);
  }
  updateSands(dt) {
    const w = this.world, FULL = 1.45;   // sunk to the chin
    for (const S of this.sands) {
      S.t += dt; const A = Math.min(1, S.t / 0.35) * Math.min(1, (S.life - S.t) / 0.6);
      S.m.material.uniforms.uTime.value = S.t; S.m.material.uniforms.uAlpha.value = 0.95 * Math.max(0, A);
      for (const t of w.fighters) {
        if (t === S.f || t.dead) continue;
        let C = S.caught.get(t);
        const d = Math.hypot(t.pos.x - S.at.x, t.pos.z - S.at.z);
        if (!C && t.onGround && d < S.R * 0.9 && S.t < S.life - 0.5 && t.action !== 'down' && t.invuln <= 0) { C = { depth: 0.05, tick: 0 }; S.caught.set(t, C); w.audio.rumble(0.5); }
        if (!C) continue;
        // drawn to the middle, swallowed steadily; each JUMP heaves them up
        t.pos.x += (S.at.x - t.pos.x) * Math.min(1, dt * 1.5); t.pos.z += (S.at.z - t.pos.z) * Math.min(1, dt * 1.5); t.vel.x = t.vel.z = 0; if (t.vel.y > 0) t.vel.y = 0;
        C.depth += dt * (0.36 + 0.1 * C.depth);
        if (t.input && t.input.jump) { C.depth -= 0.14; w.fx.dust(_v.set(t.pos.x, S.at.y, t.pos.z), 3, 1.2, 0xb39b7a); }
        t.restrainT = Math.max(t.restrainT || 0, 0.1); t.sandSink = Math.max(0, C.depth);
        if (C.depth > 0.75 && (C.tick -= dt) <= 0) { C.tick = 0.25; w.combat.damage(t, 1, _v.set(0, 0, 0), S.f, 'quicksand', t.chestPos(_v2), 0, -1); }
        if (Math.random() < dt * 10) w.fx.dust(_v.set(t.pos.x + rand(-0.4, 0.4), S.at.y, t.pos.z + rand(-0.4, 0.4)), 1, 0.6, 0xb39b7a);
        const out = C.depth <= 0;
        const crushed = C.depth >= FULL;
        if (out || crushed || S.t >= S.life || t.dead) {
          S.caught.delete(t); t.sandSink = 0; t.restrainT = Math.min(t.restrainT, 0.05);
          if (crushed) {
            // closed over to the chin: crushed and thrown out onto the sand
            w.combat.damage(t, 20, _v.set(rand(-1, 1), 0, rand(-1, 1)).normalize().clone(), S.f, 'quicksand', t.chestPos(new THREE.Vector3()), 6, 2);
            w.fx.debrisBurst(_v.set(t.pos.x, S.at.y + 0.2, t.pos.z), 14, 3, 0.07, 0x8a7458, 1.8); w.fx.dust(_v, 14, 3, 0xb39b7a); w.audio.impact(1.0); w.popup(S.f, 'SWALLOWED', true);
          } else { t.vel.y = 5; t.onGround = false; w.fx.dust(_v.set(t.pos.x, S.at.y, t.pos.z), 10, 2, 0xb39b7a); }
          if (out) w.popup(t, 'BROKE FREE', false);
        }
      }
      if (Math.random() < dt * 5) { const a = rand(0, 6.28), r = rand(0, S.R * 0.9); w.fx.dust(_v.set(S.at.x + Math.cos(a) * r, S.at.y, S.at.z + Math.sin(a) * r), 1, 0.5, 0xb39b7a); }
      if (S.t >= S.life) { w.scene.remove(S.m); S.m.material.dispose(); S.dead = true; }
    }
    this.sands = this.sands.filter(S => !S.dead);
  }

  // ---------------------------------------------------------------- Rock Armour
  // (brief: "rocks completely cover the character and form a rock man") stone plates fly up from the ground and lock onto
  // every part of the body, from the feet upwards: shins, thighs, hips, the torso in three plates, shoulders, upper
  // arms, forearms, fists, neck and head. Each plate is fixed to its own bone, so the joints still bend, punch, guard
  // and fall naturally. While it holds: blows do 40 % of their damage, light hits do not make him flinch, a stagger is
  // only a flinch and a knockdown only a stagger; he moves at 80 % speed. (20 Nov, after review) it is the close-quarters
  // form: stone fists hit 40 % harder and push further (combat.damage). It soaks 70 damage or lasts 10 s, then bursts.
  armour(f) {
    const w = this.world;
    if (f.armour) this.armourEnd(f, true);
    const H = f.hero; if (!H) return;
    const parts = [
      // [bone, child for the length (or null), thickness (m), plates, delay]
      ['DEF-footL', 'DEF-toeL', 0.2, 2, 0.0], ['DEF-footR', 'DEF-toeR', 0.2, 2, 0.0],
      ['DEF-shinL', 'DEF-footL', 0.25, 3, 0.06], ['DEF-shinR', 'DEF-footR', 0.25, 3, 0.06],
      ['DEF-thighL', 'DEF-shinL', 0.31, 3, 0.12], ['DEF-thighR', 'DEF-shinR', 0.31, 3, 0.12],
      ['DEF-hips', 'DEF-spine001', 0.48, 3, 0.18], ['DEF-spine001', 'DEF-spine002', 0.48, 3, 0.22], ['DEF-spine002', 'DEF-spine003', 0.5, 3, 0.26], ['DEF-spine003', 'DEF-neck', 0.52, 3, 0.3],
      ['DEF-upper_armL', 'DEF-forearmL', 0.24, 3, 0.34], ['DEF-upper_armR', 'DEF-forearmR', 0.24, 3, 0.34],
      ['DEF-forearmL', 'DEF-handL', 0.21, 3, 0.4], ['DEF-forearmR', 'DEF-handR', 0.21, 3, 0.4],
      ['DEF-handL', 'DEF-f_middle01L', 0.18, 2, 0.45], ['DEF-handR', 'DEF-f_middle01R', 0.18, 2, 0.45],
      ['DEF-neck', 'DEF-head', 0.22, 2, 0.48], ['DEF-head', null, 0.34, 2, 0.52],
    ];
    const A = { f, plates: [], t: 0, hp: 70, life: 10 };
    for (const [bn, cn, th, n, delay] of parts) {
      const bone = H.bones[bn]; if (!bone) continue;
      const child = cn && H.bones[cn];
      const seg = child ? child.position.clone() : new THREE.Vector3(0, 0.12 / Math.max(1e-4, bone.getWorldScale(_v).y), 0);   // the bone's length, in its own frame
      const ws = bone.getWorldScale(_v).x || 1, len = seg.length(), thick = th / ws;
      const q = new THREE.Quaternion().setFromUnitVectors(_v2.set(0, 1, 0), seg.clone().normalize());
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(this.rockGeos[(i + bn.length) % this.rockGeos.length], this.armourMat);
        const u = n === 1 ? 0.5 : 0.15 + 0.7 * i / (n - 1);   // (overlapping along the bone, so no gap shows)
        const shoulder = /upper_arm/.test(bn) && i === 0;
        const L = len * (n === 1 ? 1.0 : 0.62), T = thick * (shoulder ? 1.3 : 1) * rand(0.92, 1.08);
        m.position.copy(seg).multiplyScalar(u); m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(_v2.set(0, 1, 0), rand(0, 6.28)));
        m.userData.scale = new THREE.Vector3(T * 0.5, Math.max(L * 0.5, T * 0.45), T * 0.5);
        if (!cn) { m.userData.scale.set(T * 0.5, T * 0.55, T * 0.52); m.position.set(0, T * (0.3 + 0.12 * i), -T * 0.04 * i); }   // the head: a rough helm
        m.scale.setScalar(0.0001); m.castShadow = true; bone.add(m);
        A.plates.push({ m, delay: delay + i * 0.03, bone });
      }
    }
    f.armour = A; this.armours.push(A);
    w.fx.dust(_v.set(f.pos.x, f.groundY, f.pos.z), 14, 2.5, 0xa08a6c); w.fx.debrisBurst(_v.set(f.pos.x, f.groundY + 0.1, f.pos.z), 18, 1.6, 0.09, 0x6a5d50, 2);
    w.audio.rumble(1.1); w.shake(0.3, f.pos); w.popup(f, 'ROCK ARMOUR', true);
  }
  armourEnd(f, quiet) {
    const A = f.armour; if (!A) return; const w = this.world;
    for (const P of A.plates) {
      if (!quiet) { P.m.getWorldPosition(_v); w.fx.debrisBurst(_v, 2, 4, 0.1, 0x6f665e, 1); }
      P.bone.remove(P.m);
    }
    if (!quiet) { w.fx.dust(f.chestPos(_v), 10, 2.5, 0x9a8a78); w.audio.rumble(0.8); w.audio.impact(0.8); w.popup(f, 'ARMOUR BROKEN', false); }
    A.dead = true; f.armour = null;
  }
  // a blow on the armour (called from fighter.takeHit): returns [damage, level] after the armour takes its share
  armourHit(f, dmg, level) {
    const A = f.armour; if (!A) return [dmg, level];
    const taken = dmg * 0.4; A.hp -= dmg - taken;
    const w = this.world; w.fx.debrisBurst(f.chestPos(_v), 4, 3, 0.07, 0x6f665e, 1); w.audio.impact(0.5);
    if (A.hp <= 0) this.armourEnd(f, false);
    return [taken, level >= 2 ? 1 : level >= 1 ? 0 : -1];
  }
  updateArmours(dt) {
    for (const A of this.armours) {
      if (A.dead) continue;
      A.t += dt; const f = A.f;
      for (const P of A.plates) {
        const k = clamp((A.t - P.delay) / 0.18, 0, 1), e = k * k * (3 - 2 * k), pop = k < 1 ? 1 + 0.25 * Math.sin(k * Math.PI) : 1;
        P.m.scale.copy(P.m.userData.scale).multiplyScalar(Math.max(0.0001, e * pop));
        if (k > 0 && k < 0.2 && !P.flew) { P.flew = true; P.m.getWorldPosition(_v); this.world.fx.debrisBurst(_v.setY(f.groundY + 0.05), 1, 1.5, 0.06, 0x6a5d50, 2.5); }
      }
      if (f.dead || A.t >= A.life) this.armourEnd(f, f.dead);
    }
    this.armours = this.armours.filter(A => !A.dead);
  }

  // ---------------------------------------------------------------- Earth Gauntlet
  // (20 Nov, Earth brief) on a punch the striking fist clenches and small rocks fly up from the ground and lock round the
  // fist and forearm (each piece fixed to the hand or forearm bone, so the wrist and elbow still bend and the stone
  // follows the punch exactly); it stays while the punching goes on and crumbles 0.7 s after the last punch.
  gauntlet(f, side) {
    const H = f.hero; if (!H) return;
    f.gaunts = f.gaunts || {};
    const G = f.gaunts[side];
    if (G && !G.dead) { G.until = G.t + 0.7 + 0.5; return; }
    const parts = [['DEF-hand' + side, 'DEF-f_middle01' + side, 0.15, 2], ['DEF-forearm' + side, 'DEF-hand' + side, 0.17, 3]];
    const g = { f, side, t: 0, until: 1.2, plates: [] };
    for (const [bn, cn, th, n] of parts) {
      const bone = H.bones[bn], child = H.bones[cn]; if (!bone || !child) continue;
      const seg = child.position.clone(), ws = bone.getWorldScale(_v).x || 1, len = seg.length(), T = th / ws;
      const q = new THREE.Quaternion().setFromUnitVectors(_v2.set(0, 1, 0), seg.clone().normalize());
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(this.rockGeos[(i * 2 + side.length) % this.rockGeos.length], this.armourMat);
        m.position.copy(seg).multiplyScalar(n === 1 ? 0.5 : 0.2 + 0.65 * i / (n - 1));
        m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(_v2.set(0, 1, 0), rand(0, 6.28)));
        m.userData.scale = new THREE.Vector3(T * 0.5, Math.max(len * 0.36, T * 0.45), T * 0.5); m.scale.setScalar(0.0001); m.castShadow = true;
        bone.add(m); g.plates.push({ m, bone, delay: i * 0.025 });
      }
    }
    // the stones come up off the floor to the fist
    const w = this.world; w.fx.debrisBurst(_v.set(f.pos.x, f.groundY + 0.05, f.pos.z), 6, 1.2, 0.06, 0x6a5d50, 2.2);
    f.gaunts[side] = g; this.gaunts.push(g);
  }
  updateGauntlets(dt) {
    const w = this.world;
    for (const g of this.gaunts) {
      g.t += dt;
      for (const P of g.plates) { const k = clamp((g.t - P.delay) / 0.09, 0, 1); P.m.scale.copy(P.m.userData.scale).multiplyScalar(Math.max(0.0001, k)); }
      const f = g.f, punching = f.action === 'tech' && f.tech && (f.tech === f.style.tech.hand || f.tech.variantOf === f.style.tech.hand);
      if (punching) g.until = Math.max(g.until, g.t + 0.7);
      if (g.t > g.until || f.dead || f.el !== 'earth' || f.armour) {
        for (const P of g.plates) { P.m.getWorldPosition(_v); if (Math.random() < 0.6) w.fx.debrisBurst(_v, 1, 2, 0.06, 0x6f665e, 0.6); P.bone.remove(P.m); }
        g.dead = true; if (f.gaunts && f.gaunts[g.side] === g) f.gaunts[g.side] = null;
      }
    }
    this.gaunts = this.gaunts.filter(g => !g.dead);
  }

  // ---------------------------------------------------------------- Earth Compression (HAND held)
  // (20 Nov, Earth brief) the hands come up in front of the chest, palms facing one another, and draw inward while rock
  // fragments fly in from the ground between them and pack together into a stone that grows denser the longer HAND is
  // held (0.35 m to 0.75 m across over 1.2 s). Letting go thrusts a palm and the compressed stone flies at the rival:
  // 9 damage at the smallest to 24 at full size, the full one knocking the rival down.
  compressStart(f) {
    f.comp = { t: 0, r: 0.16, frags: [], tick: 0 };
    // a loose stone lying near (4 m) flies up into the hands and becomes the heart of the compressed stone
    const stone = this.world.arena.nearestLooseStone && this.world.arena.nearestLooseStone(f.pos, 4);
    if (stone) { stone.col.dead = true; stone.mesh.visible = false; stone.taken = true; const m = this.rock(0.3); m.position.copy(stone.mesh.position); this.world.scene.add(m); f.comp.frags.push({ m, t: 0, from: stone.mesh.position.clone() }); f.comp.t = 0.35; this.world.fx.dust(stone.mesh.position, 8, 2, 0xa08a6c); }
  }
  compressTick(f, dt) {
    const C = f.comp; if (!C) return; const w = this.world; C.t += dt;
    const k = Math.min(1, C.t / 1.2); C.r = 0.17 + 0.2 * k;
    const mid = f.handPos('L', _v).add(f.handPos('R', _v2)).multiplyScalar(0.5).addScaledVector(f.forward(_v3), 0.12);
    if (!C.m) { C.m = this.rock(0.2); w.scene.add(C.m); }
    C.m.position.lerp(mid, 0.6); C.m.scale.setScalar(C.r * (1 + 0.04 * Math.sin(C.t * 40))); C.m.rotation.y += dt * 2; C.m.rotation.x += dt * 1.3;
    if ((C.tick -= dt) <= 0) {
      C.tick = 0.06;
      const a = rand(0, 6.28), from = _v.set(f.pos.x + Math.cos(a) * rand(1.2, 2.4), f.groundY + 0.05, f.pos.z + Math.sin(a) * rand(1.2, 2.4));
      const m = this.rock(rand(0.05, 0.1)); m.position.copy(from); w.scene.add(m); C.frags.push({ m, t: 0, from: from.clone() });
      if (Math.random() < 0.3) w.fx.dust(from, 1, 0.6, 0xa08a6c);
    }
    for (const F of C.frags) {
      F.t += dt * 3.2; const e = Math.min(1, F.t);
      F.m.position.copy(F.from).lerp(C.m.position, e * e); F.m.position.y += Math.sin(e * Math.PI) * 0.6; F.m.rotation.x += dt * 10;
      if (e >= 1) { w.scene.remove(F.m); F.dead = true; }
    }
    C.frags = C.frags.filter(F => !F.dead);
    if (Math.random() < dt * 4) w.audio.rumble(0.35, C.m.position);
  }
  // released (HAND let go): the stone waits on the thrust (earth.thrust launches it); dropped (hit, out of energy): it
  // crumbles
  compressEnd(f, released) {
    const C = f.comp; if (!C) return; const w = this.world;
    for (const F of C.frags) w.scene.remove(F.m);
    f.comp = null;
    if (!C.m) return;
    if (released && C.t > 0.2) { f.compBall = { m: C.m, r: C.r, k: Math.min(1, C.t / 1.2) }; }
    else { w.fx.debrisBurst(C.m.position, 8, 2, 0.07, 0x6a5d50); w.scene.remove(C.m); }
  }
  compressLaunch(f) {
    const Bd = f.compBall; if (!Bd) return; f.compBall = null; const w = this.world, B = this.B;
    const from = Bd.m.position.clone(); w.scene.remove(Bd.m);
    const o = B.fire('boulder', f, from); o.dmg = Math.round(9 + 15 * Bd.k); o.knock = 6 + 8 * Bd.k; if (Bd.k > 0.85) o.level = 2;
    o.mesh.scale.multiplyScalar(0.6 + 0.9 * Bd.k);
    w.fx.debrisBurst(from, 8, 3, 0.07, 0x6a5d50); w.audio.rumble(0.6 + 0.5 * Bd.k, from); w.shake(0.1 + 0.2 * Bd.k, from);
    if (Bd.k > 0.85) w.popup(f, 'COMPRESSED STONE', true);
  }

  // ---------------------------------------------------------------- Earth Hand (HAND with the stick pulled away)
  // (20 Nov, Earth brief) the bender thrusts one hand at the rival and closes the fingers: a huge hand of stone tears up
  // out of the ground under the rival, the fingers close round them and lift them (1 s, held; each JUMP tears free 0.25 s
  // sooner), then it slams them down (14 damage, a knockdown) and crumbles. A rival in the air or out of reach (12 m): the
  // stone hand still rises and swats where they were.
  earthHand(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    const near = t && Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) < 12;
    const at = near ? new THREE.Vector3(t.pos.x, t.groundY, t.pos.z) : f.pos.clone().addScaledVector(f.forward(_v).setY(0).normalize(), 5);
    at.y = w.arena.groundAt(at.x, at.z, at.y + 1);
    const g = new THREE.Group(); g.position.copy(at); g.rotation.y = Math.atan2(f.pos.x - at.x, f.pos.z - at.z); w.scene.add(g);
    const palm = this.rock(1); palm.scale.set(0.75, 0.42, 0.95); palm.position.set(0, 0.25, 0); g.add(palm);
    const wrist = this.rock(1); wrist.scale.set(0.55, 1.1, 0.6); wrist.position.set(0, -0.8, 0.15); g.add(wrist);
    const fingers = [];
    for (let i = 0; i < 5; i++) {
      const thumb = i === 4, piv = new THREE.Group();
      piv.position.set(thumb ? 0.62 : -0.48 + i * 0.32, 0.5, thumb ? 0.25 : -0.55); if (thumb) piv.rotation.y = -1.1; g.add(piv);
      const s1 = this.rock(1); s1.scale.set(0.15, 0.42, 0.15); s1.position.set(0, 0.38, 0); piv.add(s1);
      const j = new THREE.Group(); j.position.set(0, 0.78, 0); piv.add(j);
      const s2 = this.rock(1); s2.scale.set(0.13, 0.32, 0.13); s2.position.set(0, 0.3, 0); j.add(s2);
      fingers.push({ piv, j, thumb });
    }
    const H = { f, t: near ? t : null, at, g, fingers, time: 0, phase: 'rise', hold: 1.0 };
    g.position.y = at.y - 2.2; g.scale.setScalar(1.25);
    this.hands.push(H);
    w.fx.crater(at, 3); w.fx.debrisBurst(_v.copy(at).setY(at.y + 0.1), 18, 3.5, 0.11, 0x6a5d50, 1.6); w.fx.dust(at, 12, 3, 0xa08a6c);
    w.audio.rumble(1.0, at); w.shake(0.25, at); w.popup(f, 'EARTH HAND', true);
  }
  updateHands(dt) {
    const w = this.world;
    for (const H of this.hands) {
      H.time += dt; const t = H.t, g = H.g;
      if (H.phase === 'rise') {
        const k = Math.min(1, H.time / 0.3); g.position.y = H.at.y - 2.2 + 2.4 * k * (2 - k);
        for (const F of H.fingers) { F.piv.rotation.x = 0.15; F.j.rotation.x = 0.1; }
        if (k >= 1) {
          H.phase = 'grab'; H.time = 0;
          if (t && !t.dead && t.invuln <= 0 && Math.hypot(t.pos.x - H.at.x, t.pos.z - H.at.z) < 1.6 && t.pos.y - t.groundY < 1.5) { H.caught = true; t.restrainT = Math.max(t.restrainT || 0, H.hold + 0.3); t.handGrip = H; w.combat.damage(t, 4, _v.set(0, 0, 0), H.f, 'earthHand', t.chestPos(new THREE.Vector3()), 0, -1); }
          else { // nothing in it: a swat on the spot
            for (const v of w.fighters) if (v !== H.f && !v.dead && v.invuln <= 0 && Math.hypot(v.pos.x - H.at.x, v.pos.z - H.at.z) < 2.0 && v.pos.y - v.groundY < 2.2) w.combat.damage(v, 10, _v.set(v.pos.x - H.at.x, 0, v.pos.z - H.at.z).normalize().clone(), H.f, 'earthHand', v.chestPos(new THREE.Vector3()), 8, 1);
          }
        }
      } else if (H.phase === 'grab') {
        const close = Math.min(1, H.time / 0.18);
        for (const F of H.fingers) { F.piv.rotation.x = (F.thumb ? -0.9 : 1.15) * close; F.j.rotation.x = 1.2 * close; }
        if (H.caught && t) {
          if (t.input && t.input.jump) H.hold -= 0.25;
          const lift = Math.min(1, H.time / 0.5);
          g.position.y = H.at.y + 0.2 + 1.0 * lift;
          t.pos.set(H.at.x, H.at.y + 1.0 * lift + 0.3, H.at.z); t.vel.set(0, 0, 0); t.onGround = false; t.restrainT = Math.max(t.restrainT, 0.1);
          if (H.time >= H.hold || t.dead) { H.phase = 'slam'; H.time = 0; }
        } else if (H.time > 0.35) { H.phase = 'sink'; H.time = 0; }
      } else if (H.phase === 'slam') {
        const k = Math.min(1, H.time / 0.16); g.position.y = H.at.y + 1.2 - 1.6 * k;
        if (t && H.caught) { t.pos.y = H.at.y + 1.3 * (1 - k); }
        if (k >= 1) {
          if (t && H.caught && !t.dead) { t.handGrip = null; t.restrainT = 0.05; t.onGround = true; w.combat.damage(t, 14, _v.set(t.pos.x - H.f.pos.x, 0, t.pos.z - H.f.pos.z).normalize().clone(), H.f, 'earthHand', t.chestPos(new THREE.Vector3()), 3, 2); }
          w.fx.crater(H.at, 2.6); w.fx.debrisBurst(_v.copy(H.at).setY(H.at.y + 0.3), 16, 4, 0.1, 0x6a5d50); w.fx.dust(H.at, 12, 3, 0xa08a6c); w.audio.rumble(1.2, H.at); w.shake(0.35, H.at);
          H.phase = 'sink'; H.time = 0;
        }
      } else {
        g.position.y -= dt * 4.5; for (const F of H.fingers) F.piv.rotation.x *= 0.9;
        if (H.time > 0.6) { w.scene.remove(g); H.dead = true; if (t && t.handGrip === H) t.handGrip = null; }
      }
    }
    this.hands = this.hands.filter(H => !H.dead);
  }

  // ---------------------------------------------------------------- Ground Shift (LEG with the stick pulled away)
  // (20 Nov, Earth brief) the hips turn and both forearms sweep sideways; a slab of ground under the rival lurches the
  // same way (the floor cracks round it and the slab slides 1.5 m), throwing them off balance: a stumble and a sideways
  // stagger (6 damage), or, caught mid-stride or already reeling, the legs go and they fall (Sweep Fall).
  groundShift(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    const at = t && Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) < 12 ? new THREE.Vector3(t.pos.x, t.groundY, t.pos.z) : f.pos.clone().addScaledVector(f.forward(_v).setY(0).normalize(), 4);
    at.y = w.arena.groundAt(at.x, at.z, at.y + 1);
    const fw = f.forward(new THREE.Vector3()).setY(0).normalize(), side = new THREE.Vector3(-fw.z, 0, fw.x).multiplyScalar(f.techSide > 0 ? 1 : -1);
    const slab = this.rock(1); slab.scale.set(1.6, 0.35, 1.6); slab.position.set(at.x, at.y - 0.2, at.z); w.scene.add(slab);
    this.shifts.push({ f, slab, at, side, t: 0, hit: false, target: t });
    w.fx.crater(at, 3.2); w.audio.rumble(0.9, at); w.shake(0.2, at); w.popup(f, 'GROUND SHIFT', true);
  }
  updateShifts(dt) {
    const w = this.world;
    for (const S of this.shifts) {
      S.t += dt; const k = Math.min(1, S.t / 0.22);
      S.slab.position.set(S.at.x + S.side.x * 1.5 * k, S.at.y - 0.2 + 0.12 * Math.sin(k * Math.PI), S.at.z + S.side.z * 1.5 * k);
      if (Math.random() < 0.6 && k < 1) w.fx.dust(S.slab.position, 2, 1.5, 0xa08a6c);
      if (!S.hit && S.t > 0.06) {
        S.hit = true;
        for (const v of w.fighters) {
          if (v === S.f || v.dead || v.invuln > 0 || !v.onGround || Math.hypot(v.pos.x - S.at.x, v.pos.z - S.at.z) > 1.9) continue;
          const reeling = v.action === 'hit' || v.action === 'stagger' || v.speedNorm > 0.5;
          if (reeling) { v.lastHitFrom = S.f; v.shiftFall = true; }
          w.combat.damage(v, 6, S.side.clone(), S.f, 'groundShift', v.chestPos(new THREE.Vector3()), reeling ? 3 : 5, reeling ? 2 : 1);
          v.shiftFall = false;
        }
        w.fx.debrisBurst(_v.copy(S.at).setY(S.at.y + 0.1), 14, 3, 0.09, 0x6a5d50, 1.2);
      }
      if (S.t > 1.2) { S.slab.position.y -= dt * 2; }
      if (S.t > 1.6) { w.scene.remove(S.slab); S.dead = true; }
    }
    this.shifts = this.shifts.filter(S => !S.dead);
  }

  // ---------------------------------------------------------------- Slab Shackles (GUARD held + LEG)
  // (20 Nov, Earth brief) the hands draw inward and close: stone segments rise round the rival's ankles and shins and
  // lock (5 damage). The legs are held 2 s while the upper body struggles (and can still guard); each JUMP breaks
  // 0.3 s off; the shackles shatter when it ends.
  shackles(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    if (!t || Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) > 12 || !t.onGround || t.invuln > 0) { w.audio.rumble(0.5); return; }
    const at = new THREE.Vector3(t.pos.x, t.groundY, t.pos.z), segs = [];
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28, m = this.rock(1); m.scale.set(0.16, 0.42, 0.16); m.position.set(at.x + Math.cos(a) * 0.3, at.y - 0.5, at.z + Math.sin(a) * 0.3); m.rotation.set(Math.sin(a) * 0.35, a, -Math.cos(a) * 0.35); w.scene.add(m); segs.push(m); }
    const K = { f, t, at, segs, time: 0, dur: 2.0 };
    t.restrainT = Math.max(t.restrainT || 0, K.dur); t.vel.set(0, 0, 0);
    w.combat.damage(t, 5, _v.set(0, 0, 0), f, 'shackles', t.chestPos(new THREE.Vector3()), 0, -1);
    w.fx.debrisBurst(_v.copy(at).setY(at.y + 0.1), 10, 2, 0.07, 0x6a5d50, 1.4); w.audio.rumble(0.9, at); w.popup(f, 'SLAB SHACKLES', true);
    this.shackled.push(K);
  }
  updateShackles(dt) {
    const w = this.world;
    for (const K of this.shackled) {
      K.time += dt; const t = K.t;
      if (t.input && t.input.jump) { K.dur -= 0.3; w.fx.debrisBurst(_v.copy(K.at).setY(K.at.y + 0.3), 2, 1.5, 0.05, 0x6a5d50); }
      const k = Math.min(1, K.time / 0.15); for (const m of K.segs) m.position.y = K.at.y - 0.5 + 0.72 * k;
      const free = t.dead || K.time >= K.dur || t.action === 'down';
      if (!free) { t.pos.x = K.at.x; t.pos.z = K.at.z; t.vel.x = t.vel.z = 0; t.restrainT = Math.max(t.restrainT, 0.05); }
      else { t.restrainT = Math.min(t.restrainT, 0.05); for (const m of K.segs) { w.fx.debrisBurst(m.position, 2, 2.5, 0.06, 0x6a5d50); w.scene.remove(m); } w.audio.rumble(0.6, K.at); K.dead = true; }
    }
    this.shackled = this.shackled.filter(K => !K.dead);
  }

  // ---------------------------------------------------------------- Earthbreaker (SPECIAL held 1 s): the ultimate
  // (20 Nov, Earth brief, an original ultimate) a deep stance; the arms reach out to the earth and draw up and inward
  // while great rocks tear out of the ground round the bender and grind together into one mass in front of him (the
  // pose is held while it gathers, about 1 s); the hips and torso turn to the rival and both arms drive forward: the
  // mass flies and crashes down on them. The impact: a crater, a ring of rock spikes erupting outward through the
  // ground, fragments thrown up and falling, a rolling cloud of dust (no fire). Up to 34 damage within 5 m, a heavy
  // throw for anyone within 3 m; 50 energy, 16 s cooldown.
  breakerGather(f) {
    const w = this.world, at = f.pos.clone().addScaledVector(f.forward(_v).setY(0).normalize(), 1.6);
    at.y = f.groundY + 1.3;
    const g = new THREE.Group(); g.position.copy(at); w.scene.add(g);
    const E = { f, g, at, t: 0, state: 'gather', parts: [], vel: new THREE.Vector3(), r: 0.4 };
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.28 + rand(-0.2, 0.2), R = rand(2.2, 3.4), m = this.rock(rand(0.35, 0.6));
      const from = new THREE.Vector3(f.pos.x + Math.cos(a) * R, f.groundY - 0.3, f.pos.z + Math.sin(a) * R);
      m.position.copy(from); w.scene.add(m);
      E.parts.push({ m, from, slot: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.15, 0.5)), d: i * 0.06 });
      w.fx.crater(_v.copy(from).setY(f.groundY), 1.4); w.fx.debrisBurst(_v.copy(from).setY(f.groundY + 0.1), 5, 2, 0.08, 0x6a5d50, 1.5);
    }
    w.audio.rumble(1.2); w.shake(0.3, f.pos); w.popup(f, 'EARTHBREAKER', true);
    this.breakers.push(E);
  }
  breakerLaunch(f) {
    const E = this.breakers.find(e => e.f === f && e.state === 'gather'); if (!E) return;
    const t = f.target && !f.target.dead ? f.target : null;
    const dest = t ? t.pos.clone().setY(t.groundY) : f.pos.clone().addScaledVector(f.forward(_v).setY(0).normalize(), 10);
    E.state = 'fly'; E.t = 0; E.from = E.g.position.clone(); E.dest = dest; E.dur = clamp(dest.distanceTo(E.from) / 22, 0.25, 0.8);
    this.world.audio.rumble(1.0); this.world.audio.whoosh(1.3);
  }
  updateBreakers(dt) {
    const w = this.world;
    for (const E of this.breakers) {
      E.t += dt; const f = E.f;
      if (E.state === 'gather') {
        if (f.dead || f.reacting() || f.action !== 'tech' || f.tech !== f.style.tech.breaker) { for (const P of E.parts) w.scene.remove(P.m); w.scene.remove(E.g); E.dead = true; f.breakerHold = false; continue; }
        // the pose waits while the mass gathers (hero pins the clip)
        // (pinU: the low gathering crouch of earth_pillar; was 0.33 of the Tai Chi push)
        const pinU = 0.07; if (f.actionU >= pinU && E.t < 1.0) { f.actionT = pinU * f.A.dur; f.breakerHold = true; } else if (E.t >= 1.0) f.breakerHold = false;
        E.g.position.copy(f.pos).addScaledVector(f.forward(_v).setY(0).normalize(), 1.7).setY(f.groundY + 1.5);
        for (const P of E.parts) {
          const k = clamp((E.t - P.d) / 0.7, 0, 1), e = k * k * (3 - 2 * k);
          _v.copy(E.g.position).addScaledVector(P.slot, 1 + 0.8 * (1 - e)); P.m.position.copy(P.from).lerp(_v, e); P.m.position.y += Math.sin(e * Math.PI) * 1.2;
          P.m.rotation.x += dt * 2; P.m.rotation.z += dt * 1.5;
        }
        if (Math.random() < dt * 8) w.fx.debrisBurst(E.g.position, 1, 1.5, 0.06, 0x6a5d50, 0.4);
        if (Math.random() < dt * 3) w.audio.rumble(0.5, E.g.position);
      } else {
        const k = Math.min(1, E.t / E.dur), p = _v.copy(E.from).lerp(E.dest, k); p.y += Math.sin(k * Math.PI) * 2.2;
        const off = p.clone().sub(E.g.position); E.g.position.copy(p);
        for (const P of E.parts) { P.m.position.add(off); P.m.rotation.x += dt * 4; }
        if (Math.random() < 0.6) w.fx.dust(p, 1, 1, 0xa08a6c);
        if (k >= 1) { this.breakerImpact(E); for (const P of E.parts) w.scene.remove(P.m); w.scene.remove(E.g); E.dead = true; }
      }
    }
    this.breakers = this.breakers.filter(E => !E.dead);
  }
  breakerImpact(E) {
    const w = this.world, c = E.dest, f = E.f, B = this.B;
    w.fx.crater(c, 6); w.shake(1.1, c); w.audio.rumble(1.6, c); w.audio.impact(1.4);
    for (let i = 0; i < 4; i++) w.fx.debrisBurst(_v.copy(c).setY(c.y + 0.3), 16, 6 + i, 0.14, i % 2 ? 0x6a5d50 : 0x7a7068, 2);
    w.fx.dust(c, 24, 6, 0x9a8466);
    this.cloud(c.clone().setY(c.y + 0.5), 4.5, 3.5);
    // a ring of rock spikes erupting outward through the ground
    for (let ring = 1; ring <= 3; ring++) for (let i = 0; i < 8 + ring * 3; i++) { const a = i / (8 + ring * 3) * 6.28; B.spikes.push({ owner: f, t: -ring * 0.08, pos: new THREE.Vector3(c.x + Math.cos(a) * ring * 1.6, c.y, c.z + Math.sin(a) * ring * 1.6), mesh: null, hit: new Set() }); }
    for (const P of this.B.pillars || []) if (!P.dead && !P.col.dead && Math.hypot(P.col.x - c.x, P.col.z - c.z) < 5) { P.col.dead = true; B.lowerPillar(P); }
    for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0) continue;
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
      if (d < 5) w.combat.damage(t, Math.round(34 - d * 4), _v.set(t.pos.x - c.x, 0, t.pos.z - c.z).normalize().clone(), f, 'earthbreaker', t.chestPos(new THREE.Vector3()), d < 3 ? 15 : 9, 2);
    }
    w.popup(f, 'EARTHBREAKER', true);
  }

  update(dt) { this.updateHands(dt); this.updateShifts(dt); this.updateShackles(dt); this.updateBreakers(dt); this.updateGauntlets(dt); for (const f of this.world.fighters) if (f.comp) this.compressTick(f, dt); this.updateStorm(dt); this.updateTremors(dt); this.updateBlasts(dt); this.updateClouds(dt); this.updatePits(dt); this.updateSands(dt); this.updateArmours(dt); }
  clear() {
    const w = this.world;
    for (const B of this.blasts) { for (const P of B.sprites) w.scene.remove(P.s); for (const G of B.grit) w.scene.remove(G.m); }
    for (const C of this.clouds) for (const P of C.sprites) w.scene.remove(P.s);
    for (const P of this.pits) { for (const r of P.rim) w.scene.remove(r.m); w.scene.remove(P.pit); P.t.sinkY = 0; P.t.sinkP = null; }
    for (const S of this.sands) w.scene.remove(S.m);
    for (const A of this.armours) this.armourEnd(A.f, true);
    for (const R of this.tremors) w.scene.remove(R.m);
    for (const g of this.gaunts) for (const P of g.plates) P.bone.remove(P.m); this.gaunts = [];
    for (const H of this.hands) w.scene.remove(H.g); for (const S of this.shifts) w.scene.remove(S.slab); for (const K of this.shackled) for (const m of K.segs) w.scene.remove(m); for (const E of this.breakers) { for (const P of E.parts) w.scene.remove(P.m); w.scene.remove(E.g); E.f.breakerHold = false; }
    this.hands = []; this.shifts = []; this.shackled = []; this.breakers = [];
    for (const f of w.fighters || []) { if (f.comp) this.compressEnd(f, false); if (f.compBall) { w.scene.remove(f.compBall.m); f.compBall = null; } f.gaunts = null; }
    this.storming = null; if (this.stormS) { const sc = w.scene, O = this.stormS; sc.fog.color.copy(O.fogC); sc.fog.near = O.near; sc.fog.far = O.far; if (O.bg) sc.background.copy(O.bg); this.stormS = null; }
    this.blasts = []; this.clouds = []; this.pits = []; this.sands = []; this.armours = []; this.tremors = [];
    for (const f of w.fighters || []) { f.sandT = 0; f.sandSink = 0; f.blindT = 0; }
  }
}
