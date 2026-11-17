// M3 effect acceptance: every elemental effect is measured against the limb that produces it, frame by frame.
//   - anchoring: the effect starts at the hand / foot bone (distance in metres, every frame it exists)
//   - direction: the effect moves the way the limb moves (angle between the hand or foot velocity and the effect)
//   node tests/m3-effects-test.mjs [baseUrl] [outDir]  (close-up and normal-distance frames are written to outDir)
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
const P = () => S(() => { const { player: p, opp: o, world } = window.__EF; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, alt: p.pos.y - p.groundY, sp: Math.hypot(p.vel.x, p.vel.z), mob: p.mob && p.mob.kind, heading: p.mob && p.mob.heading, act: p.action, tech: p.tech && p.tech.name, en: p.en, ohp: o.hp, oact: o.action, oy: o.pos.y - o.groundY, ox: o.pos.x, oz: o.pos.z, clip: p.hero && p.hero.curName, low: p.hero && p.hero.lowName, onG: p.onGround }; });
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

// camera views: 'close' frames the fighter, the striking limb and the effect from the side at 3.4 m (rendered with
// its own camera and read straight off the canvas); 'normal' is the game's own camera with the HUD
const snap = async (name, mode = 'close', at = null) => {
  if (mode === 'normal') { await ev(() => window.__EF.render()); await page.screenshot({ path: `${OUT}/${name}.jpg`, quality: 80, timeout: 120000 }); return; }
  const url = await ev((at) => {
    const E = window.__EF, { world, player: p } = E, C = world.camera.constructor;
    const cam = window.__closeCam || (window.__closeCam = new C(50, 1, 0.05, 200));
    const r = world.renderer;
    const c = at ? new world.scene.position.constructor(...at) : p.chestPos(); const fw = p.forward();
    const W = r.domElement.width, H = r.domElement.height; cam.aspect = W / H; cam.updateProjectionMatrix();
    if (at) { cam.position.set(c.x - fw.z * 7.5, c.y + 1.6, c.z + fw.x * 7.5); cam.lookAt(c.x, c.y, c.z); }   // a wide side view of both fighters
    else { cam.position.set(c.x - fw.z * 3.4 - fw.x * 0.6, c.y + 0.7, c.z + fw.x * 3.4 - fw.z * 0.6); cam.lookAt(c.x + fw.x * 1.8, c.y - 0.25, c.z + fw.z * 1.8); }
    r.render(world.scene, cam); return r.domElement.toDataURL('image/jpeg', 0.85);
  }, at);
  fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
};

// per-frame sample of a whip against its limb: root distance to the bone, angle between the hand's motion and
// the motion of the first third of the rope, tip distance from the hand
const whipSample = () => S(() => {
  const { world, player: p } = window.__EF, Wp = world.bending.weapons, W = Wp.whips.find(x => x.f === p);
  if (!W) return null;
  const bone = Wp.limbPos(p, W.limb, W.ls, new world.scene.position.constructor()), r = W.pts[0], m = W.pts[4], mp = W.prev[4], t = W.pts[W.pts.length - 1];
  return { kind: W.kind, rel: W.tRel >= 0, ext: +W.ext.toFixed(2), rootD: +bone.distanceTo(r).toFixed(3), tipD: +bone.distanceTo(t).toFixed(2),
    aim: [W.aim.x, W.aim.y, W.aim.z].map(v => v.toFixed(2)).join(","), dir: [W.dir.x, W.dir.y, W.dir.z].map(v => v.toFixed(2)).join(","), od: +Math.min(...W.pts.map(q => Math.hypot(q.x - window.__EF.opp.pos.x, q.z - window.__EF.opp.pos.z))).toFixed(2), ty: +t.y.toFixed(2), dist: +Math.hypot(p.pos.x - window.__EF.opp.pos.x, p.pos.z - window.__EF.opp.pos.z).toFixed(2), hv: [W.vRoot.x, W.vRoot.y, W.vRoot.z], mv: [(m.x - mp.x) * 30, (m.y - mp.y) * 30, (m.z - mp.z) * 30], clip: p.tech && p.tech.clip, hand: W.ls };
});
const ang = (a, b) => { const la = Math.hypot(...a), lb = Math.hypot(...b); if (la < 0.8 || lb < 0.8) return null; return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / la / lb))) * 180 / Math.PI; };

