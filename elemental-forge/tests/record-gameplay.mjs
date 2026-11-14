// Records a gameplay demonstration at true game speed.
// The headless test browser renders slowly, so the game is advanced in exact 1/30 s steps and every
// frame is captured from the WebGL canvas (the HTML HUD overlay is not included), then encoded to a 30 fps MP4 with ffmpeg. Player inputs are
// scripted through the same control state the touch UI writes; the opponent is the real AI (Normal).
// Usage: node tests/record-gameplay.mjs [baseUrl] [out.mp4]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = path.resolve(process.argv[3] || './gameplay.mp4');
const FR = path.join(path.dirname(OUT), 'frames-' + path.basename(OUT, '.mp4'));
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF);
await page.locator('#btn-start').click();
await page.evaluate(() => { const E = window.__EF; E.state.manual = true; E.controls.touchUsed = true; E.state.locked = false; });

// Director: decides inputs per frame from live game state (no teleporting once recording starts).
let frame = 0;
const plan = [];
const at = (from, to, fn) => plan.push({ from, to, fn });
// 0-4 s: free movement: run, auto-sprint, sweeping turn, stop
at(0, 45, (s, c) => { c.stick = [0, 1]; });
at(45, 110, (s, c) => { c.stick = [0.75, 0.66]; });
at(110, 130, (s, c) => { c.stick = [-0.6, 0.8]; });
at(130, 150, (s, c) => { c.stick = [0, 0]; });
// lock on and close the distance, strafing in
at(150, 151, (s, c) => { c.press.push('lock'); });
at(151, 400, (s, c) => { if (s.dist > 3.0) c.stick = [s.f % 120 < 60 ? 0.45 : -0.45, 1]; else c.stick = [0, 0]; });
// melee exchange: combo, sidestep, combo, back off, rock throw
at(400, 470, (s, c) => { if (s.dist > 2.2) c.stick = [0, 1]; if (s.f % 9 === 0) c.press.push('attack'); });
at(470, 480, (s, c) => { c.stick = [1, 0]; if (s.f === 472) c.press.push('dodge'); });
at(480, 540, (s, c) => { if (s.dist > 2.0) c.stick = [0, 1]; if (s.f % 9 === 0) c.press.push('attack'); });
at(540, 575, (s, c) => { c.stick = [0, -1]; if (s.f === 545) c.press.push('dodge'); });
at(575, 610, (s, c) => { c.stick = [-0.7, 0]; if (s.f === 580) c.press.push('bend'); });
at(610, 660, (s, c) => { c.stick = [0.7, 0]; c.held.push('guard'); });
// heavy palm, then a full-charge slam
at(660, 720, (s, c) => { if (s.dist > 2.2) c.stick = [0, 1]; else if (s.f >= 690 && s.f < 703) c.held.push('attack'); if (s.f === 690) c.press.push('attack'); });
at(720, 800, (s, c) => { if (s.dist > 2.4 && s.f < 745) c.stick = [0, 1]; if (s.f >= 745 && s.f < 775) c.held.push('attack'); if (s.f === 745) c.press.push('attack'); });
at(800, 860, (s, c) => { c.stick = [0, -0.4]; });
// rock barrage while circling, ending with a jump and roll
at(860, 1000, (s, c) => { c.stick = [s.f < 930 ? 1 : -1, 0.15]; if (s.f % 22 === 0) c.press.push('bend'); });
at(1000, 1060, (s, c) => { c.stick = [0, 1]; if (s.f === 1005) c.press.push('jump'); if (s.f === 1030) c.press.push('dodge'); });
const TOTAL = 1060;

// Install the plan in the page (functions are sent as source) and capture the WebGL canvas in batches.
await page.evaluate((src) => { window.__plan = src.map(([from, to, f]) => ({ from, to, fn: eval('(' + f + ')') })); }, plan.map(p => [p.from, p.to, p.fn.toString()]));
const BATCH = 10;
for (frame = 0; frame < TOTAL; frame += BATCH) {
  const shots = await page.evaluate(([start, n]) => {
    const E = window.__EF, C = E.controls, out = [];
    for (let f = start; f < start + n; f++) {
      const { player, opp } = E;
      const st = { dist: Math.hypot(opp.pos.x - player.pos.x, opp.pos.z - player.pos.z), f };
      const c = { stick: [0, 0], press: [], held: [] };
      for (const p of window.__plan) if (f >= p.from && f < p.to) p.fn(st, c);
      C.stick.x = c.stick[0]; C.stick.y = c.stick[1];
      for (const k of ['attack', 'bend', 'guard', 'jump', 'dodge']) C.btn[k] = c.held.includes(k) || (k === 'bend' && c.press.includes('bend'));
      for (const k of c.press) C.pressed[k] = true;
      E.step(1 / 30); E.render();
      out.push(document.getElementById('game').toDataURL('image/jpeg', 0.82)); // same task as render: buffer still valid
    }
    return out;
  }, [frame, Math.min(BATCH, TOTAL - frame)]);
  shots.forEach((d, i) => fs.writeFileSync(path.join(FR, `f${String(frame + i).padStart(5, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
  if (frame % 100 === 0) process.stdout.write(`frame ${frame}/${TOTAL}\n`);
}
const summary = await page.evaluate(() => ({ playerHp: window.__EF.player.hp, rivalHp: window.__EF.opp.hp, hits: window.__EF.player.stats, phase: window.__EF.state.phase }));
await browser.close();
execSync(`ffmpeg -v error -y -framerate 30 -i "${FR}/f%05d.jpg" -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "${OUT}"`);
console.log('wrote', OUT, JSON.stringify(summary), errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
