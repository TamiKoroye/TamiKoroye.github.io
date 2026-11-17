// Motion retargeting onto the game's 53-bone mannequin. Runs in the browser (used offline by tools/retarget/*.mjs
// through headless Chromium). Supported sources:
//   - CMU BVH (MotionBuilder naming: Hips, LowerBack, Spine, Spine1, LeftUpLeg, ...)
//   - Mixamo FBX ("mixamorig" prefix, fingers)                      - also Rokoko files exported on the Mixamo rig
//   - Rokoko FBX on Rokoko's own skeleton (Hips, Spine1..4, LeftThigh, LeftShin, Finger1..5)
// Method: per frame, each mapped source joint's world rotation relative to its rest pose is transferred onto the
// matching mannequin bone, after aligning the bone's rest direction with the source's rest direction (so the two
// rest poses need not be identical), then converted to mannequin-local rotations down the hierarchy. Hips height
// is scaled by leg length and measured from the take's own floor; horizontal travel is removed from the pose
// (the game moves the fighter) but recorded separately so the game can apply it. Clips face +Z at their start.
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

const SIDES = ['L', 'R'];
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// mannequin bone names per slot
const TARGET = {
  hips: 'DEF-hips', spine: ['DEF-spine001', 'DEF-spine002', 'DEF-spine003'], neck: 'DEF-neck', head: 'DEF-head',
  side: (s) => ({ shoulder: 'DEF-shoulder' + s, arm: 'DEF-upper_arm' + s, fore: 'DEF-forearm' + s, hand: 'DEF-hand' + s,
    thigh: 'DEF-thigh' + s, shin: 'DEF-shin' + s, foot: 'DEF-foot' + s, toe: 'DEF-toe' + s,
    thumb: [1, 2, 3].map(i => `DEF-thumb0${i}${s}`), index: [1, 2, 3].map(i => `DEF-f_index0${i}${s}`), middle: [1, 2, 3].map(i => `DEF-f_middle0${i}${s}`),
    ring: [1, 2, 3].map(i => `DEF-f_ring0${i}${s}`), pinky: [1, 2, 3].map(i => `DEF-f_pinky0${i}${s}`) }),
};
// source rigs: bone name per slot (S = 'Left' | 'Right'); null entries are skipped
const RIGS = {
  cmu: { hips: 'Hips', spine: ['LowerBack', 'Spine', 'Spine1'], neck: 'Neck', head: 'Head',
    side: (S) => ({ shoulder: S + 'Shoulder', arm: S + 'Arm', fore: S + 'ForeArm', hand: S + 'Hand', handChild: S + 'FingerBase',
      thigh: S + 'UpLeg', shin: S + 'Leg', foot: S + 'Foot', toe: S + 'ToeBase' }) },
  mixamo: { hips: 'Hips', spine: ['Spine', 'Spine1', 'Spine2'], neck: 'Neck', head: 'Head',
    side: (S) => ({ shoulder: S + 'Shoulder', arm: S + 'Arm', fore: S + 'ForeArm', hand: S + 'Hand', handChild: S + 'HandMiddle1',
      thigh: S + 'UpLeg', shin: S + 'Leg', foot: S + 'Foot', toe: S + 'ToeBase',
      thumb: [1, 2, 3].map(i => S + 'HandThumb' + i), index: [1, 2, 3].map(i => S + 'HandIndex' + i), middle: [1, 2, 3].map(i => S + 'HandMiddle' + i),
      ring: [1, 2, 3].map(i => S + 'HandRing' + i), pinky: [1, 2, 3].map(i => S + 'HandPinky' + i) }) },
  // Unreal-style skeleton (pelvis, spine_01..03, clavicle_l, upperarm_l, calf_l, ball_l), e.g. the KinemIQ /
  // Verge3D GLB and FBX clips supplied on 15 Nov
  ue: { hips: 'pelvis', spine: ['spine_01', 'spine_02', 'spine_03'], neck: 'neck_01', head: 'Head',
    side: (S) => { const s = S === 'Left' ? 'l' : 'r'; return { shoulder: 'clavicle_' + s, arm: 'upperarm_' + s, fore: 'lowerarm_' + s, hand: 'hand_' + s, handChild: 'middle_01_' + s,
      thigh: 'thigh_' + s, shin: 'calf_' + s, foot: 'foot_' + s, toe: 'ball_' + s,
      thumb: [1, 2, 3].map(i => `thumb_0${i}_${s}`), index: [1, 2, 3].map(i => `index_0${i}_${s}`), middle: [1, 2, 3].map(i => `middle_0${i}_${s}`),
      ring: [1, 2, 3].map(i => `ring_0${i}_${s}`), pinky: [1, 2, 3].map(i => `pinky_0${i}_${s}`) }; } },
  // full Unreal Engine 5 mannequin skeleton (spine_01..05, neck_01..02, lowercase head), e.g. the Qi Gong takes
  ue5: { hips: 'pelvis', spine: ['spine_01', 'spine_03', 'spine_05'], neck: 'neck_01', head: 'head',
    side: (S) => { const s = S === 'Left' ? 'l' : 'r'; return { shoulder: 'clavicle_' + s, arm: 'upperarm_' + s, fore: 'lowerarm_' + s, hand: 'hand_' + s, handChild: 'middle_01_' + s,
      thigh: 'thigh_' + s, shin: 'calf_' + s, foot: 'foot_' + s, toe: 'ball_' + s,
      thumb: [1, 2, 3].map(i => `thumb_0${i}_${s}`), index: [1, 2, 3].map(i => `index_0${i}_${s}`), middle: [1, 2, 3].map(i => `middle_0${i}_${s}`),
      ring: [1, 2, 3].map(i => `ring_0${i}_${s}`), pinky: [1, 2, 3].map(i => `pinky_0${i}_${s}`) }; } },
  // Motifect AI exports (LeftLeg is the thigh, LeftShin the lower leg, Spine1 / Spine2 / Chest, Neck1)
  motifect: { hips: 'Hips', spine: ['Spine1', 'Spine2', 'Chest'], neck: 'Neck1', head: 'Head',
    side: (S) => ({ shoulder: S + 'Shoulder', arm: S + 'Arm', fore: S + 'ForeArm', hand: S + 'Hand', handChild: S + 'HandMiddle1',
      thigh: S + 'Leg', shin: S + 'Shin', foot: S + 'Foot', toe: S + 'ToeBase',
      thumb: [1, 2, 3].map(i => S + 'HandThumb' + i), index: [1, 2, 3].map(i => S + 'HandIndex' + i), middle: [1, 2, 3].map(i => S + 'HandMiddle' + i),
      ring: [1, 2, 3].map(i => S + 'HandRing' + i), pinky: [1, 2, 3].map(i => S + 'HandPinky' + i) }) },
  // Human Basic Motions (Unity, "B-" bones): two spine bones, so the third slot is left out
  hbm: { hips: 'B-hips', spine: ['B-spine', 'B-chest', null], neck: 'B-neck', head: 'B-head',
    side: (S) => { const s = S === 'Left' ? 'L' : 'R'; return { shoulder: 'B-shoulder' + s, arm: 'B-upperArm' + s, fore: 'B-forearm' + s, hand: 'B-hand' + s, handChild: 'B-middleFinger01' + s,
      thigh: 'B-thigh' + s, shin: 'B-shin' + s, foot: 'B-foot' + s, toe: 'B-toe' + s,
      thumb: [1, 2, 3].map(i => `B-thumb0${i}${s}`), index: [1, 2, 3].map(i => `B-indexFinger0${i}${s}`), middle: [1, 2, 3].map(i => `B-middleFinger0${i}${s}`),
      ring: [1, 2, 3].map(i => `B-ringFinger0${i}${s}`), pinky: [1, 2, 3].map(i => `B-pinky0${i}${s}`) }; } },
  rokoko: { hips: 'Hips', spine: ['Spine1', 'Spine2', 'Spine4'], neck: 'Neck', head: 'Head',
    side: (S) => ({ shoulder: S + 'Shoulder', arm: S + 'Arm', fore: S + 'ForeArm', hand: S + 'Hand', handChild: S + 'Finger3Proximal',
      thigh: S + 'Thigh', shin: S + 'Shin', foot: S + 'Foot', toe: S + 'Toe',
      thumb: ['Metacarpal', 'Proximal', 'Distal'].map(k => S + 'Finger1' + k), index: ['Proximal', 'Medial', 'Distal'].map(k => S + 'Finger2' + k),
      middle: ['Proximal', 'Medial', 'Distal'].map(k => S + 'Finger3' + k), ring: ['Proximal', 'Medial', 'Distal'].map(k => S + 'Finger4' + k),
      pinky: ['Proximal', 'Medial', 'Distal'].map(k => S + 'Finger5' + k) }) },
};

