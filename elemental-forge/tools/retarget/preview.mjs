// Renders baked clips on the mannequin next to (or, with OVERLAY=1, over) the source skeleton, as PNG strips.
// Usage: node tools/retarget/preview.mjs <baseUrl> <pack.json> <spec.json> <bvhDir> <outDir> <name,name,...> [frames=10] [view=34|side|front]
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const [BASE, PACK, SPEC, DIR, OUT, NAMES, FRAMES = '10', VIEW = '34'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 440 } })).newPage();
page.on('pageerror', e => console.error('page error', e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
await page.evaluate(() => { document.body.innerHTML = ''; });
const pack = fs.readFileSync(PACK, 'utf8');
for (const name of NAMES.split(',')) {
  const base = name.replace(/_M$/, ''), s = spec.find(x => x.name === base);
  const shots = await page.evaluate(async ([packText, name, s, bvhText, frames, view, over]) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js'); const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
    window.__R ??= (() => { const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(400, 440); document.body.appendChild(r.domElement); return r; })();
    const r = window.__R, scene = new THREE.Scene(); scene.background = new THREE.Color(0xd8dde4);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(2, 4, 3); scene.add(d);
    scene.add(new THREE.GridHelper(6, 12, 0x888888, 0xaaaaaa));
    window.__G ??= await new GLTFLoader().loadAsync('assets/characters/ual-mannequin.json');
    const man = window.__G.scene; scene.add(man);
    man.traverse(o => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xc89870, roughness: 0.8 }); });
    const pk = JSON.parse(packText), cj = pk.clips.find(c => c.name === name); const { unpack } = await import('./js/mocap.js'); const clip = cj.q ? unpack(cj, pk.fps || 30) : THREE.AnimationClip.parse(cj);
    const mixer = new THREE.AnimationMixer(man); mixer.clipAction(clip).play();
    // source skeleton
    let srcRoot, srcClip, sm = null, holder = new THREE.Group();
    if (s.bvh) { const b = new BVHLoader().parse(bvhText); srcRoot = b.skeleton.bones[0]; srcClip = b.clip; holder.add(srcRoot); }
    else { let f; if (/\.glb$/i.test(s.src)) { const g = await new GLTFLoader().loadAsync(s.src); f = g.scene; f.animations = g.animations; f.updateMatrixWorld(true); let sk = null; f.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o.skeleton; }); if (sk) sk.pose(); } else f = await new FBXLoader().loadAsync(s.src); srcClip = f.animations.slice().sort((a, b) => b.duration - a.duration)[0]; f.traverse(o => { if (o.isMesh) o.visible = false; }); holder.add(f); srcRoot = f; }
    scene.add(holder);
    const sh = new THREE.SkeletonHelper(srcRoot); sh.material.depthTest = false; sh.renderOrder = 9; scene.add(sh);
    holder.updateMatrixWorld(true);
    const hipsB = (() => { let h = null; srcRoot.traverse(o => { if (!h && /(Hips|pelvis)$/.test(o.name)) h = o; }); return h; })();
    const footB = (() => { let h = null; srcRoot.traverse(o => { if (!h && /(LeftFoot|foot_l)$/.test(o.name)) h = o; }); return h; })();
    const hy = hipsB.getWorldPosition(new THREE.Vector3()).y - footB.getWorldPosition(new THREE.Vector3()).y;
    holder.scale.setScalar(0.83 / hy);
    sm = new THREE.AnimationMixer(srcRoot); sm.clipAction(srcClip).play();
    const start = s.start || 0; sm.setTime(start); holder.updateMatrixWorld(true);
    const h0 = hipsB.getWorldPosition(new THREE.Vector3());
    holder.position.set((over ? 0 : 1.3) - h0.x, 0, -h0.z);
    const cam = new THREE.PerspectiveCamera(40, 400 / 440, 0.1, 50);
    const pos = view === 'side' ? [4.5, 1.2, 0.4] : view === 'front' ? [0.65, 1.2, 4.6] : [3.3, 1.6, 3.6];
    cam.position.set(...pos); cam.lookAt(over ? 0 : 0.65, 0.9, 0);
    const out = [];
    for (let i = 0; i < frames; i++) {
      const t = (clip.duration * i) / Math.max(1, frames - 1);
      mixer.setTime(Math.min(t, clip.duration - 1e-3)); sm.setTime(start + t);
      r.render(scene, cam); out.push(r.domElement.toDataURL('image/jpeg', 0.85));
    }
    scene.remove(man); return out;
  }, [pack, name, s, s.bvh ? fs.readFileSync(path.join(DIR, s.bvh), 'utf8') : null, +FRAMES, VIEW, !!process.env.OVERLAY]);
  const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true });
  shots.forEach((d, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
  console.log('preview', name);
}
await browser.close();
