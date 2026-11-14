// Skinned character generator.
// Builds ONE continuous skinned mesh per fighter on a real THREE.Skeleton. Limbs and torso are
// lofted tubes whose vertices are weight-blended across joints, so elbows, knees, hips and the
// waist bend smoothly instead of separate primitives sliding apart. Clothing is vertex-coloured,
// so the whole body is a single draw call (plus its shadow).
import * as THREE from 'three';

export const HIP_H = 0.92;
export const LEG = 0.42;

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// Bone layout (local offsets from parent), matching the pose system in fighter.js.
function boneLayout(b) {
  return [
    ['hips', null, 0, HIP_H, 0],
    ['spine', 'hips', 0, 0.1, 0],
    ['chest', 'spine', 0, 0.17, 0],
    ['neck', 'chest', 0, 0.32, 0],
    ['head', 'neck', 0, 0.1, 0.01],
    ['sL', 'chest', 0.215 * b, 0.24, -0.01], ['eL', 'sL', 0, -0.285, 0], ['wL', 'eL', 0, -0.26, 0],
    ['sR', 'chest', -0.215 * b, 0.24, -0.01], ['eR', 'sR', 0, -0.285, 0], ['wR', 'eR', 0, -0.26, 0],
    ['hL', 'hips', 0.1, -0.02, 0], ['kL', 'hL', 0, -LEG, 0], ['aL', 'kL', 0, -LEG, 0],
    ['hR', 'hips', -0.1, -0.02, 0], ['kR', 'hR', 0, -LEG, 0], ['aR', 'kR', 0, -LEG, 0],
  ];
}

