// Defence demonstration at normal game speed: (1) water wall douses a fireball, (2) a boulder breaks through the
// water wall at reduced force, (3) GUARD + SPECIAL freezes the wall into ice that stays and blocks, (4) rotating
// streams stop an attack from behind, (5) a perfectly timed guard redirects a fireball into the thrower.
// Usage: node tests/record-defence.mjs [baseUrl] [out.mp4]
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/', OUT = path.resolve(process.argv[3] || './defence.mp4'), DIR = OUT.replace(/\.mp4$/, '-frames');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const FONT = ['/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 760, height: 428 } })).newPage();
await page.goto(BASE); await page.waitForFunction(() => window.__EF); await page.locator('#btn-start').click();
await page.evaluate(() => { const E = window.__EF; E.state.manual = true; E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; for (let i = 0; i < 30; i++) E.step(1 / 30); });
const scenes = [
  ['Water wall douses a fireball', 75], ['A boulder breaks through the water wall (half damage)', 75],
  ['GUARD + SPECIAL: the wall freezes into ice, which stays and blocks', 110], ['Rotating streams stop an attack from behind', 80], ['Perfect guard redirects a fireball into the thrower', 75]];
let n = 0; const labels = [];
for (let si = 0; si < scenes.length; si++) {
  const [title, frames] = scenes[si]; labels.push([n, n + frames, title]);
  for (let f0 = 0; f0 < frames; f0 += 15) {
    const shots = await page.evaluate(([si, f0, k]) => {
      const E = window.__EF, V = E.player.pos.constructor, p = E.player, o = E.opp, B = E.world.bending, C = E.controls, out = [];
      const fire = (kind, from, at) => B.fire(kind, o, new V(...from), { target: at || p.chestPos() });
      for (let i = 0; i < k; i++) {
        const f = f0 + i;
        if (f === 0) {
          B.clear(); for (const x of [p, o]) { x.hp = 100; x.en = 100; x.vel.set(0, 0, 0); x.action = null; x.tech = null; x.guarding = false; x.dead = false; x.stunT = 0; x.guardCd = 0; x.holding = false; }
          p.setElement('water', true); o.setElement(si === 1 ? 'earth' : 'fire', true); p.pos.set(0, 0, -12); o.pos.set(0, 0, -5); p.faceYaw = p.yaw = 0; o.faceYaw = o.yaw = Math.PI;
          E.state.locked = true; E.camCtl.snapBehind(p); for (const key of Object.keys(C.btn)) C.btn[key] = false;
          if (si === 3) { for (let j = 0; j < 2; j++) B.spawn('water', p, p.pos.clone().setY(1.2), 'orbit'); }
        }
        if (si !== 4) C.btn.guard = f > 8 && (si !== 2 || f < 70);
        if (si === 0 && f === 22) fire('fireball', [0, 1.3, -5.6]);
        if (si === 1 && f === 22) fire('boulder', [0, 1.3, -5.6]);
        if (si === 2 && f === 24) C.pressed.special = true;
        if (si === 2 && (f === 50 || f === 85)) fire('fireball', [0, 1.3, -5.6]);
        if (si === 3 && f === 26) fire('fireball', [0.5, 1.3, -18], p.chestPos());
        if (si === 4) { if (f === 15) window.__pf = fire('fireball', [0, 1.3, -5.6]); const b = window.__pf; C.btn.guard = !!(b && f > 15 && b.pos.distanceTo(p.chestPos()) < 3.2) || C.btn.guard; }
        if (si === 3) { const c = E.world.camera; }
        E.step(1 / 30);
        if (si === 3) { const c = E.world.camera; c.position.set(p.pos.x + 3.6, 2.4, p.pos.z - 1.5); c.lookAt(p.pos.x, 1.0, p.pos.z - 0.8); }
        E.render(); out.push(document.getElementById('game').toDataURL('image/jpeg', 0.88));
      }
      return out;
    }, [si, f0, Math.min(15, frames - f0)]);
    for (const d of shots) fs.writeFileSync(path.join(DIR, `f${String(n++).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64'));
  }
}
const lab = labels.map(([a, b, t]) => `drawtext=fontfile=${FONT}:text='${t.replace(/[:']/g, '')}':x=16:y=14:fontsize=21:fontcolor=white:borderw=3:bordercolor=black@0.7:enable='between(t,${a / 30},${b / 30})'`).join(',');
execSync(`ffmpeg -v error -y -framerate 30 -i "${DIR}/f%04d.jpg" -vf "${lab}" -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart "${OUT}"`);
await browser.close(); console.log('wrote', OUT);
