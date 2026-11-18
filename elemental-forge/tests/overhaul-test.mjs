// Combat-overhaul acceptance checks (16 Nov brief, section 15): water weapons, ice, ice surfing and launches; air
// weapons and flight; earth stomp eruption and rock surfing; fire stomp ring and flame propulsion. Driven by touch on
// the on-screen controls (DODGE held = the element's mobility) with exact 1/30 s steps. Usage:
//   node tests/overhaul-test.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots/overhaul';
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
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 });   // the software renderer is slow with the venue scan
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

const stubAI = () => ev(() => { const E = window.__EF; E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.dodgeHeld = i.jump = i.jumpHeld = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; });
const P = () => S(() => { const { player: p, opp: o, world } = window.__EF; return { dk: p.dodgeT > 0 ? p.dodgeKind : null, x: p.pos.x, y: p.pos.y, z: p.pos.z, alt: p.pos.y - p.groundY, sp: Math.hypot(p.vel.x, p.vel.z), mob: p.mob && p.mob.kind, heading: p.mob && p.mob.heading, act: p.action, tech: p.tech && p.tech.name, en: p.en, ohp: o.hp, oact: o.action, oy: o.pos.y - o.groundY, ox: o.pos.x, oz: o.pos.z, clip: p.hero && p.hero.curName, low: p.hero && p.hero.lowName, onG: p.onGround }; });
const run = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) { await stepN(1); const r = await P(); out.push(r); if (fn) await fn(i, r); } return out; };

// every damage event the rival takes, with the attack that caused it (so a stomp is not credited with a kick's hit)
const hitsOn = () => S(() => window.__hits || []);
const clearHits = () => S(() => { window.__hits = []; });
head('Load');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__EF && window.__EF.LOAD && (window.__EF.LOAD.ok || window.__EF.LOAD.errors.length), null, { timeout: 60000 });
const load = await S(() => window.__EF.LOAD);
check('build loads its character and every clip', load.ok && load.clipsDecoded === load.clipsExpected, `${load.clipsDecoded}/${load.clipsExpected} clips`);
await page.locator('#btn-start').tap(); await ev(() => { window.__EF.state.manual = true; const E = window.__EF, C = E.world.combat, d = C.damage.bind(C); window.__hits = []; C.damage = (t, dmg, ...r) => { if (t === E.opp) window.__hits.push(r[2]); return d(t, dmg, ...r); }; }); await stubAI(); await stepN(50);

// ================================================================== WATER
head('Water: whips');
await setup({ el: 'water', p: [0, 0, -9], o: [0, 0, -4] }); await stepN(3);
const kinds = [];
// (17 Nov, later: Water's HAND alternates whips with ball-throwing punches, so six presses are needed for the three whips)
for (let i = 0; i < 6; i++) { await press('btn-hand', 2); for (let j = 0; j < 14; j++) { await stepN(1); const k = await S(() => window.__EF.world.bending.weapons.whips.map(W => W.kind)); for (const x of k) if (kinds[kinds.length - 1] !== x) kinds.push(x); } if (i === 2) await shot('water-whip'); }
const whipHp = await S(() => window.__EF.opp.hp);
check('HAND chain lashes the whip in different directions', new Set(kinds).size >= 3, kinds.join(' > '));
check('the whip strikes connect', whipHp <= 100 - 14, `rival hp ${whipHp}`);
await setup({ el: 'water', p: [0, 0, -9], o: [0, 0, -4] }); await stepN(3);
await hold('btn-hand'); await stepN(14);
const tipAt = () => S(() => { const h = window.__EF.world.bending.holds.get(window.__EF.player); return h && h.whips ? h.whips.map(W => W.pts[13].x) : null; });
await stick(80, 0); await stepN(14); const right = await tipAt();
await stick(-80, 0); await stepN(20); const left = await tipAt(); await stickUp();
const twinHp = await S(() => window.__EF.opp.hp); await shot('water-twin-whips');
await fUp(6); await stepN(6);
check('holding HAND keeps two whips, one from each hand', right && right.length === 2, right ? `${right.length} whips` : 'none');
check('the stick sweeps the held whips across', right && left && Math.abs((right[0] + right[1]) - (left[0] + left[1])) > 2, right && left ? `tips x ${right.map(v => v.toFixed(1))} -> ${left.map(v => v.toFixed(1))}` : '');
check('the held whips strike the rival', twinHp < 100, `rival hp ${twinHp}`);