class MeshBuilder {
  constructor(boneIndex) {
    this.bi = boneIndex;
    this.pos = []; this.nrm = []; this.col = []; this.si = []; this.sw = []; this.idx = [];
  }
  // Append a BufferGeometry (indexed) with a per-vertex colour and weight function.
  add(geo, colorFn, weightFn) {
    if (!geo.index) geo = mergeIndex(geo);
    geo.computeVertexNormals();
    const p = geo.attributes.position, n = geo.attributes.normal, base = this.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      const c = colorFn(v); this.col.push(c.r, c.g, c.b);
      const w = weightFn(v).filter(e => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let sum = 0; for (const e of w) sum += e[1];
      for (let k = 0; k < 4; k++) {
        if (k < w.length) { this.si.push(this.bi[w[k][0]]); this.sw.push(w[k][1] / sum); }
        else { this.si.push(0); this.sw.push(0); }
      }
    }
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + base);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
function mergeIndex(geo) {
  const n = geo.attributes.position.count, a = [];
  for (let i = 0; i < n; i++) a.push(i);
  geo.setIndex(a); return geo;
}

// Loft a closed tube along +y through elliptical rings. ring: {y, rx, rz, cx, cz, c (colour key), bump(theta,y)}
function loft(rings, seg, capTop = true, capBottom = true) {
  const pos = [], idx = [];
  const cols = [];
  for (const r of rings) {
    for (let s = 0; s < seg; s++) {
      const th = (s / seg) * Math.PI * 2;
      const bump = r.bump ? r.bump(th, r.y) : 0;
      pos.push((r.cx || 0) + Math.sin(th) * (r.rx + bump), r.y, (r.cz || 0) + Math.cos(th) * (r.rz + bump));
      cols.push(r.c);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < seg; s++) {
      const a = i * seg + s, b = i * seg + (s + 1) % seg, c = (i + 1) * seg + s, d = (i + 1) * seg + (s + 1) % seg;
      // orient outward: rings may go up or down in y
      if (rings[i + 1].y > rings[i].y) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const addCap = (ri, up) => {
    const r = rings[ri], center = pos.length / 3;
    pos.push(r.cx || 0, r.y + (up ? 0.01 : -0.01), r.cz || 0); cols.push(r.c);
    for (let s = 0; s < seg; s++) {
      const a = ri * seg + s, b = ri * seg + (s + 1) % seg;
      if (up) idx.push(a, b, center); else idx.push(a, center, b);
    }
  };
  const ascending = rings[rings.length - 1].y > rings[0].y;
  if (capBottom) addCap(ascending ? 0 : rings.length - 1, false);
  if (capTop) addCap(ascending ? rings.length - 1 : 0, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.userData.cols = cols;
  return g;
}

function ellipsoid(cx, cy, cz, rx, ry, rz, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz); g.translate(cx, cy, cz);
  return g;
}

/**
 * opts: { skin, pants, sash, wrap, build (shoulder width scale), bulk (muscle scale) }
 * returns { root, tumble, J (name -> Bone), mesh, material, skeleton }
 */
export function buildSkinnedFighter(opts) {
  const b = opts.build || 1, bulk = opts.bulk || 1;
  const C = {
    skin: new THREE.Color(opts.skin), pants: new THREE.Color(opts.pants), sash: new THREE.Color(opts.sash),
    wrap: new THREE.Color(opts.wrap ?? 0xd8cbb0), dark: new THREE.Color(0x1a1210), skinDark: new THREE.Color(opts.skin).multiplyScalar(0.8),
  };

  // --- skeleton
  const root = new THREE.Group();
  const tumble = new THREE.Group(); tumble.position.y = 0.6; root.add(tumble);
  const offs = new THREE.Group(); offs.position.y = -0.6; tumble.add(offs);
  const J = {}, bones = [], boneIndex = {};
  for (const [name, parent, x, y, z] of boneLayout(b)) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, z);
    (parent ? J[parent] : offs).add(bone);
    J[name] = bone; boneIndex[name] = bones.length; bones.push(bone);
  }
  root.updateMatrixWorld(true);
  const W = {}; for (const n in J) W[n] = J[n].getWorldPosition(new THREE.Vector3());

  const mb = new MeshBuilder(boneIndex);
  const colOf = (geo) => (v) => C[geo.userData.cols[0]] || C.skin;
  const perVertexCol = (geo) => { const cols = geo.userData.cols; let i = 0; return () => C[cols[i++]] || C.skin; };

  // --- torso (pelvis to neck base): hips / spine / chest blend
  const torsoW = (v) => {
    const t1 = smooth((v.y - (W.spine.y - 0.05)) / 0.1), t2 = smooth((v.y - (W.chest.y - 0.05)) / 0.12);
    const w = [['hips', 1 - t1], ['spine', t1 * (1 - t2)], ['chest', t1 * t2]];
    // shoulder tops follow the arms a little so raised arms don't tear the trap/deltoid line
    if (v.y > 1.36 && Math.abs(v.x) > 0.15 * b) { const k = smooth((Math.abs(v.x) - 0.15 * b) / 0.08) * smooth((v.y - 1.36) / 0.08) * 0.35; w.push([v.x > 0 ? 'sL' : 'sR', k]); }
    return w;
  };
  const pec = (th, y) => {
    const front = Math.max(0, Math.cos(th));
    const side = Math.abs(Math.sin(th));
    const hump = Math.exp(-((y - 1.33) ** 2) / 0.0025);
    const abs = Math.exp(-((y - 1.13) ** 2) / 0.006) * Math.exp(-((side - 0.25) ** 2) / 0.02) * 0.006;
    return (0.024 * Math.exp(-((side - 0.5) ** 2) / 0.05) * hump + abs) * front * bulk;
  };
  const back = (th, y) => -0.012 * Math.max(0, -Math.cos(th)) * Math.exp(-(Math.sin(th) ** 2) / 0.01) * (y > 1.05 ? 1 : 0); // spine groove
  const tb = (th, y) => pec(th, y) + back(th, y);
  const T = (y, rx, rz, c, cz = 0) => ({ y, rx: rx * (c === 'skin' && y > 1.15 ? b * 1.1 : 1.04), rz: rz * (c === 'skin' && y > 1.15 ? 1.1 : 1.04), c, cz, bump: c === 'skin' ? tb : null });
  const torso = loft([
    T(0.79, 0.15, 0.12, 'pants'), T(0.84, 0.185, 0.14, 'pants'), T(0.91, 0.198, 0.148, 'pants', -0.005), T(0.975, 0.19, 0.142, 'pants'),
    T(0.975, 0.19, 0.142, 'sash'), T(1.0, 0.182, 0.136, 'sash'), T(1.04, 0.172, 0.13, 'sash'),
    T(1.04, 0.168, 0.126, 'skin'), T(1.09, 0.163 * bulk, 0.12, 'skin'), T(1.16, 0.178 * bulk, 0.125, 'skin'), T(1.23, 0.205 * bulk, 0.138, 'skin'),
    T(1.3, 0.228 * bulk, 0.148, 'skin', 0.005), T(1.37, 0.235 * bulk, 0.145, 'skin'), T(1.43, 0.215 * bulk, 0.125, 'skin', -0.01),
    T(1.48, 0.16, 0.1, 'skin', -0.015), T(1.51, 0.075, 0.07, 'skin', -0.005),
  ], 18, true, true);
  mb.add(torso, perVertexCol(torso), torsoW);

  // --- neck + head
  const neckW = (v) => { const t = smooth((v.y - 1.5) / 0.06), h = smooth((v.y - 1.6) / 0.05); return [['chest', 1 - t], ['neck', t * (1 - h)], ['head', t * h]]; };
  const neck = loft([{ y: 1.46, rx: 0.082, rz: 0.074, c: 'skin', cz: -0.005 }, { y: 1.55, rx: 0.07, rz: 0.068, c: 'skin' }, { y: 1.64, rx: 0.06, rz: 0.06, c: 'skin', cz: 0.01 }], 12, false, false);
  mb.add(neck, perVertexCol(neck), neckW);
  const hy = W.head.y, hz = W.head.z;
  const headW = () => [['head', 1]];
  const cSkin = () => C.skin, cDark = () => C.dark;
  const skull = ellipsoid(0, hy + 0.1, hz - 0.005, 0.1, 0.122, 0.112, 18, 14);
  mb.add(skull, cSkin, headW);
  mb.add(ellipsoid(0, hy + 0.035, hz + 0.03, 0.078, 0.058, 0.08, 12, 8), cSkin, headW);          // jaw
  mb.add(ellipsoid(0, hy + 0.09, hz + 0.105, 0.018, 0.03, 0.022, 8, 6), cSkin, headW);           // nose
  mb.add(ellipsoid(0, hy + 0.123, hz + 0.088, 0.072, 0.014, 0.025, 10, 6), cSkin, headW);        // brow ridge
  for (const s of [1, -1]) {
    mb.add(ellipsoid(0.037 * s, hy + 0.108, hz + 0.098, 0.016, 0.01, 0.008, 8, 6), cDark, headW); // eyes
    mb.add(ellipsoid(0.1 * s, hy + 0.095, hz - 0.005, 0.018, 0.034, 0.016, 8, 6), cSkin, headW);   // ears
  }

  // --- arms
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const x = W['s' + S].x, z = W['s' + S].z, yS = W['s' + S].y, yE = W['e' + S].y, yW = W['w' + S].y;
    const A = (y, r, c, rz) => ({ y, rx: r * bulk * 1.2, rz: (rz ?? r) * bulk * 1.2, cx: x, cz: z, c });
    const arm = loft([
      A(yS + 0.05, 0.05, 'skin'), A(yS + 0.03, 0.08, 'skin'), A(yS - 0.03, 0.084, 'skin'), A(yS - 0.1, 0.07, 'skin', 0.072),
      A(yS - 0.17, 0.066, 'skin', 0.07), A(yE + 0.06, 0.056, 'skin'), A(yE, 0.05, 'skin'), A(yE - 0.05, 0.056, 'skin', 0.054),
      A(yE - 0.12, 0.05, 'skin', 0.047), A(yW + 0.07, 0.043, 'skin'), A(yW + 0.07, 0.047, 'wrap'), A(yW + 0.01, 0.045, 'wrap'),
    ], 12, true, true);
    const armW = (v) => {
      const e = smooth((yE + 0.045 - v.y) / 0.09);
      const top = smooth((v.y - (yS - 0.02)) / 0.07) * 0.3;
      return [['s' + S, (1 - e) * (1 - top)], ['e' + S, e], ['chest', (1 - e) * top]];
    };
    mb.add(arm, perVertexCol(arm), armW);
    // fist
    mb.add(ellipsoid(x, yW - 0.035, z + 0.005, 0.056, 0.066, 0.06, 12, 8), cSkin, () => [['w' + S, 1]]);
    mb.add(ellipsoid(x - 0.02 * s, yW - 0.025, z + 0.04, 0.02, 0.03, 0.02, 6, 6), cSkin, () => [['w' + S, 1]]); // thumb
  }

