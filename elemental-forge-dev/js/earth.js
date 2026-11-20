// Earth's new skills (20 Nov, Earth phase one, the user's brief): Dust Cloud, Earth Sinking, Quicksand and Rock Armour.
// Each is started by a technique event (elements.js: earth.dust, earth.sink, earth.quicksand, earth.armour) and lives
// here until it ends. EarthSkills.update(dt) runs every frame from Bending.update.
import * as THREE from 'three';
import { jaggedRockGeometry } from './arena.js';
import { mulberry32, rand, clamp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const DUST_COLS = [0x9c8466, 0xb39b7a, 0x7d6a52, 0xa88f6c, 0x8a7458];

export class EarthSkills {
  constructor(B) {
    this.B = B; this.world = B.world;
    this.blasts = []; this.clouds = []; this.pits = []; this.sands = []; this.armours = [];
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
  cloud(at, R, life) {
    const C = { pos: at.clone(), R, life, t: 0, sprites: [] };
    for (let i = 0; i < 22; i++) {
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

  // ---------------------------------------------------------------- Earth Sinking
  // (brief) the bender bends the knees and drives both palms down; the ground under the rival loosens and pulls the feet
  // in: the rival drops to the shins into a churned pit (a hole is opened in the look of the floor: a dark pit, broken
  // rim stones round the legs), cannot step out, bends the knees and struggles to get free. Lasts 2.2 s; each JUMP or
  // DODGE pressed while stuck tears free 0.35 s sooner. The bender can follow up while the rival is held.
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
      if (t.input && (t.input.jump || t.input.dodge)) { P.dur -= 0.35; w.fx.dust(P.at, 3, 1.2, 0xa08a6c); }
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
  // (brief) from a stable stance the hands circle downwards and the ground round the rival turns into swirling sand for
  // 4.5 s: anyone but the bender standing in it moves at a third of their speed, sinks a little into it and cannot
  // jump high. It traps; it is not Earth's surfing.
  quicksand(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    const at = t && Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) < 12 ? new THREE.Vector3(t.pos.x, 0, t.pos.z) : f.pos.clone().addScaledVector(f.forward(_v).setY(0).normalize(), 4.5);
    at.y = w.arena.groundAt(at.x, at.z, (t ? t.pos.y : f.pos.y) + 1);
    const m = new THREE.Mesh(this.sandGeo || (this.sandGeo = (() => { const g = new THREE.CircleGeometry(1, 40); g.rotateX(-Math.PI / 2); return g; })()), this.sandMat.clone());
    const R = 3.2; m.scale.set(R, 1, R); m.position.set(at.x, at.y + 0.02, at.z); m.renderOrder = 2; w.scene.add(m);
    this.sands.push({ f, at, R, m, t: 0, life: 4.5 });
    w.fx.dust(at, 14, 3, 0xb39b7a); w.audio.rumble(0.8); w.popup(f, 'QUICKSAND', true);
  }
  updateSands(dt) {
    const w = this.world;
    for (const S of this.sands) {
      S.t += dt; const A = Math.min(1, S.t / 0.35) * Math.min(1, (S.life - S.t) / 0.6);
      S.m.material.uniforms.uTime.value = S.t; S.m.material.uniforms.uAlpha.value = 0.92 * Math.max(0, A);
      for (const t of w.fighters) {
        if (t === S.f || t.dead || !t.onGround) continue;
        const d = Math.hypot(t.pos.x - S.at.x, t.pos.z - S.at.z);
        if (d < S.R * 0.95) {
          t.sandT = 0.12; t.sandSink = Math.min(0.22, (t.sandSink || 0) + dt * 0.4);
          if (Math.random() < dt * 6) w.fx.dust(_v.set(t.pos.x, S.at.y, t.pos.z), 1, 0.8, 0xb39b7a);
        }
      }
      if (Math.random() < dt * 5) { const a = rand(0, 6.28), r = rand(0, S.R * 0.9); w.fx.dust(_v.set(S.at.x + Math.cos(a) * r, S.at.y, S.at.z + Math.sin(a) * r), 1, 0.5, 0xb39b7a); }
      if (S.t >= S.life) { w.scene.remove(S.m); S.m.material.dispose(); S.dead = true; }
    }
    this.sands = this.sands.filter(S => !S.dead);
    for (const t of w.fighters) {
      if ((t.sandT || 0) > 0) { t.sandT -= dt; if (t.vel.y > 4.5) t.vel.y = 4.5; }
      else if (t.sandSink) t.sandSink = Math.max(0, t.sandSink - dt * 1.2);
    }
  }

  // ---------------------------------------------------------------- Rock Armour
  // (brief: "rocks completely cover the character and form a rock man") stone plates fly up from the ground and lock onto
  // every part of the body, from the feet upwards: shins, thighs, hips, the torso in three plates, shoulders, upper
  // arms, forearms, fists, neck and head. Each plate is fixed to its own bone, so the joints still bend, punch, guard
  // and fall naturally. While it holds: blows do 40 % of their damage, light hits do not make him flinch, a stagger is
  // only a flinch and a knockdown only a stagger; he moves at 80 % speed. It soaks 70 damage or lasts 10 s, then bursts.
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

  update(dt) { this.updateBlasts(dt); this.updateClouds(dt); this.updatePits(dt); this.updateSands(dt); this.updateArmours(dt); }
  clear() {
    const w = this.world;
    for (const B of this.blasts) { for (const P of B.sprites) w.scene.remove(P.s); for (const G of B.grit) w.scene.remove(G.m); }
    for (const C of this.clouds) for (const P of C.sprites) w.scene.remove(P.s);
    for (const P of this.pits) { for (const r of P.rim) w.scene.remove(r.m); w.scene.remove(P.pit); P.t.sinkY = 0; P.t.sinkP = null; }
    for (const S of this.sands) w.scene.remove(S.m);
    for (const A of this.armours) this.armourEnd(A.f, true);
    this.blasts = []; this.clouds = []; this.pits = []; this.sands = []; this.armours = [];
    for (const f of w.fighters || []) { f.sandT = 0; f.sandSink = 0; f.blindT = 0; }
  }
}
