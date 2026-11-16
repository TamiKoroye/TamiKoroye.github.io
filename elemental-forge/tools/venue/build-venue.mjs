// Builds the game's barn-ruin venue from the photogrammetry scan (brick-arcs.fbx, 1.48 M triangles, four 8K
// texture atlases) for a phone browser:
//   1. loads the scan with three.js FBXLoader (in Node),
//   2. welds and simplifies each texture atlas's triangles with meshoptimizer,
//   3. writes a binary glTF (positions, normals, UVs, four materials with the downscaled atlases) and
//   4. rasterises the simplified mesh into a 0.4 m height grid and merges the tall cells into box colliders
//      (walls and piers) that the game uses for collision, standing on top, projectiles and the camera.
// Usage: node tools/venue/build-venue.mjs <scan.fbx> <atlas dir (1024 px jpgs)> <three r170 package dir> <meshopt_simplifier.module.js> <out dir> [triangles=48000]
import fs from 'node:fs'; import path from 'node:path';
const [SRC, ATLAS, THREE_DIR, MESHOPT, OUT, TRIS = '48000'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

// three.js r170 and meshoptimizer from a local npm install (THREE_DIR / MESHOPT point at them); FBXLoader runs in Node
// with a minimal image stub (textures are not needed here: the atlases are attached from ATLAS below)
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };
const { pathToFileURL } = await import('node:url');
const THREE = await import(pathToFileURL(path.join(THREE_DIR, 'build/three.module.js')).href);
const { FBXLoader } = await import(pathToFileURL(path.join(THREE_DIR, 'examples/jsm/loaders/FBXLoader.js')).href);
const { MeshoptSimplifier } = await import(pathToFileURL(MESHOPT).href); await MeshoptSimplifier.ready;
const res = await (async (src, target) => {
  const data = fs.readFileSync(src);
  const f = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), path.dirname(src) + '/'); f.updateMatrixWorld(true);
  let mesh = null; f.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const g = mesh.geometry; g.applyMatrix4(mesh.matrixWorld); g.scale(0.01, 0.01, 0.01);   // centimetres -> metres
  const total = g.attributes.position.count / 3;
  // the scan switches atlas every few triangles: gather each atlas's triangles from all of its runs
  const runs = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
  const byMat = new Map(); for (const r of runs) { if (!byMat.has(r.materialIndex)) byMat.set(r.materialIndex, []); byMat.get(r.materialIndex).push(r); }
  const PA = g.attributes.position.array, UA = g.attributes.uv.array, out = [];
  for (const [mat, list] of byMat) {
    const verts = []; for (const r of list) for (let v = r.start; v < r.start + r.count; v++) verts.push(v);
    const gr = { materialIndex: mat, count: verts.length };
    // weld identical corners (same position and UV) so the simplifier sees a connected surface
    const map = new Map(), idx = new Uint32Array(gr.count), pos = [], uv = [];
    for (let vi = 0; vi < verts.length; vi++) { const v = verts[vi];
      const key = Math.round(PA[v * 3] * 1e4) + ',' + Math.round(PA[v * 3 + 1] * 1e4) + ',' + Math.round(PA[v * 3 + 2] * 1e4) + ',' + Math.round(UA[v * 2] * 1e5) + ',' + Math.round(UA[v * 2 + 1] * 1e5);
      let k = map.get(key);
      if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(PA[v * 3], PA[v * 3 + 1], PA[v * 3 + 2]); uv.push(UA[v * 2], UA[v * 2 + 1]); }
      idx[vi] = k;
    }
    const P0 = new Float32Array(pos);
    const want = Math.min(idx.length, Math.max(300, Math.round(target * (gr.count / 3) / total)) * 3);
    const [si] = MeshoptSimplifier.simplify(idx, P0, 3, want, 0.35, []);
    const remap = new Int32Array(P0.length / 3).fill(-1); let n = 0;
    for (const i of si) if (remap[i] < 0) remap[i] = n++;
    const P = new Float32Array(n * 3), U = new Float32Array(n * 2), I = new Uint32Array(si.length);
    for (let i = 0; i < remap.length; i++) if (remap[i] >= 0) { const j = remap[i]; P[j * 3] = P0[i * 3]; P[j * 3 + 1] = P0[i * 3 + 1]; P[j * 3 + 2] = P0[i * 3 + 2]; U[j * 2] = uv[i * 2]; U[j * 2 + 1] = 1 - uv[i * 2 + 1]; }
    for (let i = 0; i < si.length; i++) I[i] = remap[si[i]];
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(P, 3)); ng.setIndex(new THREE.BufferAttribute(I, 1)); ng.computeVertexNormals();
    out.push({ mat: gr.materialIndex, P, N: new Float32Array(ng.attributes.normal.array), U, I, tris: I.length / 3 });
    console.log('atlas', gr.materialIndex, gr.count / 3, 'triangles ->', I.length / 3, '(welded vertices', P0.length / 3, ')');
  }
  return { total, out };
})(SRC, +TRIS);
console.log('source triangles', res.total, '-> simplified', res.out.reduce((a, o) => a + o.tris, 0));

