// Motion-capture retargeting: BVH (CMU / MotionBuilder naming) -> the game's 53-bone mannequin skeleton.
// Runs in the browser (used offline by tools/retarget/bake.mjs through headless Chromium).
// Method: per frame, transfer each mapped joint's world-space rotation relative to its rest pose, after
// aligning each source bone's rest direction to the target bone's rest direction (T-pose to T-pose),
// then convert to target-local rotations down the target hierarchy. Hips translation is scaled by leg
// length; the clip is made in-place horizontally (the game moves the fighter) and faces +Z at its start.
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

// source joint -> [target bone, source child used for rest direction, target child used for rest direction]
const MAP = [
  ['Hips', 'DEF-hips', 'LowerBack', 'DEF-spine001'],
  ['LowerBack', 'DEF-spine001', 'Spine', 'DEF-spine002'],
  ['Spine', 'DEF-spine002', 'Spine1', 'DEF-spine003'],
  ['Spine1', 'DEF-spine003', 'Neck', 'DEF-neck'],
  ['Neck', 'DEF-neck', 'Head', 'DEF-head'],
  ['Head', 'DEF-head', null, null],
  ['LeftShoulder', 'DEF-shoulderL', 'LeftArm', 'DEF-upper_armL'], ['RightShoulder', 'DEF-shoulderR', 'RightArm', 'DEF-upper_armR'],
  ['LeftArm', 'DEF-upper_armL', 'LeftForeArm', 'DEF-forearmL'], ['RightArm', 'DEF-upper_armR', 'RightForeArm', 'DEF-forearmR'],
  ['LeftForeArm', 'DEF-forearmL', 'LeftHand', 'DEF-handL'], ['RightForeArm', 'DEF-forearmR', 'RightHand', 'DEF-handR'],
  ['LeftHand', 'DEF-handL', 'LeftFingerBase', 'DEF-f_middle01L'], ['RightHand', 'DEF-handR', 'RightFingerBase', 'DEF-f_middle01R'],
  ['LeftUpLeg', 'DEF-thighL', 'LeftLeg', 'DEF-shinL'], ['RightUpLeg', 'DEF-thighR', 'RightLeg', 'DEF-shinR'],
  ['LeftLeg', 'DEF-shinL', 'LeftFoot', 'DEF-footL'], ['RightLeg', 'DEF-shinR', 'RightFoot', 'DEF-footR'],
  ['LeftFoot', 'DEF-footL', 'LeftToeBase', 'DEF-toeL'], ['RightFoot', 'DEF-footR', 'RightToeBase', 'DEF-toeR'],
];

const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

/**
 * bvhText: BVH file contents; target: the mannequin scene (bind pose); opts: { start, end (seconds), fps, name, inPlace }
 * returns a THREE.AnimationClip that plays on the mannequin (track names are its bone names)
 */
