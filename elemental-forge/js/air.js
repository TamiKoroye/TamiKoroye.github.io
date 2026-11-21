// Airbending, phase one (20 Nov, the user's Airbending brief, after the two Avatar airbending reference videos): Air
// Blast, the palm-palm-kick combination, Air Swipe, Air Blades, Air Bomb, Air Funnel and Suction. Each is started by a
// technique event (elements.js: air.blast, air.combo, air.swipe, air.blades, air.bomb, air.suction) or by the held LEG
// (funnel) and lives here until it ends; AirSkills.update(dt) runs every frame from Bending.update.
//
// The look of the air (the references): translucent, spiralling currents in pale silver-white with a faint blue, bright
// at the edges and clear in the middle, with curved streaks showing the direction of travel and dust where the wind
// meets the ground. Not smoke, not water: a shader draws moving spiral bands and a bright rim on each wind body.
import * as THREE from 'three';
import { rand, clamp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const WIND_VS = `varying vec2 vUv; varying float vRim;
void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vec3 n = normalize(mat3(modelMatrix) * normal);
  vRim = 1.0 - abs(dot(n, normalize(cameraPosition - wp.xyz))); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const WIND_FS = `uniform float uTime, uOpacity, uTwist, uFlow; uniform vec3 uCol; varying vec2 vUv; varying float vRim;
void main() {
  float bands = 0.5 + 0.5 * sin((vUv.x * uTwist + vUv.y * 9.0 - uTime * uFlow) * 6.2831);
  bands = pow(bands, 3.0);
  float streak = 0.5 + 0.5 * sin((vUv.x * uTwist * 2.3 - vUv.y * 4.0 + uTime * uFlow * 0.6) * 6.2831);
  float a = (pow(vRim, 1.6) * 0.75 + bands * 0.45 + pow(streak, 6.0) * 0.25) * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(mix(uCol, vec3(1.0), bands * 0.6 + vRim * 0.3), a);
}`;
export function windMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: WIND_VS, fragmentShader: WIND_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: o.opacity ?? 0.8 }, uTwist: { value: o.twist ?? 3 }, uFlow: { value: o.flow ?? 2.5 }, uCol: { value: new THREE.Color(o.color ?? 0xcfe6f5) } },
  });
}

export class AirSkills {
  constructor(B) {
    this.B = B; this.world = B.world;
    this.shots = []; this.bursts = []; this.funnels = new Map(); this.pulls = [];
    this.sphereGeo = new THREE.SphereGeometry(1, 20, 14);
    this.ringGeo = new THREE.TorusGeometry(1, 0.12, 6, 28);
    // a crescent: a band of a ring, lying flat, opening forward (+Z)
    // a crescent: an upright curved wall of wind (a band of an open cylinder) bowing forward (+Z), so it reads from the
    // side as well as from behind; the blade is the same, thin and short
    this.crescentGeo = new THREE.CylinderGeometry(1, 1, 0.8, 36, 2, true, -1.05, 2.1);
    this.bladeGeo = new THREE.CylinderGeometry(1, 1, 0.16, 30, 1, true, -0.75, 1.5);
    // the funnel / suction cone: narrow at z = 0 (the hands), wide at z = 1
    this.coneGeo = (() => { const g = new THREE.CylinderGeometry(1, 0.18, 1, 24, 6, true); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2); return g; })();
  }
  // a wind body (mesh with its own material, so it can fade on its own)
  body(geo, o) { const m = new THREE.Mesh(geo, windMaterial(o)); m.renderOrder = 5; this.world.scene.add(m); return m; }
  drop(m) { this.world.scene.remove(m); m.material.dispose(); }
  aimDir(f, from) { const t = f.target && !f.target.dead ? f.target : null; return t ? t.chestPos(_v).sub(from).normalize().clone() : f.forward(new THREE.Vector3()).setY(0).normalize(); }
  // the first rival whose body (a capsule from hips to head) is within r of p
  touching(f, p, r, skip) {
    for (const t of this.world.fighters) {
      if (t === f || t.dead || (skip && skip.has(t))) continue;
      const lying = t.action === 'down' || t.action === 'getup';
      const y0 = t.pos.y + (lying ? 0.1 : 0.4), y1 = t.pos.y + (lying ? 0.4 : 1.6), y = clamp(p.y, y0, y1);
      if (Math.hypot(p.x - t.pos.x, p.y - y, p.z - t.pos.z) < r + 0.3) return t;
    }
    return null;
  }

  // ---------------------------------------------------------------- 1. Air Blast (HAND at range)
  // The palm thrust drives out a compressed ball of air: a clear core with spiral bands, two pressure rings turning round
  // it, streaks behind. It strikes when it reaches the rival (not before): 8 damage, the chest recoils and the body is
  // driven back a step; a close hit (within 4 m) is a stagger.
  blast(f, side) {
    const from = f.handPos(side > 0 ? 'R' : 'L', new THREE.Vector3()), dir = this.aimDir(f, from);
    from.addScaledVector(dir, 0.35);
    const core = this.body(this.sphereGeo, { opacity: 0.85, twist: 4, flow: 4 });
    const rings = [0, 1].map(() => this.body(this.ringGeo, { opacity: 0.9, twist: 6, flow: 6 }));
    this.shots.push({ kind: 'blast', f, pos: from, dir, speed: 24, range: 15, t: 0, core, rings, r: 0.58, dmg: 8, from: from.clone() });
    this.world.audio.gust(0.8); this.world.audio.airBurst(0.8, from);
  }
  // ---------------------------------------------------------------- 2. the palm, palm, kick combination (HAND close)
  // Each strike releases a short compressed burst along the striking hand or foot, exactly on the strike: a small ring of
  // air and streaks. The first palm: a small recoil (5); the pivoting second palm: interrupts (6); the turning kick: a
  // curved gust that throws the rival sideways or back (9, a stagger, or a knockdown for a rival already reeling).
  comboHit(f, stage) {
    const w = this.world, limb = stage === 2 ? f.footPos(f.techSide > 0 ? 'L' : 'R', new THREE.Vector3()) : f.handPos(f.techSide > 0 ? 'R' : 'L', new THREE.Vector3());
    const dir = this.aimDir(f, limb); dir.y = Math.max(-0.2, Math.min(0.2, dir.y)); dir.normalize();
    const ring = this.body(this.ringGeo, { opacity: 0.9, twist: 6, flow: 6 });
    ring.position.copy(limb).addScaledVector(dir, 0.4); ring.quaternion.setFromUnitVectors(_v.set(0, 0, 1), dir);
    this.bursts.push({ m: ring, t: 0, life: 0.25, grow: stage === 2 ? 2.4 : 1.4, vel: dir.clone().multiplyScalar(6) });
    for (let i = 0; i < (stage === 2 ? 8 : 4); i++) w.fx.wind(limb.clone().addScaledVector(dir, 0.3), _v.copy(dir).multiplyScalar(rand(6, 10)).add(_v2.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1))), stage === 2 ? 0.7 : 0.45, 0.3);
    const reach = stage === 2 ? 3.2 : 2.6;
    for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0) continue;
      const to = _v3.set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z), d = to.length(), fw = f.forward(_v2).setY(0).normalize();
      if (d > reach || (d > 0.3 && to.dot(fw) / d < 0.35) || Math.abs(t.pos.y - f.pos.y) > 1.4) continue;
      const reeling = t.action === 'hit' || t.action === 'stagger';
      const push = stage === 2 ? _v.copy(dir).setY(0).normalize().clone() : to.clone().normalize();
      w.combat.damage(t, [5, 6, 9][stage], push, f, 'airStrike', t.chestPos(new THREE.Vector3()), [3, 3.5, 9][stage], stage === 2 ? (reeling ? 2 : 1) : 0);
    }
    w.audio.gust(stage === 2 ? 0.9 : 0.5); w.audio.hit(stage === 2 ? 1 : 0.6, limb);
  }
  // ---------------------------------------------------------------- 3. Air Swipe (HAND with the stick sideways)
  // The open palm sweeps across the body and a wide crescent of compressed air travels forward from the hand, its curved
  // leading edge clear and bright, turbulence along it; it stays one coherent arc. 9 damage, a sideways recoil in the
  // direction of the sweep (a stagger), a knockdown for a rival caught mid-attack.
  swipe(f) {
    const from = f.chestPos(new THREE.Vector3()), dir = this.aimDir(f, from); dir.y = 0; dir.normalize();
    const m = this.body(this.crescentGeo, { opacity: 0.85, twist: 2, flow: 5 });
    const sideDir = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(f.techSide > 0 ? -1 : 1);
    this.shots.push({ kind: 'swipe', f, pos: from.clone().addScaledVector(dir, 0.6), dir, speed: 17, range: 12, t: 0, core: m, rings: [], r: 1.3, dmg: 9, side: sideDir, from: from.clone() });
    this.world.audio.gust(0.9); this.world.audio.airBurst(1.0, from);
  }
  // ---------------------------------------------------------------- 4. Air Blades (LEG at range)
  // Two quick cuts of the hands release two narrow blades of high-pressure air, crossing on the diagonal, thin and bright
  // edged, fast (30 m/s). Each cut is a sharp recoil (6, no knockdown); both landing within half a second is a stagger.
  blades(f, which) {
    const from = f.handPos(which > 0 ? 'R' : 'L', new THREE.Vector3()), dir = this.aimDir(f, from);
    const m = this.body(this.bladeGeo, { opacity: 0.95, twist: 1.5, flow: 8, color: 0xe4f3ff });
    m.userData.roll = which > 0 ? 0.7 : -0.7;
    this.shots.push({ kind: 'blade', f, pos: from.clone().addScaledVector(dir, 0.4), dir, speed: 30, range: 14, t: 0, core: m, rings: [], r: 0.55, dmg: 6, from: from.clone() });
    this.world.audio.airBurst(0.7, from);
  }
  // ---------------------------------------------------------------- 5. Air Bomb (LEG close)
  // From the crouch the legs straighten and both palms push out and down: a shell of compressed air bursts out of the
  // body and a pressure wave rolls along the floor, raising a ring of dust. Within 2 m: lifted off the feet and thrown
  // back (12, a knockdown along the blast); to 4.5 m: pushed away, a stagger (8).
  bomb(f) {
    const w = this.world, c = f.pos.clone().setY(f.pos.y + 0.9);
    const shell = this.body(this.sphereGeo, { opacity: 0.75, twist: 5, flow: 7 }); shell.position.copy(c);
    this.bursts.push({ m: shell, t: 0, life: 0.45, grow: 4.6, vel: new THREE.Vector3() });
    const ground = this.body(this.ringGeo, { opacity: 0.9, twist: 8, flow: 9 }); ground.position.set(f.pos.x, f.groundY + 0.15, f.pos.z); ground.rotation.x = Math.PI / 2;
    this.bursts.push({ m: ground, t: 0, life: 0.55, grow: 5.5, vel: new THREE.Vector3(), flat: true });
    w.fx.dust(_v.set(f.pos.x, f.groundY, f.pos.z), 18, 5, 0xc9c0b0); w.fx.ring(f.pos, 4.5, 0xeaf6ff, 0.4);
    for (let i = 0; i < 18; i++) { const a = i / 18 * 6.28; w.fx.wind(_v.set(f.pos.x + Math.cos(a) * 0.6, f.groundY + 0.4, f.pos.z + Math.sin(a) * 0.6), _v2.set(Math.cos(a) * 12, rand(0.5, 2.5), Math.sin(a) * 12), 0.8, 0.35); }
    for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0) continue;
      const d = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z); if (d > 4.5 || Math.abs(t.pos.y - f.pos.y) > 2) continue;
      const dir = new THREE.Vector3(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize();
      if (d < 2) { w.combat.damage(t, 12, dir, f, 'airBomb', t.chestPos(new THREE.Vector3()), 12, 2); t.vel.y = Math.max(t.vel.y, 6); t.onGround = false; }
      else w.combat.damage(t, 8, dir, f, 'airBomb', t.chestPos(new THREE.Vector3()), 8, 1);
    }
    w.audio.gust(1.3); w.shake(0.3, f.pos);
  }
  // ---------------------------------------------------------------- 6. Suction (HAND with the stick pulled away)
  // The open hand reaches toward the rival and draws back to the body: spirals of air run from the rival to the bender,
  // tightening as they pull. The rival is hauled off balance toward him (about 3 m over 0.4 s), the upper body pitching
  // forward into a stumbling stagger (3), an opening for the palms or the Air Bomb.
  suction(f) {
    const w = this.world, t = f.target && !f.target.dead ? f.target : null;
    // (21 Nov) reaches 20 m (was 11: HAND throws Suction at a rival beyond 8.5 m, so the pull has to reach well past that)
    if (!t || Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z) > 20 || t.invuln > 0) { w.audio.gust(0.5); return; }
    const toMe = new THREE.Vector3(f.pos.x - t.pos.x, 0, f.pos.z - t.pos.z), d = toMe.length(); toMe.normalize();
    w.combat.damage(t, 3, toMe.clone(), f, 'suction', t.chestPos(new THREE.Vector3()), 0, 1);
    this.pulls.push({ f, t, dir: toMe, left: Math.max(0, d - 1.6), t0: 0, cone: this.body(this.coneGeo, { opacity: 0.6, twist: 5, flow: -6 }) });
    w.audio.gust(1.0);
  }

  // ---------------------------------------------------------------- 7. Air Funnel (LEG held)
  // Both palms forward, the forearms working in small opposing circles: a cone of fast air from between the hands to the
  // rival, spiral pressure bands inside, a turbulent edge. The rival in it braces (a flinch every 0.4 s, 2 damage, pushed
  // back); kept on them 1.2 s their guard breaks and they are driven back (a stagger). Drains energy while held.
  funnelTick(f, dt) {
    const w = this.world; let F = this.funnels.get(f);
    if (!F) { F = { t: 0, tick: 0, onT: 0, cone: this.body(this.coneGeo, { opacity: 0.55, twist: 6, flow: 9 }) }; this.funnels.set(f, F); }
    F.t += dt; F.seen = true;
    const from = f.handPos('L', _v).add(f.handPos('R', _v2)).multiplyScalar(0.5).addScaledVector(f.forward(_v3), 0.3).clone();
    const dir = this.aimDir(f, from), len = 9;
    F.cone.position.copy(from); F.cone.quaternion.setFromUnitVectors(_v.set(0, 0, 1), dir);
    const grow = Math.min(1, F.t / 0.25); F.cone.scale.set(1.5 * grow, 1.5 * grow, len * grow);
    if (Math.random() < 0.6) w.fx.wind(from.clone().addScaledVector(dir, rand(1, 7)), _v.copy(dir).multiplyScalar(rand(10, 16)), 0.5, 0.3);
    w.audio.hold('funnel' + (f === w.fighters[0] ? 0 : 1), 'windLoop', 1.3, from);
    let hitT = null;
    for (const t of w.fighters) {
      if (t === f || t.dead) continue;
      const rel = t.chestPos(_v3).sub(from), along = rel.dot(dir); if (along < 0 || along > len) continue;
      if (rel.addScaledVector(dir, -along).length() < 0.4 + 1.3 * along / len) hitT = t;
    }
    if (hitT) {
      F.onT += dt; hitT.vel.x += dir.x * 7 * dt; hitT.vel.z += dir.z * 7 * dt;
      if ((F.tick -= dt) <= 0) { F.tick = 0.4; w.combat.damage(hitT, 2, dir.clone().setY(0).normalize(), f, 'airFunnel', hitT.chestPos(new THREE.Vector3()), 2, F.onT > 1.2 ? 1 : 0); if (F.onT > 1.2) F.onT = 0.4; }
      if (Math.random() < 0.4) w.fx.dust(_v.set(hitT.pos.x, hitT.groundY, hitT.pos.z), 1, 1.5, 0xc9c0b0);
    } else F.onT = Math.max(0, F.onT - dt);
  }

  update(dt) {
    const w = this.world;
    for (const S of this.shots) {
      S.t += dt; S.pos.addScaledVector(S.dir, S.speed * dt);
      S.core.material.uniforms.uTime.value = S.t;
      if (S.kind === 'blast') {
        S.core.position.copy(S.pos); S.core.scale.setScalar(S.r * (1 + 0.08 * Math.sin(S.t * 40)));
        S.rings.forEach((m, i) => { m.material.uniforms.uTime.value = S.t; m.position.copy(S.pos).addScaledVector(S.dir, -0.2 - i * 0.45); m.quaternion.setFromUnitVectors(_v.set(0, 0, 1), S.dir); m.rotateZ(S.t * (i ? -9 : 9)); m.scale.setScalar(S.r * (1.2 + i * 0.5)); });
        if (Math.random() < 0.8) w.fx.wind(S.pos.clone(), _v.copy(S.dir).multiplyScalar(-4).add(_v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))), 0.4, 0.25);
      } else {
        // crescents and blades: the arc faces forward and grows as it travels
        S.core.position.copy(S.pos); S.core.quaternion.setFromUnitVectors(_v.set(0, 0, 1), _v2.copy(S.dir).setY(0).normalize());
        if (S.core.userData.roll) S.core.rotateZ(S.core.userData.roll);
        const g = S.kind === 'swipe' ? 1.2 + S.t * 1.6 : 0.55 + S.t * 0.4; S.core.scale.set(g, 1, g);
        if (Math.random() < 0.5) w.fx.wind(S.pos.clone().add(_v.set(rand(-g, g) * 0.6, rand(-0.2, 0.2), rand(-g, g) * 0.6)), _v2.copy(S.dir).multiplyScalar(-3), 0.35, 0.2);
      }
      // the blow lands where the wind reaches the body
      const hit = this.touching(S.f, S.pos, S.kind === 'swipe' ? 1.0 + S.t * 1.2 : S.r);
      let end = S.pos.distanceTo(S.from) > S.range || S.pos.y < w.arena.groundAt(S.pos.x, S.pos.z, S.pos.y + 1) - 0.2;
      if (hit && hit.invuln <= 0) {
        const dist = S.from.distanceTo(hit.pos);
        if (S.kind === 'blast') w.combat.damage(hit, S.dmg, S.dir.clone().setY(0).normalize(), S.f, 'airBlast', S.pos.clone(), dist < 4 ? 7 : 5, dist < 4 ? 1 : 0);
        else if (S.kind === 'swipe') { const midAttack = hit.action === 'tech'; w.combat.damage(hit, S.dmg, S.side.clone().add(_v.copy(S.dir).setY(0).multiplyScalar(0.5)).normalize(), S.f, 'airSwipe', S.pos.clone(), 7, midAttack ? 2 : 1); }
        else { const now = w.time ?? performance.now() / 1000, two = hit._bladeT && now - hit._bladeT < 0.5; hit._bladeT = now; w.combat.damage(hit, S.dmg, S.dir.clone().setY(0).normalize(), S.f, 'airBlade', S.pos.clone(), 3, two ? 1 : 0); }
        const ring = this.body(this.ringGeo, { opacity: 0.9, twist: 6, flow: 6 }); ring.position.copy(S.pos); ring.quaternion.setFromUnitVectors(_v.set(0, 0, 1), S.dir);
        this.bursts.push({ m: ring, t: 0, life: 0.3, grow: 2.2, vel: new THREE.Vector3() });
        w.audio.gust(0.7); end = true;
      }
      if (end || hit) { this.drop(S.core); S.rings.forEach(m => this.drop(m)); S.dead = true; if (!hit) w.fx.dust(S.pos, 4, 1.5, 0xc9c0b0); }
    }
    this.shots = this.shots.filter(S => !S.dead);
    for (const P of this.bursts) {
      P.t += dt; const k = P.t / P.life; P.m.material.uniforms.uTime.value = P.t;
      P.m.position.addScaledVector(P.vel, dt); P.m.scale.setScalar(0.3 + P.grow * Math.sqrt(k)); if (P.flat) P.m.scale.z = 0.3 + P.grow * Math.sqrt(k);
      P.m.material.uniforms.uOpacity.value = 0.9 * (1 - k);
      if (k >= 1) { this.drop(P.m); P.dead = true; }
    }
    this.bursts = this.bursts.filter(P => !P.dead);
    for (const P of this.pulls) {
      P.t0 += dt; const t = P.t, f = P.f, k = Math.min(1, P.t0 / 0.4);
      const step = P.left * Math.min(1, dt / 0.4) * (k < 1 ? 1 : 0);
      if (!t.dead) { t.pos.x += P.dir.x * step; t.pos.z += P.dir.z * step; }
      const from = t.chestPos(_v), to = f.handPos(f.techSide > 0 ? 'R' : 'L', _v2), d = from.distanceTo(to);
      P.cone.material.uniforms.uTime.value = P.t0; P.cone.position.copy(from); P.cone.quaternion.setFromUnitVectors(_v3.set(0, 0, 1), from.clone().sub(to).normalize()); P.cone.position.copy(to);
      P.cone.scale.set(1.2 * (1 - 0.6 * k), 1.2 * (1 - 0.6 * k), d); P.cone.material.uniforms.uOpacity.value = 0.6 * (1 - Math.max(0, P.t0 - 0.4) / 0.25);
      if (Math.random() < 0.7) w.fx.wind(from.clone(), to.clone().sub(from).normalize().multiplyScalar(12), 0.4, 0.25);
      if (P.t0 > 0.65) { this.drop(P.cone); P.dead = true; }
    }
    this.pulls = this.pulls.filter(P => !P.dead);
    for (const [f, F] of this.funnels) {
      F.cone.material.uniforms.uTime.value = F.t;
      if (!F.seen) { this.drop(F.cone); this.funnels.delete(f); continue; }
      F.seen = false;
    }
  }
  clear() {
    for (const S of this.shots) { this.drop(S.core); S.rings.forEach(m => this.drop(m)); }
    for (const P of this.bursts) this.drop(P.m);
    for (const P of this.pulls) this.drop(P.cone);
    for (const F of this.funnels.values()) this.drop(F.cone);
    this.shots = []; this.bursts = []; this.pulls = []; this.funnels.clear();
  }
}
