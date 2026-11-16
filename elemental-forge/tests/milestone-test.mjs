// Milestone 1 (master specification) checks: the new mechanics in the real game, driven by touch on the on-screen
// controls with exact 1/30 s steps. Fire jet jump, water spiral streams and icebending, air circling evasion,
// kicks while running, and the opponent reading and answering strikes. Usage:
//   node tests/milestone-test.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots/milestone';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let section = '';
const check = (name, ok, detail = '') => { results.push({ section, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const head = (s) => { section = s; console.log(`\n== ${s}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(BASE) ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
const fingers = new Map();
// touch-driven pointer events are delivered on the next animation frame, so give the page one before stepping
// Chromium's DevTools touch emulation holds back the most recent touchmove until another touch event
// arrives, so every gesture is followed by a sub-pixel nudge of the fingers still down to flush it.
const settle = async () => { await sleep(30); if (fingers.size) { await touch('touchMove', [...fingers.values()].map(f => ({ ...f, x: f.x + 0.01 }))); } await sleep(30); };
const fDown = async (id, x, y) => { fingers.set(id, { x, y, id }); await touch('touchStart', [...fingers.values()]); await settle(); };
const fMove = async (id, x, y) => { fingers.set(id, { x, y, id }); await touch('touchMove', [...fingers.values()]); await settle(); };
// lifting one finger: touchEnd listing only that finger (other fingers stay down)
const fUp = async (id) => { const f = fingers.get(id); fingers.delete(id); if (f) await touch('touchEnd', [f]); await settle(); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const stepN = (n) => ev((n) => { for (let i = 0; i < n; i++) window.__EF.step(1 / 30); window.__EF.render(); }, n);
const btnCenter = async (id) => { const b = await page.locator('#' + id).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// press an on-screen button with a real touch, hold for `frames`, release
const press = async (id, frames = 2, tid = 5) => { const c = await btnCenter(id); await fDown(tid, c.x, c.y); await stepN(frames); await fUp(tid); };
const hold = async (id, tid = 6) => { const c = await btnCenter(id); await fDown(tid, c.x, c.y); };
const stick = async (dx, dy) => { if (!fingers.has(1)) await fDown(1, 160, 300); await fMove(1, 160 + dx, 300 + dy); };
const stickUp = () => fingers.has(1) ? fUp(1) : null;
const S = (fn, arg) => ev(fn, arg);
// reset both fighters to a known state, rival passive and facing the player
const setup = (o) => ev((o) => {
  const E = window.__EF, { player, opp, camCtl, state, world } = E;
  world.bending.clear(); state.locked = o.locked ?? true; state.aimHold = 0;
  for (const f of [player, opp]) { f.vel.set(0, 0, 0); f.action = null; f.tech = null; f.stunT = 0; f.dodgeT = 0; f.hp = 100; f.en = 100; f.guarding = false; f.holding = false; f.charging = false; f.handHoldT = -1; f.legHoldT = -1; f.counterT = 0; f.invuln = 0; f.dead = false; f.restrainT = 0; f.spinYaw = 0; if (f.ext) f.ext.set(0, 0, 0); f.tumble.quaternion.identity(); f.stats = { hitsLanded: 0, blocks: 0, perfect: 0, techniques: {} }; }
  player.setElement(o.el || 'earth', true); opp.setElement(o.oel || 'earth', true);
  player.pos.set(...(o.p || [0, 0, -12])); opp.pos.set(...(o.o || [0, 0, -4]));
  player.faceYaw = player.yaw = Math.atan2(opp.pos.x - player.pos.x, opp.pos.z - player.pos.z); opp.faceYaw = opp.yaw = player.faceYaw + Math.PI;
  camCtl.snapBehind(player);
  for (const k of Object.keys(E.controls.btn)) E.controls.btn[k] = false;
}, o);
const oppFire = (kind, from) => ev(([kind, from]) => { const { world, opp, player } = window.__EF; return world.bending.fire(kind, opp, new world.scene.position.constructor(...from), { target: player.chestPos() }).kind; }, [kind, from]);

const stubAI = () => ev(() => { const E = window.__EF; E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = i.jumpHeld = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; });
const realAI = (d) => ev((d) => { const E = window.__EF; E.ai.update = Object.getPrototypeOf(E.ai).update; E.ai.setDifficulty(d); E.ai.combo = []; E.ai.reaction = null; E.ai.guardT = 0; }, d);

head('Load');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
await sleep(800);
const load = await S(() => window.__EF.LOAD);
check('build loads its character and every clip', load && load.ok && load.clipsDecoded === load.clipsExpected, load ? `${load.clipsDecoded}/${load.clipsExpected} clips, character ${load.character}` : 'no LOAD record');
await page.locator('#btn-start').tap();
await ev(() => { window.__EF.state.manual = true; });
await stubAI();
await stepN(50);
check('fight phase begins', (await S(() => window.__EF.state.phase)) === 'fight');

// ------------------------------------------------------------------ fire
head('Fire: flame-jet jump');
await setup({ el: 'fire', p: [0, 0, -12], o: [8, 0, 6] });
await stepN(5);
await press('btn-jump', 2);
let tapPeak = 0; for (let i = 0; i < 40; i++) { await stepN(1); tapPeak = Math.max(tapPeak, await S(() => window.__EF.player.pos.y - window.__EF.player.groundY)); }
await setup({ el: 'fire', p: [0, 0, -12], o: [8, 0, 6] });
await stepN(5);
const en0 = await S(() => window.__EF.player.en);
await hold('btn-jump');
let jetPeak = 0, jetFrames = 0;
for (let i = 0; i < 40; i++) { await stepN(1); const r = await S(() => ({ y: window.__EF.player.pos.y - window.__EF.player.groundY, j: window.__EF.player.jetting })); jetPeak = Math.max(jetPeak, r.y); if (r.j) jetFrames++; if (i === 18) await shot('fire-jet'); }
await fUp(6);
const enUsed = en0 - (await S(() => window.__EF.player.en));
let landRing = false; for (let i = 0; i < 60 && !landRing; i++) { await stepN(1); landRing = await S(() => window.__EF.player.onGround && window.__EF.world.bending.rings.some(r => r.owner === window.__EF.player && r.el === 'fire')); }
check('holding JUMP drives the firebender higher than a plain jump', jetPeak > tapPeak + 1.0, `plain jump ${tapPeak.toFixed(2)} m, jet jump ${jetPeak.toFixed(2)} m, ${jetFrames} frames of thrust`);
check('the flame jets cost energy', enUsed > 15, `${enUsed.toFixed(0)} energy used`);
check('a jet landing bursts flame outward', landRing);

// ------------------------------------------------------------------ water
head('Water: spiral streams SPECIAL');
await setup({ el: 'water', p: [0, 0, -10], o: [0, 0, -3] });
await stepN(3);
await press('btn-special', 2); await stepN(18);
const sp = await S(() => { const { world, player } = window.__EF, s = world.bending.spirals.find(x => x.owner === player); if (!s) return null; let top = 0; for (const pts of s.pts) for (const p of pts) top = Math.max(top, p.y - player.pos.y); return { n: s.streams.filter(t => t.mesh.visible).length, top, head: player.hero.bones['DEF-head'].getWorldPosition(new player.pos.constructor()).y - player.pos.y }; });
await shot('water-spiral');
check('SPECIAL gathers three streams circling the body', sp && sp.n === 3, sp ? `${sp.n} streams` : 'no spiral');
check('the streams stay below the head', sp && sp.top < sp.head - 0.05, sp ? `highest stream point ${sp.top.toFixed(2)} m, head ${sp.head.toFixed(2)} m` : '');
await oppFire('fireball', [0, 1.3, -4]); await stepN(12);
const caught = await S(() => { const { world, player } = window.__EF, s = world.bending.spirals.find(x => x.owner === player); return { c: s ? s.caught : -1, hp: player.hp }; });
check('circulating streams catch an incoming fireball', caught.c >= 1 && caught.hp === 100, `caught ${caught.c}, player hp ${caught.hp}`);
await press('btn-hand', 2); await stepN(30);
const rel = await S(() => ({ hp: window.__EF.opp.hp, left: window.__EF.world.bending.spirals.length }));
check('HAND releases the streams at the opponent', rel.hp < 100 && rel.left === 0, `rival hp ${rel.hp}`);

head('Water: icebending');
await setup({ el: 'water', p: [0, 0, -10], o: [0, 0, -6] });
await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6);
let ice = { n: 0, hp: 100 };
for (let i = 0; i < 60; i++) { await stepN(1); const r = await S(() => ({ n: window.__EF.world.bending.spikes.filter(s => s.ice && s.mesh).length, hp: window.__EF.opp.hp })); if (r.n > ice.n) { ice.n = r.n; if (r.n >= 4) await shot('water-ice'); } ice.hp = r.hp; }
check('the tidal sweep freezes into a line of ice spikes', ice.n >= 3, `${ice.n} ice spikes`);
check('the ice spikes hit the opponent', ice.hp < 100, `rival hp ${ice.hp} (wave and spikes together)`);
await setup({ el: 'water', p: [0, 0, -10], o: [0, 0, 6] });
await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6);
for (let i = 0; i < 40 && !(await S(() => window.__EF.world.bending.spikes.some(x => x.ice && x.mesh && x.t > 0.15 && x.t < 0.5))); i++) await stepN(1);
const melt = await S(() => { const { world, opp } = window.__EF, B = world.bending, s = B.spikes.find(x => x.ice && x.mesh && x.t > 0.15 && x.t < 0.5); if (!s) return null; const P = s.pos.clone(); P.y += 0.8; P.x += 2.5; /* from the side: no other spike in the line is in the way */ B.fire('fireball', opp, P, { target: s.pos.clone().setY(s.pos.y + 0.6) }); for (let i = 0; i < 6; i++) window.__EF.step(1 / 30); return { t: s.t }; });
check('fire melts ice', melt && melt.t >= 1.3, melt ? `spike life jumped to ${melt.t.toFixed(2)} s (it would be ${'<'}0.8 s without the fireball)` : 'no young spike to test');

// ------------------------------------------------------------------ air
head('Air: Baguazhang circling evasion');
await setup({ el: 'air', p: [0, 0, -4], o: [0, 0, 0] });
await stepN(3);
const a0 = await S(() => { const { player: p, opp: o } = window.__EF; return { a: Math.atan2(p.pos.x - o.pos.x, p.pos.z - o.pos.z), d: Math.hypot(p.pos.x - o.pos.x, p.pos.z - o.pos.z) }; });
await stick(80, 0); await press('btn-dodge', 2); await stepN(12); await stickUp();
const a1 = await S(() => { const { player: p, opp: o } = window.__EF; let face = Math.abs(((p.faceYaw - Math.atan2(o.pos.x - p.pos.x, o.pos.z - p.pos.z)) + Math.PI * 3) % (Math.PI * 2) - Math.PI); return { a: Math.atan2(p.pos.x - o.pos.x, p.pos.z - o.pos.z), d: Math.hypot(p.pos.x - o.pos.x, p.pos.z - o.pos.z), face, kind: p.dodgeKind, counter: p.counterT }; });
const swept = Math.abs(((a1.a - a0.a) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 180 / Math.PI;
await shot('air-circle');
check('a sideways air dodge circles around the opponent', a1.kind === 'circle' && swept > 70 && Math.abs(a1.d - a0.d) < 1.2, `${swept.toFixed(0)} degrees around, distance ${a0.d.toFixed(1)} -> ${a1.d.toFixed(1)} m`);
check('the bender keeps facing the opponent while circling', a1.face < 0.35, `${(a1.face * 180 / Math.PI).toFixed(0)} degrees off`);
await press('btn-hand', 2); await stepN(8);
const ctr = await S(() => ({ a: window.__EF.player.action, hp: window.__EF.opp.hp }));
check('the circle ends in a counter window: HAND counters from the flank', a1.counter > 0 && ctr.a === 'counter', `counter window ${a1.counter.toFixed(2)} s, action ${ctr.a}`);

// ------------------------------------------------------------------ all elements
head('Kicks while running');
for (const el of ['earth', 'fire', 'water', 'air']) {
  await setup({ el, locked: false, p: [0, 0, -14], o: [0, 0, 4] });
  await stick(0, -80); await stepN(20);
  await press('btn-leg', 2); await stepN(6);
  const r = await S(() => { const p = window.__EF.player; return { t: p.tech && p.tech.name, sp: Math.hypot(p.vel.x, p.vel.z) }; });
  await stickUp(); await stepN(20);
  check(`${el}: LEG while running gives a running kick that keeps momentum`, r.t === 'Running Kick' && r.sp > 2.5, `${r.t}, ${r.sp.toFixed(1)} m/s during the kick`);
}

// ------------------------------------------------------------------ AI
head('Opponent reads strikes');
const trial = async (d) => {
  let reacted = 0;
  for (let k = 0; k < 10; k++) {
    await setup({ el: 'earth', oel: 'earth', p: [0, 0, -2.2], o: [0, 0, 0] });
    await realAI(d); await stepN(4);
    await S(() => { const o = window.__EF.opp; o.action = null; o.tech = null; window.__EF.ai.combo = []; });
    await press('btn-hand', 1);
    let r = false;
    for (let i = 0; i < 12; i++) { await stepN(1); r = r || await S(() => { const o = window.__EF.opp; return o.guarding || o.dodgeT > 0; }); }
    if (r) reacted++;
    await stubAI();
  }
  return reacted;
};
const master = await trial('master'), training = await trial('training');
check('master opponent guards or evades most close strikes', master >= 5, `${master}/10 reacted`);
check('training opponent reacts less than master', training < master, `training ${training}/10, master ${master}/10`);

head('Opponent combinations and counters');
await setup({ el: 'earth', oel: 'fire', p: [0, 0, -2.0], o: [0, 0, 0] });
await realAI('master');
const seq = await S(() => { const E = window.__EF, o = E.opp, P = E.player, out = []; let last = null; for (let i = 0; i < 600; i++) { P.hp = 100; P.en = 100; o.en = 100; E.step(1 / 30); if (o.action === 'tech' && o.techN !== last) { last = o.techN; out.push([+(i / 30).toFixed(2), o.tech.name]); } } return out; });
let chains = 0; for (let i = 1; i < seq.length; i++) if (seq[i][0] - seq[i - 1][0] < 0.75) chains++;
check('master opponent strings strikes into combinations', chains >= 3, `${seq.length} techniques in 20 s, ${chains} follow-ups within 0.75 s: ${seq.slice(0, 8).map(s => s[1]).join(', ')}`);
await stubAI();

head('Regression');
check('no runtime errors during the test', errors.length === 0, errors.slice(0, 3).join(' | '));
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} milestone checks passed against ${BASE}`);
fs.writeFileSync(`${OUT}/milestone-results.json`, JSON.stringify({ base: BASE, build: await S(() => document.getElementById('build-stamp') ? document.getElementById('build-stamp').textContent : null), results }, null, 1));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