export function retargetBVH(bvhText, target, opts = {}) {
  const fps = opts.fps || 30, inPlace = opts.inPlace !== false;
  const bvh = new BVHLoader().parse(bvhText);
  const srcRoot = bvh.skeleton.bones[0];
  const holder = new THREE.Group(); holder.add(srcRoot); holder.updateMatrixWorld(true);
  const S = {}; bvh.skeleton.bones.forEach(b => (S[b.name] = b));
  const T = {}; target.traverse(o => { if (o.isBone) T[o.name] = o; });
  target.updateMatrixWorld(true);

  // ---- source rest: the T-pose that this BVH release adds as the first frame (its joint rotations are not
  // exactly zero), and facing: make the actor face +Z with left on +X
  const mixer = new THREE.AnimationMixer(srcRoot);
  const action = mixer.clipAction(bvh.clip); action.play();
  mixer.setTime(0); holder.updateMatrixWorld(true);
  const restPos = {}, restInv = {};
  for (const b of bvh.skeleton.bones) { restPos[b.name] = wp(b); restInv[b.name] = wq(b).invert(); }
  const flip = restPos.LeftUpLeg.x < restPos.RightUpLeg.x;      // left leg on -X means the actor faces -Z
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), flip ? Math.PI : 0);

  // ---- per-bone alignment from target rest direction to (rotated) source rest direction
  const rows = [];
  const mirror = !!opts.mirror;
  const swap = (n) => n && (mirror ? n.replace(/L$/, '#').replace(/R$/, 'L').replace(/#$/, 'R') : n);
  for (const [s, t0n, sc, tc0] of MAP) {
    const t = swap(t0n), tc = swap(tc0);
    if (!S[s] || !T[t]) continue;
    const tRest = wq(T[t]);
    let dS, dT;
    if (sc && S[sc] && tc && T[tc]) {
      dS = restPos[sc].clone().sub(restPos[s]).applyQuaternion(R).normalize();
      if (mirror) dS.x = -dS.x;
      dT = wp(T[tc]).sub(wp(T[t])).normalize();
    } else { dS = new THREE.Vector3(0, 1, 0); dT = new THREE.Vector3(0, 1, 0); }
    rows.push({ s: S[s], t: T[t], C: new THREE.Quaternion().setFromUnitVectors(dT, dS), tRest });
  }
  const byTarget = new Map(rows.map(r => [r.t, r]));
  const order = []; const walk = (b) => { order.push(b); for (const c of b.children) if (c.isBone) walk(c); }; walk(T.root || T['DEF-hips']);
  const restLocal = new Map(order.map(b => [b, b.quaternion.clone()]));
  const parentOf = (b) => b.parent;
  const baseQ = wq(order[0].parent);

  // leg-length scale for hips translation
  const srcLeg = restPos.Hips.y - restPos.LeftFoot.y, tgtLeg = wp(T['DEF-hips']).y - wp(T['DEF-footL']).y;
  const scale = tgtLeg / Math.max(1e-6, srcLeg);
  const tHipsRestLocal = T['DEF-hips'].position.clone();
  const tHipsParentInv = new THREE.Matrix4().copy(T['DEF-hips'].parent.matrixWorld).invert();

  // ---- sample the source clip
  // floor of the take: lowest toe-joint height over the whole recording (the actor's floor need not be y = 0)
  let floorY = Infinity;
  for (let t = 0; t <= bvh.clip.duration; t += 0.05) {
    mixer.setTime(t); holder.updateMatrixWorld(true);
    floorY = Math.min(floorY, wp(S.LeftToeBase).y, wp(S.RightToeBase).y);
  }
  const toeRest = Math.min(restPos.LeftToeBase.y, restPos.RightToeBase.y) - restPos.Hips.y;   // toe below hips at rest (negative)
  const t0 = opts.start ?? 0, t1 = Math.min(opts.end ?? bvh.clip.duration, bvh.clip.duration);
  const n = Math.max(2, Math.round((t1 - t0) * fps) + 1);
  const times = new Float32Array(n), qv = new Map(rows.map(r => [r.t.name, new Float32Array(n * 4)])), hp = new Float32Array(n * 3);
  let heading = null, startHips = null;
  const tmp = new THREE.Quaternion(), wqT = new Map();
  for (let i = 0; i < n; i++) {
    const tt = t0 + (t1 - t0) * (i / (n - 1));
    mixer.setTime(tt); holder.updateMatrixWorld(true);
    // remove the actor's starting heading so every clip begins facing +Z
    if (!heading) {
      const hq = R.clone().multiply(wq(S.Hips)).multiply(restInv.Hips), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(hq); fwd.y = 0; fwd.normalize();
      heading = opts.keepHeading ? new THREE.Quaternion() : new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(0, 0, 1));
      startHips = wp(S.Hips).applyQuaternion(R).applyQuaternion(heading);
    }
    const G = heading.clone().multiply(R);       // global correction applied to the source world
    wqT.clear();
    for (const b of order) {
      const parentQ = b === order[0] ? baseQ : wqT.get(parentOf(b));
      const r = byTarget.get(b);
      let local;
      if (r) {
        // target world = G * srcWorld(t) * G^-1 (delta from identity rest) * C * targetRest
        const D = G.clone().multiply(wq(r.s)).multiply(restInv[r.s.name]).multiply(G.clone().invert());
        if (mirror) { D.y = -D.y; D.z = -D.z; }        // reflect the motion across the body's mid-plane (x = 0)
        const world = D.multiply(r.C).multiply(r.tRest);
        local = parentQ.clone().invert().multiply(world);
        const a = qv.get(b.name); a[i * 4] = local.x; a[i * 4 + 1] = local.y; a[i * 4 + 2] = local.z; a[i * 4 + 3] = local.w;
      } else local = restLocal.get(b);
      wqT.set(b, parentQ.clone().multiply(local));
    }
    // hips translation, scaled, in place horizontally
    // horizontal drift (zero when in place) + vertical offset from the actor's standing hip height
    const p = wp(S.Hips).applyQuaternion(R).applyQuaternion(heading).sub(startHips).multiplyScalar(scale); p.y = 0;
    if (mirror) p.x = -p.x;
    if (inPlace) { p.x = 0; p.z = 0; }
    const restHipsWorld = new THREE.Vector3().copy(tHipsRestLocal).applyMatrix4(T['DEF-hips'].parent.matrixWorld);
    const hw = restHipsWorld.add(new THREE.Vector3(0, Math.min(opts.noRise ? 0 : 1e9, (wp(S.Hips).y - floorY + toeRest) * scale), 0)).add(p);
    const hl = hw.applyMatrix4(tHipsParentInv);
    hp[i * 3] = hl.x; hp[i * 3 + 1] = hl.y; hp[i * 3 + 2] = hl.z;
    times[i] = i / fps;
  }
  // keep quaternion signs continuous (avoids flips when the mixer interpolates)
  for (const a of qv.values()) for (let i = 1; i < n; i++) {
    const d = a[i * 4] * a[i * 4 - 4] + a[i * 4 + 1] * a[i * 4 - 3] + a[i * 4 + 2] * a[i * 4 - 2] + a[i * 4 + 3] * a[i * 4 - 1];
    if (d < 0) for (let k = 0; k < 4; k++) a[i * 4 + k] *= -1;
  }
  const tracks = [new THREE.VectorKeyframeTrack('DEF-hips.position', times, hp)];
  for (const [name, a] of qv) tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, a));
  return new THREE.AnimationClip(opts.name || 'mocap', (n - 1) / fps, tracks);
}
