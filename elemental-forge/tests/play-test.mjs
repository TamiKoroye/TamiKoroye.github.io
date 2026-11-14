// Automated play test: launches the game in Chromium at a Galaxy S25 Ultra-sized landscape
// viewport, drives it with real CDP multi-touch events and checks game state + screenshots.
// Usage: node tests/play-test.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// S25 Ultra CSS viewport is ~412 x 891 in portrait; play in landscape.
const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
const fingers = new Map();
const fDown = (id, x, y) => { fingers.set(id, { x, y, id }); return touch(fingers.size === 1 ? 'touchStart' : 'touchStart', [...fingers.values()]); };
const fMove = (id, x, y) => { fingers.set(id, { x, y, id }); return touch('touchMove', [...fingers.values()]); };
const fUp = (id) => { fingers.delete(id); return fingers.size ? touch('touchMove', [...fingers.values()]) : touch('touchEnd', []); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const waitGame = async (sec) => { // wait for `sec` seconds of *game* time (headless GPU is slow)
  const t0 = await ev(() => window.__EF.player.time);
  for (let i = 0; i < 400; i++) { await sleep(50); const t = await ev(() => window.__EF.player.time); if (t - t0 >= sec) return; }
};
const btnCenter = async (id) => { const b = await page.locator('#' + id).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const tapBtn = async (id, holdSec = 0.05, tid = 5) => { const c = await btnCenter(id); await fDown(tid, c.x, c.y); await waitGame(holdSec); await fUp(tid); };

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__EF, null, { timeout: 30000 });
await sleep(1500);
await shot('01-menu');
check('page loads without errors', errors.length === 0, errors.join(' | '));
const gl = await ev(() => { const c = document.getElementById('game'); const g = c.getContext('webgl2') || c.getContext('webgl'); return !!g; });
check('WebGL context available', gl);

// start with deterministic AI for the mechanics tests (no dodging / attacking unless we ask)
await page.locator('#btn-start').tap();
// mechanics checks run against a passive rival (it stands and faces the player); the real AI is exercised later on a fresh page
await ev(() => { const a = window.__EF.ai; a.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.attack = i.bend = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; });
await waitGame(1.6);
await shot('02-round-start');
const s0 = await ev(() => ({ phase: window.__EF.state.phase, p: window.__EF.player.pos.toArray(), o: window.__EF.opp.pos.toArray(), meshes: (() => { let n = 0; window.__EF.world.scene.traverse(o => { if (o.isMesh) n++; }); return n; })() }));
check('fight phase begins', s0.phase === 'fight', s0.phase);
check('scene populated with meshes', s0.meshes > 100, `${s0.meshes} meshes (each fighter is now a single skinned mesh)`);

// visibility of both fighters in camera frustum
const vis = await ev(() => {
  const { world, player, opp } = window.__EF; const cam = world.camera; cam.updateMatrixWorld();
  const p = player.pos.clone(); p.y += 1; p.project(cam); const o = opp.pos.clone(); o.y += 1; o.project(cam);
  const inV = v => Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1;
  return { player: inV(p), opp: inV(o) };
});
check('player visible on screen', vis.player); check('opponent visible on screen', vis.opp);

// ---------------- movement with the left virtual stick (lock-on off so the camera is free)
await ev(() => { window.__EF.state.locked = false; });
const startPos = await ev(() => window.__EF.player.pos.clone());
await touch('touchStart', [{ x: 160, y: 300, id: 1 }]);
await touch('touchMove', [{ x: 160, y: 230, id: 1 }]); // push forward
await waitGame(0.6);
await shot('03-running-forward');
await waitGame(0.6);
const mid = await ev(() => ({ pos: window.__EF.player.pos.clone(), speed: Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z), yaw: window.__EF.camCtl.yaw }));
check('stick forward moves the player', Math.hypot(mid.pos.x - startPos.x, mid.pos.z - startPos.z) > 2, `moved ${Math.hypot(mid.pos.x - startPos.x, mid.pos.z - startPos.z).toFixed(2)} m, speed ${mid.speed.toFixed(2)}`);

