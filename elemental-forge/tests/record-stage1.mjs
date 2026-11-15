// Stage 1 evidence: the same scripted input for each element, recorded at normal game speed (exact 1/30 s steps).
//   pass "body": elemental effects hidden, close three-quarter side camera, so the body movement itself is visible
//   pass "game": full effects, the normal gameplay camera
// Script per element (7 s): stance, step in, HAND, HAND, LEG, LEG, SPECIAL, hold HAND (sustained bending),
// GUARD while the rival punches, take a hit, charged LEG.
// Usage: node tests/record-stage1.mjs [baseUrl] [outDir] [elements] [passes=body,game]
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = path.resolve(process.argv[3] || './stage1'); fs.mkdirSync(OUT, { recursive: true });
const ELS = (process.argv[4] || 'earth,fire,water,air').split(',');
const PASSES = (process.argv[5] || 'body,game').split(',');
const FONT = ['/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f));
const ART = { earth: 'EARTH - Hung Gar', fire: 'FIRE - Northern Shaolin', water: 'WATER - Tai Chi', air: 'AIR - Baguazhang' };
const PLAN = {
  total: 225,
  press: { 30: 'hand', 52: 'hand', 74: 'leg', 98: 'leg', 124: 'special' },
  held: [[150, 175, 'hand'], [178, 196, 'guard'], [198, 222, 'leg']],
  stick: [[12, 26, [0, 0.55]]],
  oppHand: [184],                           // the rival punches into the guard
  labels: [[0, 'stance'], [30, 'HAND x2'], [74, 'LEG x2'], [124, 'SPECIAL'], [150, 'sustained HAND'], [178, 'GUARD'], [198, 'charged LEG']],
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 760, height: 428 }, deviceScaleFactor: 1 })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF);
await page.locator('#btn-start').click();
const outs = [];
for (const pass of PASSES) for (const el of ELS) {
  const dir = path.join(OUT, `${pass}-${el}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  await page.evaluate(([el, PLAN]) => {
    const E = window.__EF, { player: p, opp: o, world, state, camCtl } = E;
    state.manual = true; window.__plan = PLAN; window.__f = 0;
    E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); if (window.__oppHand) { i.hand = true; window.__oppHand = false; } };
    for (let i = 0; i < 20; i++) E.step(1 / 30);
    world.bending.clear();
    for (const f of [p, o]) { f.hp = 100; f.en = 100; f.vel.set(0, 0, 0); f.action = null; f.tech = null; f.dead = false; f.stunT = 0; f.charging = false; f.holding = false; f.legHoldT = -1; f.handHoldT = -1; f.tumble.quaternion.identity(); if (f.ext) f.ext.set(0, 0, 0); }
    p.setElement(el, true); o.setElement(el === 'earth' ? 'fire' : 'earth', true);
    const x = el === 'water' ? 12 : 0, z = el === 'water' ? -10 : -11;
    p.pos.set(x, 0, z); o.pos.set(x, 0, z + 5.2);
    p.faceYaw = p.yaw = 0; o.faceYaw = o.yaw = Math.PI; camCtl.snapBehind(p); state.locked = true;
    for (const k of Object.keys(E.controls.btn)) E.controls.btn[k] = false;
    // body pass: everything except the arena, the fighters and the lights is hidden while rendering
    window.__keep = new Set([world.arena.group, p.root, o.root]); world.scene.traverse(c => { if (c.isLight) window.__keep.add(c); });
  }, [el, PLAN]);
  for (let f0 = 0; f0 < PLAN.total; f0 += 15) {
    const shots = await page.evaluate(([k, pass]) => {
      const E = window.__EF, C = E.controls, P = window.__plan, out = [], cam = E.world.camera, pl = E.player, op = E.opp;
      for (let i = 0; i < k; i++) {
        const f = window.__f++;
        C.stick.x = 0; C.stick.y = 0;
        for (const [a, b, v] of P.stick) if (f >= a && f < b) { C.stick.x = v[0]; C.stick.y = v[1]; }
        for (const key of ['hand', 'leg', 'guard', 'special', 'jump', 'dodge']) C.btn[key] = false;
        for (const [a, b, key] of P.held) if (f >= a && f < b) { C.btn[key] = true; if (f === a) C.pressed[key] = true; }
        if (P.press[f]) C.pressed[P.press[f]] = true;
        if (P.oppHand.includes(f)) { window.__oppHand = true; op.pos.set(pl.pos.x, 0, pl.pos.z + 1.6); }
        pl.en = 100; op.hp = Math.max(op.hp, 60); pl.hp = Math.max(pl.hp, 60);
        // keep the rival at a sensible distance so techniques connect and stay in frame
        const d = op.pos.distanceTo(pl.pos); if (d > 4.2) op.pos.lerp(pl.pos, 0.06); if (d < 1.2) op.pos.addScaledVector(op.pos.clone().sub(pl.pos).setY(0).normalize(), 0.05);
        E.step(1 / 30);
        let hidden = [];
        if (pass === 'body') {
          const p = pl.pos; cam.position.set(p.x + 3.1, p.y + 1.45, p.z + 1.2); cam.lookAt(p.x, p.y + 0.95, p.z + 0.9);
          for (const c of E.world.scene.children) if (c.visible && !window.__keep.has(c)) { c.visible = false; hidden.push(c); }
        }
        E.render();
        for (const c of hidden) c.visible = true;
        out.push(document.getElementById('game').toDataURL('image/jpeg', 0.88));
      }
      return out;
    }, [Math.min(15, PLAN.total - f0), pass]);
    shots.forEach((d, i) => fs.writeFileSync(path.join(dir, `f${String(f0 + i).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
  }
  const clip = path.join(OUT, `${pass}-${el}.mp4`);
  const lab = PLAN.labels.map(([f, t], i) => { const e = (PLAN.labels[i + 1] ? PLAN.labels[i + 1][0] : PLAN.total) / 30; return `drawtext=fontfile=${FONT}:text='${t}':x=w-text_w-16:y=14:fontsize=22:fontcolor=white:borderw=3:bordercolor=black@0.7:enable='between(t,${f / 30},${e})'`; }).join(',');
  const title = `drawtext=fontfile=${FONT}:text='${ART[el]}${pass === 'body' ? ' - body only (effects hidden)' : ''}':x=16:y=14:fontsize=22:fontcolor=white:borderw=3:bordercolor=black@0.7`;
  execSync(`ffmpeg -v error -y -framerate 30 -i "${dir}/f%04d.jpg" -vf "${title},${lab}" -c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart "${clip}"`);
  outs.push(clip); console.log('clip', pass, el);
}
fs.writeFileSync(path.join(OUT, 'list.txt'), outs.map(c => `file '${c}'`).join('\n'));
execSync(`ffmpeg -v error -y -f concat -safe 0 -i "${path.join(OUT, 'list.txt')}" -c copy "${path.join(OUT, 'stage1-all.mp4')}"`);
await browser.close();
console.log('wrote', path.join(OUT, 'stage1-all.mp4'), errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
