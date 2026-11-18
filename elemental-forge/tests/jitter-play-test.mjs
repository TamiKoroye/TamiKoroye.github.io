// Gameplay jitter check: the gate every new move passes before it ships.
// A clip can be smooth on its own and still twitch in the game, when presses cut it short, variants alternate and
// the blends between them pull the limbs back and forth (this is what the Tai Chi moves in r18 did). So this test
// plays each element with the keyboard controls the way a thumb on the phone does (fast HAND taps, fast LEG taps,
// mixed, guard on and off, dodges), steps the game at 60 fps and records the world position of the hands,
// forearms, feet, head and chest in the fighter's own frame (locomotion removed). A "reversal" is a frame where a
// body part moving faster than 1 m/s turns back on itself on the next frame (velocity turning by more than 120
// degrees in 1/60 s). Real strikes reverse at the end of each strike; twitching reverses many times per second.
// Usage: node tests/jitter-play-test.mjs <baseUrl> [element,element] [--json out.json] [--write-baseline file]
// Exit code 1 when any element/sequence is above the limit.
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const ELS = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'fire,water,earth,air').split(',');
const JOUT = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
// Limits: against a baseline file (tests/jitter-baseline.json, measured on r19, the last build without twitching) a
// sequence fails when it reverses or snaps clearly more than the baseline did: more than 1.5 times and more than
// +0.25 reversals/s (or +0.5 snaps/s). Calibration on the twitching r18 Tai Chi build, water hand taps: 0.88
// reversals/s and 2.86 snaps/s against 0.19 and 1.18 on r19, so it fails both limits.
// --write-baseline <file> records the current build as the baseline.
const BASEF = new URL('./jitter-baseline.json', import.meta.url).pathname;
const WRITE = process.argv.includes('--write-baseline') ? process.argv[process.argv.indexOf('--write-baseline') + 1] : null;
const BASELINE = !WRITE && fs.existsSync(BASEF) ? JSON.parse(fs.readFileSync(BASEF, 'utf8')) : [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'rec=1');
await page.waitForFunction(() => window.__EF && window.__EF.LOAD && (window.__EF.LOAD.ok || window.__EF.LOAD.errors.length), null, { timeout: 60000 });
await page.locator('#btn-start').click(); await page.waitForFunction(() => window.__EF.state.phase === 'fight', null, { timeout: 120000 });
await page.evaluate(() => {
  const E = window.__EF; E.state.manual = true;
  // the rival stands still so only the player's own animation is measured
  E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.dodgeHeld = i.jump = i.jumpHeld = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); };
  E.state.locked = true; E.player.target = E.opp;
  window.__BONES = ['DEF-handL', 'DEF-handR', 'DEF-forearmL', 'DEF-forearmR', 'DEF-footL', 'DEF-footR', 'DEF-head', 'DEF-chest'];
  window.__rec = [];
});
const step = (n) => page.evaluate((n) => {
  const E = window.__EF, P = E.player, V = E.camera.position.constructor, v = new V();
  for (let i = 0; i < n; i++) {
    P.hp = Math.max(P.hp, 50); E.opp.hp = Math.max(E.opp.hp, 50);
    E.step(1 / 60);
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
    window.__rec.push(window.__BONES.map(b => { const bo = P.hero.bones[b]; if (!bo) return [0, 0, 0]; bo.getWorldPosition(v); const x = v.x - P.pos.x, z = v.z - P.pos.z; return [x * c - z * s, v.y - P.pos.y, x * s + z * c]; }));
  }
}, n);
const keyTap = async (code, every, frames) => { for (let f = 0; f < frames; f += every) { await page.keyboard.down(code); await step(2); await page.keyboard.up(code); await step(every - 2); } };
const SEQ = {
  'hand taps': async () => keyTap('KeyF', 9, 240),
  'leg taps': async () => keyTap('KeyG', 12, 240),
  'hand+leg': async () => { for (let i = 0; i < 10; i++) { await keyTap('KeyF', 9, 9); await keyTap('KeyG', 12, 12); } },
  'guard on/off': async () => { for (let i = 0; i < 4; i++) { await page.keyboard.down('KeyQ'); await step(30); await page.keyboard.up('KeyQ'); await step(15); await keyTap('KeyF', 9, 18); } },
  'dodges': async () => { for (let i = 0; i < 4; i++) { await page.keyboard.down(i % 2 ? 'KeyA' : 'KeyD'); await page.keyboard.down('ShiftLeft'); await step(3); await page.keyboard.up('ShiftLeft'); await step(25); await page.keyboard.up(i % 2 ? 'KeyA' : 'KeyD'); await keyTap('KeyF', 9, 18); await step(10); } },
};
const results = []; let failed = false;
for (const el of ELS) for (const [name, fn] of Object.entries(SEQ)) {
  await page.evaluate((el) => {
    const E = window.__EF, P = E.player, O = E.opp; P.setElement(el, true); O.setElement('earth', true);
    P.reset(0, 0, 0); O.reset(0, 2.6, Math.PI); E.world.bending.clear && E.world.bending.clear(); window.__rec = [];
  }, el);
  await step(40); await page.evaluate(() => { window.__rec = []; });
  await fn(); await step(30);
  const rec = await page.evaluate(() => window.__rec);
  const nb = rec[0].length, per = new Array(nb).fill(0), snaps = new Array(nb).fill(0);
  for (let b = 0; b < nb; b++) {
    for (let i = 1; i < rec.length - 1; i++) {
      const p0 = rec[i - 1][b], p1 = rec[i][b], p2 = rec[i + 1][b];
      const a = [0, 1, 2].map(k => (p1[k] - p0[k]) * 60), c = [0, 1, 2].map(k => (p2[k] - p1[k]) * 60);
      const ma = Math.hypot(...a), mc = Math.hypot(...c);
      if (ma > 1 && mc > 1 && (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / (ma * mc) < -0.5) per[b]++;
      // a snap: the part jumps (acceleration above 400 m/s^2, i.e. a 7 m/s change of speed in one frame)
      if (Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) * 60 > 400) snaps[b]++;
    }
  }
  const secs = rec.length / 60, rates = per.map(n => n / secs), mean = rates.reduce((s, r) => s + r, 0) / nb;
  const worst = rates.indexOf(Math.max(...rates)), bones = await page.evaluate(() => window.__BONES);
  const snapRate = snaps.reduce((s, n) => s + n, 0) / nb / secs;
  const bl = BASELINE.find(r => r.el === el && r.seq === name);
  const pass = !bl || ((mean <= Math.max(bl.revPerSecPerPart * 1.5, bl.revPerSecPerPart + 0.25)) && (snapRate <= Math.max(bl.snapsPerSecPerPart * 1.5, bl.snapsPerSecPerPart + 0.5)));
  if (!pass) failed = true;
  results.push({ el, seq: name, revPerSecPerPart: +mean.toFixed(2), snapsPerSecPerPart: +snapRate.toFixed(2), worstPart: bones[worst], worstRate: +rates[worst].toFixed(2), pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${el.padEnd(6)} ${name.padEnd(13)} ${mean.toFixed(2).padStart(5)} reversals/s per part, ${snapRate.toFixed(2)} snaps/s  (worst ${bones[worst]} ${rates[worst].toFixed(1)}/s)${bl ? `  baseline ${bl.revPerSecPerPart} / ${bl.snapsPerSecPerPart}` : ''}`);
}
if (errors.length) { console.log('page errors:', errors.slice(0, 5)); failed = true; }
if (WRITE) fs.writeFileSync(WRITE, JSON.stringify(results, null, 1));
if (JOUT) fs.writeFileSync(JOUT, JSON.stringify(results, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