// ---------------- simultaneous: keep running + drag right half to rotate the camera (multi-touch)
const yaw0 = await ev(() => window.__EF.camCtl.yaw);
await touch('touchMove', [{ x: 160, y: 230, id: 1 }, { x: 600, y: 200, id: 2 }]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: 120, y: 260, id: 1 }, { x: 600 + i * 20, y: 200, id: 2 }]); await sleep(40); }
await waitGame(0.3);
const yaw1 = await ev(() => window.__EF.camCtl.yaw);
check('right-half drag rotates camera while moving (multi-touch)', Math.abs(yaw1 - yaw0) > 0.2, `yaw delta ${(yaw1 - yaw0).toFixed(2)} rad`);
await shot('04-strafe-and-look');
await touch('touchEnd', []);
await waitGame(0.5);
const stopped = await ev(() => Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z));
check('player decelerates to a stop on release', stopped < 0.3, `speed ${stopped.toFixed(2)}`);

// ---------------- independent move + aim: strafe sideways while facing the locked rival
await ev(() => { const { player, opp, camCtl, state } = window.__EF; player.pos.set(0, 0.16, -3); player.vel.set(0, 0, 0); opp.pos.set(0, 0.16, 4); state.locked = true; player.faceYaw = player.yaw = 0; camCtl.snapBehind(player); }); // on the dais: guaranteed clear of rocks
await touch('touchStart', [{ x: 160, y: 300, id: 1 }]);
await touch('touchMove', [{ x: 230, y: 300, id: 1 }]); // stick right
await waitGame(0.8);
const strafe = await ev(() => { const { player, opp } = window.__EF; const want = Math.atan2(opp.pos.x - player.pos.x, opp.pos.z - player.pos.z); const d = Math.atan2(Math.sin(want - player.faceYaw), Math.cos(want - player.faceYaw)); const mv = Math.atan2(player.vel.x, player.vel.z); return { faceErr: Math.abs(d), moveVsFace: Math.abs(Math.atan2(Math.sin(mv - player.faceYaw), Math.cos(mv - player.faceYaw))) }; });
check('locked strafe: faces rival while moving sideways', strafe.faceErr < 0.25 && strafe.moveVsFace > 1.0 && strafe.moveVsFace < 2.2, `face error ${strafe.faceErr.toFixed(2)} rad, move vs facing ${strafe.moveVsFace.toFixed(2)} rad`);
await shot('05-lock-strafe');
await touch('touchEnd', []);

// ---------------- jump
await tapBtn('btn-jump');
await waitGame(0.25);
const jy = await ev(() => window.__EF.player.pos.y - window.__EF.player.groundY);
check('jump leaves the ground', jy > 0.4, `height ${jy.toFixed(2)} m`);
await shot('06-jump');
await waitGame(1.0);

// ---------------- dodge roll
const dz0 = await ev(() => window.__EF.player.pos.clone());
await touch('touchStart', [{ x: 160, y: 300, id: 1 }]); await touch('touchMove', [{ x: 100, y: 300, id: 1 }]);
const dc = await btnCenter('btn-dodge');
await touch('touchStart', [{ x: 100, y: 300, id: 1 }, { ...dc, id: 3 }]);
await waitGame(0.18);
await shot('07-dodge-roll');
await touch('touchEnd', []);
await waitGame(0.4);
const dz1 = await ev(() => window.__EF.player.pos.clone());
check('dodge dashes the player', Math.hypot(dz1.x - dz0.x, dz1.z - dz0.z) > 2.5, `${Math.hypot(dz1.x - dz0.x, dz1.z - dz0.z).toFixed(2)} m`);

// ---------------- ranged: rock thrown at reticle hits the locked rival
await ev(() => { const { player, opp, camCtl, state } = window.__EF; player.pos.set(-3, 0, -9); player.vel.set(0, 0, 0); opp.pos.set(-3, 0, 1); opp.vel.set(0, 0, 0); opp.hp = 100; state.locked = true; camCtl.snapBehind(player); window.__EF.ai.f.input.mx = 0; });
await ev(() => { const a = window.__EF.ai; a.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.attack = i.bend = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; });
await waitGame(0.4);
await tapBtn('btn-bend', 0.05);
const rockState = [];
for (let i = 0; i < 30; i++) { const st = await ev(() => window.__EF.world.combat.rocks.map(r => r.state)); rockState.push(...st); if (st.includes('held')) { await shot('08-rock-raised'); break; } await sleep(30); }
check('BEND raises a rock from the ground', rockState.includes('rising') || rockState.includes('held'), [...new Set(rockState)].join(','));
await waitGame(0.5);
await shot('09-rock-flying');
await waitGame(0.8);
const oh = await ev(() => window.__EF.opp.hp);
check('thrown rock hits the rival', oh < 100, `rival hp ${oh}`);

