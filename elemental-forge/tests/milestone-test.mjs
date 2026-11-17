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
// every damage event the rival takes, by attack kind
await page.evaluate(() => { const E = window.__EF, C = E.world.combat, d = C.damage.bind(C); window.__hits = []; C.damage = (t, dmg, ...r) => { if (t === E.opp) window.__hits.push(r[2]); return d(t, dmg, ...r); }; });
const hitsOn = () => page.evaluate(() => window.__hits || []);
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
head('Water: Drowning Sphere SPECIAL');
// (17 Nov brief: the SPECIAL surrounds the opponent in a ball of water, as if drowning inside it; the ball freezes into
//  jagged ice, deals the damage and shatters away. It replaces the stream circulating round the bender.)
await setup({ el: 'water', p: [0, 0, -10], o: [0, 0, -4] });
await stepN(3);
await press('btn-special', 2);
const seenP = new Set(); let held = 0, around = 99;
for (let j = 0; j < 70; j++) {
  await stepN(1);
  const r = await S(() => { const { world, opp: o } = window.__EF, D = world.bending.specials.list.find(x => x.kind === 'drown'); return D ? { ph: D.phase, d: D.mesh.position.distanceTo(o.chestPos().setY(o.pos.y + 1.0)), r: o.restrainT > 0 } : null; });
  if (r) { seenP.add(r.ph); if (r.r) held++; around = Math.min(around, r.d); }
  if (j === 22) await shot('water-drown');
  if (j === 34) await shot('water-drown-ice');
}
const dHits = await hitsOn();
check('SPECIAL closes a ball of water round the opponent and holds them inside it', seenP.has('engulf') && held > 10 && around < 0.3, `held ${held} frames, ball centre ${around.toFixed(2)} m from the opponent`);
check('the ball freezes into jagged ice', seenP.has('freeze'), [...seenP].join(' > '));
check('then shatters for the damage and is gone', dHits.includes('drown') && !(await S(() => window.__EF.world.bending.specials.list.length)), `rival hit by: ${dHits.join(',') || 'nothing'}`);

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
for (let i = 0; i < 100 && !(await S(() => window.__EF.world.bending.spikes.some(x => x.ice && x.mesh && x.t > 0.15 && x.t < 0.5))); i++) await stepN(1);   // (the spikes now form where the tidal wave stops)
const melt = await S(() => { const { world, opp } = window.__EF, B = world.bending, s = B.spikes.find(x => x.ice && x.mesh && x.t > 0.15 && x.t < 0.5); if (!s) return null; const o2 = B.spikes.find(x => x.ice && x !== s), lx = o2 ? o2.pos.x - s.pos.x : 1, lz = o2 ? o2.pos.z - s.pos.z : 0, ll = Math.hypot(lx, lz) || 1; const P = s.pos.clone(); P.y += 0.8; P.x += -lz / ll * 2.5; P.z += lx / ll * 2.5; /* across the line of spikes, so no other spike is in the way */ B.fire('fireball', opp, P, { target: s.pos.clone().setY(s.pos.y + 0.6) }); for (let i = 0; i < 6; i++) window.__EF.step(1 / 30); return { t: s.t }; });
check('fire melts ice', melt && melt.t >= 1.3, melt ? `spike life jumped to ${melt.t.toFixed(2)} s (it would be ${'<'}0.8 s without the fireball)` : 'no young spike to test');