// ---- vertical extent and centring: the floor (low percentile of heights) goes to y = 0, the footprint is centred
const prims = res.out;
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; const ys = [];
for (const p of prims) for (let i = 0; i < p.P.length; i += 3) { minX = Math.min(minX, p.P[i]); maxX = Math.max(maxX, p.P[i]); minZ = Math.min(minZ, p.P[i + 2]); maxZ = Math.max(maxZ, p.P[i + 2]); ys.push(p.P[i + 1]); }
const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

// ---- height grid (0.4 m): highest surface and lowest surface per cell, by rasterising triangles
const CELL = 0.4, GX = Math.ceil((maxX - minX) / CELL) + 1, GZ = Math.ceil((maxZ - minZ) / CELL) + 1;
const hi = new Float32Array(GX * GZ).fill(-1e9), lo = new Float32Array(GX * GZ).fill(1e9), occ = new Uint8Array(GX * GZ);
let band = null;   // second pass: [low, high] heights that count as an obstacle at body height
const raster = () => { for (const p of prims) for (let t = 0; t < p.I.length; t += 3) {
  const v = [p.I[t], p.I[t + 1], p.I[t + 2]].map(i => [p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]);
  // sample the triangle at barycentric points dense enough for the cell size
  const e = Math.max(Math.hypot(v[1][0] - v[0][0], v[1][2] - v[0][2]), Math.hypot(v[2][0] - v[0][0], v[2][2] - v[0][2]), Math.hypot(v[2][0] - v[1][0], v[2][2] - v[1][2]));
  const n = Math.max(1, Math.ceil(e / (CELL * 0.5)));
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
    const u = a / n, w = b / n, c = 1 - u - w;
    const x = v[0][0] * c + v[1][0] * u + v[2][0] * w, y = v[0][1] * c + v[1][1] * u + v[2][1] * w, z = v[0][2] * c + v[1][2] * u + v[2][2] * w;
    const gi = Math.floor((x - minX) / CELL), gk = Math.floor((z - minZ) / CELL), k = gk * GX + gi;
    if (band) { if (y > band[0] && y < band[1]) occ[k] = 1; }
    else { if (y > hi[k]) hi[k] = y; if (y < lo[k]) lo[k] = y; }
  }
} };
raster();
// the scan is not level: fit a plane to the ground (the lower surface of each cell, near the median) and rotate
// the whole model so that plane is horizontal, then measure again
{
  const lows0 = [...lo].filter(v => v < 1e8).sort((a, b) => a - b), med = lows0[Math.floor(lows0.length * 0.5)];
  let n = 0, sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (let gk = 0; gk < GZ; gk++) for (let gi = 0; gi < GX; gi++) { const y = lo[gk * GX + gi]; if (y > 1e8 || Math.abs(y - med) > 1.2) continue; const x = minX + (gi + 0.5) * CELL, z = minZ + (gk + 0.5) * CELL; n++; sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; }
  // least squares y = a x + b z + c
  const M = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], R = [sxy, szy, sy];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), col = (i) => M.map((row, r) => row.map((v, c) => c === i ? R[r] : v));
  const a = det(col(0)) / D, b = det(col(1)) / D;
  const nrm = new THREE.Vector3(-a, 1, -b).normalize(), q = new THREE.Quaternion().setFromUnitVectors(nrm, new THREE.Vector3(0, 1, 0)), v = new THREE.Vector3();
  console.log('ground slope', (Math.atan(a) * 57.3).toFixed(2), 'deg along x,', (Math.atan(b) * 57.3).toFixed(2), 'deg along z: levelling');
  for (const p of prims) { for (let i = 0; i < p.P.length; i += 3) { v.set(p.P[i], p.P[i + 1], p.P[i + 2]).applyQuaternion(q); p.P[i] = v.x; p.P[i + 1] = v.y; p.P[i + 2] = v.z; } for (let i = 0; i < p.N.length; i += 3) { v.set(p.N[i], p.N[i + 1], p.N[i + 2]).applyQuaternion(q); p.N[i] = v.x; p.N[i + 1] = v.y; p.N[i + 2] = v.z; } }
  hi.fill(-1e9); lo.fill(1e9); raster();
}
// the walkable ground: in open cells (a single surface, top close to bottom) the top surface; cells under walls and
// overhangs take their neighbours' ground; then smoothed. The arena uses this as ground height inside the footprint.
const ground = new Float32Array(GX * GZ).fill(NaN);
for (let k = 0; k < GX * GZ; k++) if (hi[k] > -1e8 && hi[k] - lo[k] < 0.45) ground[k] = hi[k];
{ // wall tops, beams and stray underside fragments are not ground: keep cells within -1 m / +1.5 m of the median
  const g0 = [...ground].filter(v => !isNaN(v)).sort((a, b) => a - b), med = g0[Math.floor(g0.length * 0.5)];
  for (let k = 0; k < ground.length; k++) if (ground[k] > med + 1.5 || ground[k] < med - 1) ground[k] = NaN; }