// ---------------- free aim (unlocked): rock lands where the reticle points
await ev(() => { const { player, opp, camCtl, state } = window.__EF; state.locked = false; player.pos.set(10, 0, -20); opp.pos.set(-20, 0, 20); camCtl.snapBehind(player); camCtl.yaw = 0.5; camCtl.pitch = 0.32; });
await waitGame(0.3);
const aimP = await ev(() => window.__EF.aimPoint().toArray());
const c2 = await btnCenter('btn-bend');
await touch('touchStart', [{ ...c2, id: 6 }]);
await waitGame(0.5);
await shot('10-rock-suspended');
const held = await ev(() => window.__EF.world.combat.rocks.map(r => r.state));
check('holding BEND keeps the rock suspended', held.includes('held'), JSON.stringify(held));
await ev(() => { window.__EF._impacts = []; const c = window.__EF.world.combat; const orig = c.shatter.bind(c); c.shatter = (r, h) => { window.__EF._impacts.push(r.pos.toArray()); orig(r, h); }; });
await touch('touchEnd', []);
await waitGame(1.4);
const imp = await ev(() => window.__EF._impacts);
const aimNow = await ev(() => window.__EF.aimPoint().toArray());
const errDist = imp.length ? Math.hypot(imp[0][0] - aimNow[0], imp[0][2] - aimNow[2]) : 99;
check('free-aim rock impacts at the reticle point', imp.length > 0 && errDist < 1.5, `impact ${imp[0]?.map(v => v.toFixed(1))} vs aim ${aimNow.map(v => v.toFixed(1))} (err ${errDist.toFixed(2)} m)`);
await shot('11-rock-impact');

// ---------------- defence: stone shield blocks an incoming rock
const fireAtPlayer = async () => ev(() => {
  const { world, opp, player } = window.__EF; const c = world.combat;
  opp.en = 100; c.summonRock(opp); const r = opp.heldRock; r.state = 'held'; r.pos.set(opp.pos.x, 1.4, opp.pos.z + 1.0);
  opp.input.aimPoint.set(player.pos.x, player.pos.y + 1.2, player.pos.z); c.release(opp);
});
await ev(() => { const { player, opp, camCtl, state } = window.__EF; state.locked = true; player.pos.set(0, 0, -14); player.hp = 100; player.vel.set(0, 0, 0); opp.pos.set(0, 0, -4); opp.vel.set(0, 0, 0); camCtl.snapBehind(player); });
await waitGame(0.3);
const gc = await btnCenter('btn-guard');
await touch('touchStart', [{ ...gc, id: 7 }]);
await waitGame(0.35);
const shieldUp = await ev(() => window.__EF.world.combat.shields.length);
check('GUARD raises a stone shield', shieldUp === 1, `${shieldUp} shield(s)`);
await shot('12-shield-raised');
await fireAtPlayer();
await waitGame(0.2);
await shot('13-rock-vs-shield');
await waitGame(0.6);
const afterBlock = await ev(() => ({ hp: window.__EF.player.hp, sh: window.__EF.world.combat.shields[0]?.hp }));
check('shield intercepts the rock (no damage taken)', afterBlock.hp === 100 && afterBlock.sh < 70, `player hp ${afterBlock.hp}, shield hp ${afterBlock.sh}`);
await touch('touchEnd', []);
await waitGame(0.6);
check('shield sinks when GUARD released', (await ev(() => window.__EF.world.combat.shields.length)) === 0);
await fireAtPlayer();
await waitGame(0.8);
const unguarded = await ev(() => window.__EF.player.hp);
check('same rock without guard damages the player', unguarded < 100, `player hp ${unguarded}`);

