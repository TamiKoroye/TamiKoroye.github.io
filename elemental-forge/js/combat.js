// Combat resolution shared by every element: lunges, melee hit checks, damage, blocking and perfect guards.
// Elemental objects, projectiles and defences live in elements.js.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();

export class Combat {
  constructor(world) { this.world = world; }

  // step in toward the target when a technique starts within reach
  lunge(f, spec) {
    const t = f.target;
    if (!t || t.dead || !spec || !spec.lunge) return;
    _d.subVectors(t.pos, f.pos); _d.y = 0;
    const d = _d.length();
    const fwd = f.forward(_v2);
    const facing = _d.dot(fwd) / (d || 1);
    // a ranged strike (whip) steps in only as far as its reach needs: a rival just beyond it is closed on
    if (spec.reach && d > spec.reach - 0.5 && d < spec.reach + 3.5 && (facing > 0.3 || f.input.strafe)) {
      _d.normalize();
      f.lungeDir.copy(_d).multiplyScalar(Math.min(spec.lunge, Math.min(1.8, d - spec.reach + 0.7) / 0.14));   // a step of at most 1.8 m
      f.lungeT = 0.14; f.faceYaw = Math.atan2(_d.x, _d.z);
      return;
    }
    if (spec.reach) return;   // already inside its reach: the whip is thrown from where the bender stands
    if (d < 5 && d > 1.1 && (facing > 0.3 || f.input.strafe)) {
      _d.normalize();
      f.lungeDir.copy(_d).multiplyScalar(Math.min(spec.lunge, Math.min(1.0, d - 1.0) / 0.14));   // one step in (at most 1 m)
      f.lungeT = 0.14;
      f.faceYaw = Math.atan2(_d.x, _d.z);
    }
  }

  // spec: { dmg, range, arc (min cosine to target, -1.1 = all around), knock, level }
  meleeCheck(f, spec, kind = 'melee') {
    if (!spec) return false;
    for (const t of this.world.fighters) {
      if (t === f || t.dead) continue;
      _d.subVectors(t.pos, f.pos); const dy = _d.y; _d.y = 0;
      const d = _d.length();
      if (d > spec.range + t.radius * 0.5 || Math.abs(dy) > 1.4) continue;
      const fy = f.faceYaw, fwd = _v2.set(Math.sin(fy), 0, Math.cos(fy));
      if (d > 0.3 && _d.dot(fwd) / d < spec.arc) continue;
      if (t.invuln > 0) continue;
      _d.normalize();
      const hitPt = t.chestPos(new THREE.Vector3()).addScaledVector(_d, -0.3);
      this.damage(t, spec.dmg, _d.clone(), f, kind, hitPt, spec.knock, spec.level || 0);
      return true;
    }
    // strikes also chip enemy defences
    for (const d of this.world.bending.defs) {
      if (d.owner === f || d.dead) continue;
      if (d.pos.distanceTo(f.pos) < spec.range + 0.8) { this.world.bending.hitDefence(d, spec.dmg * (spec.guardBreak || 1), d.pos.clone().setY(f.pos.y + 1.2), f.el); this.world.audio.impact(0.5); return true; }
    }
    return false;
  }