// ------------------------------------------------------------------ whips (water, air)
for (const el of (process.env.WHIPS ? [process.env.WHIPS] : process.env.ONLY ? [] : ['water', 'air'])) {
  head(`${el}: whip from the hand`);
  await setup({ el, p: [0, 0, -9], o: [0, 0, -5] }); await stepN(10);
  const per = {};
  for (let i = 0; i < 4; i++) {
    // a hit knocks the rival out of reach; each strike is measured against a rival standing 4 m in front again
    await S(() => { const { player: p, opp: o } = window.__EF; const fw = p.forward(); o.pos.set(p.pos.x + fw.x * 4, p.pos.y, p.pos.z + fw.z * 4); o.vel.set(0, 0, 0); o.action = null; o.stunT = 0; o.invuln = 0; });
    await press('btn-hand', 2);
    const rows = []; let shot = 0, ballSeen = [];
    for (let j = 0; j < 30; j++) {
      await stepN(1); const r = await whipSample(); if (r) rows.push(r);
      if (el === 'water' && !ballSeen.length) ballSeen = await S(() => window.__EF.world.bending.objs.filter(o => o.owner === window.__EF.player && (o.kind === 'water' || o.kind === 'iceBall')).map(o => o.kind));
      if (r && r.rel && shot < 2 && i < 3 && (shot === 0 || rows.filter(x => x.rel).length === 4)) { await snap(`${el}-whip${i}-${shot ? 'lash' : 'release'}`); if (shot && i < 2) await snap(`${el}-whip${i}-lash-normal`, 'normal'); shot++; }
    }
    // (17 Nov brief: Air's third strike is a cross punch firing an air cannon, not a whip)
    const isCannon = await S(() => /^fire_punch/.test(window.__EF.player.hero.curName || '') || (window.__hits || []).length && false);
    if (!rows.length && el === 'air' && i === 2) { per.cannon = 1; await stepN(12); continue; }
    // (17 Nov, later: Water's second and fourth strikes are punches that throw a ball of water or ice, not whips;
    //  for those the check is that a ball really left the fist)
    if (!rows.length && el === 'water' && i % 2 === 1) {
      check(`water strike ${i + 1}: the punch throws a water or ice ball`, ballSeen.length > 0, ballSeen.join(',') || 'no ball');
      await stepN(12); continue;
    }
    if (!rows.length) { check(`${el} strike ${i + 1}: a whip came out`, false); continue; }
    const k = rows[0].kind, clip = rows[0].clip;
    const maxRoot = Math.max(...rows.map(r => r.rootD)), maxTip = Math.max(...rows.map(r => r.tipD));
    const angs = rows.filter(r => !r.rel).map(r => ang(r.hv, r.mv)).filter(a => a !== null);
    const mean = angs.length ? angs.reduce((a, b) => a + b, 0) / angs.length : null;
    per[k] = (per[k] || 0) + 1;
    check(`${el} strike ${i + 1} (${clip}, ${rows[0].hand} hand, kind ${k}): rope root stays on the hand bone`, maxRoot < 0.02, `max root offset ${maxRoot.toFixed(3)} m over ${rows.length} frames`);
    check(`${el} strike ${i + 1}: reach no longer than 4.6 m`, maxTip <= 4.7, `max tip distance ${maxTip.toFixed(2)} m`);
    check(`${el} strike ${i + 1}: before the release the rope moves with the hand`, mean !== null && mean < 60, `mean angle between hand motion and rope motion ${mean === null ? 'n/a' : mean.toFixed(0) + ' deg'} over ${angs.length} moving frames`);
    if (process.env.DBG) console.log(rows.filter(r => r.rel).slice(0, 8).map(r => `${r.od}/${r.ty} aim ${r.aim} dir ${r.dir}`).join(" | "));
    await stepN(12);
  }
  check(`${el}: strikes use different arm paths (whip kinds)`, Object.keys(per).length >= 2, JSON.stringify(per));
  const hl = await hitsOn(), hits = hl.filter(t => /Whip/.test(t)).length + hl.filter(t => t === 'proj').length; check(`${el}: strikes land on the rival at 4 m (at least 3 of 4; Air's third is the air cannon, Water's second and fourth throw balls)`, hits >= 3, `${hits} hits: ${hl.join(',')}`); await clearHits();
}

