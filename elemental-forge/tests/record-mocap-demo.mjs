// Side-by-side recording of the same scripted fight input with the old procedural techniques (left) and the
// retargeted motion-capture techniques (right), seen from a three-quarter side camera so the arms, torso
// and legs are visible. Each element: HAND, HAND, LEG, LEG, then the charged LEG technique.
// Usage: node tests/record-mocap-demo.mjs [baseUrl] [out.mp4] [elements=earth,fire,water,air] [view=side|game]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = path.resolve(process.argv[3] || './mocap-demo.mp4');
const ELS = (process.argv[4] || 'earth,fire,water,air').split(',');
const VIEW = process.argv[5] || 'side';
const TMP = OUT.replace(/\.mp4$/, '') + '-frames';
const FONT = ['/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f));
const ART = { earth: 'EARTH - Hung Gar', fire: 'FIRE - Northern Shaolin', water: 'WATER - Tai Chi', air: 'AIR - Baguazhang' };
// frame -> input, per element segment of 150 frames (5 s)
const PLAN = { press: { 8: 'hand', 30: 'hand', 52: 'leg', 76: 'leg' }, held: [[100, 128, 'leg']], total: 150 };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function record(url, tag) {
  const page = await (await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__EF);
  await page.locator('#btn-start').click();
  const dir = path.join(TMP, tag); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const el of ELS) {
    await page.evaluate(([el, PLAN]) => {
      const E = window.__EF, { player: p, opp: o, world, state, camCtl } = E;
      state.manual = true; window.__plan = PLAN;
      E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); };
      for (let i = 0; i < 20; i++) E.step(1 / 30);
      world.bending.clear();
      for (const f of [p, o]) { f.hp = 100; f.en = 100; f.vel.set(0, 0, 0); f.action = null; f.tech = null; f.dead = false; f.stunT = 0; f.charging = false; f.legHoldT = -1; f.tumble.quaternion.identity(); }
      p.setElement(el, true); o.setElement('earth', true);
      p.pos.set(0, 0, -11); o.pos.set(0, 0, -6.5);
      p.faceYaw = p.yaw = 0; o.faceYaw = o.yaw = Math.PI; camCtl.snapBehind(p); state.locked = true; window.__f = 0;
      for (const k of Object.keys(E.controls.btn)) E.controls.btn[k] = false;
    }, [el, PLAN]);
    for (let f0 = 0; f0 < PLAN.total; f0 += 10) {
      const shots = await page.evaluate(([k, view]) => {
        const E = window.__EF, C = E.controls, P = window.__plan, out = [], cam = E.world.camera;
        for (let i = 0; i < k; i++) {
          const f = window.__f++;
          for (const key of ['hand', 'leg', 'guard', 'special', 'jump', 'dodge']) C.btn[key] = false;
          for (const [a, b, key] of P.held) if (f >= a && f < b) { C.btn[key] = true; if (f === a) C.pressed[key] = true; }
          if (P.press[f]) C.pressed[P.press[f]] = true;
          E.player.en = 100; E.opp.hp = Math.max(E.opp.hp, 60);
          // keep the rival in range so every technique connects
          const pl = E.player, op = E.opp; if (op.pos.distanceTo(pl.pos) > 3.2) { op.pos.lerp(pl.pos, 0.08); }
          E.step(1 / 30);
          if (view === 'side') {   // three-quarter side view, following the fighter
            const p = pl.pos; cam.position.set(p.x + 2.7, p.y + 1.4, p.z - 1.0); cam.lookAt(p.x, p.y + 0.95, p.z + 0.25);
          }
          E.render();
          out.push(document.getElementById('game').toDataURL('image/jpeg', 0.88));
        }
        return out;
      }, [Math.min(10, PLAN.total - f0), VIEW]);
      for (const d of shots) fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64'));
    }
    console.log(tag, el, 'done');
  }
  await page.close();
  if (errors.length) console.log(tag, 'page errors:', errors.join(' | '));
  return dir;
}
const sep = BASE.includes('?') ? '&' : '?';
const before = await record(BASE + sep + 'mocap=0', 'procedural');
const after = await record(BASE, 'mocap');
await browser.close();
const t = (txt, x, y, size = 22) => FONT ? `drawtext=fontfile=${FONT}:text='${txt}':x=${x}:y=${y}:fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black@0.7` : 'null';
const labels = ELS.map((el, i) => t(ART[el], '(w-text_w)/2', 'h-40', 24) + `:enable='between(t,${i * 5},${i * 5 + 5})'`).join(',');
execSync(`ffmpeg -v error -y -framerate 30 -i "${before}/f%04d.jpg" -framerate 30 -i "${after}/f%04d.jpg" -filter_complex "[0]${t('BEFORE - procedural', 14, 12)}[a];[1]${t('AFTER - motion capture', 14, 12)}[b];[a][b]hstack=inputs=2,${labels}" -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart "${OUT}"`);
console.log('wrote', OUT);