const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

export function detectRig(names) {
  const has = (n) => names.includes(n);
  if (has('LowerBack')) return 'cmu';
  if (has('B-hips') && has('B-upperArmL')) return 'hbm';
  if (has('pelvis') && has('calf_l') && has('spine_05')) return 'ue5';
  if (has('pelvis') && has('calf_l')) return 'ue';
  if (has('LeftThigh') && has('Spine4')) return 'rokoko';
  if (has('Hips') && has('Spine2') && has('LeftUpLeg')) return 'mixamo';
  if (has('Hips') && has('LeftShin') && has('Chest')) return 'motifect';
  return null;
}

// [sourceBone, targetBone, sourceChild, targetChild] rows for a rig
function pairs(rig, opts) {
  const R = RIGS[rig], T = TARGET, rows = [];
  const add = (s, t, sc, tc) => { if (s && t) rows.push([s, t, sc ?? null, tc ?? null]); };
  add(R.hips, T.hips, R.spine[0], T.spine[0]);
  // each spine bone aims at the next source bone that exists (a rig with fewer spine bones skips a slot)
  for (let i = 0; i < 3; i++) { if (!R.spine[i]) continue; const j = [1, 2].map(k => i + k).find(k => k < 3 && R.spine[k]); add(R.spine[i], T.spine[i], j !== undefined ? R.spine[j] : R.neck, j !== undefined ? T.spine[j] : T.neck); }
  add(R.neck, T.neck, R.head, T.head);
  add(R.head, T.head, null, null);
  for (let k = 0; k < 2; k++) {
    const s = R.side(['Left', 'Right'][k]), t = T.side(SIDES[k]);
    add(s.shoulder, t.shoulder, s.arm, t.arm);
    add(s.arm, t.arm, s.fore, t.fore);
    add(s.fore, t.fore, s.hand, t.hand);
    add(s.hand, t.hand, s.handChild, t.middle[0]);
    add(s.thigh, t.thigh, s.shin, t.shin);
    add(s.shin, t.shin, s.foot, t.foot);
    add(s.foot, t.foot, s.toe, t.toe);
    add(s.toe, t.toe, null, null);
    if (opts.fingers !== false && s.thumb) for (const f of FINGERS) for (let i = 0; i < 3; i++) add(s[f][i], t[f][i], s[f][i + 1], t[f][i + 1]);
  }
  return rows;
}