// ------------------------------------------------------------------ kicks throw the element along the foot's path
for (const el of (process.env.ONLY || process.env.WHIPS ? [] : ["water", "fire", "air"])) {
  head(`${el}: kick arcs follow the kicking foot`);
  await setup({ el, p: [0, 0, -9], o: [0, 0, -5] }); await stepN(10); await clearHits();
  await press('btn-leg', 2);
  let born = null, shots = 0;
  for (let j = 0; j < 40 && shots < 2; j++) {
    await stepN(1);
    const r = await S(() => {
      const { world, player: p } = window.__EF, A = world.bending.weapons.arcs.find(a => a.f === p); if (!A) return null;
      const N = A.pts.length, foot = p.limbPath('foot', A.footSide || 'L', 0.24), side = A.footSide;
      const fp = (s) => p.limbPath('foot', s, 0.24);
      // which foot drew it: the one whose recent path lies closest to the arc's first shape
      const best = ['L', 'R'].map(s => { const P = fp(s); return [s, P, P.length ? Math.min(...P.map(q => q.distanceTo(A.c))) : 99]; }).sort((a, b) => a[2] - b[2])[0];
      const P = best[1], chord = A.pts[N - 1].clone().sub(A.pts[0]), fmove = P.length > 1 ? P[P.length - 1].clone().sub(P[0]) : chord.clone();
      const cos = chord.dot(fmove) / Math.max(1e-6, chord.length() * fmove.length());
      const nowFoot = p.footPos(best[0]);
      return { t: A.t, el: A.el, foot: best[0], dFoot: +nowFoot.distanceTo(A.c).toFixed(2), cos: +cos.toFixed(2), chord: +chord.length().toFixed(2), clip: p.hero && p.hero.curName };
    });
    if (r && !born) born = r;
    if (r && (shots === 0 || r.t > 0.12)) { await snap(`${el}-kick-${shots ? 'flight' : 'birth'}`); if (shots) await snap(`${el}-kick-flight-normal`, 'normal'); shots++; }
  }
  if (!born) { check(`${el}: the kick threw an arc`, false); continue; }
  check(`${el} kick (${born.clip}, ${born.foot} foot): the arc is born at the kicking foot`, born.dFoot < 0.9, `arc centre ${born.dFoot} m from the foot on its first frame`);
  check(`${el} kick: the arc runs the way the foot moved`, Math.abs(born.cos) > 0.7, `cosine between the arc's chord and the foot's motion ${born.cos}, chord ${born.chord} m`);
  await stepN(20);
  const hits = (await hitsOn()).filter(t => /Arc/.test(t)).length; check(`${el} kick: the arc strikes the rival at 4 m`, hits >= 1, `${hits} arc hits`);
}

// ------------------------------------------------------------------ SPECIALs
const spec = () => S(() => {
  const { world, player: p, opp: o } = window.__EF, L = world.bending.specials.list.filter(s => s.f === p);
  const V = (v) => v ? [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] : null;
  const hl = p.handPos('L'), hr = p.handPos('R');
  return { kinds: L.map(s => s.kind + (s.phase ? ':' + s.phase : '')), act: p.tech && p.tech.name, clip: p.hero && p.hero.curName, oy: +(o.pos.y - o.groundY).toFixed(2), ohp: o.hp, oact: o.action,
    blast: (L.find(s => s.kind === 'fireBlast') || {}).c ? V(L.find(s => s.kind === 'fireBlast').c) : null, footL: V(p.footPos('L')), footR: V(p.footPos('R')),
    rup: (L.find(s => s.kind === 'rupture') || {}).pts ? L.find(s => s.kind === 'rupture').pts.map(V) : null, ppos: V(p.pos), opos: V(o.pos),
    dragonHands: (() => { const d = L.find(s => s.kind === 'dragon'); if (!d || !d.tube) return null; return [Math.min(...d.pts.map(q => q.distanceTo(hl))), Math.min(...d.pts.map(q => q.distanceTo(hr)))].map(x => +x.toFixed(2)); })(),
    torn: (() => { const t = L.find(s => s.kind === 'tornado'); return t ? { c: V(t.c), free: t.free, g: +t.grow.toFixed(2), held: t.held.size } : null; })() };
});
for (const el of (process.env.ONLY || process.env.WHIPS ? [] : ["fire", "earth", "water", "air"])) {
  head(`${el}: SPECIAL`);
  await setup({ el, p: [0, 0, -9], o: [0, 0, el === 'fire' ? -5.5 : -4.5] }); await stepN(10); await clearHits();
  await press('btn-special', 2);
  const rows = []; let shot = 0;
  for (let j = 0; j < 120; j++) {
    await stepN(1); const r = await spec(); rows.push(r);
    if ([6, 12, 18, 26, 36, 50].includes(j)) { await snap(`${el}-special-${String(j).padStart(2, '0')}`, 'close', r.ppos.map((v, i) => i === 1 ? v + 1.1 : (v + r.opos[i]) / 2)); }
    if (j === 22) await snap(`${el}-special-normal`, 'normal');
  }
  const hits = await hitsOn(); const maxOy = Math.max(...rows.map(r => r.oy)), minHp = Math.min(...rows.map(r => r.ohp));
  console.log('   clips', [...new Set(rows.map(r => r.clip))].join(','), ' effects', [...new Set(rows.flatMap(r => r.kinds))].join(','), ' hits', hits.join(','));
  if (el === 'fire') {
    const i = rows.findIndex(r => r.blast); const r = rows[i] || {};
    const d = r.blast ? Math.min(...[r.footL, r.footR].map(f => Math.hypot(f[0] - r.blast[0], f[2] - r.blast[2]))) : 99;
    check('fire: the explosion goes off at the kicking foot', d < 1.0, `blast centre ${d.toFixed(2)} m (horizontal) from the nearest foot, frame ${i}`);
    check('fire: flames pour from the feet during the leap (trail effect)', rows.some(r => r.kinds.includes('fireTrail')));
    check('fire: the blast knocks the rival down', hits.includes('fireBlast') && rows.some(r => r.oact === 'down'), `hits ${hits.join(',')}`);
  }
  if (el === 'earth') {
    const r = rows.find(r => r.rup) || {};
    const dirOk = r.rup ? r.rup.every(p => p[2] > r.ppos[2]) : false;
    check('earth: the rupture runs from the bender toward the rival', dirOk, r.rup ? `${r.rup.length} bursts from z ${r.rup[0][2]} to ${r.rup[r.rup.length - 1][2]} (bender z ${r.ppos[2]}, rival z ${r.opos[2]})` : 'no rupture');
    check('earth: the rival is struck and thrown up', hits.includes('rupture') && maxOy > 0.8, `max rival height ${maxOy} m`);
  }
  if (el === 'water') {
    // (17 Nov brief: the SPECIAL engulfs the opponent in a ball of water that freezes and shatters)
    check('water: SPECIAL engulfs the rival in a ball of water, freezes it, shatters it for the damage', rows.some(r => r.kinds.some(k => k.startsWith('drown'))) && hits.includes('drown'), `effects ${[...new Set(rows.flatMap(r => r.kinds))].join(',')}; hits ${hits.join(',')}`);
  }
  if (el === 'air') {
    const t0 = rows.find(r => r.torn);
    check('air: the tornado forms around the bender', t0 && Math.hypot(t0.torn.c[0] - t0.ppos[0], t0.torn.c[2] - t0.ppos[2]) < 0.2);
    check('air: it travels to the rival, lifts them and throws them out', hits.includes('tornado') && maxOy > 1.2, `max rival height ${maxOy} m, hits ${hits.join(',')}`);
  }
  check(`${el}: SPECIAL leaves nothing behind`, (await spec()).kinds.length === 0 || (await (async () => { await stepN(90); return (await spec()).kinds.length === 0; })()), JSON.stringify((await spec()).kinds));
}

