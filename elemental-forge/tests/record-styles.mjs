// Records one clip per element with the same scripted input, so the four martial-arts styles can be
// compared directly: stance, strafing run, HAND/LEG combinations, sustained bending while moving,
// launching held objects, SPECIAL, guarding an incoming attack and the charged technique.
// The game is advanced in exact 1/30 s steps and the WebGL canvas captured every frame (true game speed;
// the HTML HUD is not part of the canvas). The rival stands passive for clarity and fires one projectile.
// Usage: node tests/record-styles.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = path.resolve(process.argv[3] || './style-videos');
fs.mkdirSync(OUT, { recursive: true });
const FONT = ['/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 890, height: 412 }, deviceScaleFactor: 1 })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF);
await page.locator('#btn-start').click();

// timeline (frame -> input); shared by all elements
const PLAN = `({
  press: { 75: 'hand', 87: 'hand', 102: 'leg', 120: 'leg', 196: 'hand', 210: 'leg', 222: 'special', 238: 'special', 254: 'special' },
  held: [[130, 185, 'hand'], [268, 292, 'guard'], [298, 322, 'leg']],
  stick: [[30, 75, [1, 0.15]], [130, 185, [-0.75, 0]], [188, 196, [0, 0]]],
  fire: 272, total: 345 })`;
const LABEL = { earth: 'EARTH - Hung Gar', fire: 'FIRE - Northern Shaolin', water: 'WATER - Tai Chi Chuan', air: 'AIR - Baguazhang' };
const clips = [];
for (const el of ['earth', 'fire', 'water', 'air']) {
  const FR = path.join(OUT, 'frames-' + el);
  fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR);
  await page.evaluate(([el, PLAN]) => {
    const E = window.__EF, { player: p, opp: o, world, state, camCtl } = E;
    state.manual = true; window.__plan = eval(PLAN);
    E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); };
    for (let i = 0; i < 45; i++) E.step(1 / 30);
    world.bending.clear();
    for (const f of [p, o]) { f.hp = 100; f.en = 100; f.vel.set(0, 0, 0); f.action = null; f.dead = false; f.stunT = 0; f.tumble.quaternion.identity(); }
    p.setElement(el, true); o.setElement(el === 'fire' ? 'water' : 'fire', true);
    p.pos.set(el === 'water' ? 19 : 0, 0, el === 'water' ? -13 : -11); o.pos.set(p.pos.x, 0, p.pos.z + 7.5);
    p.faceYaw = p.yaw = 0; camCtl.snapBehind(p); state.locked = true; window.__f = 0;
  }, [el, PLAN]);
  const total = 345;
  for (let f0 = 0; f0 < total; f0 += 10) {
    const shots = await page.evaluate((n) => {
      const E = window.__EF, C = E.controls, P = window.__plan, out = [];
      for (let k = 0; k < n; k++) {
        const f = window.__f++;
        C.stick.x = 0; C.stick.y = 0;
        for (const [a, b, v] of P.stick) if (f >= a && f < b) { C.stick.x = v[0]; C.stick.y = v[1]; }
        for (const key of ['hand', 'leg', 'guard', 'special', 'jump', 'dodge']) C.btn[key] = false;
        for (const [a, b, key] of P.held) if (f >= a && f < b) { C.btn[key] = true; if (f === a) C.pressed[key] = true; }
        if (P.press[f]) C.pressed[P.press[f]] = true;
        if (f === P.fire) { const { world, opp, player } = E; E.opp.en = 100; world.bending.fire(opp.el === 'fire' ? 'fireball' : 'water', opp, opp.chestPos().add(opp.forward().multiplyScalar(0.8)), { target: player.chestPos() }); }
        if (E.player.en < 40) E.player.en = 100;   // keep the demo flowing
        E.opp.hp = Math.max(E.opp.hp, 60);
        E.step(1 / 30); E.render();
        out.push(document.getElementById('game').toDataURL('image/jpeg', 0.85));
      }
      return out;
    }, Math.min(10, total - f0));
    shots.forEach((d, i) => fs.writeFileSync(path.join(FR, `f${String(f0 + i).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
  }
  const clip = path.join(OUT, `style-${el}.mp4`);
  const text = FONT ? `,drawtext=fontfile=${FONT}:text='${LABEL[el]}':x=18:y=16:fontsize=26:fontcolor=white:borderw=3:bordercolor=black@0.7` : '';
  execSync(`ffmpeg -v error -y -framerate 30 -i "${FR}/f%04d.jpg" -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2${text}" -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart "${clip}"`);
  clips.push(clip);
  console.log('clip', el, 'done');
}
fs.writeFileSync(path.join(OUT, 'list.txt'), clips.map(c => `file '${c}'`).join('\n'));
execSync(`ffmpeg -v error -y -f concat -safe 0 -i "${path.join(OUT, 'list.txt')}" -c copy "${path.join(OUT, 'four-styles.mp4')}"`);
await browser.close();
console.log('wrote', path.join(OUT, 'four-styles.mp4'), errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
