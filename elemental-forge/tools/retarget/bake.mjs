// Bakes BVH motion capture into AnimationClips for the game's mannequin, using headless Chromium + three.js.
// Usage: node tools/retarget/bake.mjs <baseUrl> <spec.json> <bvhDir> <out.json> [--only name] [--keep-heading]
// spec.json: [{ "name", "bvh": "135_07.bvh", "start", "end", "mirror", "noRise", "impact" }, ...]
// Every clip is baked as given and, unless "mirror" is set explicitly, also mirrored as "<name>_M".
// Output is one JSON pack { clips: [AnimationClip.toJSON + {impact}] }, values rounded to 4 decimals.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const args = process.argv.slice(2);
const [BASE, SPEC, DIR, OUT] = args;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const keep = args.includes('--keep-heading');
let spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
if (only) spec = spec.filter(s => s.name === only);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.error('page error', e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
const texts = {};
for (const s of spec) texts[s.bvh] ??= fs.readFileSync(path.join(DIR, s.bvh), 'utf8');
const pack = await page.evaluate(async ([spec, texts, keep]) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { retargetBVH } = await import('./tools/retarget/retarget.js');
  const g = await new GLTFLoader().loadAsync('assets/characters/ual-mannequin.json');
  const out = [];
  const one = (s, name, mirror) => {
    const clip = retargetBVH(texts[s.bvh], g.scene, { name, start: s.start, end: s.end, fps: 30, mirror, noRise: !!s.noRise, keepHeading: keep, inPlace: !keep });
    const j = THREE.AnimationClip.toJSON(clip);
    for (const t of j.tracks) { t.times = Array.from(t.times, v => +v.toFixed(4)); t.values = Array.from(t.values, v => +v.toFixed(4)); }
    if (s.impact !== undefined) j.impact = +(s.impact - (s.start || 0)).toFixed(3);
    if (s.limb) j.limb = mirror !== !!s.mirror ? s.limb[0] + (s.limb[1] === 'L' ? 'R' : 'L') : s.limb;
    j.src = s.bvh + ' ' + s.start + '-' + s.end + (mirror ? ' mirrored' : '');
    out.push(j);
  };
  for (const s of spec) { one(s, s.name, !!s.mirror); if (s.mirror === undefined) one(s, s.name + '_M', true); }
  return out;
}, [spec, texts, keep]);
const json = JSON.stringify({ source: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), retargeted by tools/retarget', clips: pack });
fs.writeFileSync(OUT, json);
console.log('wrote', OUT, pack.length, 'clips', (json.length / 1024).toFixed(0) + ' KB');
await browser.close();