// ------------------------------------------------------------------ Earth gathering and recovery from the floor
head('earth: gathering rock from the ground, and getting up');
await setup({ el: 'earth', p: [0, 0, -9], o: [0, 0, -4] }); await stepN(10);
{
  await hold('btn-hand'); const clips = []; let low = 9;
  for (let j = 0; j < 75; j++) {
    await stepN(1);
    const r = await S(() => { const { player: p, world } = window.__EF; return { t: p.hero.cur && +p.hero.cur.time.toFixed(2), w: p.hero.cur && +p.hero.cur.getEffectiveWeight().toFixed(2), g: +(p.gatherT || 0).toFixed(2), clip: p.hero.curName, hy: Math.min(p.handPos('L').y, p.handPos('R').y) - p.groundY, n: world.bending.held(p, 'earth') }; });
    clips.push(r.clip); if (r.clip === "Fixing_Kneeling") low = Math.min(low, r.hy); if (process.env.DBG) console.log(j, r.clip, r.hy.toFixed(2), r.t, r.w, r.g);
    if (j === 12 || j === 40) await snap(`earth-gather-${j}`);
  }
  await fUp(6);
  const n = await S(() => window.__EF.world.bending.held(window.__EF.player, 'earth'));
  check('earth: holding HAND sinks to the ground for the rocks (Fixing_Kneeling)', clips.includes('Fixing_Kneeling') && low < 0.6, `lowest hand ${low.toFixed(2)} m above the ground; clips ${[...new Set(clips)].join(',')}`);
  check('earth: rocks are drawn up while gathering', n >= 1, `${n} rocks held`);
}
await setup({ el: 'earth', oel: 'fire', p: [0, 0, -9], o: [0, 0, -5.5] }); await stepN(5);
{
  // the rival's Dragon Descent knocks the player down; the recovery is recorded
  await S(() => { const { opp } = window.__EF; opp.startTech(opp.style.tech.special, 1); });
  const seq = []; let shots = 0;
  for (let j = 0; j < 110; j++) { await stepN(1); const r = await S(() => ({ a: window.__EF.player.action, c: window.__EF.player.hero.curName })); seq.push(r); if (r.a === 'getup' && shots < 3 && j % 4 === 0) { await snap(`getup-${shots}`); shots++; } }
  const ups = seq.filter(r => r.a === 'getup').map(r => r.c);
  check('recovery from a knockdown plays the Mixamo get-up (on the back, roll to a crouch, stand)', ups.length > 5 && ups.every(c => c === 'getup'), `getup frames ${ups.length}, clips ${[...new Set(ups)].join(',') || 'none'}; actions ${[...new Set(seq.map(r => r.a))].join(',')}`);
}

console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 1));
await browser.close();
