// Automated play test for Elemental Forge.
// Launches the game in Chromium at a Galaxy S25 Ultra landscape viewport, drives it with real CDP
// multi-touch events on the on-screen controls, and steps the simulation in exact 1/30 s frames so
// that timing-sensitive mechanics are tested deterministically. Usage:
//   node tests/play-test.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let section = '';
const check = (name, ok, detail = '') => { results.push({ section, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const head = (s) => { section = s; console.log(`\n== ${s}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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

// ======================================================================== load
head('Load and render');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
await sleep(800);
await shot('01-menu');
check('page loads without errors', errors.length === 0, errors.join(' | '));
check('WebGL context available', await ev(() => { const c = document.getElementById('game'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }));
await page.locator('#btn-start').tap();
await ev(() => { const E = window.__EF; E.state.manual = true; E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; });
await stepN(50);
check('fight phase begins', (await S(() => window.__EF.state.phase)) === 'fight');
const vis = await S(() => { const { world, player, opp } = window.__EF; const p = player.pos.clone(); p.y += 1; p.project(world.camera); const o = opp.pos.clone(); o.y += 1; o.project(world.camera); const inV = v => Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1; return [inV(p), inV(o)]; });
check('player and rival both on screen', vis[0] && vis[1]);
await shot('02-fight');

// ======================================================================== star controls
head('Star-shaped mobile controls');
const layout = async () => S(() => { const ids = ['jump', 'guard', 'dodge', 'hand', 'leg', 'special']; const r = {}; for (const id of ids) { const b = document.getElementById('btn-' + id).getBoundingClientRect(); r[id] = { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2, b }; } return { r, W: innerWidth, H: innerHeight }; });
const checkLayout = (L, tag) => {
  const r = L.r, ids = Object.keys(r);
  let minGap = 1e9, pair = '';
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = r[ids[i]], b = r[ids[j]]; const g = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r; if (g < minGap) { minGap = g; pair = ids[i] + '/' + ids[j]; } }
  const inside = ids.every(k => r[k].b.left >= 0 && r[k].b.right <= L.W && r[k].b.top >= 80 && r[k].b.bottom <= L.H);
  const star = r.jump.y < r.guard.y && r.jump.y < r.dodge.y && r.guard.x < r.special.x && r.dodge.x > r.special.x && r.guard.y < r.hand.y && r.dodge.y < r.leg.y && r.hand.x < r.special.x && r.leg.x > r.special.x && r.hand.y > r.special.y && r.leg.y > r.special.y && Math.abs(r.jump.x - r.special.x) < 2;
  check(`${tag}: five-point star around a centre SPECIAL`, star, `JUMP top, GUARD upper-left, DODGE upper-right, HAND lower-left, LEG lower-right`);
  check(`${tag}: no overlapping button hitboxes`, minGap > 6, `smallest gap ${minGap.toFixed(1)} px (${pair})`);
  check(`${tag}: all buttons on screen, clear of the health bars`, inside);
};
checkLayout(await layout(), 'default size');
await S(() => { const E = window.__EF; E.state.btnSize = 1.25; E.state.btnSpread = 1.3; E.layoutStar(); });
checkLayout(await layout(), 'largest size and spacing');
await S(() => { const E = window.__EF; E.state.btnSize = 1; E.state.btnSpread = 1; E.layoutStar(); });
check('HAND and LEG are the largest buttons', await S(() => { const w = id => document.getElementById(id).getBoundingClientRect().width; return w('btn-hand') > w('btn-guard') && w('btn-leg') > w('btn-jump') && w('btn-hand') === w('btn-leg'); }));
await shot('03-star-controls');

// ======================================================================== movement
head('Movement, camera and multi-touch');
await setup({ locked: false, p: [0, 0, -14], o: [20, 0, 20] });
await stick(0, -25); await stepN(20);
const walkSp = await S(() => Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z));
await stick(0, -80); await stepN(8);
const runSp = await S(() => Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z));
await stepN(25);
const spr = await S(() => ({ sp: Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z), on: window.__EF.player.sprinting }));
check('partial stick deflection walks', walkSp > 1 && walkSp < 4, `${walkSp.toFixed(2)} m/s`);
check('full deflection runs', runSp > 5, `${runSp.toFixed(2)} m/s`);
check('holding the stick at its rim sprints', spr.on && spr.sp > 8, `${spr.sp.toFixed(2)} m/s`);
const yaw0 = await S(() => window.__EF.camCtl.yaw);
await fDown(2, 600, 200); for (let i = 1; i <= 8; i++) { await fMove(2, 600 + i * 20, 200); await stepN(1); } await fUp(2);
const yaw1 = await S(() => window.__EF.camCtl.yaw);
check('right-half drag turns the camera while running (two fingers)', Math.abs(yaw1 - yaw0) > 0.2, `yaw change ${(yaw1 - yaw0).toFixed(2)} rad`);
await stickUp(); await stepN(15);
check('player decelerates to a stop on release', (await S(() => Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z))) < 0.3);
await setup({ locked: true, p: [0, 0.16, -3], o: [0, 0.16, 4] });
await stick(80, 0); await stepN(20);
const strafe = await S(() => { const { player, opp } = window.__EF; const want = Math.atan2(opp.pos.x - player.pos.x, opp.pos.z - player.pos.z); const d = Math.atan2(Math.sin(want - player.faceYaw), Math.cos(want - player.faceYaw)); const mv = Math.atan2(player.vel.x, player.vel.z); return { faceErr: Math.abs(d), moveVsFace: Math.abs(Math.atan2(Math.sin(mv - player.faceYaw), Math.cos(mv - player.faceYaw))) }; });
await stickUp();
check('locked strafe: faces the rival while moving sideways', strafe.faceErr < 0.25 && strafe.moveVsFace > 1 && strafe.moveVsFace < 2.2, `face error ${strafe.faceErr.toFixed(2)}, move vs facing ${strafe.moveVsFace.toFixed(2)} rad`);
// jumping, double jump for air
await setup({ locked: false, el: 'earth', p: [0, 0, -14], o: [20, 0, 20] });
await press('btn-jump', 1); let h1 = 0; for (let i = 0; i < 20; i++) { await stepN(1); h1 = Math.max(h1, await S(() => window.__EF.player.pos.y)); }
await stepN(20);
await setup({ locked: false, el: 'air', p: [0, 0, -14], o: [20, 0, 20] });
await press('btn-jump', 1); await stepN(12); await press('btn-jump', 1); let h2 = 0; for (let i = 0; i < 25; i++) { await stepN(1); h2 = Math.max(h2, await S(() => window.__EF.player.pos.y)); }
check('jump leaves the ground', h1 > 0.9, `${h1.toFixed(2)} m`);
check('air: air-assisted double jump goes higher', h2 > h1 + 0.6, `air ${h2.toFixed(2)} m vs earth ${h1.toFixed(2)} m`);
await stepN(30);
// ramp / ledge (slope)
await setup({ locked: false, p: [-12.5, 0, 16], o: [20, 0, 20] });
await S(() => { window.__EF.camCtl.yaw = -Math.PI / 2; });
await stick(0, -80); let maxY = 0; for (let i = 0; i < 25; i++) { await stepN(3); maxY = Math.max(maxY, await S(() => window.__EF.player.pos.y)); } await stickUp();
check('slope: runs up the ramp onto the 1.6 m ledge', maxY > 1.5, `max height ${maxY.toFixed(2)} m`);

// ======================================================================== styles
head('Four distinct martial-arts styles');
const styleData = await S(() => {
  const { player: p } = window.__EF, out = {};
  for (const el of ['earth', 'fire', 'water', 'air']) {
    p.setElement(el, true); p.action = null; p.speedNorm = 0; p.onGround = true; p.guarding = p.holding = p.charging = false; p.dodgeT = 0;
    for (let i = 0; i < 60; i++) { p.time += 1 / 30; p.animate(1 / 30); }
    out[el] = { pose: Array.from(p.cur), run: p.style.loco.run, sprint: p.style.loco.sprint, dodge: p.style.dodge.kind, art: p.style.art, hipDrop: p.cur[p.cur.length - 2] };
  }
  return out;
});
const els = ['earth', 'fire', 'water', 'air'];
let minPoseDist = 1e9, minPair = '';
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const a = styleData[els[i]].pose, b = styleData[els[j]].pose; let d = 0; for (let k = 0; k < a.length; k++) d += (a[k] - b[k]) ** 2; d = Math.sqrt(d); if (d < minPoseDist) { minPoseDist = d; minPair = els[i] + '/' + els[j]; } }
check('each element has its own stance (pose distance between every pair)', minPoseDist > 0.8, `closest pair ${minPair}: ${minPoseDist.toFixed(2)} rad`);
check('earth stance is the lowest (rooted Hung Gar)', styleData.earth.hipDrop < Math.min(styleData.fire.hipDrop, styleData.water.hipDrop, styleData.air.hipDrop), els.map(e => `${e} ${styleData[e].hipDrop.toFixed(2)}`).join(', '));
check('air is the fastest and earth the slowest mover', styleData.air.sprint > styleData.fire.sprint && styleData.earth.sprint < styleData.water.sprint, els.map(e => `${e} ${styleData[e].sprint}`).join(', ') + ' m/s sprint');
check('each element dodges differently', new Set(els.map(e => styleData[e].dodge)).size === 4, els.map(e => `${e}: ${styleData[e].dodge}`).join(', '));
check('styles named after their martial arts', styleData.earth.art === 'Hung Gar' && styleData.fire.art === 'Northern Shaolin' && styleData.water.art === 'Tai Chi Chuan' && styleData.air.art === 'Baguazhang');

// ======================================================================== element switching
head('Element switching');
await setup({ locked: false, el: 'earth', p: [0, 0, -14], o: [20, 0, 20] });
await stick(0, -80); await stepN(10);
const sw = [];
for (const el of ['fire', 'water', 'air', 'earth']) {
  const c = await btnCenter(`elements .el[data-el="${el}"]`.replace('elements ', '')).catch(() => null);
  const b = await page.locator(`.el[data-el="${el}"]`).boundingBox();
  await fDown(7, b.x + b.width / 2, b.y + b.height / 2); await stepN(2); await fUp(7); await stepN(4);
  sw.push(await S((el) => { const p = window.__EF.player, c = p.mesh.geometry.attributes.color, i = p.sashIdx[0]; return { el: p.el, want: el, sp: Math.hypot(p.vel.x, p.vel.z), sash: [c.getX(i), c.getY(i), c.getZ(i)], active: document.querySelector('.el.active').dataset.el }; }, el));
}
await stickUp();
check('element buttons switch instantly while running (touch)', sw.every(s => s.el === s.want && s.active === s.want), sw.map(s => s.el).join(' -> '));
check('switching does not interrupt movement', sw.every(s => s.sp > 4), sw.map(s => s.sp.toFixed(1)).join(', ') + ' m/s');
check('the sash takes each element\'s colour', new Set(sw.map(s => s.sash.map(v => v.toFixed(2)).join())).size === 4);

// ======================================================================== per-element techniques
const elRes = {};
for (const el of els) {
  head(`${el.toUpperCase()}: HAND, LEG, sustained control, defence, charged technique`);
  const R = elRes[el] = {};
  // HAND tap at range: element projectile hits
  await setup({ el, p: [0, 0, -12], o: [0, 0, -4] });
  await press('btn-hand', 2);
  const kinds = new Set(); for (let i = 0; i < 30; i++) { await stepN(1); (await S(() => window.__EF.world.bending.objs.map(o => o.kind))).forEach(k => kinds.add(k)); }
  R.hand = await S(() => window.__EF.opp.hp);
  check(`${el}: HAND sends an element projectile that hits`, R.hand < 100 && kinds.size > 0, `projectile ${[...kinds].join(',')}; rival hp ${R.hand}`);
  await shot(`10-${el}-hand`);
  // LEG tap at range
  await setup({ el, p: [0, 0, -12], o: [0, 0, -5.5] });
  await press('btn-leg', 2);
  let legReact = new Set(), kick = null;
  for (let i = 0; i < 30; i++) {
    await stepN(1);
    const s = await S(() => { const { player: p, opp: o } = window.__EF; const T = p.tech;
      if (p.hero) {   // measure the visible character: thigh angle from vertical, ankle heights, chest rotation against the hips
        const B = p.hero.bones, V = p.pos.constructor, wp = (n) => B[n].getWorldPosition(new V()), wq = (n) => B[n].getWorldQuaternion(B[n].quaternion.clone());
        const thigh = (x) => { const d = wp('DEF-shin' + x).sub(wp('DEF-thigh' + x)).normalize(); return Math.acos(Math.max(-1, Math.min(1, -d.y))); };
        const qc = wq('DEF-spine003'), qh = wq('DEF-hips'); const dot = Math.abs(qc.x * qh.x + qc.y * qh.y + qc.z * qh.z + qc.w * qh.w);
        const tw = 2 * Math.acos(Math.min(1, dot));
        return { a: o.action, u: p.action === 'tech' ? p.actionU : -1, active: T && T.active ? T.active.from : 0.4, hipL: [thigh('L'), 0], hipR: [thigh('R'), 0], spine: [tw], aL: wp('DEF-footL').y - p.groundY, aR: wp('DEF-footR').y - p.groundY };
      }
      return { a: o.action, u: p.action === 'tech' ? p.actionU : -1, active: T && T.active ? T.active.from : 0.4, hipL: [p.cur[33], p.cur[35]], hipR: [p.cur[42], p.cur[44]], spine: [p.cur[3], p.cur[4], p.cur[5], p.cur[0], p.cur[1], p.cur[2]], aL: p.J.aL.getWorldPosition(p.pos.clone()).y - p.groundY, aR: p.J.aR.getWorldPosition(p.pos.clone()).y - p.groundY }; });
    if (s.a) legReact.add(s.a);
    if (!kick && s.u >= s.active) kick = s;
    if (i === 10) await shot(`11-${el}-leg`);
  }
  R.leg = await S(() => window.__EF.opp.hp);
  check(`${el}: LEG kick launches its technique and staggers the rival`, R.leg < 100 && (legReact.has('stagger') || legReact.has('down')), `rival hp ${R.leg}; reactions ${[...legReact].filter(Boolean).join(',')}`);
  if (kick) {
    const kickLeg = Math.max(Math.abs(kick.hipL[0]) + Math.abs(kick.hipL[1]), Math.abs(kick.hipR[0]) + Math.abs(kick.hipR[1]));
    const supportFoot = Math.min(kick.aL, kick.aR), torso = Math.max(...kick.spine.map(Math.abs));
    check(`${el}: full-body kick (leg raised, supporting foot planted, hips/torso engaged)`, kickLeg > 0.9 && supportFoot < 0.4 && torso > 0.08, `kicking hip ${kickLeg.toFixed(2)} rad, support ankle ${supportFoot.toFixed(2)} m above ground, torso ${torso.toFixed(2)} rad`);
  }
  // sustained HAND hold (and movement while bending)
  const holdPos = el === 'water' ? [12, 0, -9] : [0, 0, -12];
  await setup({ el, p: holdPos, o: el === 'water' ? [12, 0, -1] : [0, 0, -5] });
  await hold('btn-hand'); await stepN(el === 'water' ? 60 : 40);
  const sus = await S(() => { const { player: p, opp: o, world } = window.__EF; return { holding: p.holding, held: world.bending.held(p), oHp: o.hp, oz: o.pos.z }; });
  await stick(80, 0); await stepN(15);
  const moveBend = await S(() => ({ sp: Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z), holding: window.__EF.player.holding, held: window.__EF.world.bending.held(window.__EF.player) }));
  await stickUp(); await shot(`12-${el}-hold`);
  await fUp(6); await stepN(4);
  const susDetail = `holding=${sus.holding}, held objects ${sus.held}, rival hp ${sus.oHp}`;
  if (el === 'earth') check('earth: holding HAND lifts three rocks that orbit the player', sus.holding && sus.held === 3, susDetail);
  if (el === 'fire') check('fire: holding HAND sustains a fire stream that burns the rival', sus.holding && sus.oHp < 100, susDetail);
  if (el === 'water') check('water: holding HAND near a pool draws three water globes', sus.holding && sus.held === 3, susDetail);
  if (el === 'air') check('air: holding HAND pushes the rival back with a sustained wind', sus.holding && sus.oz > -5 + 1.5, `${susDetail}, rival pushed to z ${sus.oz.toFixed(1)} (from -5)`);
  check(`${el}: can move while sustaining bending`, moveBend.sp > 1.5 && (moveBend.holding || moveBend.held > 0), `${moveBend.sp.toFixed(1)} m/s while bending`);
  // multiple controlled objects
  if (el === 'earth') {
    const before = await S(() => window.__EF.world.bending.held(window.__EF.player));
    await press('btn-hand', 2); await stepN(15);
    const mid = await S(() => window.__EF.world.bending.held(window.__EF.player));
    await press('btn-leg', 2); await stepN(15);
    const after = await S(() => ({ held: window.__EF.world.bending.held(window.__EF.player), kinds: window.__EF.world.bending.objs.filter(o => o.state === 'flying').map(o => o.kind) }));
    check('earth: held rocks are launched one at a time by punches and kicks', before === 3 && mid === 2 && after.held === 1, `${before} -> ${mid} (punch) -> ${after.held} (kick)`);
  }
  if (el === 'fire' || el === 'air') {
    await setup({ el, p: [0, 0, -14], o: [0, 0, -2] });
    for (let i = 0; i < 3; i++) { await press('btn-special', 2); await stepN(14); }
    const orbs = await S(() => window.__EF.world.bending.held(window.__EF.player));
    await shot(`13-${el}-three-orbs`);
    // the release happens on the 4th press's impact frame (about 0.3 s into the authored throw)
    await press('btn-special', 2); await stepN(14);
    const fly = await S(() => window.__EF.world.bending.objs.filter(o => o.state === 'flying' && o.owner === window.__EF.player).map(o => o.kind));
    await stepN(30);
    check(`${el}: SPECIAL builds up three controlled ${el === 'fire' ? 'flame orbs' : 'vortices'}, then releases them together`, orbs === 3 && fly.length >= 1, `held ${orbs}, then flying: ${fly.join(',')}`);
  }
  if (el === 'water') {
    const g0 = moveBend.held;
    await setup({ el, p: [12, 0, -9], o: [12, 0, -3] });
    await hold('btn-hand'); await stepN(60); await fUp(6); await stepN(2);
    const g1 = await S(() => window.__EF.world.bending.held(window.__EF.player));
    await press('btn-leg', 2); await stepN(20);
    const g2 = await S(() => ({ held: window.__EF.world.bending.held(window.__EF.player), oHp: window.__EF.opp.hp }));
    check('water: a kick spends one held globe as a water arc', g1 === 3 && g2.held === 2 && g2.oHp < 100, `globes ${g1} -> ${g2.held}; rival hp ${g2.oHp}`);
    // whip once full
    await hold('btn-hand'); await stepN(30);
    const whip = await S(() => { const h = window.__EF.world.bending.holds.get(window.__EF.player); return { mode: h && h.mode, oHp: window.__EF.opp.hp }; });
    await shot('13-water-whip');
    await fUp(6); await stepN(4);
    check('water: holding HAND with full globes becomes a water whip', whip.mode === 'whip', `mode ${whip.mode}, rival hp ${whip.oHp}`);
  }
  // defence: raise guard, rival fires a projectile at the player
  const threat = { earth: 'rock', fire: 'fireball', water: 'fireball', air: 'rock' }[el];
  await setup({ el, p: [0, 0, -14], o: [0, 0, -4] });
  await hold('btn-guard', 8); await stepN(12);
  await oppFire(threat, [0, 1.4, -5]);
  let vel0 = null, vel1 = null;
  for (let i = 0; i < 25; i++) { await stepN(1); const v = await S(() => { const o = window.__EF.world.bending.objs.find(o => o.owner === window.__EF.opp || o.airTurned); return o ? [o.vel.x, o.vel.z] : null; }); if (v) { if (!vel0) vel0 = v; vel1 = v; } if (i === 6) await shot(`14-${el}-guard`); }
  const def = await S(() => ({ php: window.__EF.player.hp, blocks: window.__EF.player.stats.blocks, def: window.__EF.player.defense && window.__EF.player.defense.el }));
  await fUp(8); await stepN(6);
  const name = { earth: 'stone wall stops a rock', fire: 'fire wall burns away a fireball', water: 'water shield douses a fireball', air: 'air deflection turns a rock aside' }[el];
  check(`${el}: GUARD defence works: ${name}`, def.php === 100 && def.blocks > 0, `player hp ${def.php}, blocks ${def.blocks}${el === 'air' && vel0 && vel1 ? `, rock heading changed ${(Math.abs(Math.atan2(vel1[0], vel1[1]) - Math.atan2(vel0[0], vel0[1]))).toFixed(2)} rad` : ''}`);
  // perfect guard: raise just before impact -> sent back at the thrower
  await setup({ el, p: [0, 0, -14], o: [0, 0, -4] });
  const ptype = el === 'fire' ? 'fireball' : 'rock';
  await oppFire(ptype, [0, 1.4, -5]);
  const fired = await S(() => { const E = window.__EF; for (let i = 0; i < 60; i++) { const r = E.world.bending.objs[0]; if (r && r.pos.distanceTo(E.player.chestPos()) < 4.5) { E.controls.btn.guard = true; return true; } E.step(1 / 30); } return false; });
  await stepN(25);
  const pg = await S(() => ({ perfect: window.__EF.player.stats.perfect, ohp: window.__EF.opp.hp, php: window.__EF.player.hp }));
  await S(() => { window.__EF.controls.btn.guard = false; }); await stepN(8);
  check(`${el}: perfect guard sends the ${ptype} back into the thrower`, fired && pg.perfect > 0 && pg.ohp < 100 && pg.php === 100, JSON.stringify(pg));
  // charged LEG technique
  await setup({ el, p: [0, 0, -12], o: [0, 0, -9.6] });
  await hold('btn-leg', 9); await stepN(36);
  // the opening kick knocks the rival away; bring them back in range of the charged technique
  await S(() => { const { player: p, opp: o } = window.__EF; const fw = p.forward(); o.pos.set(p.pos.x + fw.x * 2.3, 0, p.pos.z + fw.z * 2.3); o.vel.set(0, 0, 0); o.action = null; o.stunT = 0; o.invuln = 0; o.hp = 100; });
  await fUp(9);
  const reacts = new Set(); let tech = null;
  for (let i = 0; i < 30; i++) { await stepN(1); const s = await S(() => ({ a: window.__EF.opp.action, t: window.__EF.player.tech && window.__EF.player.tech.name })); if (s.a) reacts.add(s.a); if (s.t) tech = s.t; if (i === 12) await shot(`15-${el}-charged`); }
  const ch = await S(() => window.__EF.opp.hp);
  check(`${el}: hold-and-release LEG performs the charged technique`, tech && ch < 100 && (reacts.has('down') || reacts.has('stagger')), `${tech}; rival hp ${ch}; reactions ${[...reacts].join(',')}`);
  await stepN(30);
}

// ======================================================================== interactions & environment
head('Elemental interactions and environment');
await setup({ el: 'water', oel: 'fire', p: [0, 0, -14], o: [0, 0, -2] });
await S(() => { const { world, player, opp } = window.__EF, V = player.pos.constructor; world.bending.fire('fireball', opp, new V(0, 1.4, -3), { target: player.chestPos() }); world.bending.fire('water', player, new V(0, 1.4, -13), { target: opp.chestPos() }); });
let clash = null; for (let i = 0; i < 20; i++) { await stepN(1); clash = await S(() => ({ fire: window.__EF.world.bending.objs.filter(o => o.el === 'fire').length, water: window.__EF.world.bending.objs.filter(o => o.el === 'water').length })); if (!clash.fire) break; }
check('water projectile puts out a fireball in mid-air', clash.fire === 0 && clash.water === 1, JSON.stringify(clash));
await setup({ el: 'water', p: [0, 0, -14], o: [20, 0, 20] });
await S(() => { const B = window.__EF.world.bending; B.burn(0, -9, 0, window.__EF.opp); });
const burnsBefore = await S(() => window.__EF.world.bending.burns.length);
await S(() => { const { world, player } = window.__EF, V = player.pos.constructor; world.bending.fire('water', player, new V(0, 1.2, -13), { target: new V(0, 0, -9) }); });
await stepN(25);
check('water extinguishes burning ground', burnsBefore === 1 && (await S(() => window.__EF.world.bending.burns.length)) === 0);
await setup({ el: 'air', oel: 'fire', p: [0, 0, -14], o: [0, 0, -2] });
await S(() => { const { world, player, opp } = window.__EF, V = player.pos.constructor; world.bending.fire('fireball', opp, new V(0, 1.4, -3), { target: player.chestPos() }); world.bending.fire('gust', player, new V(0, 1.4, -13), { target: opp.chestPos() }); });
await stepN(25);
const blown = await S(() => ({ ohp: window.__EF.opp.hp, php: window.__EF.player.hp }));
check('air gust blows a fireball back at its caster', blown.ohp < 100 && blown.php === 100, JSON.stringify(blown));
await setup({ el: 'fire', oel: 'earth', p: [0, 0, -14], o: [0, 0, -4] });
await hold('btn-guard', 8); await stepN(12);
await oppFire('rock', [0, 1.4, -5]); await stepN(30);
const thruFire = await S(() => window.__EF.player.hp);
await fUp(8); await stepN(6);
check('a rock punches through a fire wall at reduced force', thruFire < 100 && thruFire > 100 - 12, `player hp ${thruFire} (unguarded rock does 12)`);
// pillar platform + standing on it
await setup({ el: 'earth', locked: false, p: [0, 0, -14], o: [20, 0, 20] });
await press('btn-special', 2); await stepN(25);
// let the authored pillar-raising move finish before walking onto the pillar
await S(() => { const E = window.__EF; for (let i = 0; i < 40 && E.player.action; i++) E.step(1 / 30); });
const pil = await S(() => { const p = window.__EF.world.bending.pillars[0]; return p ? { x: p.col.x, z: p.col.z, top: p.col.top } : null; });
check('earth SPECIAL raises a solid stone pillar', pil && pil.top > 1.3, JSON.stringify(pil));
await stick(0, -60); await stepN(3); await press('btn-jump', 1); let onPillar = 0; for (let i = 0; i < 30; i++) { await stepN(1); onPillar = Math.max(onPillar, await S(() => window.__EF.player.onGround ? window.__EF.player.pos.y : 0)); } await stickUp();
await shot('16-on-pillar');
check('player can jump onto the pillar and stand on it', onPillar > 1.3, `standing height ${onPillar.toFixed(2)} m`);
// boulder
const boulder = await S(() => { const c = window.__EF.world.arena.colliders.find(c => c.rock && c.walk && c.top < 1.25 && Math.hypot(c.x, c.z) < 26); return c ? { x: c.x, z: c.z, r: c.r, top: c.top } : null; });
if (boulder) {
  await setup({ el: 'air', locked: false, p: [boulder.x, 0, boulder.z - boulder.r - 1.6], o: [20, 0, 20] });
  await S(() => { window.__EF.player.faceYaw = 0; window.__EF.camCtl.yaw = 0; });
  await stick(0, -45); await press('btn-jump', 1); await stepN(4); await press('btn-jump', 1);
  let onB = 0, released = false;
  for (let i = 0; i < 40; i++) {
    await stepN(1);
    const st = await S((b) => { const p = window.__EF.player; return { d: Math.hypot(p.pos.x - b.x, p.pos.z - b.z), y: p.onGround ? p.pos.y : 0 }; }, boulder);
    if (!released && st.d < 0.35) { released = true; await stickUp(); }   // let go of the stick once over the boulder
    onB = Math.max(onB, st.y);
  }
  if (!released) await stickUp();
  check('player can jump onto a boulder and stand on it', onB > boulder.top - 0.1, `boulder top ${boulder.top.toFixed(2)} m, standing at ${onB.toFixed(2)} m`);
}
// loose stone lifted from the arena
await setup({ el: 'earth', p: [0, 0, 0], o: [20, 0, 20] });
const stoneInfo = await S(() => { const s = window.__EF.world.arena.looseStones[0]; window.__EF.player.pos.set(s.home.x + 2, 0, s.home.z); return { x: s.home.x, z: s.home.z }; });
await hold('btn-hand'); await stepN(14); await fUp(6); await stepN(4);
const lifted = await S(() => ({ taken: window.__EF.world.arena.looseStones[0].taken, kinds: window.__EF.world.bending.objs.map(o => o.kind) }));
check('earth lifts an existing loose stone from the arena', lifted.taken && lifted.kinds.includes('boulder'), JSON.stringify(lifted));

// ======================================================================== combinations & animation continuity
head('Combinations and animation continuity');
for (const el of els) {
  await setup({ el, p: [0, 0, -12], o: [0, 0, -9.8] });
  const seq = await S(() => {
    const E = window.__EF, P = E.player, C = E.controls; let maxJump = 0, idleGaps = 0, prev = Float32Array.from(P.cur), techs = [];
    const plan = { 0: 'hand', 9: 'leg', 24: 'hand', 33: 'dodge', 45: 'leg', 60: 'special' };
    for (let f = 0; f < 80; f++) {
      if (plan[f]) C.pressed[plan[f]] = true;
      E.step(1 / 30);
      for (let i = 0; i < 51; i++) maxJump = Math.max(maxJump, Math.abs(P.cur[i] - prev[i]));
      prev = Float32Array.from(P.cur);
      if (P.action === 'tech' && techs[techs.length - 1] !== P.tech.name + P.techSide) techs.push(P.tech.name + P.techSide);
    }
    return { maxJump, techs: techs.length };
  });
  check(`${el}: HAND / LEG / dodge / SPECIAL chain flows without pose snapping`, seq.techs >= 4 && seq.maxJump < 0.75, `${seq.techs} techniques, largest single-frame joint change ${seq.maxJump.toFixed(2)} rad`);
}
// the brief's earth combination: raise a rock, move sideways while controlling it, kick it
await setup({ el: 'earth', p: [0, 0, -12], o: [0, 0, -3] });
await hold('btn-hand'); await stepN(14); await fUp(6);
await stick(80, 0); await stepN(15);
const combo = await S(() => ({ held: window.__EF.world.bending.held(window.__EF.player), sp: Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z) }));
await press('btn-leg', 2); await stepN(25); await stickUp();
const comboHit = await S(() => window.__EF.opp.hp);
check('earth combo: lift a rock, strafe while holding it, kick it into the rival', combo.held >= 1 && combo.sp > 3 && comboHit < 100, `held ${combo.held} at ${combo.sp.toFixed(1)} m/s, rival hp ${comboHit}`);

// ======================================================================== camera
head('Camera');
await setup({ el: 'earth', locked: false, p: [-20, 0.9, -15.4], o: [20, 0, 20] });
// player stands just north of the stepped platform, camera looks north so it sits above the platform behind them
await S(() => { const E = window.__EF; E.player.pos.set(-20, 0, -13.6); E.player.faceYaw = E.player.yaw = 0; E.camCtl.snapBehind(E.player); E.camCtl.yaw = 0; E.camCtl.pitch = -0.32; E.camCtl.autoCam = false; });
await stepN(20);
const cam = await S(() => { const E = window.__EF, v = E.player.pos.clone(); v.y += 1; v.project(E.world.camera); return { lift: E.camCtl.pitchLift, py: v.y }; });
await shot('17-camera-platform');
check('camera rises over a raised platform edge instead of being blocked', cam.lift > 0.05 && Math.abs(cam.py) < 0.9, `pitch lift ${cam.lift.toFixed(2)} rad, player at screen y ${cam.py.toFixed(2)}`);
await S(() => { window.__EF.camCtl.autoCam = true; });
await setup({ el: 'fire', locked: false, p: [0, 0, -12], o: [20, 0, 20] });
const camSpin = await S(() => { const E = window.__EF, P = E.player; const y0 = E.camCtl.yaw; let maxD = 0, spinMax = 0;
  E.controls.pressed.leg = true; for (let i = 0; i < 10; i++) E.step(1 / 30);
  // body rotation: the procedural spin (spinYaw) or, with authored clips, the hips' turn relative to the fighter's facing
  const hipsYaw = () => { if (!P.hero) return 0; const hb = P.hero.bones['DEF-hips'], q = hb.getWorldQuaternion(hb.quaternion.clone()); const f = { x: 2 * (q.x * q.z + q.w * q.y), z: 1 - 2 * (q.x * q.x + q.y * q.y) }; let d = Math.atan2(f.x, f.z) - P.yaw; return Math.atan2(Math.sin(d), Math.cos(d)); };
  let turned = 0, prevH = hipsYaw();
  E.controls.pressed.leg = true; for (let i = 0; i < 30; i++) { E.step(1 / 30); maxD = Math.max(maxD, Math.abs(E.camCtl.yaw - y0)); const h = hipsYaw(); let dh = h - prevH; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); turned += Math.abs(dh); prevH = h; spinMax = Math.max(spinMax, Math.abs(P.spinYaw), turned); }
  return { maxD, spun: P.stats.techniques['Spinning Flame Kick'] || 0, spinMax }; });
check('camera stays steady through spinning kicks', camSpin.spun > 0 && camSpin.spinMax > 3 && camSpin.maxD < 0.12, `spinning kicks ${camSpin.spun}, body turned ${camSpin.spinMax.toFixed(1)} rad, camera yaw drift ${camSpin.maxD.toFixed(3)} rad`);

// ======================================================================== live AI round + regression
head('AI, performance and regression');
await page.reload(); await page.waitForFunction(() => window.__EF); await sleep(500);
await page.locator('#btn-start').tap();
const aiRun = await S(() => { const E = window.__EF; E.state.manual = true; const t0 = performance.now(); for (let i = 0; i < 330; i++) E.step(1 / 30); E.render(); return { ms: (performance.now() - t0) / 330, oppEl: E.opp.el, techs: E.opp.stats.techniques, php: E.player.hp, finite: E.world.fighters.every(f => ![...f.cur].some(Number.isNaN) && Number.isFinite(f.pos.x)), info: E.info() }; });
await shot('18-ai-round');
check('AI rival fights with its element techniques', Object.keys(aiRun.techs).length >= 2, `${aiRun.oppEl}: ${JSON.stringify(aiRun.techs)}, player hp ${aiRun.php}`);
check('fighter state stays finite (no NaN poses)', aiRun.finite);
check('simulation cost per frame is small', aiRun.ms < 12, `${aiRun.ms.toFixed(2)} ms per simulated frame (includes HUD; software renderer not included)`);
check('render cost stays bounded', aiRun.info.calls < 220, `${aiRun.info.calls} draw calls, ${aiRun.info.triangles} triangles`);
// portrait prompt
const pctx = await browser.newContext({ viewport: { width: 412, height: 891 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const pp = await pctx.newPage(); pp.on('pageerror', e => errors.push(e.message));
await pp.goto(BASE); await pp.waitForFunction(() => window.__EF); await pp.evaluate(() => document.getElementById('btn-start').click()); await sleep(300);
check('portrait shows the rotate-phone prompt', (await pp.evaluate(() => getComputedStyle(document.getElementById('rotate')).display)) === 'flex');
check('no runtime errors during the whole test', errors.length === 0, errors.slice(0, 5).join(' | '));

fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
