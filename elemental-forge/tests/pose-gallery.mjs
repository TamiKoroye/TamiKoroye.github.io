// Renders close-up stills of the fighter's procedural poses for visual inspection.
// Usage: node tests/pose-gallery.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 400 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE); await page.waitForFunction(() => window.__EF);
await page.locator('#btn-start').click();
await page.waitForTimeout(800);
const poses = [
  ['idle', null, 0, 0], ['run', null, 0.9, 1.2], ['run2', null, 0.9, 2.8], ['strafe', null, 0.7, 1.0],
  ['jab', 'jab', 0.45, 0], ['cross', 'cross', 0.45, 0], ['kick', 'kick', 0.5, 0], ['raise', 'raise', 0.9, 0],
  ['throw', 'throw', 0.45, 0], ['guard', 'GUARD', 0, 0], ['hold', 'HOLD', 0, 0], ['air', 'AIR', 0, 0], ['dodge', 'DODGE', 0, 0], ['hit', 'hit', 0.5, 0],
];
for (const [name, act, a, b] of poses) {
  await page.evaluate(([name, act, a, b]) => {
    const { world, player, opp, state } = window.__EF;
    state.paused = true; document.getElementById('hud').classList.add('hidden');
    opp.root.visible = false;
    const p = player; p.pos.set(0, 0.16, -10); p.yaw = p.faceYaw = 0; p.spinYaw = 0; p.vel.set(0, 0, 0);
    p.onGround = true; p.guarding = act === 'GUARD'; p.holding = act === 'HOLD'; p.dodgeT = act === 'DODGE' ? 0.25 : 0; p.dead = false;
    p.speedNorm = 0; p.action = null; p.moveLocal.set(0, 1);
    if (name.startsWith('run')) { p.speedNorm = a; p.runPhase = b; p.vel.set(0, 0, 6); }
    if (name === 'strafe') { p.speedNorm = a; p.runPhase = b; p.moveLocal.set(1, 0); p.vel.set(6, 0, 0); }
    if (act === 'AIR') { p.onGround = false; p.vel.y = 1; }
    if (act && act === act.toLowerCase()) { p.action = act; }
    const dur = { jab: 0.3, cross: 0.32, kick: 0.6, raise: 0.32, throw: 0.36, hit: 0.34 }[act] || 1;
    for (let i = 0; i < 60; i++) { if (p.action) p.actionT = a * dur; p.animate(1 / 30); }
    if (act === 'DODGE') { p.dodgeDir.set(0, 0, 1); }
    p.root.position.copy(p.pos); p.root.rotation.y = p.yaw;
    const cam = world.camera; cam.position.set(2.6, 1.6, -7.6); cam.lookAt(0, 1.0, -10); cam.aspect = 480 / 400; cam.fov = 45; cam.updateProjectionMatrix();
  }, [name, act, a, b]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/pose-${name}.png` });
}
await browser.close();
console.log('done');