for (let it = 0; it < 40; it++) { let left = 0; const g2 = ground.slice(); for (let gk = 0; gk < GZ; gk++) for (let gi = 0; gi < GX; gi++) { const k = gk * GX + gi; if (!isNaN(ground[k])) continue; let n = 0, sum = 0; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i2 = gi + di, k2 = gk + dk; if (i2 < 0 || k2 < 0 || i2 >= GX || k2 >= GZ) continue; const v = ground[k2 * GX + i2]; if (!isNaN(v)) { n++; sum += v; } } if (n) g2[k] = sum / n; else left++; } ground.set(g2); if (!left) break; }
const gs = [...ground].filter(v => !isNaN(v)).sort((a, b) => a - b), floorY = gs[Math.floor(gs.length * 0.5)];
for (let k = 0; k < ground.length; k++) if (isNaN(ground[k])) ground[k] = floorY;
{ const g2 = ground.slice(); for (let gk = 0; gk < GZ; gk++) for (let gi = 0; gi < GX; gi++) { let n = 0, sum = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const i2 = gi + a, k2 = gk + b; if (i2 < 0 || k2 < 0 || i2 >= GX || k2 >= GZ) continue; n++; sum += ground[k2 * GX + i2]; } g2[gk * GX + gi] = sum / n; } ground.set(g2); }
// cells with geometry at body height above their own ground (0.4 to 1.8 m) are walls / piers / debris heaps;
// arches and beams overhead are not, so fighters walk under them
const occ2 = new Uint8Array(GX * GZ);
for (const p of prims) for (let t = 0; t < p.I.length; t += 3) {
  const v = [p.I[t], p.I[t + 1], p.I[t + 2]].map(i => [p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]);
  const e = Math.max(Math.hypot(v[1][0] - v[0][0], v[1][2] - v[0][2]), Math.hypot(v[2][0] - v[0][0], v[2][2] - v[0][2]), Math.hypot(v[2][0] - v[1][0], v[2][2] - v[1][2]), Math.abs(v[1][1] - v[0][1]), Math.abs(v[2][1] - v[0][1]));
  const n = Math.max(1, Math.ceil(e / (CELL * 0.5)));
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
    const u = a / n, w = b / n, c = 1 - u - w;
    const x = v[0][0] * c + v[1][0] * u + v[2][0] * w, y = v[0][1] * c + v[1][1] * u + v[2][1] * w, z = v[0][2] * c + v[1][2] * u + v[2][2] * w;
    const gi = Math.floor((x - minX) / CELL), gk = Math.floor((z - minZ) / CELL); if (gi < 0 || gk < 0 || gi >= GX || gk >= GZ) continue;
    const k = gk * GX + gi; if (y > ground[k] + 0.4 && y < ground[k] + 1.8) occ2[k] = 1;
  }
}
const wall = occ2;
// merge wall cells into boxes greedily (rows, then extend down while the run matches), top = highest cell
const used = new Uint8Array(GX * GZ), boxes = [];
for (let gk = 0; gk < GZ; gk++) for (let gi = 0; gi < GX; gi++) {
  const k = gk * GX + gi; if (!wall[k] || used[k]) continue;
  let w = 1; while (gi + w < GX && wall[gk * GX + gi + w] && !used[gk * GX + gi + w]) w++;
  let h = 1; outer: while (gk + h < GZ) { for (let i = 0; i < w; i++) { const kk = (gk + h) * GX + gi + i; if (!wall[kk] || used[kk]) break outer; } h++; }
  let top = -1e9; for (let a = 0; a < h; a++) for (let i = 0; i < w; i++) { const kk = (gk + a) * GX + gi + i; used[kk] = 1; top = Math.max(top, hi[kk]); }
  boxes.push({ x: +(minX + (gi + w / 2) * CELL - cx).toFixed(2), z: +(minZ + (gk + h / 2) * CELL - cz).toFixed(2), hx: +(w * CELL / 2).toFixed(2), hz: +(h * CELL / 2).toFixed(2), top: +(top - floorY).toFixed(2) });
}
console.log('floor', floorY.toFixed(2), 'footprint', (maxX - minX).toFixed(1), 'x', (maxZ - minZ).toFixed(1), 'm; wall boxes', boxes.length);

