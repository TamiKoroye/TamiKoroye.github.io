// Bakes the "Bomb Crack Ground" fracture simulation (tyFlow, 1416 animated fragments, 3.3 s) into one compact
// module for Earth's ground reactions: a single merged mesh (fragment id per vertex, top-surface flag per vertex)
// plus a per-frame table of every fragment's position, rotation and scale. The game moves the fragments in the
// vertex shader from that table (js/crack.js), so a burst is one draw call.
// Usage: node tools/venue/build-crack.mjs <Bomb Crack_Ground_00.fbx> <three r170 package dir> <out .js> [fps=12] [fragments=600]
import path from 'node:path'; import fs from 'node:fs'; import { pathToFileURL } from 'node:url';
const [SRC, THREE_DIR, OUT, FPS = '15'] = process.argv.slice(2);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };
const THREE = await import(pathToFileURL(path.join(THREE_DIR, 'build/three.module.js')).href);
const { FBXLoader } = await import(pathToFileURL(path.join(THREE_DIR, 'examples/jsm/loaders/FBXLoader.js')).href);
const d = fs.readFileSync(SRC);
const root = new FBXLoader().parse(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength), path.dirname(SRC) + '/');
const clip = root.animations[0];
const frags = []; root.traverse(o => { if (o.isMesh) frags.push(o); });
const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
const nF = Math.floor(clip.duration * +FPS) + 1;
// sample every fragment's world transform (centimetres -> metres)
const T = new Float32Array(nF * frags.length * 8), M = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
const maxS = new Float32Array(frags.length);
for (let fi = 0; fi < nF; fi++) {
  mixer.setTime(Math.min(clip.duration, fi / +FPS)); root.updateMatrixWorld(true);
  frags.forEach((m, k) => {
    m.matrixWorld.decompose(p, q, sc);
    const o = (fi * frags.length + k) * 8;
    T[o] = p.x * 0.01; T[o + 1] = p.y * 0.01; T[o + 2] = p.z * 0.01; T[o + 3] = sc.x;
    T[o + 4] = q.x; T[o + 5] = q.y; T[o + 6] = q.z; T[o + 7] = q.w;
    maxS[k] = Math.max(maxS[k], sc.x);
  });
}
// the largest fragments carry the look of the burst: keep the MAX biggest that ever become visible
const MAX = +(process.argv[6] || 600);
const size = frags.map((m, k) => { m.geometry.computeBoundingSphere(); return m.geometry.boundingSphere.radius * maxS[k]; });
// pieces that never move (the unbroken ground around the hole) are dropped: the game draws its own crater
const moved = frags.map((m, k) => { let mx = 0; for (let fi = 1; fi < nF; fi++) { const o = (fi * frags.length + k) * 8, o0 = k * 8; mx = Math.max(mx, Math.hypot(T[o] - T[o0], T[o + 1] - T[o0 + 1], T[o + 2] - T[o0 + 2])); } return mx; });
const keep = frags.map((m, k) => k).filter(k => maxS[k] > 0.02 && moved[k] > 0.05).sort((a, b) => size[b] - size[a]).slice(0, MAX).sort((a, b) => a - b);
console.log('static pieces dropped', frags.filter((m, k) => moved[k] <= 0.05).length);
// merged geometry in fragment-local metres; 'frag' = column in the table, 'top' = 1 on the ground surface material
const pos = [], fragA = [], topA = [];
keep.forEach((k, col) => {
  const g = frags[k].geometry, P = g.attributes.position, mats = [].concat(frags[k].material).map(x => x.name);
  // written unindexed (the fragments share no corners): three vertices per triangle
  const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : P.count, materialIndex: 0 }];
  for (const gr of groups) for (let i = gr.start; i < gr.start + gr.count; i++) {
    const v = g.index ? g.index.getX(i) : i;
    pos.push(P.getX(v) * 0.01, P.getY(v) * 0.01, P.getZ(v) * 0.01); fragA.push(col); topA.push(/surface/i.test(mats[gr.materialIndex] || '') ? 1 : 0);
  }
});
// pack: table as int16 (metres x 1000 for position, x 10000 for scale, x 32767 for the quaternion)
const tab = new Int16Array(nF * keep.length * 8);
for (let fi = 0; fi < nF; fi++) keep.forEach((k, col) => {
  const s = (fi * frags.length + k) * 8, o = (fi * keep.length + col) * 8;
  for (let c = 0; c < 3; c++) tab[o + c] = Math.max(-32768, Math.min(32767, Math.round(T[s + c] * 1000)));
  tab[o + 3] = Math.min(32767, Math.round(T[s + 3] * 10000));
  for (let c = 4; c < 8; c++) tab[o + c] = Math.round(T[s + c] * 32767);
});
const P16 = Int16Array.from(pos, v => Math.round(v * 10000));   // fragment-local, 0.1 mm
const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const out = `// Earth ground-burst: fracture simulation baked by tools/venue/build-crack.mjs from "Bomb Crack Ground 00".
export default { fps: ${FPS}, frames: ${nF}, frags: ${keep.length}, duration: ${clip.duration.toFixed(3)},
  pos: '${b64(P16)}', frag: '${b64(Uint16Array.from(fragA))}', top: '${b64(Uint8Array.from(topA))}', table: '${b64(tab)}' };
`;
fs.writeFileSync(OUT, out);
console.log('fragments', frags.length, 'kept', keep.length, 'vertices', pos.length / 3, 'triangles', pos.length / 9, 'frames', nF, '->', (out.length / 1048576).toFixed(2), 'MB');
