// Renders each element's martial-arts style side by side: stance, run, hand, kicks, charged move,
// sustained hold, guard and special, all on the same skeleton. Output: style-<element>-<pose>.png
// Usage: node tests/style-gallery.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './style-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 360, height: 400 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE); await page.waitForFunction(() => window.__EF);
await page.locator('#btn-start').click(); await page.waitForTimeout(600);
// [label, kind, technique key / variant, progress]
const POSES = [['stance', 'idle'], ['run', 'run'], ['hand', 'tech', 'hand', 0.38], ['kick', 'tech', 'leg0', 0.48], ['kick2', 'tech', 'leg1', 0.45],
  ['charged', 'tech', 'charged', 0.5], ['hold', 'hold'], ['guard', 'guard'], ['special', 'tech', 'special', 0.5]];
for (const el of ['earth', 'fire', 'water', 'air']) for (const [label, kind, key, u] of POSES) {
  await page.evaluate(([el, kind, key, u]) => {
    const { world, player: p, opp, state } = window.__EF;
    state.paused = true; document.getElementById('hud').classList.add('hidden'); document.getElementById('rotate').classList.remove('armed'); opp.root.visible = false;
    p.setElement(el, true);
    p.pos.set(0, 0, -10); p.yaw = p.faceYaw = 0; p.spinYaw = 0; p.vel.set(0, 0, 0); p.bank = 0; p.accLean = 0; p.onGround = true;
    p.guarding = kind === 'guard'; p.holding = kind === 'hold'; p.charging = false; p.dodgeT = 0; p.action = null; p.tech = null; p.speedNorm = 0; p.moveLocal.set(0, 1); p.holdPh = 0.3;
    if (kind === 'run') { p.speedNorm = 1.0; p.runPhase = 1.2; }
    let def = null;
    if (kind === 'tech') { const T = p.style.tech; def = key === 'leg0' ? T.leg[0] : key === 'leg1' ? T.leg[1] : T[key]; p.action = 'tech'; p.tech = def; p.techSide = 1; }
    for (let i = 0; i < 70; i++) { if (def) { p.actionT = u * def.dur; if (def.spin) p.spinYaw = def.spin[2] * Math.PI * 2 * Math.min(1, Math.max(0, (u - def.spin[0]) / (def.spin[1] - def.spin[0]))); } p.time += 1 / 30; p.animate(1 / 30); }
    p.yaw = p.faceYaw + p.spinYaw; p.root.position.copy(p.pos); p.root.rotation.y = p.yaw;
    if (p.hero) { p.hero.wU = p.hero.wL = 1; p.root.updateMatrixWorld(true); for (let i = 0; i < 4; i++) p.hero.update(1 / 30); }
    const cam = world.camera; cam.position.set(2.7, 1.5, -7.4); cam.lookAt(0, 0.95, -10); cam.aspect = 0.9; cam.fov = 42; cam.updateProjectionMatrix();
  }, [el, kind, key, u]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/style-${el}-${label}.png` });
}
await browser.close();
console.log('done');
