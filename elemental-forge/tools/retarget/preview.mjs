// Renders a baked clip on the mannequin next to the source BVH skeleton, as a strip of PNG frames.
// Usage: node tools/retarget/preview.mjs <baseUrl> <pack.json> <file.bvh> <outDir> [start] [frames=12] [view=side|front|34] [clipName]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const [BASE, CLIP, BVH, OUT, START = '0', FRAMES = '12', VIEW = '34', NAME] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 480 } })).newPage();
page.on('pageerror', e => console.error('page error', e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
const shots = await page.evaluate(async ([clipJson, bvhText, start, frames, view, over, name]) => {
  globalThis.OVER = over;
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
  document.body.innerHTML = '';
  const W = 640, H = 480, r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(W, H); document.body.appendChild(r.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd8dde4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(2, 4, 3); scene.add(d);
  scene.add(new THREE.GridHelper(6, 12, 0x888888, 0xaaaaaa));
  const g = await new GLTFLoader().loadAsync('assets/characters/ual-mannequin.json');
  const man = g.scene; scene.add(man);
  man.traverse(o => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xc89870, roughness: 0.8 }); });
  const pk = JSON.parse(clipJson), cj = pk.clips ? (pk.clips.find(c => c.name === name) || pk.clips[0]) : pk; const clip = THREE.AnimationClip.parse(cj);
  const mixer = new THREE.AnimationMixer(man); mixer.clipAction(clip).play();
  // source skeleton, scaled to a similar height, placed to the right
  const bvh = new BVHLoader().parse(bvhText);
  const holder = new THREE.Group(); holder.add(bvh.skeleton.bones[0]); scene.add(holder);
  const sh = new THREE.SkeletonHelper(bvh.skeleton.bones[0]); sh.material.linewidth = 3; scene.add(sh);
  holder.updateMatrixWorld(true); { const wl = new THREE.Vector3(), wr = new THREE.Vector3(); bvh.skeleton.getBoneByName('LeftUpLeg').getWorldPosition(wl); bvh.skeleton.getBoneByName('RightUpLeg').getWorldPosition(wr); if (wl.x < wr.x) holder.rotation.y = Math.PI; }
  { const hp = new THREE.Vector3(), fp = new THREE.Vector3(); bvh.skeleton.getBoneByName('Hips').getWorldPosition(hp); bvh.skeleton.getBoneByName('LeftToeBase').getWorldPosition(fp); holder.scale.setScalar(0.917 / (hp.y - fp.y)); }
  holder.position.set(+(globalThis.OVER ? 0 : 1.4), 0, 0); sh.material.depthTest = false; sh.renderOrder = 9;
  const sm = new THREE.AnimationMixer(bvh.skeleton.bones[0]); sm.clipAction(bvh.clip).play();
  sm.setTime(start); holder.updateMatrixWorld(true);
  { const h0 = new THREE.Vector3(); bvh.skeleton.getBoneByName('Hips').getWorldPosition(h0); holder.position.x -= h0.x - holder.position.x; holder.position.z -= h0.z; }
  const cam = new THREE.PerspectiveCamera(40, W / H, 0.1, 50);
  const pos = view === 'side' ? [5, 1.2, 0.4] : view === 'front' ? [0.7, 1.2, 5] : [3.6, 1.6, 3.6];
  cam.position.set(...pos); cam.lookAt(0.7, 0.9, 0);
  const out = [];
  for (let i = 0; i < frames; i++) {
    const t = (clip.duration * i) / Math.max(1, frames - 1);
    mixer.setTime(t); sm.setTime(start + t);
    r.render(scene, cam); out.push(r.domElement.toDataURL('image/png'));
  }
  return out;
}, [fs.readFileSync(CLIP, 'utf8'), fs.readFileSync(BVH, 'utf8'), +START, +FRAMES, VIEW, !!process.env.OVERLAY, NAME]);
shots.forEach((s, i) => fs.writeFileSync(`${OUT}/f${String(i).padStart(2, '0')}.png`, Buffer.from(s.split(',')[1], 'base64')));
console.log('frames', shots.length);
await browser.close();