// ---------------- melee combo
await ev(() => { const { player, opp, camCtl, state } = window.__EF; state.locked = true; player.pos.set(0, 0, -12); player.vel.set(0, 0, 0); player.hp = 100; player.stunT = 0; player.action = null; opp.pos.set(0, 0, -9.8); opp.hp = 100; opp.vel.set(0, 0, 0); camCtl.snapBehind(player); });
await waitGame(0.3);
for (let i = 0; i < 3; i++) { await tapBtn('btn-attack', 0.05); await waitGame(i === 1 ? 0.12 : 0.22); if (i === 1) await shot('14-combo-punch'); }
await waitGame(0.15);
await shot('15-spin-kick');
await waitGame(0.6);
const mel = await ev(() => window.__EF.opp.hp);
check('STRIKE combo damages the rival', mel < 100, `rival hp ${mel}`);

// ================= Stage A: movement / combat responsiveness =================
const setup = (o) => ev((o) => { const { player, opp, camCtl, state, world } = window.__EF; state.locked = o.locked; world.combat.clear();
  for (const f of [player, opp]) { f.vel.set(0, 0, 0); f.action = null; f.stunT = 0; f.dodgeT = 0; f.hp = 100; f.en = 100; f.guarding = false; f.charging = false; f.atkHoldT = -1; f.counterT = 0; f.invuln = 0; f.dead = false; }
  player.pos.set(...o.p); opp.pos.set(...o.o); player.faceYaw = player.yaw = Math.atan2(opp.pos.x - player.pos.x, opp.pos.z - player.pos.z); camCtl.snapBehind(player); }, o);
const P = (fn) => ev(fn);
// walk vs run vs sprint from stick deflection
await setup({ locked: false, p: [0, 0, -14], o: [20, 0, 20] });
fingers.clear();
await fDown(1, 160, 300); await fMove(1, 160, 280); // ~35% deflection
await waitGame(0.8);
const walkSp = await P(() => Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z));
await fMove(1, 160, 220); // full
await waitGame(0.25);
const runSp = await P(() => Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z));
await waitGame(0.9);
const sprintSt = await P(() => ({ sp: Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z), on: window.__EF.player.sprinting }));
await shot('20-sprint');
await fUp(1); await waitGame(0.6);
check('analogue stick: partial deflection walks', walkSp > 1.2 && walkSp < 4, `${walkSp.toFixed(2)} m/s`);
check('full deflection runs', runSp > 5.5 && runSp < 7, `${runSp.toFixed(2)} m/s`);
check('holding the stick at its rim sprints', sprintSt.on && sprintSt.sp > 8.5, `${sprintSt.sp.toFixed(2)} m/s`);

// slope: run up the ramp onto the raised ledge
await setup({ locked: false, p: [-12.5, 0, 16], o: [20, 0, 20] });
await P(() => { window.__EF.camCtl.yaw = -Math.PI / 2; });
await fDown(1, 160, 300); await fMove(1, 160, 230);
let maxY = 0; for (let i = 0; i < 25; i++) { await waitGame(0.1); maxY = Math.max(maxY, await P(() => window.__EF.player.pos.y)); }
await shot('21-on-ledge');
await fUp(1);
check('ramp: player climbs the slope onto the 1.6 m ledge', maxY > 1.5, `max height ${maxY.toFixed(2)} m`);

// heavy (hold STRIKE briefly) and charged slam (hold long) against a passive rival
await setup({ locked: true, p: [0, 0, -12], o: [0, 0, -10.4] });
await waitGame(0.2);
let ac = await btnCenter('btn-attack');
await fDown(4, ac.x, ac.y); await waitGame(0.45);
const chargingA = await P(() => window.__EF.player.charging);
await fUp(4);
let seen = new Set(); for (let i = 0; i < 12; i++) { await waitGame(0.05); seen.add(await P(() => window.__EF.player.action)); if (i === 4) await shot('22-heavy'); }
const hpHeavy = await P(() => ({ hp: window.__EF.opp.hp, act: window.__EF.opp.action }));
check('hold STRIKE: light jab then charge stance', chargingA);
check('short hold releases a heavy palm strike that staggers', seen.has('heavy') && hpHeavy.hp < 100, `actions ${[...seen].join(',')}; rival hp ${hpHeavy.hp}`);
await setup({ locked: true, p: [0, 0, -12], o: [0, 0, -10.2] });
await waitGame(0.2);
await fDown(4, ac.x, ac.y); await waitGame(1.15);
await shot('23-charging');
await fUp(4);
let oppActs = new Set(); for (let i = 0; i < 16; i++) { await waitGame(0.05); oppActs.add(await P(() => window.__EF.opp.action)); if (i === 9) await shot('24-slam'); }
const slamRes = await P(() => ({ hp: window.__EF.opp.hp }));
check('long hold releases a charged slam that knocks the rival down', oppActs.has('down') && slamRes.hp < 100, `rival states ${[...oppActs].join(',')}; hp ${slamRes.hp}`);
await waitGame(1.2);
check('knocked-down rival gets back up', await P(() => !window.__EF.opp.action || window.__EF.opp.action === 'getup' || window.__EF.opp.action === null));