// ---- binary glTF writer (one mesh, four primitives, four textured materials)
for (const p of prims) for (let i = 0; i < p.P.length; i += 3) { p.P[i] -= cx; p.P[i + 1] -= floorY; p.P[i + 2] -= cz; }
const chunks = []; let off = 0; const views = [], accessors = [];
const addView = (buf, target) => { const pad = (4 - (buf.length % 4)) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) }); chunks.push(buf, Buffer.alloc(pad)); off += buf.length + pad; return views.length - 1; };
const mm = (a, s) => { const mn = Array(s).fill(Infinity), mx = Array(s).fill(-Infinity); for (let i = 0; i < a.length; i++) { const c = i % s; mn[c] = Math.min(mn[c], a[i]); mx[c] = Math.max(mx[c], a[i]); } return [mn, mx]; };
const primitives = [];
for (const p of prims) {
  const acc = (arr, type, comp, target, minmax) => { const v = addView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), target); accessors.push({ bufferView: v, componentType: comp, count: arr.length / ({ VEC3: 3, VEC2: 2, SCALAR: 1 }[type]), type, ...(minmax ? { min: minmax[0], max: minmax[1] } : {}) }); return accessors.length - 1; };
  primitives.push({ attributes: { POSITION: acc(p.P, 'VEC3', 5126, 34962, mm(p.P, 3)), NORMAL: acc(p.N, 'VEC3', 5126, 34962), TEXCOORD_0: acc(p.U, 'VEC2', 5126, 34962) }, indices: acc(p.I, 'SCALAR', 5125, 34963), material: p.mat });
}
const images = [], textures = [], materials = [];
for (let i = 0; i < 4; i++) {
  const jpg = fs.readFileSync(path.join(ATLAS, `brick-arcs${i ? i : ''}.jpg`));
  images.push({ bufferView: addView(jpg), mimeType: 'image/jpeg' }); textures.push({ source: i });
  materials.push({ name: 'atlas' + i, pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0, roughnessFactor: 0.95 } });
}
const bin = Buffer.concat(chunks);
const gltf = { asset: { version: '2.0', generator: 'Elemental Forge tools/venue/build-venue.mjs' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'barn_ruin' }], meshes: [{ primitives }], accessors, bufferViews: views, buffers: [{ byteLength: bin.length }], images, textures, materials };
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const glb = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(glb, 28 + json.length);
fs.writeFileSync(path.join(OUT, 'barn-ruin.glb'), glb);
// ground grid relative to the floor, in centimetres (int16, base64), origin at the grid's (x0, z0) corner
const gcm = new Int16Array(GX * GZ); for (let k = 0; k < gcm.length; k++) gcm[k] = Math.round((ground[k] - floorY) * 100);
fs.writeFileSync(path.join(OUT, 'barn-ruin-colliders.json'), JSON.stringify({ cell: CELL, footprint: [+(maxX - minX).toFixed(2), +(maxZ - minZ).toFixed(2)], boxes,
  ground: { x0: +(minX - cx).toFixed(3), z0: +(minZ - cz).toFixed(3), cell: CELL, nx: GX, nz: GZ, cm: Buffer.from(gcm.buffer).toString('base64') } }));
console.log('ground relief', (Math.min(...gcm) / 100).toFixed(2), 'to', (Math.max(...gcm) / 100).toFixed(2), 'm around the floor');
console.log('wrote', path.join(OUT, 'barn-ruin.glb'), (glb.length / 1048576).toFixed(2), 'MB');
