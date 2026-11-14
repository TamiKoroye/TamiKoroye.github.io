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
  ['idle', null, 0, 0], ['walk', null, 0.4, 1.2], ['run', null, 0.95, 1.2], ['sprint', null, 1.42, 1.3], ['strafe', null, 0.7, 1.0],
  ['jab', 'jab', 0.42, 0], ['cross', 'cross', 0.42, 0], ['kick', 'kick', 0.5, 0], ['heavy', 'heavy', 0.52, 0], ['charge', 'CHARGE', 0, 0],
  ['slam-up', 'slam', 0.33, 0], ['slam-down', 'slam', 0.6, 0], ['counter', 'counter', 0.35, 0], ['raise', 'raise', 0.9, 0], ['throw', 'throw', 0.42, 0],
  ['guard', 'GUARD', 0, 0], ['hold', 'HOLD', 0, 0], ['air', 'AIR', 0, 0], ['roll', 'DODGE', 0.4, 'roll'], ['sidestep', 'DODGE', 0.5, 'side'],
  ['backstep', 'DODGE', 0.5, 'back'], ['hit', 'hit', 0.5, 0], ['stagger', 'stagger', 0.35, 0], ['down', 'down', 0.8, 0], ['getup', 'getup', 0.3, 0],
];
for (const [name, act, a, b] of poses) {
  await page.evaluate(([name, act, a, b]) => {
    const { world, player, opp, state } = window.__EF;
    state.paused = true; document.getElementById('hud').classList.add('hidden');
    opp.root.visible = false;
    const p = player; p.pos.set(0, 0, -10); p.yaw = p.faceYaw = 0; p.spinYaw = 0; p.vel.set(0, 0, 0); p.prevVel.set(0, 0, 0); p.bank = 0; p.accLean = 0;
    p.onGround = true; p.guarding = act === 'GUARD'; p.holding = act === 'HOLD'; p.charging = act === 'CHARGE'; p.chargeT = 0.8; p.dead = false;
    p.dodgeT = 0; p.speedNorm = 0; p.action = null; p.moveLocal.set(0, 1); p.koDir = null; p.tumble.position.y = 0.6;
    if (['walk', 'run', 'sprint'].includes(name)) { p.speedNorm = a; p.runPhase = b; }
    if (name === 'strafe') { p.speedNorm = a; p.runPhase = b; p.moveLocal.set(1, 0); }
    if (act === 'AIR') { p.onGround = false; p.vel.y = 1; }
    if (act === 'DODGE') { p.dodgeKind = b; p.dodgeDur = { roll: 0.42, side: 0.26, back: 0.3 }[b]; p.dodgeDir.set(b === 'side' ? 1 : 0, 0, b === 'back' ? -1 : 1); }
    if (act === 'down' || act === 'getup') p.koDir = new p.pos.constructor(0, 0, -1);
    if (act && act === act.toLowerCase()) { p.action = act; }
    const dur = { jab: 0.3, cross: 0.32, kick: 0.58, heavy: 0.52, slam: 0.72, counter: 0.4, raise: 0.32, throw: 0.36, hit: 0.3, stagger: 0.62, down: 0.85, getup: 0.45 }[act] || 1;
    for (let i = 0; i < 60; i++) { if (p.action) p.actionT = a * dur; if (act === 'DODGE') p.dodgeT = p.dodgeDur * (1 - a); p.animate(1 / 30); }
    p.root.position.copy(p.pos); p.root.rotation.y = p.yaw;
    const cam = world.camera; cam.position.set(2.6, 1.6, -7.6); cam.lookAt(0, 1.0, -10); cam.aspect = 480 / 400; cam.fov = 45; cam.updateProjectionMatrix();
  }, [name, act, a, b]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/pose-${name}.png` });
}
await browser.close();
console.log('done');