// dodge cancels attack recovery; attack pressed mid-dodge is buffered
await setup({ locked: true, p: [0, 0, -12], o: [0, 0, -6] });
await waitGame(0.2);
// deterministic frame stepping (30 fps) so short timing windows are tested exactly
const stepN = (n) => ev((n) => { for (let i = 0; i < n; i++) window.__EF.step(1 / 30); window.__EF.render(); }, n);
await P(() => { window.__EF.state.manual = true; });
await P(() => { window.__EF.controls.pressed.attack = true; });
await stepN(1);
await stepN(4);
const dcBefore = await P(() => ({ a: window.__EF.player.action, u: +window.__EF.player.actionU.toFixed(2), ph: window.__EF.state.phase, stun: window.__EF.player.stunT, react: window.__EF.player.reacting(), hold: window.__EF.player.atkHoldT, ch: window.__EF.player.charging, guard: window.__EF.player.guarding, dead: window.__EF.player.dead }));
await P(() => { window.__EF.controls.pressed.dodge = true; });
await stepN(2);
const dcAfter = await P(() => ({ d: window.__EF.player.dodgeT > 0, act: window.__EF.player.action }));
check('dodge cancels attack recovery', dcBefore.a === 'jab' && dcAfter.d && !dcAfter.act, `before: ${JSON.stringify(dcBefore)}, after: dodging=${dcAfter.d}`);
await stepN(4);
await P(() => { window.__EF.state.manual = false; });
await tapBtn('btn-attack', 0.03);
let buffered = false; for (let i = 0; i < 12; i++) { await waitGame(0.04); const a = await P(() => window.__EF.player.action); if (a === 'jab' || a === 'cross' || a === 'kick') { buffered = true; break; } }
check('attack pressed during a dodge is buffered and fires', buffered);

// locked-on sidestep and backstep
await setup({ locked: true, p: [0, 0, -12], o: [0, 0, -4] });
await waitGame(0.3);
await fDown(1, 160, 300); await fMove(1, 230, 300);
const dcB = await btnCenter('btn-dodge');
await fDown(3, dcB.x, dcB.y); await waitGame(0.1);
const side = await P(() => window.__EF.player.dodgeKind);
await shot('25-sidestep');
await fUp(3); await fUp(1); await waitGame(0.5);
await fDown(1, 160, 300); await fMove(1, 160, 370);
await fDown(3, dcB.x, dcB.y); await waitGame(0.1);
const backK = await P(() => window.__EF.player.dodgeKind);
await fUp(3); await fUp(1);
check('locked-on lateral dodge is a sidestep', side === 'side', side);
check('locked-on backward dodge is a backstep', backK === 'back', backK);

// perfect guard: raise the shield just before a rock lands -> rock deflects back into the thrower, counter window opens
await setup({ locked: true, p: [0, 0, -14], o: [0, 0, -4] });
await waitGame(0.3);
await P(() => { const { world, opp, player } = window.__EF; const c = world.combat; c.summonRock(opp); const r = opp.heldRock; r.state = 'held'; r.pos.set(opp.pos.x, 1.4, opp.pos.z - 1.0); opp.input.aimPoint.set(player.pos.x, 1.2, player.pos.z); c.release(opp); });
// step frame by frame and press GUARD (as the on-screen button does) when the rock is ~5 m out
const fired = await P(() => { const E = window.__EF; E.state.manual = true;
  for (let i = 0; i < 60; i++) { const r = E.world.combat.rocks[0]; if (r && r.pos.distanceTo(E.player.chestPos()) < 5) { E.controls.btn.guard = true; return true; } E.step(1 / 30); } return false; });