/**
 * Retarget an animated source skeleton onto the mannequin.
 * srcRoot: Object3D containing the source bones (rest pose = its state before any animation is applied, or
 *          opts.restTime); clip: AnimationClip for srcRoot; target: the mannequin scene in bind pose.
 * opts: { start, end (seconds), fps = 30, name, inPlace = true, mirror, noRise, keepHeading, restTime, fingers }
 * returns { clip, travel: Float32Array [x, z] per frame in metres (clip-local, facing +Z), rig }
 */
export function retargetSkeleton(srcRoot, clip, target, opts = {}) {
  const fps = opts.fps || 30, inPlace = opts.inPlace !== false, mirror = !!opts.mirror;
  const holder = new THREE.Group(); holder.add(srcRoot);
  const S = {}; srcRoot.traverse(o => { if (o.isBone || o.type === 'Bone' || o.isObject3D) { const n = o.name.replace(/^(mixamorig|EEJANAIBot)[:_]?/, ''); if (n && !(n in S)) S[n] = o; } });
  const rig = opts.rig || detectRig(Object.keys(S));
  if (!rig) throw new Error('unknown skeleton: ' + Object.keys(S).slice(0, 12).join(','));
  const T = {}; target.traverse(o => { if (o.isBone) T[o.name] = o; });
  target.updateMatrixWorld(true);

  // rest pose: the skeleton's bind state as loaded (FBX), or a given frame (BVH from this release: its added
  // T-pose first frame)
  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(clip).play();
  if (opts.restTime !== undefined) mixer.setTime(opts.restTime);
  holder.updateMatrixWorld(true);
  // Z-up exports (Unreal Engine 5 FBX): turn the source upright, judged from the hips-to-head direction at rest
  {
    const hp = S[RIGS[rig].hips], hd = S[RIGS[rig].head];
    if (hp && hd) { const v = wp(hd).sub(wp(hp)); if (Math.abs(v.z) > Math.abs(v.y) * 1.5) { holder.rotation.x = v.z > 0 ? -Math.PI / 2 : Math.PI / 2; holder.updateMatrixWorld(true); } }
  }
  if (opts.restTime === undefined) {
    // the action has not been applied yet (setTime was not called), so the bones still hold the bind pose
  }
  const restPos = {}, restInv = {};
  for (const [n, o] of Object.entries(S)) { restPos[n] = wp(o); restInv[n] = wq(o).invert(); }
  const L = (n) => restPos[n] ? n : null;
  const legL = RIGS[rig].side('Left'), legR = RIGS[rig].side('Right');
  const flip = restPos[legL.thigh].x < restPos[legR.thigh].x;      // left leg on -X means the actor faces -Z
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), flip ? Math.PI : 0);

  const swap = (n) => n && (mirror ? n.replace(/L$/, '#').replace(/R$/, 'L').replace(/#$/, 'R') : n);
  const rows = [];
  for (const [s, t0, sc, tc0] of pairs(rig, opts)) {
    const t = swap(t0), tc = swap(tc0);
    if (!S[s] || !T[t] || !L(s)) continue;
    const tRest = wq(T[t]);
    let dS, dT;
    if (sc && S[sc] && tc && T[tc]) {
      dS = restPos[sc].clone().sub(restPos[s]); dT = wp(T[tc]).sub(wp(T[t]));
    } else if (S[s].parent && T[t].parent && T[t].parent.isBone) {
      // no child to aim at (head, toes, finger tips): use the direction from the parent joint
      dS = restPos[s].clone().sub(wp(S[s].parent)); dT = wp(T[t]).sub(wp(T[t].parent));
    } else { dS = new THREE.Vector3(0, 1, 0); dT = new THREE.Vector3(0, 1, 0); }
    dS.applyQuaternion(R).normalize(); dT.normalize();
    if (mirror) dS.x = -dS.x;
    if (dS.lengthSq() < 1e-8 || dT.lengthSq() < 1e-8) { dS.set(0, 1, 0); dT.set(0, 1, 0); }
    rows.push({ s: S[s], sn: s, t: T[t], C: new THREE.Quaternion().setFromUnitVectors(dT, dS), tRest });
  }
  const byTarget = new Map(rows.map(r => [r.t, r]));
  const order = []; const walk = (b) => { order.push(b); for (const c of b.children) if (c.isBone) walk(c); }; walk(T.root || T['DEF-hips']);
  const restLocal = new Map(order.map(b => [b, b.quaternion.clone()]));
  const baseQ = wq(order[0].parent);

  // leg-length scale (also converts units: CMU inches-ish, FBX centimetres, mannequin metres)
  const hipsN = RIGS[rig].hips, footN = legL.foot, toeL = legL.toe, toeR = legR.toe;
  const srcLeg = restPos[hipsN].y - restPos[footN].y, tgtLeg = wp(T['DEF-hips']).y - wp(T['DEF-footL']).y;
  const scale = tgtLeg / Math.max(1e-6, srcLeg);
  const tHipsRestLocal = T['DEF-hips'].position.clone();
  const tHipsParentInv = new THREE.Matrix4().copy(T['DEF-hips'].parent.matrixWorld).invert();
  const toeRest = Math.min(restPos[toeL].y, restPos[toeR].y) - restPos[hipsN].y;   // toes below the hips at rest

  // floor of the take: lowest toe-joint height over the whole recording
  let floorY = Infinity;
  for (let t = 0; t <= clip.duration; t += 0.05) {
    mixer.setTime(t); holder.updateMatrixWorld(true);
    floorY = Math.min(floorY, wp(S[toeL]).y, wp(S[toeR]).y);
  }

  // which way the clip should face the opponent (+Z): a strike's limb at its impact frame (hips to hand or foot),
  // otherwise the direction the head faces at the clip's start (fighters look at their opponent; hips and chest
  // are often turned side-on in a fighting stance)
  const limbBone = (l) => { const side = RIGS[rig].side(l[1] === 'L' ? 'Left' : 'Right'); return S[l[0] === 'k' ? side.foot : side.hand]; };
  const headN = RIGS[rig].head;
  function facing(tStart) {
    let v;
    if (opts.aim && opts.aim.limb && opts.aim.time !== undefined) {
      mixer.setTime(opts.aim.time); holder.updateMatrixWorld(true);
      v = wp(limbBone(opts.aim.limb)).sub(wp(S[hipsN])).applyQuaternion(R);
      if (opts.aim.limb[0] === 'p') v.sub(wp(S[RIGS[rig].spine[2]]).sub(wp(S[hipsN])).applyQuaternion(R));   // punches: from the chest
    } else {
      mixer.setTime(tStart); holder.updateMatrixWorld(true);
      const q = R.clone().multiply(wq(S[opts.aim === 'hips' ? hipsN : headN])).multiply(restInv[opts.aim === 'hips' ? hipsN : headN]);
      v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    }
    v.y = 0; if (v.lengthSq() < 1e-8) v.set(0, 0, 1);
    return v.normalize();
  }
  const t0 = opts.start ?? 0, t1 = Math.min(opts.end ?? clip.duration, clip.duration);
  const n = Math.max(2, Math.round((t1 - t0) * fps) + 1);
  const times = new Float32Array(n), qv = new Map(rows.map(r => [r.t.name, new Float32Array(n * 4)])), hp = new Float32Array(n * 3);
  const travel = new Float32Array(n * 2);
  let heading = null, startHips = null;
  const wqT = new Map();
  for (let i = 0; i < n; i++) {
    // the last sample stops just short of the clip's end: at exactly its duration a looping action wraps to frame 0
    const tt = Math.min(t0 + (t1 - t0) * (i / (n - 1)), clip.duration - 1e-3);
    mixer.setTime(tt); holder.updateMatrixWorld(true);
    if (!heading) {
      heading = opts.keepHeading ? new THREE.Quaternion() : new THREE.Quaternion().setFromUnitVectors(facing(tt), new THREE.Vector3(0, 0, 1));
      mixer.setTime(tt); holder.updateMatrixWorld(true);
      startHips = wp(S[hipsN]).applyQuaternion(R).applyQuaternion(heading);
    }
    const G = heading.clone().multiply(R), Gi = G.clone().invert();
    wqT.clear();
    for (const b of order) {
      const parentQ = b === order[0] ? baseQ : wqT.get(b.parent);
      const r = byTarget.get(b);
      let local;
      if (r) {
        const D = G.clone().multiply(wq(r.s)).multiply(restInv[r.sn]).multiply(Gi);
        if (mirror) { D.y = -D.y; D.z = -D.z; }        // reflect the motion across the body's mid-plane (x = 0)
        const world = D.multiply(r.C).multiply(r.tRest);
        local = parentQ.clone().invert().multiply(world);
        const a = qv.get(b.name); a[i * 4] = local.x; a[i * 4 + 1] = local.y; a[i * 4 + 2] = local.z; a[i * 4 + 3] = local.w;
      } else local = restLocal.get(b);
      wqT.set(b, parentQ.clone().multiply(local));
    }
    const p = wp(S[hipsN]).applyQuaternion(R).applyQuaternion(heading).sub(startHips).multiplyScalar(scale); p.y = 0;
    if (mirror) p.x = -p.x;
    travel[i * 2] = p.x; travel[i * 2 + 1] = p.z;
    if (inPlace) { p.x = 0; p.z = 0; }
    const restHipsWorld = new THREE.Vector3().copy(tHipsRestLocal).applyMatrix4(T['DEF-hips'].parent.matrixWorld);
    const hw = restHipsWorld.add(new THREE.Vector3(0, Math.min(opts.noRise ? 0 : 1e9, (wp(S[hipsN]).y - floorY + toeRest) * scale), 0)).add(p);
    const hl = hw.applyMatrix4(tHipsParentInv);
    hp[i * 3] = hl.x; hp[i * 3 + 1] = hl.y; hp[i * 3 + 2] = hl.z;
    times[i] = i / fps;
  }
  for (const a of qv.values()) for (let i = 1; i < n; i++) {
    const d = a[i * 4] * a[i * 4 - 4] + a[i * 4 + 1] * a[i * 4 - 3] + a[i * 4 + 2] * a[i * 4 - 2] + a[i * 4 + 3] * a[i * 4 - 1];
    if (d < 0) for (let k = 0; k < 4; k++) a[i * 4 + k] *= -1;
  }
  const tracks = [new THREE.VectorKeyframeTrack('DEF-hips.position', times, hp)];
  for (const [name, a] of qv) tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, a));
  holder.remove(srcRoot);
  return { clip: new THREE.AnimationClip(opts.name || 'mocap', (n - 1) / fps, tracks), travel, rig };
}

// CMU BVH convenience wrapper (rest = the T-pose this BVH release adds as frame one)
export function retargetBVH(bvhText, target, opts = {}) {
  const bvh = new BVHLoader().parse(bvhText);
  return retargetSkeleton(bvh.skeleton.bones[0], bvh.clip, target, { restTime: 0, ...opts }).clip;
}