// ------------------------------------------------------------------ air
head('Air: whirlwind dash');
// (17 Nov brief: Air's DODGE wraps a whirlwind round the bender and throws them quickly sideways in the chosen
//  direction, in place of the arc walked round the opponent)
await setup({ el: 'air', p: [0, 0, -4], o: [0, 0, 0] });
await stepN(3);
const a0 = await S(() => ({ x: window.__EF.player.pos.x, z: window.__EF.player.pos.z }));
await stick(80, 0); await press('btn-dodge', 2);
let whirl = 0; for (let j = 0; j < 12; j++) { await stepN(1); whirl = Math.max(whirl, await S(() => window.__EF.world.bending.weapons.whirls.length)); if (j === 5) await shot('air-whirl'); }
await stickUp();
const a1 = await S(() => { const { player: p, opp: o } = window.__EF; let face = Math.abs(((p.faceYaw - Math.atan2(o.pos.x - p.pos.x, o.pos.z - p.pos.z)) + Math.PI * 3) % (Math.PI * 2) - Math.PI); return { x: p.pos.x, z: p.pos.z, face }; });
// the stick's right is the screen's right: the bender faces +z here, so that is world -x
// (17 Nov, later: the dodge became a two-second glide that the stick steers and that turns with the lock-on, so a
//  little forward drift is expected; the check is now the direction of travel, within 25 degrees of the stick)
check('DODGE: a whirlwind wraps the airbender and throws them sideways in the stick direction', whirl > 0 && a0.x - a1.x > 2.5 && Math.abs(Math.atan2(a1.z - a0.z, a0.x - a1.x)) < 25 * Math.PI / 180, `moved ${(a0.x - a1.x).toFixed(1)} m to the screen's right, ${(a1.z - a0.z).toFixed(1)} m forward/back; whirlwind drawn ${whirl > 0}`);
check('the bender keeps facing the opponent through the dash', a1.face < 0.6, `${(a1.face * 180 / Math.PI).toFixed(0)} degrees off`);
// (the first glide lasts two seconds: the second DODGE is pressed after it has ended)
await stepN(60); const a1b = await S(() => ({ x: window.__EF.player.pos.x, z: window.__EF.player.pos.z })); await stick(-80, 0); await press('btn-dodge', 2); await stepN(14); await stickUp();
const a2 = await S(() => ({ x: window.__EF.player.pos.x, z: window.__EF.player.pos.z }));
// lock-on turns the bender (and the camera) to keep facing the rival after the first dash, so 'left' is measured as
// the whole distance moved and its direction against the first dash's
const d1 = [a1.x - a0.x, a1.z - a0.z], d2 = [a2.x - a1b.x, a2.z - a1b.z], L2 = Math.hypot(...d2), cosD = (d1[0] * d2[0] + d1[1] * d2[1]) / (Math.hypot(...d1) * L2 || 1);
check('the dash goes whichever way the stick points (back to the left)', L2 > 2.5 && cosD < 0.3, `moved ${L2.toFixed(1)} m, direction ${(Math.acos(Math.max(-1, Math.min(1, cosD))) * 180 / Math.PI).toFixed(0)} degrees from the first dash`);

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
    for (let i = 0; i < 12; i++) { await stepN(1); r = r || await S(() => { const o = window.__EF.opp; return o.guarding || o.dodgeT > 0 || (o.tech && o.tech.name === 'Roll'); });   /* (17 Nov: Earth evades with a roll; its DODGE is the rock slide) */ }
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
// six separate close engagements (the Master AI otherwise backs off to its preferred range): each starts at 2 m
// and is watched for 1.5 s; an engagement counts if a strike starts no more than 0.25 s after the previous one ends
const eng = await S(() => { const E = window.__EF, o = E.opp, P = E.player, out = [];
  for (let k = 0; k < 6; k++) {
    P.pos.set(0, 0, -2); o.pos.set(0, 0, 0); o.vel.set(0, 0, 0); o.action = null; o.tech = null; E.ai.combo = []; E.ai.meleeT = 0;
    const seq = []; let last = null;
    for (let i = 0; i < 45; i++) { P.hp = 100; P.en = 100; o.en = 100; E.step(1 / 30); if (o.action === 'tech' && o.techN !== last) { last = o.techN; seq.push([i / 30, o.tech.name, o.tech.dur]); } }
    out.push(seq);
  }
  return out; });
const chained = eng.filter(sq => sq.some((x, i) => i > 0 && x[0] - sq[i - 1][0] < sq[i - 1][2] + 0.25)).length;
check('master opponent strings strikes into combinations', chained >= 4, `${chained}/6 close engagements had a strike following the previous one with no idle gap (under 0.25 s): ${eng.map(sq => sq.map(x => x[1]).join('+') || '-').join(' | ')}`);
await stubAI();

head('Regression');
check('no runtime errors during the test', errors.length === 0, errors.slice(0, 3).join(' | '));
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} milestone checks passed against ${BASE}`);
fs.writeFileSync(`${OUT}/milestone-results.json`, JSON.stringify({ base: BASE, build: await S(() => document.getElementById('build-stamp') ? document.getElementById('build-stamp').textContent : null), results }, null, 1));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