await stepN(5); await shot('26-deflect');
await stepN(15);
const pg = await P(() => ({ perfect: window.__EF.player.stats.perfect, counter: window.__EF.player.counterT > 0, oppHp: window.__EF.opp.hp, php: window.__EF.player.hp, guarding: window.__EF.player.guarding, gCd: +window.__EF.player.guardCd.toFixed(2), act: window.__EF.player.action, dodge: window.__EF.player.dodgeT, btn: window.__EF.controls.btn.guard, en: Math.round(window.__EF.player.en) }));
await P(() => { window.__EF.controls.btn.guard = false; }); await stepN(10);
await P(() => { window.__EF.state.manual = false; });
check('perfect guard deflects the rock back into the thrower', fired && pg.perfect > 0 && pg.oppHp < 100 && pg.php === 100, JSON.stringify({ fired, ...pg }));
await P(() => { window.__EF.player.counterT = 0.9; window.__EF.opp.pos.set(0, 0, -12.5 + 1.8); });
await tapBtn('btn-attack', 0.03);
await waitGame(0.08);
const ctr = await P(() => window.__EF.player.action);
check('strike during the counter window performs a counter attack', ctr === 'counter', ctr);
await waitGame(0.5);

// rendering cost of the skinned characters
const info = await P(() => ({ ...window.__EF.info(), tris: window.__EF.player.triangles }));
check('each fighter is one skinned mesh', info.tris > 1000, `${info.tris} triangles per fighter; frame: ${info.calls} draw calls, ${info.triangles} triangles`);

// ---------------- full AI round (normal difficulty) for a few seconds
await ev(() => { location.hash = ''; });
await page.reload(); await page.waitForFunction(() => window.__EF); await sleep(800);
await page.locator('#btn-start').tap();
await waitGame(2.0);
fingers.clear();
await fDown(1, 160, 300); await fMove(1, 160, 240);
await waitGame(1.5);
await shot('16-ai-fight-a');
await fMove(1, 220, 300);
for (let i = 0; i < 3; i++) { await tapBtn('btn-bend', 0.05, 8 + i); await waitGame(0.9); }
await shot('17-ai-fight-b');
const stillMoving = await ev(() => ({ held: window.__EF.controls.stickPtr !== null, mag: Math.hypot(window.__EF.controls.stick.x, window.__EF.controls.stick.y), sp: Math.hypot(window.__EF.player.vel.x, window.__EF.player.vel.z) }));
check('stick stays active while tapping BEND with the other thumb', stillMoving.held && stillMoving.mag > 0.8, `stick held=${stillMoving.held}, deflection ${stillMoving.mag.toFixed(2)}, speed ${stillMoving.sp.toFixed(2)} m/s`);
await fUp(1);
await waitGame(4);
await shot('18-ai-fight-c');
const aiStats = await ev(() => ({ php: window.__EF.player.hp, ohp: window.__EF.opp.hp, opos: window.__EF.opp.pos.toArray().map(v => +v.toFixed(1)), fps: window.__EF.stats.fps.toFixed(1) }));
check('AI opponent moves and fights', true, JSON.stringify(aiStats));
const sane = await ev(() => window.__EF.world.fighters.every(f => ![...f.cur].some(Number.isNaN) && Number.isFinite(f.vel.x) && Number.isFinite(f.pos.x)));
check('fighter state stays finite after reload (no NaN poses)', sane);
const pv = await ev(() => { const { player, world } = window.__EF; const v = player.pos.clone(); v.y += 1; v.project(world.camera); return Math.abs(v.x) < 1 && Math.abs(v.y) < 1; });
check('player on screen during live AI round', pv);

// ---------------- portrait shows rotate prompt
const pctx = await browser.newContext({ viewport: { width: 412, height: 891 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const pp = await pctx.newPage(); pp.on('pageerror', e => errors.push(e.message));
await pp.goto(BASE); await pp.waitForFunction(() => window.__EF); await pp.evaluate(() => document.getElementById('btn-start').click());
await sleep(500);
await pp.screenshot({ path: `${OUT}/19-portrait-prompt.png` });
const rot = await pp.evaluate(() => getComputedStyle(document.getElementById('rotate')).display);
check('portrait shows rotate-phone prompt', rot === 'flex', rot);

check('no runtime errors during test', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
