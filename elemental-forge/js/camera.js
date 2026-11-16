// Third-person follow camera: shoulder offset, auto-follow, lock-on framing, collision, shake.
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff } from './util.js';
import { HALF } from './arena.js';

export class FollowCam {
  constructor(camera, arena) {
    this.cam = camera; this.arena = arena;
    this.yaw = 0; this.pitch = 0.2;
    this.dist = 3.5; this.curDist = 3.5;
    this.shoulder = 0.55;
    this.sideAngle = 0.3;
    this.pivot = new THREE.Vector3();
    this.lockOffsetYaw = 0;
    this.sinceLook = 99;
    this.shakeAmt = 0;
    this.autoCam = true;
    this.ray = new THREE.Raycaster();
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.fovBase = 62; this.fovKick = 0;
  }

  snapBehind(f) { this.yaw = f.faceYaw; this.pitch = 0.2; this.pivot.set(f.pos.x, f.pos.y + 1.55, f.pos.z); this.lockOffsetYaw = 0; }

  update(dt, player, target, locked, look) {
    // look: {x, y} radians this frame from touch/mouse
    if (Math.abs(look.x) + Math.abs(look.y) > 1e-5) this.sinceLook = 0; else this.sinceLook += dt;

    // pivot follows the player (y smoothed so jumps don't jerk the view)
    const p = player.pos;
    this.pivot.x = damp(this.pivot.x, p.x, 22, dt);
    this.pivot.z = damp(this.pivot.z, p.z, 22, dt);
    // airborne: ordinary jumps are smoothed; flight and propelled high jumps are tracked closely so the bender
    // never leaves the frame
    const alt = p.y - (player.groundY ?? 0), aerial = !player.onGround && (alt > 2.2 || (player.mob && player.mob.kind === 'fly') || player.highJump);
    this.pivot.y = damp(this.pivot.y, p.y + 1.55, player.onGround ? 10 : aerial ? 9 : 4, dt);

    if (locked && target && !target.dead) {
      // camera sits behind the player, looking through to the target
      const dx = target.pos.x - p.x, dz = target.pos.z - p.z;
      const want = Math.atan2(dx, dz);
      this.lockOffsetYaw = clamp(this.lockOffsetYaw + look.x, -0.9, 0.9);
      if (this.sinceLook > 0.35) this.lockOffsetYaw = damp(this.lockOffsetYaw, 0, 3, dt);
      // three-quarter view while locked on, so the fighter's arms and legs read instead of only the back
      this.yaw = dampAngle(this.yaw, want + this.lockOffsetYaw + this.sideAngle, 7, dt);
      const d = Math.hypot(dx, dz);
      const wantPitch = clamp(0.27 + Math.atan2((p.y - target.pos.y) * 0.5, Math.max(d, 1)) - (d < 3 ? 0.05 : 0), -0.2, 0.6);
      this.pitch = damp(this.pitch, wantPitch + clamp(look.y * 4, -0.2, 0.2), 5, dt);
    } else {
      this.yaw += look.x; this.pitch = clamp(this.pitch + look.y, -0.55, 1.05);
      this.lockOffsetYaw = 0;
      if (this.autoCam && this.sinceLook > 1.1) {
        const sp = Math.hypot(player.vel.x, player.vel.z);
        // drift behind the direction of travel (not when running at the camera)
        if (sp > 2 && !player.input.strafe) {
          const heading = Math.atan2(player.vel.x, player.vel.z);
          const d = angleDiff(this.yaw, heading);
          if (Math.abs(d) < 2.2) this.yaw += d * (1 - Math.exp(-1.4 * (sp / 6.6) * dt));
        }
        // keep the rival roughly in view during combat
        if (target && !target.dead) {
          const dx = target.pos.x - p.x, dz = target.pos.z - p.z, d = Math.hypot(dx, dz);
          const want = Math.atan2(dx, dz), off = angleDiff(this.yaw, want);
          if (d < 22 && Math.abs(off) > 0.75) this.yaw += (off - Math.sign(off) * 0.75) * (1 - Math.exp(-1.6 * dt));
        }
        this.pitch = damp(this.pitch, 0.18, 0.8, dt);
      }
    }

    // over-the-shoulder offset widens during lock-on so the rival is framed beside / above the player
    // framing matches the references: the fighter fills ~40% of the screen height, over the right shoulder
    this.shoulder = damp(this.shoulder, locked && target && !target.dead ? 0.8 : 0.5, 4, dt);
    // closer framing than before (3.1 / 3.4 m), widened while the view must take in more: a SPECIAL, flight and
    // high jumps, fast surfing or flame running
    const T = player.action === 'tech' ? player.tech : null, st = player.style && player.style.tech;
    const wide = (T && st && (T === st.special || T === st.release) ? 1.7 : 0) + (aerial ? 1.0 : 0) + (player.mob && player.mob.kind !== 'fly' && Math.hypot(player.vel.x, player.vel.z) > 9 ? 0.6 : 0);
    this.wide = damp(this.wide || 0, Math.min(2.2, wide), wide > (this.wide || 0) ? 3 : 1.5, dt);
    this.dist = (locked && target && !target.dead ? 3.4 : 3.1) + this.wide;
    // build view
    // Low obstructions (platform edges, ledges, boulders, pillars) are cleared by raising the camera over them;
    // only tall ones (walls, spires) make it pull in. This keeps the lower part of the view open on raised terrain.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.right.set(-cy, 0, sy);
    const base = _v.copy(this.pivot).addScaledVector(this.right, this.shoulder);
    const blocked = (pitch) => {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      this.ray.set(base, _v2.set(-sy * cp, sp, -cy * cp));
      this.ray.far = this.dist + 0.3;
      const h = this.ray.intersectObjects(this.arena.cameraBlockers, false);
      return h.length ? h[0].distance : Infinity;
    };
    // is the player's lower body hidden from this camera pitch? (sight line from the hips to the camera)
    const hips = _v4.set(player.pos.x, player.pos.y + 0.6, player.pos.z);
    const bodyHidden = (pitch) => {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cam = _v3.set(base.x - sy * cp * this.dist, base.y + sp * this.dist, base.z - cy * cp * this.dist);
      const dir = _v2.subVectors(cam, hips), len = dir.length(); dir.divideScalar(len);
      this.ray.set(hips, dir); this.ray.far = len;
      return this.ray.intersectObjects(this.arena.cameraBlockers, false).length > 0;
    };
    let lift = 0;
    if (blocked(this.pitch) < this.dist || bodyHidden(this.pitch)) {
      for (const l of [0.12, 0.24, 0.36, 0.5, 0.65]) { if (blocked(this.pitch + l) >= this.dist && !bodyHidden(this.pitch + l)) { lift = l; break; } lift = l; }
    }
    this.pitchLift = damp(this.pitchLift || 0, lift, lift > (this.pitchLift || 0) ? 10 : 2.5, dt);
    const pitch = Math.min(1.15, this.pitch + this.pitchLift);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.fwd.set(sy * cp, -sp, cy * cp);
    let want = this.dist;
    const hd = blocked(pitch);
    if (hd < this.dist + 0.3) want = Math.max(1.2, hd - 0.3);
    this.curDist = want < this.curDist ? want : damp(this.curDist, want, 4, dt);
    const pos = _v3.copy(base).addScaledVector(this.fwd, -this.curDist);
    const lim = HALF + 1.2;
    pos.x = clamp(pos.x, -lim, lim); pos.z = clamp(pos.z, -lim, lim);
    pos.y = Math.max(pos.y, 0.35);
    // shake
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
      const s = this.shakeAmt * this.shakeAmt * 0.6;
      pos.x += (Math.random() - 0.5) * s; pos.y += (Math.random() - 0.5) * s; pos.z += (Math.random() - 0.5) * s;
    }
    this.cam.position.copy(pos);
    this.cam.lookAt(_v4.copy(pos).add(this.fwd));
    const fov = this.fovBase + this.fovKick;
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov = damp(this.cam.fov, fov, 8, dt); this.cam.updateProjectionMatrix(); }
    this.fovKick = damp(this.fovKick, 0, 4, dt);
  }

  shake(a) { this.shakeAmt = Math.min(0.8, this.shakeAmt + a); }
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
