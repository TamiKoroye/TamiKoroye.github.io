// Per-frame body metrics for baked clips on the mannequin: hand reach (wrist to shoulder, metres), foot height,
// hips height, hips yaw (deg). Prints a compact timeline and detected peaks to help choose segments and impact frames.
// Usage: node tools/retarget/measure.mjs <baseUrl> <pack.json> [name,name...] [step=0.1]
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const [BASE, PACK, NAMES, STEP = '0.1'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext()).newPage();
await page.goto(BASE); await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
const res = await page.evaluate(async ([packText, names, step]) => {
  const THREE = await import('three'); const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const g = await new GLTFLoader().loadAsync('assets/characters/ual-mannequin.json'); const man = g.scene;
  const B = {}; man.traverse(o => { if (o.isBone) B[o.name] = o; });
  const P = (n) => B[n].getWorldPosition(new THREE.Vector3());
  const pk = JSON.parse(packText), out = {};
  for (const cj of pk.clips) {
    if (names && !names.includes(cj.name)) continue;
    const { unpack } = await import('./js/mocap.js'); const clip = cj.q ? unpack(cj, pk.fps || 30) : THREE.AnimationClip.parse(cj), mixer = new THREE.AnimationMixer(man); mixer.clipAction(clip).play();
    const rows = [];
    for (let t = 0; t <= clip.duration + 1e-6; t += step) {
      mixer.setTime(Math.min(t, clip.duration - 1e-4)); man.updateMatrixWorld(true);
      const q = B['DEF-hips'].getWorldQuaternion(new THREE.Quaternion()); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      // reach is measured forward of the chest as well as straight-line extension
      const chest = P('DEF-spine003');
      rows.push([+t.toFixed(2), +P('DEF-handL').distanceTo(P('DEF-upper_armL')).toFixed(2), +P('DEF-handR').distanceTo(P('DEF-upper_armR')).toFixed(2),
        +(P('DEF-footL').y - 0.08).toFixed(2), +(P('DEF-footR').y - 0.08).toFixed(2), +P('DEF-hips').y.toFixed(2), Math.round(Math.atan2(f.x, f.z) * 57.3),
        +(P('DEF-handL').z - chest.z).toFixed(2), +(P('DEF-handR').z - chest.z).toFixed(2), +P('DEF-handL').y.toFixed(2), +P('DEF-handR').y.toFixed(2)]);
    }
    mixer.stopAllAction(); out[cj.name] = { dur: clip.duration, rows };
  }
  return out;
}, [fs.readFileSync(PACK, 'utf8'), NAMES ? NAMES.split(',') : null, +STEP]);
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(res));
for (const [n, { dur, rows }] of Object.entries(res)) {
  if (process.env.JSON) continue;
  console.log(`\n## ${n} (${dur.toFixed(2)} s)  t: reachL/R  footL/R  hipsY  yaw  fwdL/R handYL/R`);
  console.log(rows.map(r => `${r[0]}:${r[1]}/${r[2]} ${r[3]}/${r[4]} ${r[5]} ${r[6]} ${r[7]}/${r[8]} ${r[9]}/${r[10]}`).join(' | '));
}
await browser.close();