  // level: -1 no reaction (damage over time), 0 flinch, 1 stagger, 2 knockdown
  damage(t, dmg, dir, from, kind, at, knock, level = 0) {
    const w = this.world;
    if (from && from.armour && from !== t && dmg > 0) { dmg *= 1.4; knock *= 1.3; }   // (20 Nov) the Rock Man's stone fists and feet
    // a raised defence is resolved before any damage: coverage by direction, element rules, durability
    // (21 Nov, after review: "Air should be able to slice through certain defences") the Air Blades, Swipe and Blast cut
    // straight through a wall of fire or water; stone still stops them
    const sliced = from && from !== t && from.el === 'air' && /^(airBlade|airSwipe|airBlast)$/.test(kind) && t.guarding && t.defense && t.defense.el !== 'earth';
    if (sliced) w.popup(t, 'SLICED', true);
    if (t.guarding && t.defense && from && from !== t && kind !== 'proj' && !sliced) {
      // perfectly timed guard against a blow: the attacker is thrown off balance and a counter opens
      if (level >= 0 && t.guardT < 0.25 && !from.dead && w.bending.covers(t.defense, dir) && !['burn', 'spike', 'slam', 'pillar'].includes(kind)) {
        from.takeHit(0, _v.copy(dir).negate(), 4, 1);
        t.counterT = 0.9; t.stats.perfect++; t.perfectT = 0.5;
        w.popup(t, 'PERFECT', true); w.fx.spark(at, 0xe8d6b0, 10); w.hitStop(0.08); w.audio.impact(0.8);
        return;
      }
      const r = w.bending.resolveDefence(t, { dir, at, el: from.el, dmg, kind, level, from });
      if (r) {
        if (level >= 0) { from.vel.x -= dir.x * 3; from.vel.z -= dir.z * 3; w.audio.impact(0.4); }
        if (r.mul <= 0) return;
        dmg *= r.mul; knock *= r.mul;
        if (r.mul < 0.5) level = -1;   // a blow taken on the guard does not stagger; one that breaks through still does
      }
    }
    t.lastHitFrom = from; t.lastHitKind = kind;   // the reaction clip is chosen from the blow (fighter.takeHit)
    // (21 Nov, after review: "visually, the moves of Air do not look devastating") an airbender's blow throws harder
    const airBlow = from && from !== t && from.el === 'air' && level >= 0;
    if (airBlow) knock *= 1.35;
    // (21 Nov, after review: "when they are close, the kick should send them spiralling back") an Air kick that lands
    // close in throws the rival off their feet, turning over and over as they fly back
    const spiral = airBlow && level >= 1 && from.action === 'tech' && from.tech && /kick|sweep|hurricane|crescent|axe|heel|front|round|teep/i.test(from.tech.clip || '') && Math.hypot(t.pos.x - from.pos.x, t.pos.z - from.pos.z) < 3.5;
    if (spiral) { level = 2; knock *= 1.5; }
    t.takeHit(dmg, dir, knock, level);
    if (level < 0) return;
    if (spiral && !t.dead) { t.vel.y = Math.max(t.vel.y, 6); t.onGround = false; t.spiralT = 0.9; w.popup(t, 'SPIRAL', true); }
    if (airBlow) {
      // and lands with a burst of wind: a shockwave ring round the body, streaks blown out along the blow, dust at the feet
      const fx = w.fx, gy = t.groundY, k = level >= 1 ? 1 : 0.6;
      fx.ring(_v.set(t.pos.x, at.y, t.pos.z), 2.2 + 1.6 * k, 0xffffff, 0.35);
      if (level >= 1) fx.ring(_v.set(t.pos.x, gy + 0.08, t.pos.z), 3.4, 0xe8f2fa, 0.45);
      for (let i = 0; i < 10 + 8 * k; i++) { const a = Math.random() * 6.283; fx.wind(_v.copy(at), _v2.set(dir.x * 9 + Math.cos(a) * 5, Math.sin(a) * 3 + 1, dir.z * 9 + Math.sin(a) * 5), 0.7, 0.35); }
      fx.dust(_v.set(t.pos.x, gy, t.pos.z), 6 + 8 * k, 2.5);
      w.shake(0.18 * k, at);
    }
    w.popup(t, String(Math.round(dmg)));
    const col = { fire: 0xffb060, water: 0xbfe4ff, air: 0xffffff }[from && from.el] || 0xfff2d0;
    w.fx.spark(at, col, level >= 1 ? 8 : 5);
    w.audio.strike(t, from, kind, level, at);
    w.hitStop(level >= 1 ? 0.08 : 0.045);
    w.shake(level >= 1 ? 0.28 : 0.14, at);
    if (from) from.stats.hitsLanded++;
    if (w.onHit) w.onHit(t, from, kind);
  }

  // earth seismic stomp: ground shockwave that knocks down anyone grounded nearby and cracks defences
  slam(f) {
    const w = this.world, R = 3.4;
    const fwd = f.forward(_v2), at = new THREE.Vector3(f.pos.x + fwd.x * 0.9, f.groundY, f.pos.z + fwd.z * 0.9);
    w.fx.ring(at, R * 1.2, 0xe2d2b4, 0.5); w.fx.ring(at, R * 0.6, 0xffffff, 0.3);
    w.fx.crater(at, 2.6); w.fx.debrisBurst(at.clone().setY(at.y + 0.1), 26, 4.5, 0.13, 0x7a6a58, 1.1); w.fx.dust(at, 12, 3.5);
    w.audio.impact(1.4); w.audio.rumble(1); w.shake(0.45, at);
    for (const t of w.fighters) {
      if (t === f || t.dead || t.invuln > 0) continue;
      const dx = t.pos.x - at.x, dz = t.pos.z - at.z, d = Math.hypot(dx, dz);
      if (d > R + t.radius || t.pos.y - t.groundY > 0.6) continue;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      this.damage(t, Math.round(16 * (1 - Math.min(1, d / (R + t.radius)) * 0.4)), dir, f, 'slam', t.chestPos(new THREE.Vector3()), 7, 2);
    }
    for (const d of w.bending.defs) if (d.owner !== f && !d.dead && d.pos.distanceTo(at) < R + 1) w.bending.hitDefence(d, 45, d.pos.clone(), 'earth');
  }

  clear() {}
  update() {}
}