head('Water: kicks produce water attacks');
const kickHits = {};
for (const [i, name, d] of [[0, 'Crescent Water Kick', 5.5], [1, 'Turning Wave Kick', 2.4], [2, 'Rising Water Kick', 4]]) {
  await setup({ el: 'water', p: [0, 0, -9], o: [0, 0, -9 + d] }); await stepN(3);
  await S((i) => { const p = window.__EF.player; p.comboTimer = i ? 0.9 : 0; p.legIdx = i - 1; }, i);
  await press('btn-leg', 2);
  let lifted = 0, tech = null; for (let j = 0; j < 36; j++) { await stepN(1); const r = await P(); tech = tech || r.tech; lifted = Math.max(lifted, r.oy); if (j === 18) await shot('water-kick-' + i); }
  kickHits[name] = { hp: await S(() => window.__EF.opp.hp), lifted, tech };
}
check('crescent kick: a low water arc hits at 5.5 m', kickHits['Crescent Water Kick'].hp < 100, JSON.stringify(kickHits['Crescent Water Kick']));
check('spinning kick: a water whip swung round the body hits', kickHits['Turning Wave Kick'].hp < 100, JSON.stringify(kickHits['Turning Wave Kick']));
check('rising kick: a water column surges under the rival and lifts them', kickHits['Rising Water Kick'].hp < 100 && kickHits['Rising Water Kick'].lifted > 1, JSON.stringify(kickHits['Rising Water Kick']));
await setup({ el: 'water', p: [0, 0, -12], o: [0, 0, -6] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6);
let waveMax = 0, iceN = 0; for (let j = 0; j < 95; j++) { await stepN(1); const r = await S(() => ({ w: window.__EF.world.bending.weapons.waves.length, ice: window.__EF.world.bending.spikes.filter(s => s.ice).length, oz: window.__EF.opp.pos.z })); waveMax = Math.max(waveMax, r.w); iceN = Math.max(iceN, r.ice); if (j === 12) await shot('water-wave'); }
const waveR = await P();
check('charged LEG: a tidal wave advances, hits and pushes the rival back', waveMax > 0 && waveR.ohp < 100 && waveR.oz > -6 + 1.5, `rival hp ${waveR.ohp}, pushed to z ${waveR.oz.toFixed(1)} (from -6)`);
check('the wave freezes into ice spikes where it stops', iceN >= 3, `${iceN} ice spikes`);

head('Water: ice weapons from the guard');
await setup({ el: 'water', p: [0, 0, -12], o: [0, 0, -4] }); await stepN(3);
await hold('btn-guard', 8); await stepN(10); await press('btn-hand', 2);
let spear = false; for (let j = 0; j < 20; j++) { await stepN(1); spear = spear || await S(() => window.__EF.world.bending.objs.some(o => o.kind === 'iceSpear')); }
const spearHp = await S(() => window.__EF.opp.hp);
check('GUARD + HAND throws an ice spear that hits', spear && spearHp < 100, `spear ${spear}, rival hp ${spearHp}`);
await press('btn-leg', 2); await stepN(4);
const cap = await S(() => ({ r: window.__EF.opp.restrainT, n: window.__EF.world.bending.weapons.captures.length }));
await shot('water-capture'); await fUp(8); await stepN(40);
check('GUARD + LEG sends a stream that captures the rival briefly', cap.n === 1 && cap.r > 0.5 && cap.r <= 1.01, `held for ${cap.r.toFixed(2)} s`);

head('Water: ice surfing and ice launch');
await setup({ el: 'water', locked: false, p: [-8, 0, -14], o: [20, 0, 20] }); await stepN(3);
await hold('btn-dodge', 7); await stick(0, -80);
const surf = await run(45);
const sMax = Math.max(...surf.map(r => r.sp)), surfing = surf.filter(r => r.mob === 'surf').length;
const trailN = await S(() => window.__EF.world.bending.weapons.trails.length);
check('DODGE held: ice forms under the feet and the waterbender surfs', surfing > 30 && trailN > 5, `${surfing} frames surfing, ${trailN} ice trail pieces`);
check('surfing accelerates beyond running speed', sMax > 9, `${sMax.toFixed(1)} m/s`);
check('the surfer holds the surfing stance', surf.slice(-5).every(r => (r.clip || '').startsWith('surf_stance')), surf[surf.length - 1].clip);
await shot('water-surf');
const h0 = surf[surf.length - 1].heading;
await stick(80, 0); await run(20); const h1 = (await P()).heading;
check('the stick steers the surf', Math.abs(((h1 - h0) + Math.PI * 3) % (Math.PI * 2) - Math.PI) > 0.9, `heading changed ${(((h1 - h0) + Math.PI * 3) % (Math.PI * 2) - Math.PI).toFixed(2)} rad`);
await press('btn-jump', 2);
let peak = 0, plat = 0; const launch = await run(40, async (i, r) => { peak = Math.max(peak, r.alt); if (i === 8) await shot('water-ice-launch'); plat = Math.max(plat, await S(() => window.__EF.world.bending.weapons.platforms.length)); });
check('JUMP while surfing: a rising ice pillar launches the bender high', peak > 2.8 && plat > 0, `peak ${peak.toFixed(2)} m above the ground, ice platforms ${plat}`);
check('the launch plays the high-jump animation', launch.some(r => /jump_high|air_loop|fall_loop/.test(r.clip || '')), [...new Set(launch.map(r => r.clip))].join(','));
await stickUp(); await fUp(7);
// (18 Nov: the ice surf now stays on after DODGE is let go, so the thumb is free to attack on a phone; a DODGE tap
//  steps off. Before, letting go of DODGE ended it. The surf is ended here the new way before the next trial)
await press('btn-dodge', 2); await run(30);
await setup({ el: 'water', locked: false, p: [-8, 0, -14], o: [20, 0, 20] }); await stepN(3);
await press('btn-jump', 1); await hold('btn-jump'); let wPeak = 0, colSeen = false; await run(30, async (i, r) => { wPeak = Math.max(wPeak, r.alt); colSeen = colSeen || await S(() => !!window.__EF.player._col); if (i === 14) await shot('water-column-launch'); }); await fUp(6); await run(30);
check('JUMP held: a water column under the feet carries the waterbender up', wPeak > 2.2 && colSeen, `peak ${wPeak.toFixed(2)} m, column visible ${colSeen}`);

// ================================================================== AIR
head('Air: weapons');
await setup({ el: 'air', p: [0, 0, -9], o: [0, 0, -4] }); await stepN(3);
for (let i = 0; i < 2; i++) { await press('btn-hand', 2); await stepN(14); }
check('air whip strikes', (await S(() => window.__EF.opp.hp)) < 100, `rival hp ${await S(() => window.__EF.opp.hp)}`);
await setup({ el: 'air', p: [0, 0, -12], o: [0, 0, -6] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6); await stepN(30);
const pw = await P(); await shot('air-pressure-wave');
check('charged LEG: a pressure wave drives the rival back', pw.ohp < 100 && pw.oz > -6 + 3, `rival hp ${pw.ohp}, pushed to z ${pw.oz.toFixed(1)} (from -6)`);
await setup({ el: 'air', p: [0, 0, -9], o: [0, 0, -5] }); await stepN(3);
await S(() => { const p = window.__EF.player; p.comboTimer = 0.9; p.legIdx = 1; });
await press('btn-leg', 2); let aLift = 0; await run(36, (i, r) => { aLift = Math.max(aLift, r.oy); });
check('rising kick: an air column launches the rival', aLift > 1.2, `rival lifted ${aLift.toFixed(2)} m`);

head('Air: flight');
await setup({ el: 'air', locked: true, p: [0, 0, -12], o: [0, 0, 0] }); await stepN(3);
// (17 Nov brief: flight starts with JUMP; DODGE is now the whirlwind dash)
await hold('btn-jump', 6);
const asc = await run(40); await fUp(6);
const fPeak = Math.max(...asc.map(r => r.alt));
check('JUMP lifts the airbender into flight; JUMP held climbs', asc.filter(r => r.mob === 'fly').length > 35 && fPeak > 6, `peak ${fPeak.toFixed(1)} m above the ground`);
check('flight plays the airborne pose', asc.slice(-5).every(r => (r.clip || '').startsWith('air_loop')), asc[asc.length - 1].clip);
await shot('air-flight');
const x0 = (await P()).x; await stick(80, 0); await run(30); const x1 = (await P()).x; await stickUp();
check('the stick steers the flight sideways', Math.abs(x1 - x0) > 4, `moved ${Math.abs(x1 - x0).toFixed(1)} m`);
const hp0 = await S(() => window.__EF.opp.hp);
for (let i = 0; i < 3; i++) { await press('btn-hand', 2); await stepN(16); }
const fl = await P(); await shot('air-aerial-attack');
check('HAND in flight strikes the rival below', fl.ohp < hp0 && fl.mob === 'fly', `rival hp ${hp0} -> ${fl.ohp}, still flying ${fl.mob === 'fly'}`);
const left0 = await S(() => window.__EF.player.mob ? window.__EF.player.mob.fuel : 0);
let endT = null; await run(200, (i, r) => { if (endT === null && r.mob !== 'fly') endT = i / 30; });
const land = await P();
check('flight is limited in time and the airbender lands on their feet', endT !== null && endT <= left0 + 0.2 && land.onG && land.act !== 'down', `flight ended ${endT === null ? 'never' : endT.toFixed(1) + ' s'} after (fuel left ${left0.toFixed(1)} s), on ground ${land.onG}, action ${land.act}`);
await fUp(7); await stepN(10);

// ================================================================== EARTH
head('Earth: stomp eruption at the opponent');
await setup({ el: 'earth', p: [0, 0, -12], o: [1, 0, -5] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6); await clearHits();
let mark = null, clipSeen = false; for (let j = 0; j < 40; j++) { await stepN(1); const r = await S(() => { const E = window.__EF.world.bending.weapons.erupts[0], o = window.__EF.opp; return { e: E ? { x: E.x, z: E.z, fired: E.fired, ox: o.pos.x, oz: o.pos.z } : null, clip: window.__EF.player.hero.curName }; }); if (r.e && !r.e.fired && !mark) mark = r.e; if (r.clip === 'stomp' || r.clip === 'stomp_M') clipSeen = true; if (j === 14) await shot('earth-stomp'); }
const stHits = await hitsOn();
check('charged LEG plays the stomp', clipSeen, '');
check('the ground is marked under the opponent before it erupts', mark && Math.hypot(mark.x - mark.ox, mark.z - mark.oz) < 0.8, mark ? `mark at ${mark.x.toFixed(1)}, ${mark.z.toFixed(1)}; rival at ${mark.ox.toFixed(1)}, ${mark.oz.toFixed(1)}` : 'no mark');
check('rock spikes erupt there and launch the rival', stHits.includes('eruption'), `rival hit by: ${stHits.join(',') || 'nothing'}`);
await setup({ el: 'earth', p: [0, 0, -12], o: [1, 0, -5] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6); await clearHits(); await stepN(3);
await S(() => { window.__EF.opp.pos.x += 3.5; });   // the rival steps out of the marked ground
await stepN(40);
const evHits = await hitsOn();
check('a rival who leaves the marked ground is not hit by the eruption', !evHits.includes('eruption'), `rival hit by: ${evHits.join(',') || 'nothing'}`);

head('Earth: rock surfing and slab launch');
await setup({ el: 'earth', locked: false, p: [-8, 0, -14], o: [20, 0, 20] }); await stepN(3);
await hold('btn-dodge', 7); await stick(0, -80);
const rs = await run(50); await shot('earth-surf');
check('DODGE held: the earthbender rides a rock slab', rs.filter(r => r.mob === 'surf').length > 35, `${rs.filter(r => r.mob === 'surf').length} frames`);
check('the slab builds speed (heavier than ice)', Math.max(...rs.map(r => r.sp)) > 7.5, `${Math.max(...rs.map(r => r.sp)).toFixed(1)} m/s`);
await press('btn-jump', 2);
// (17 Nov brief: the launch rock is a mountain of pointed peaks that drives up under the feet and sinks back, in
//  place of the flat-topped pillar)
let ePeak = 0, pil = 0; await run(40, async (i, r) => { ePeak = Math.max(ePeak, r.alt); pil = Math.max(pil, await S(() => window.__EF.world.bending.weapons.spires.length)); if (i === 6) await shot('earth-launch'); });
check('JUMP while surfing: a mountain of rock drives up and launches the earthbender', ePeak > 2.8 && pil > 0, `peak ${ePeak.toFixed(2)} m, launch rocks ${pil}`);
await stickUp(); await fUp(7); await run(30);

// ================================================================== FIRE
head('Fire: stomp');
// (17 Nov, M6 brief: the stomp is one wave of fire rolling out of the stamping foot in a full circle, in place of the
//  fireball that ran to the rival and ringed them; the three checks below test the wave instead of the ring)
await setup({ el: 'fire', p: [0, 0, -12], o: [0, 0, -6] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6); await clearHits();
let wave = null, fwMax = 0, waveT = 0;
for (let j = 0; j < 60; j++) { await stepN(1); const r = await S(() => { const E = window.__EF, R = E.world.bending.rings.find(x => x.quiet && x.owner === E.player); return R ? { r: R.r, cx: R.center.x, cz: R.center.z, px: E.player.pos.x, pz: E.player.pos.z } : null; }); if (r) { if (!wave) { wave = r; await shot('fire-stomp-wave'); } fwMax = Math.max(fwMax, r.r); waveT++; } }
check('charged LEG: the stomp sends one wave of fire out of the stamping foot in a full circle', wave && Math.hypot(wave.cx - wave.px, wave.cz - wave.pz) < 1.2 && fwMax > 7.5, wave ? `wave from ${Math.hypot(wave.cx - wave.px, wave.cz - wave.pz).toFixed(2)} m of the bender, out to ${fwMax.toFixed(1)} m` : 'no wave');
const frHits = await hitsOn();
check('the wave reaches and hits a rival 6 m away', frHits.includes('fireRing'), `rival hit by: ${frHits.join(',') || 'nothing'}`);
check('the wave has rolled past within 1.5 seconds', waveT > 0 && waveT / 30 <= 1.5, `rolled for ${(waveT / 30).toFixed(2)} s`);

head('Fire: flame propulsion');
await setup({ el: 'fire', locked: false, p: [-8, 0, -14], o: [20, 0, 20] }); await stepN(3);
await hold('btn-dodge', 7); await stick(0, -80);
const fl2 = await run(30); await shot('fire-flame-run');
// (18 Nov, after review: held DODGE no longer starts the flame run, which put the legs back to running; it keeps
//  the jet glide going, legs off the floor, for as long as it is held. JUMP from the glide is the flame jump)
check('DODGE held: the flames from the feet keep the glide going, off the floor', fl2.filter(r => r.dk === 'rocket' && r.alt > 0.6).length > 20 && !fl2.some(r => r.mob === 'flame') && Math.max(...fl2.map(r => r.sp)) > 8, `${fl2.filter(r => r.dk === 'rocket').length} frames gliding, top ${Math.max(...fl2.map(r => r.sp)).toFixed(1)} m/s, up to ${Math.max(...fl2.map(r => r.alt)).toFixed(2)} m`);
await press('btn-jump', 1); await hold('btn-jump', 8);
let fPk = 0; await run(40, (i, r) => { fPk = Math.max(fPk, r.alt); });
check('JUMP from the glide: a flame-powered high jump', fPk > 3, `peak ${fPk.toFixed(2)} m`);
await fUp(8); await stickUp(); await fUp(7); await run(30);

// ================================================================== OPPONENT
head('Opponent responses (game AI, Master)');
const realAI = (d) => ev((d) => { const E = window.__EF; E.ai.update = Object.getPrototypeOf(E.ai).update; E.ai.setDifficulty(d); Object.assign(E.ai, { combo: [], reaction: null, guardT: 0, heavyT: 99, mobT: 0, throwT: 99, specialT: 99, meleeT: 99 }); }, d);
const quiet = () => S(() => { Object.assign(window.__EF.ai, { heavyT: 99, throwT: 99, specialT: 99, meleeT: 99, mobT: 0 }); });   /* the AI only defends during these trials */
let avoidedE = 0, avoidedR = 0;
for (let k = 0; k < 5; k++) {
  await setup({ el: 'earth', p: [0, 0, -12], o: [0, 0, -5] }); await realAI('master'); await stepN(2);
  await hold('btn-leg'); for (let j = 0; j < 30; j++) { await quiet(); await stepN(1); } await fUp(6); await clearHits();
  for (let j = 0; j < 40; j++) { await quiet(); await stepN(1); }
  if (!(await hitsOn()).includes('eruption')) avoidedE++;
  await stubAI();
}
check('the opponent gets off marked ground before most eruptions', avoidedE >= 3, `${avoidedE}/5 eruptions avoided`);
for (let k = 0; k < 5; k++) {
  await setup({ el: 'fire', p: [0, 0, -12], o: [0, 0, -6] }); await realAI('master'); await stepN(2);
  await hold('btn-leg'); for (let j = 0; j < 30; j++) { await quiet(); await stepN(1); } await fUp(6); await clearHits();
  for (let j = 0; j < 45; j++) { await quiet(); await stepN(1); }
  if (!(await hitsOn()).includes('fireRing')) avoidedR++;
  await stubAI();
}
check('the opponent jumps most fire rings', avoidedR >= 3, `${avoidedR}/5 fire rings avoided`);
// a flying player is still attacked (projectiles aimed at their height)
await setup({ el: 'air', p: [0, 0, -10], o: [0, 0, -2], oel: 'earth' }); await realAI('master');
await S(() => { const E = window.__EF, C = E.world.combat, d = C.damage.bind(C); window.__hitsP = []; if (!C.__wrappedP) { C.__wrappedP = true; const prev = C.damage; C.damage = (t, dmg, ...r) => { if (t === E.player) window.__hitsP.push(r[2]); return prev(t, dmg, ...r); }; } });
// (17 Nov brief: Air flight starts with JUMP)
await press('btn-jump', 2); await hold('btn-jump', 6); await stepN(20); await fUp(6);
let shots2 = 0; for (let j = 0; j < 150; j++) { await stepN(1); if (j % 10 === 0) shots2 = Math.max(shots2, await S(() => window.__EF.world.bending.objs.filter(o => o.owner === window.__EF.opp && o.state === 'flying').length)); }
const flyHits = await S(() => window.__hitsP || []);
await stubAI(); await stepN(60);
check('the opponent keeps attacking a flying player from the ground', shots2 > 0 || flyHits.length > 0, `projectiles in the air ${shots2}, hits on the flier: ${flyHits.join(',') || 'none'}`);

// ================================================================== VENUE
head('Venue: barn ruin');
await S(() => window.__EF.world.arena.setVenue('barn'));
const V = await S(() => { const A = window.__EF.world.arena; return { venue: A.venue, cols: A.colliders.filter(c => c.venue).length, hidden: A.colliders.filter(c => c.hidden).length, inScene: !!(A.barn && A.barn.mesh.parent) }; });
check('the barn ruin loads into the arena with its colliders', V.venue === 'barn' && V.inScene && V.cols > 20, JSON.stringify(V));
check('courtyard props inside the ruin are put away', V.hidden > 0, `${V.hidden} props hidden`);
// walk into the longest wall
const wall = await S(() => { const c = window.__EF.world.arena.colliders.filter(c => c.venue).sort((a, b) => Math.max(b.hx, b.hz) * b.top - Math.max(a.hx, a.hz) * a.top)[0]; return { x: c.x, z: c.z, hx: c.hx, hz: c.hz, top: c.top }; });
const along = wall.hx > wall.hz ? 'z' : 'x';
const start = along === 'z' ? [wall.x, 0, wall.z - wall.hz - 3] : [wall.x - wall.hx - 3, 0, wall.z];
const across = along === 'z' ? [wall.x, 0, wall.z + wall.hz + 4] : [wall.x + wall.hx + 4, 0, wall.z];
await setup({ el: 'earth', locked: true, p: start, o: across }); await stepN(3);   /* facing the rival across the wall: forward runs into it */
await stick(0, -80); await stepN(60); await stickUp();
const wp = await P(); const insideWall = Math.abs(wp.x - wall.x) < wall.hx && Math.abs(wp.z - wall.z) < wall.hz;
check('walls stop the fighters', !insideWall && wp.y < 0.6, `wall ${JSON.stringify(wall)}, fighter at ${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)}`);
await shot('venue-wall');
// the fire ring does not pass through a wall: rival directly behind the wall
await setup({ el: 'fire', p: start, o: along === 'z' ? [wall.x, 0, wall.z + wall.hz + 1.2] : [wall.x + wall.hx + 1.2, 0, wall.z] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6); await clearHits(); await stepN(50);
const behind = await hitsOn();
check('a wall shields a rival from the fire ring', !behind.includes('fireRing'), `rival hit by: ${behind.join(',') || 'nothing'}`);
// earth eruption on the barn floor
await setup({ el: 'earth', p: [-2, 0, -1.5], o: [3, 0, -1.5] }); await stepN(3);
await hold('btn-leg'); await stepN(30); await fUp(6); await clearHits(); await stepN(40);
const er = await hitsOn(); await shot('venue-earth-stomp');
check('the earth stomp erupts from the barn floor under the rival', er.includes('eruption'), `rival hit by: ${er.join(',') || 'nothing'}`);
// flight above the walls
await setup({ el: 'air', p: [0, 0, -1], o: [0, 0, 8] }); await stepN(3);
await hold('btn-dodge', 7); await stepN(8); await hold('btn-jump', 6); const vf = await run(40); await fUp(6); await shot('venue-flight'); await fUp(7); await run(220);
check('the airbender can fly above the ruin walls', Math.max(...vf.map(r => r.y)) > wall.top + 1, `peak ${Math.max(...vf.map(r => r.y)).toFixed(1)} m, wall top ${wall.top} m`);
const info = await S(() => { const E = window.__EF; E.render(); const i = E.renderer.info.render; return { calls: i.calls, tris: i.triangles }; });
check('render cost in the barn stays bounded', info.tris < 450000 && info.calls < 200, `${info.calls} draw calls, ${info.tris} triangles`);
await setup({ el: 'water', p: [-4, 0, -2], o: [4, 0, 1] }); await stepN(20); await shot('venue-overview');
await S(() => window.__EF.world.arena.setVenue('courtyard'));
check('switching back restores the courtyard', await S(() => { const A = window.__EF.world.arena; return A.venue === 'courtyard' && !A.colliders.some(c => c.venue || c.hidden); }));

head('Regression');
check('no runtime errors during the test', errors.length === 0, errors.slice(0, 3).join(' | '));
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} overhaul checks passed against ${BASE}`);
fs.writeFileSync(`${OUT}/overhaul-results.json`, JSON.stringify({ base: BASE, build: await S(() => document.getElementById('build-stamp') ? document.getElementById('build-stamp').textContent : null), results }, null, 1));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
