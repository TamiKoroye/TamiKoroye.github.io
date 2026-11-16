// Bakes motion capture (CMU BVH, Mixamo FBX, Rokoko FBX) into AnimationClips for the game's mannequin, using
// headless Chromium + three.js (tools/retarget/retarget.js).
// Usage: node tools/retarget/bake.mjs <baseUrl> <spec.json> <bvhDir> <out.json> [--only name] [--keep-heading]
// spec.json entries: { "name", "src": ".anim-src/mixamo/Punching.fbx" (served path) | "bvh": "135_07.bvh" (in bvhDir),
//   "start", "end", "mirror", "noRise", "impact", "limb", "loop", "fingers" }
// Every clip is baked as given and, unless "mirror" is set explicitly, also mirrored as "<name>_M".
// Output: { clips: [AnimationClip.toJSON + { impact, limb, loop, travel, src }] }, values rounded to 4 decimals.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const args = process.argv.slice(2);
const [BASE, SPEC, DIR, OUT] = args;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const keep = args.includes('--keep-heading');
let spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
if (only) spec = spec.filter(s => only.includes(s.name));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.error('page error', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('console', m.text()); });
await page.goto(BASE); await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
const texts = {};
for (const s of spec) if (s.bvh) texts[s.bvh] ??= fs.readFileSync(path.join(DIR, s.bvh), 'utf8');
const pack = await page.evaluate(async ([spec, texts, keep]) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
  const { retargetSkeleton } = await import('./tools/retarget/retarget.js');
  const g = await new GLTFLoader().loadAsync('assets/characters/ual-mannequin.json');
  const out = [], cache = {};
  const source = async (s) => {
    const key = s.src || s.bvh;
    if (s.bvh) { const b = new BVHLoader().parse(texts[s.bvh]); return { root: b.skeleton.bones[0], clip: b.clip, restTime: 0 }; }   // BVH re-parsed each time
    if (!cache[key]) cache[key] = /\.glb$/i.test(s.src) ? await (async () => { const { GLTFLoader: GL } = await import('three/addons/loaders/GLTFLoader.js'); const g = await new GL().loadAsync(s.src); g.scene.animations = g.animations; g.scene.updateMatrixWorld(true); let sk = null; g.scene.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o.skeleton; }); if (sk) sk.pose(); return g.scene; })() : await new FBXLoader().loadAsync(s.src);
    const f = cache[key];
    // every bake from a cached source starts from its rest pose, not from wherever the previous bake left the bones
    if (!f.userData.rest) { f.userData.rest = []; f.traverse(o => f.userData.rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()])); }
    else for (const [o, p, q, sc] of f.userData.rest) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); }
    f.updateMatrixWorld(true);
    const clip = s.clip ? f.animations.find(a => a.name === s.clip) : f.animations.slice().sort((a, b) => b.duration - a.duration)[0];
    if (!clip) throw new Error('no clip ' + s.clip + ' in ' + s.src);
    const bone = f.getObjectByProperty('isBone', true);
    // unskinned exports (KinemIQ spin.glb) have plain nodes: start from the node called root
    const root = f.children.find(c => c.isBone) || (bone ? bone.parent : (f.getObjectByName('root') || f.children[0]));
    return { root, clip };
  };
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const one = async (s, name, mirror) => {
    const src = await source(s);
    const parent = src.root.parent;
    const res = retargetSkeleton(src.root, src.clip, g.scene, { name, start: s.start, end: s.end, fps: 30, mirror, noRise: !!s.noRise, keepHeading: keep, inPlace: !keep, restTime: src.restTime, fingers: s.fingers, aim: s.limb && s.impact !== undefined && s.aim !== 'head' ? { limb: s.limb, time: s.impact } : (s.aim || 'head') });
    if (parent) parent.add(src.root);
    if (s.loop) {
      // seamless loop: ease the last 0.3 s back into the first frame
      for (const t of res.clip.tracks) {
        const v = t.values, st = t.getValueSize(), n = t.times.length, k = Math.min(n - 1, Math.round(0.3 * 30));
        for (let i = n - k; i < n; i++) {
          const w = (i - (n - k) + 1) / k, e = w * w * (3 - 2 * w);
          if (st === 4) {
            const qa = new THREE.Quaternion().fromArray(v, i * 4), qb = new THREE.Quaternion().fromArray(v, 0);
            if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
            qa.slerp(qb, e).toArray(v, i * 4);
          } else for (let c = 0; c < st; c++) v[i * st + c] += (v[c] - v[i * st + c]) * e;
        }
      }
    }
    const j = THREE.AnimationClip.toJSON(res.clip);
    for (const t of j.tracks) { t.times = Array.from(t.times, r4); t.values = Array.from(t.values, r4); }
    if (s.impact !== undefined) j.impact = +(s.impact - (s.start || 0)).toFixed(3);
    if (s.limb) j.limb = mirror !== !!s.mirror ? s.limb[0] + (s.limb[1] === 'L' ? 'R' : 'L') : s.limb;
    if (s.loop) j.loop = true;
    const tr = Array.from(res.travel, v => Math.round(v * 1000) / 1000);
    if (tr.some(v => Math.abs(v) > 0.05)) j.travel = tr;
    j.src = (s.src || s.bvh).replace(/^.*\//, '') + ' ' + (s.start ?? 0) + '-' + (s.end ?? 'end') + (mirror ? ' mirrored' : '') + ' [' + res.rig + ']';
    out.push(j);
  };
  for (const s of spec) { await one(s, s.name, !!s.mirror); if (s.mirror === undefined) await one(s, s.name + '_M', true); }
  return out;
}, [spec, texts, keep]);
let prev = { clips: [] };
if (only && fs.existsSync(OUT)) prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const names = new Set(pack.map(c => c.name));
const clips = [...prev.clips.filter(c => !names.has(c.name)), ...pack];
// compact storage: every track is sampled at 30 fps, so times are implied; values are quantised to int16
// (quaternions x 32767, positions in millimetres) and stored as base64
const pack16 = (c) => {
  if (c.q) return c;   // already packed (kept from a previous bake)
  const out = { ...c, q: 1, tracks: c.tracks.map(t => {
    const isQ = /quaternion$/.test(t.name), k = isQ ? 32767 : 1000;
    const a = new Int16Array(t.values.length); t.values.forEach((v, i) => { a[i] = Math.max(-32768, Math.min(32767, Math.round(v * k))); });
    return { n: t.name, k: isQ ? 'q' : 'v', d: Buffer.from(a.buffer).toString('base64') };
  }) };
  delete out.uuid; delete out.blendMode;
  return out;
};
const json = JSON.stringify({ format: 'ef-anim-1', fps: 30, source: 'Retargeted by tools/retarget; sources listed per clip (see assets/animations/README.md)', clips: clips.map(pack16) });
fs.writeFileSync(OUT, json);
console.log('wrote', OUT, clips.length, 'clips', (json.length / 1024).toFixed(0) + ' KB');
await browser.close();
