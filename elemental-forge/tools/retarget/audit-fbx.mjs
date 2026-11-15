// Inventory of FBX animation files: clip names, duration, frame rate, skeleton, root motion, fingers, skin, FBX creator.
// Usage: node tools/retarget/audit-fbx.mjs <baseUrl> <dir served under baseUrl> <out.json>
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const [BASE, DIR, OUT] = process.argv.slice(2);
const local = path.resolve(DIR);
const files = fs.readdirSync(local).filter(f => /\.fbx$/i.test(f)).sort();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.error('page error', e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
const out = [];
for (const f of files) {
  // FBX header text: creator / application (binary FBX keeps these as plain strings)
  const buf = fs.readFileSync(path.join(local, f)); const txt = buf.toString('latin1');
  const creator = (txt.match(/FBX SDK\/FBX Plugins version [\d.]+|Mixamo|Rokoko[^\0]{0,40}|Blender[^\0]{0,20}|MotionBuilder|Maya/g) || []).slice(0, 3);
  const r = await page.evaluate(async (url) => {
    const THREE = await import('three'); const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    let g; try { g = await new FBXLoader().loadAsync(url); } catch (e) { return { error: String(e) }; }
    const bones = []; let skinned = 0, verts = 0;
    g.traverse(o => { if (o.isBone) bones.push(o.name); if (o.isSkinnedMesh) { skinned++; verts += o.geometry.attributes.position.count; } });
    const clips = g.animations.map(c => {
      let maxKeys = 0, fps = 0; const hip = c.tracks.find(t => /hips\.position$/i.test(t.name) || /Hips\.position$/.test(t.name));
      for (const t of c.tracks) { if (t.times.length > maxKeys) { maxKeys = t.times.length; fps = t.times.length > 1 ? (t.times.length - 1) / (t.times[t.times.length - 1] - t.times[0]) : 0; } }
      let travel = null;
      if (hip) { const v = hip.values, n = v.length / 3; travel = { dx: +(v[(n - 1) * 3] - v[0]).toFixed(1), dy: +(v[(n - 1) * 3 + 1] - v[1]).toFixed(1), dz: +(v[(n - 1) * 3 + 2] - v[2]).toFixed(1), y0: +v[1].toFixed(1) }; }
      const fingerTracks = c.tracks.filter(t => /Thumb|Index|Middle|Ring|Pinky|finger/i.test(t.name)).length;
      return { name: c.name, duration: +c.duration.toFixed(2), fps: +fps.toFixed(1), tracks: c.tracks.length, fingerTracks, hipTravel: travel };
    });
    const hipsBone = bones.find(b => /hips/i.test(b));
    return { bones: bones.length, prefix: (hipsBone || '').replace(/Hips$/i, ''), sample: bones.slice(0, 6), hasFingers: bones.some(b => /Thumb|Index|finger/i.test(b)), skinned, verts, clips, scale: g.scale.x };
  }, BASE + DIR.replace(/^\.\//, '') + '/' + encodeURIComponent(f));
  out.push({ file: f, bytes: buf.length, creator: [...new Set(creator)], ...r });
  console.log(f, JSON.stringify(r).slice(0, 300));
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close();