  // --- legs (baggy pants, wrapped ankles)
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const x = W['h' + S].x, yH = W['h' + S].y, yK = W['k' + S].y, yA = W['a' + S].y;
    const L = (y, r, c, rz) => ({ y, rx: r, rz: rz ?? r, cx: x + (c === 'pants' && y > yK ? 0.006 * s : 0), cz: 0, c });
    const leg = loft([
      L(yH + 0.07, 0.1, 'pants'), L(yH, 0.118, 'pants'), L(yH - 0.12, 0.115, 'pants'), L(yH - 0.26, 0.1, 'pants'),
      L(yK + 0.04, 0.088, 'pants'), L(yK - 0.03, 0.09, 'pants'), L(yK - 0.13, 0.088, 'pants', 0.092), L(yA + 0.18, 0.074, 'pants'),
      L(yA + 0.11, 0.066, 'pants'), L(yA + 0.11, 0.062, 'wrap'), L(yA + 0.03, 0.056, 'wrap'), L(yA + 0.03, 0.05, 'skin'), L(yA - 0.01, 0.048, 'skin'),
    ], 12, true, true);
    const legW = (v) => {
      const k = smooth((yK + 0.05 - v.y) / 0.1);
      const top = smooth((v.y - (yH - 0.06)) / 0.12) * 0.45;
      const an = smooth((yA + 0.04 - v.y) / 0.06);
      return [['hips', top * (1 - k)], ['h' + S, (1 - top) * (1 - k)], ['k' + S, k * (1 - an)], ['a' + S, k * an]];
    };
    mb.add(leg, perVertexCol(leg), legW);
    mb.add(ellipsoid(x, yA - 0.025, 0.055, 0.052, 0.035, 0.115, 12, 8), cSkin, () => [['a' + S, 1]]); // foot
  }
  // sash tail
  mb.add(ellipsoid(0.17, 0.9, 0.06, 0.016, 0.12, 0.04, 8, 6), () => C.sash, () => [['hips', 1]]);

  const geometry = mb.build();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.02 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.frustumCulled = false; // bounding sphere is bind-pose only; fighters are always near the action
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  return { root, tumble, J, mesh, material, skeleton, triangles: geometry.index.count / 3 };
}
