// M4 move demonstration: every move changed in the 17 Nov brief, performed with the on-screen touch controls (CDP
// touch events on the HUD buttons and the move stick), every frame stepped at 1/30 s and captured. Each frame's
// caption names the move, the buttons used and the animation clip playing. The rival stands passive (its AI is
// switched off so each move can be seen), except where a step makes it throw an attack to test a defence.
// Fire's roundhouse is shown first with the elemental effects switched off (in this recording only), then with them.
// Output: demo-<element>.mp4 and demo-log.json (the clips that played during each move).
// Usage: node tests/record-m4-demo.mjs <baseUrl> <outDir> [earth,fire,water,air] [courtyard|barn]
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots/encounters';
const ELS = (process.argv[4] || 'earth,fire,water,air').split(',');
const VENUE = process.argv[5] || 'courtyard';   // the barn ruin (or 'courtyard')
const RIVAL = { earth: 'fire', fire: 'water', water: 'fire', air: 'earth' };
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(BASE) ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const summary = {};

for (const el of ELS) {
  const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const fingers = new Map();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  const settle = async () => { await sleep(25); if (fingers.size) await touch('touchMove', [...fingers.values()].map(f => ({ ...f, x: f.x + 0.01 }))); await sleep(25); };
  const fDown = async (id, x, y, label) => { fingers.set(id, { x, y, id, label }); await touch('touchStart', [...fingers.values()]); await settle(); };
  const fMove = async (id, x, y) => { const f = fingers.get(id); fingers.set(id, { ...f, x, y }); await touch('touchMove', [...fingers.values()]); await settle(); };
  const fUp = async (id) => { const f = fingers.get(id); fingers.delete(id); if (f) await touch('touchEnd', [f]); await settle(); };
  const center = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'rec=1&venue=' + VENUE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__EF && window.__EF.LOAD && (window.__EF.LOAD.ok || window.__EF.LOAD.errors.length), null, { timeout: 60000 });
  const LOAD = await page.evaluate(() => window.__EF.LOAD);
  await page.evaluate(() => window.__EF.state.venueReady); await page.locator('#btn-start').tap(); await page.waitForFunction(() => window.__EF.state.phase !== 'menu', null, { timeout: 120000 });
  await page.evaluate(([el, rival]) => {
    const E = window.__EF; E.state.manual = true;
    E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.dodgeHeld = i.jump = i.jumpHeld = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); };
    E.opp.setElement(rival, true); E.state.locked = true; E.player.target = E.opp;
  }, [el, RIVAL[el]]);
  // the element is chosen with the HUD element button, like a player would
  const elC = await center(`button.el[data-el="${el}"]`); await fDown(9, elC.x, elC.y, el.toUpperCase()); await fUp(9);

  let stepName = 'start', frameN = 0;
  const dir = path.join(OUT, 'frames-' + el); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const log = []; const steps = [];
  // advance n frames, capturing each with a caption
  const run = async (n) => {
    const shots = await page.evaluate(([n, fingersNow, stepName, LOADc]) => {
      const E = window.__EF, P = E.player, O = E.opp, out = [];
      for (let i = 0; i < n; i++) {
        P.hp = Math.max(P.hp, 30); O.hp = Math.max(O.hp, 30);
        E.step(1 / 30);
        window.__rec = window.__rec || [];
        window.__rec.push({ step: stepName, clip: P.hero.curName, p: { act: P.action, tech: P.tech && P.tech.name, guard: P.guarding, hold: P.holding, dodge: P.dodgeT > 0 ? P.dodgeKind : null, y: +(P.pos.y - P.groundY).toFixed(2), hp: P.hp, en: Math.round(P.en), jet: !!P.jetting },
          o: { act: O.action, tech: O.tech && O.tech.name, guard: O.guarding, dodge: O.dodgeT > 0 ? O.dodgeKind : null, hp: O.hp }, d: +P.pos.distanceTo(O.pos).toFixed(1) });
        const R = E.renderer; R.render(E.scene, E.camera);
        const W = R.domElement.width, H = R.domElement.height;
        const cv = window.__cv || (window.__cv = document.createElement('canvas')); cv.width = W; cv.height = H;
        const g = cv.getContext('2d'); g.drawImage(R.domElement, 0, 0);
        g.font = 'bold 15px sans-serif'; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 4;
        g.fillText(`${P.el.toUpperCase()} vs ${O.el.toUpperCase()} rival (passive)  -  touch controls  -  ${location.host}${location.pathname}  -  venue ${E.world.arena.venue}  -  clips ${LOADc}`, 10, 22);
        g.font = 'bold 19px sans-serif'; g.fillStyle = '#ffe28a'; g.fillText(stepName, 10, 48);
        g.font = '14px sans-serif'; g.fillStyle = '#fff';
        g.fillText(`you: ${P.tech ? P.tech.name : P.guarding ? 'GUARD' : P.holding ? 'sustained bending' : P.dodgeT > 0 ? 'dodge (' + P.dodgeKind + ')' : P.mob ? P.mob.kind : P.jetting ? 'flame jets' : P.action || '-'}   clip: ${P.hero.curName}${P.hero.lowName ? ' / legs ' + P.hero.lowName : ''}   height ${(P.pos.y - P.groundY).toFixed(1)} m`, 10, 70);
        g.fillText(`rival: ${O.tech ? O.tech.name : O.guarding ? 'GUARD' : O.dodgeT > 0 ? 'dodge' : O.action || '-'}   hp ${Math.round(O.hp)}`, 10, 90);
        g.fillText('recording condition: health floored at 30, rival passive' + (window.__fxOff ? '  -  ELEMENTAL EFFECTS OFF' : ''), 10, H - 10);
        for (const q of fingersNow) { g.beginPath(); g.arc(q.x, q.y, 16, 0, 7); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill(); g.fillStyle = '#fff'; g.fillText(q.label || '', q.x + 18, q.y + 5); }
        out.push(cv.toDataURL('image/jpeg', 0.8));
      }
      return out;
    }, [n, [...fingers.values()], stepName, `${LOAD.clipsDecoded}/${LOAD.clipsExpected}`]);
    for (const s of shots) fs.writeFileSync(path.join(dir, `f${String(frameN++).padStart(5, '0')}.jpg`), Buffer.from(s.split(',')[1], 'base64'));
  };
  const st = () => page.evaluate(() => { const E = window.__EF, P = E.player, O = E.opp; return { d: P.pos.distanceTo(O.pos), oAct: O.action, oTech: O.tech && O.tech.name, oU: O.tech ? O.actionT / O.tech.dur : 1, oHp: O.hp, pHp: P.hp, counterT: P.counterT, pAct: P.action, held: E.world.bending.held(P) }; });
  const stickC = { x: 160, y: 300 };
  const stick = async (dx, dy) => { if (!fingers.has(1)) await fDown(1, stickC.x, stickC.y, 'move'); await fMove(1, stickC.x + dx, stickC.y + dy); };
  const stickUp = async () => { if (fingers.has(1)) await fUp(1); };
  const btn = async (name) => center('#btn-' + name);
  const press = async (name, frames = 2) => { const c = await btn(name); await fDown(5, c.x, c.y, name.toUpperCase()); await run(frames); await fUp(5); };
  const holdDown = async (name, id = 6) => { const c = await btn(name); await fDown(id, c.x, c.y, name.toUpperCase() + ' (held)'); };
  const begin = async (name) => { stepName = name; const s = await st(); steps.push({ step: name, startFrame: frameN, before: s }); };
  const end = async (note) => { const s = await st(); const cur = steps[steps.length - 1]; cur.after = s; cur.note = note; cur.endFrame = frameN; };


  // throw an attack at the player from the rival (to test a defence)
  const rivalThrows = (kind) => page.evaluate((kind) => { const { world, opp, player } = window.__EF; const p = opp.chestPos(); return world.bending.fire(kind, opp, p, { target: player.chestPos() }).kind; }, kind);
  // every step starts on the ground and out of any mobility, so the move recorded is the one named
  const settleGround = async () => { for (let i = 0; i < 40; i++) { const g = await page.evaluate(() => { const P = window.__EF.player; return P.onGround && !P.mob && !P.action; }); if (g) break; await run(3); } };
  const reset = async (o = {}) => { await settleGround(); return reset0(o); };
  const reset0 = (o = {}) => page.evaluate((o) => { const E = window.__EF, P = E.player, O = E.opp; P.en = 100; O.hp = Math.max(O.hp, 80); if (o.d) { const fw = P.forward(); O.pos.set(P.pos.x + fw.x * o.d, O.pos.y, P.pos.z + fw.z * o.d); O.vel.set(0, 0, 0); O.action = null; } }, o);
  const fx = (on) => page.evaluate((on) => {
    // effects switch for this recording only: element particles, whips, arcs and projectiles are not drawn
    const E = window.__EF, w = E.world, F = w.fx, Wp = w.bending.weapons; window.__fxOff = !on;
    if (!on) { window.__fxSaved = { fire: F.fire, splash: F.splash, wind: F.wind, arc: Wp.limbArc.bind(Wp) }; F.fire = () => {}; F.splash = () => {}; F.wind = () => ({}); Wp.limbArc = (...a) => { const A = window.__fxSaved.arc(...a); if (A && A.tube) A.tube.mesh.visible = false; A.hidden = true; return A; }; }
    else if (window.__fxSaved) { F.fire = window.__fxSaved.fire; F.splash = window.__fxSaved.splash; F.wind = window.__fxSaved.wind; Wp.limbArc = window.__fxSaved.arc; }
  }, on);
  const tapS = async (name, gap) => { await press(name, 2); await run(gap); };

  await run(40);
  await begin('Approach'); await stick(0, -85); for (let i = 0; i < 40 && (await st()).d > 3.4; i++) await run(3); await stickUp(); await run(15); await end();
  if (el === 'fire') {
    await begin('Roundhouse kick - EFFECTS OFF (LEG)'); await reset({ d: 2.6 }); await run(6); await fx(false); await tapS('leg', 30); await fx(true); await end();
    await run(10);
    await begin('Roundhouse kick - effects on (LEG)'); await reset({ d: 2.6 }); await tapS('leg', 30); await end();
    await begin('Jab, cross, hook: fireball from the fist (HAND x3)'); await reset({ d: 4 }); for (let i = 0; i < 3; i++) await tapS('hand', 12); await run(10); await end();
    await begin('Kicks: roundhouse, spinning back kick, knee, flip kick (LEG x4)'); await reset({ d: 2.6 }); for (let i = 0; i < 4; i++) await tapS('leg', 18); await run(14); await end();
    await begin('Jump, then kick right and left in the air (JUMP, LEG, LEG)'); await reset({ d: 3.5 }); await press('jump', 2); await run(6); await tapS('leg', 9); await tapS('leg', 18); await end();
    await begin('Flame kicked in the air destroys an incoming rock (JUMP, LEG)'); await reset({ d: 13 }); await press('jump', 2); await run(5); await rivalThrows('rock'); await tapS('leg', 22); await end();
    await begin('Fireball intercepts an incoming attack (HAND)'); await reset({ d: 13 }); await rivalThrows('water'); await run(3); await tapS('hand', 22); await end();
    await begin('Stomp: ignites on the foot plant, fire ring round the rival (LEG held)'); await reset({ d: 5 }); await holdDown('leg'); await run(30); await fUp(6); await run(60); await end();
    await begin('Fire stream (HAND held)'); await reset({ d: 3.5 }); await holdDown('hand'); await run(40); await fUp(6); await run(10); await end();
    await begin('SPECIAL: Dragon Descent'); await reset({ d: 5 }); await tapS('special', 50); await end();
    await begin('Flame run (DODGE held), flame jump (JUMP)'); await reset(); await holdDown('dodge', 7); await stick(70, -40); await run(26); await press('jump', 1); await run(24); await stickUp(); await fUp(7); await run(16); await end();
  }
  if (el === 'earth') {
    await begin('JUMP: the ground thrusts up and launches straight up'); await reset({ d: 4 }); await tapS('jump', 45); await end();
    await begin('DODGE: raised rock slide, steered, punching on it'); await reset({ d: 6 }); await press('dodge', 2); await stick(60, -60); await run(20); await stick(-60, -40); await run(10); await press('hand', 2); await run(14); await stickUp(); await tapS('dodge', 20); await end();
    await begin('GUARD: jagged rocks intercept a rock'); await reset({ d: 6 }); await holdDown('guard'); await run(10); await rivalThrows('fireball'); await run(20); await end();
    await begin('GUARD + HAND: punch the guard rocks into shards'); await press('hand', 2); await run(4); await fUp(6); await run(24); await end();
    await begin('Kicks throw rock from the foot: front, roundhouse, sweep, axe (LEG x4)'); await reset({ d: 3.2 }); for (let i = 0; i < 4; i++) await tapS('leg', 20); await end();
    await begin('Stomp (LEG held)'); await reset({ d: 5 }); await holdDown('leg'); await run(30); await fUp(6); await run(40); await end();
    await begin('SPECIAL: Ground Rupture'); await reset({ d: 6 }); await tapS('special', 70); await end();
  }
  if (el === 'water') {
    await begin('Twin whips, one on each arm (HAND x4)'); await reset({ d: 4 }); for (let i = 0; i < 4; i++) { await reset({ d: 4 }); await tapS('hand', 16); } await end();
    await begin('Whip catches the rival in the air and slams them down (HAND)'); await reset({ d: 4 }); await page.evaluate(() => { const O = window.__EF.opp; O.vel.y = 9; O.onGround = false; }); await run(6); await tapS('hand', 28); await end();
    await begin('Kicks: crescent, spinning kick with a wave on the kick, axe kick (LEG x3)'); await reset({ d: 4 }); for (let i = 0; i < 3; i++) await tapS('leg', 22); await end();
    await begin('Third kick: ice daggers (LEG)'); await reset({ d: 5 }); await page.evaluate(() => { window.__EF.player.iceN = 2; }); await tapS('leg', 26); await end();
    await begin('Water shield blocks a fireball (GUARD)'); await reset({ d: 6 }); await holdDown('guard'); await run(8); await rivalThrows('fireball'); await run(24); await fUp(6); await end();
    await begin('Ice surfing, raised above the floor (DODGE held)'); await reset(); await holdDown('dodge', 7); await stick(75, -40); await run(40); await stickUp(); await fUp(7); await run(10); await end();
    await begin('SPECIAL: Drowning Sphere - engulf, freeze, shatter'); await reset({ d: 5 }); await tapS('special', 75); await end();
  }
  if (el === 'air') {
    await begin('JUMP: sustained steerable flight, JUMP held climbs'); await reset({ d: 6 }); await press('jump', 2); await holdDown('jump', 6); await stick(60, -30); await run(26); await fUp(6); await run(10); await end();
    await begin('Palm blast in flight (HAND)'); await tapS('hand', 16); await stickUp(); await run(50); await end();
    await begin('DODGE: whirlwind dash right, then left'); await reset({ d: 4 }); await stick(85, 0); await press('dodge', 2); await run(14); await stick(-85, 0); await press('dodge', 2); await run(14); await stickUp(); await end();
    await begin('GUARD: whirlwind round the fighter, arms circling'); await reset({ d: 6 }); await holdDown('guard'); await run(10); await rivalThrows('rock'); await run(30); await fUp(6); await end();
    await begin('Strikes: two whips, air-cannon cross punch, whip (HAND x4)'); await reset({ d: 4 }); for (let i = 0; i < 4; i++) { await reset({ d: 4 }); await tapS('hand', 16); } await end();
    await begin('Kicks (LEG x3)'); await reset({ d: 3 }); for (let i = 0; i < 3; i++) await tapS('leg', 20); await end();
    await begin('SPECIAL: Tornado'); await reset({ d: 5 }); await tapS('special', 70); await end();
  }
  await begin('Somersault (JUMP, DODGE in the air)'); await reset(); await stick(0, -60); await press('jump', 1); await run(5); await tapS('dodge', 24); await stickUp(); await end();
  await begin('Roll (GUARD + DODGE)'); await reset(); await holdDown('guard'); await run(3); await stick(0, -70); await press('dodge', 2); await run(4); await fUp(6); await run(18); await stickUp(); await end();
  await run(10);

  const rec = await page.evaluate(() => window.__rec);
  summary[el] = { load: LOAD, errors, frames: frameN, steps: steps.map(s => ({ step: s.step, frames: [s.startFrame, s.endFrame],
    clips: [...new Set(rec.slice(s.startFrame, s.endFrame).map(r => r.clip).filter(Boolean))],
    techniques: [...new Set(rec.slice(s.startFrame, s.endFrame).map(r => r.p.tech || (r.p.guard ? 'GUARD' : r.p.hold ? 'sustained' : r.p.dodge ? 'dodge:' + r.p.dodge : null)).filter(Boolean))],
    rivalHp: [Math.round(s.before.oHp), Math.round(s.after.oHp)], playerHp: [Math.round(s.before.pHp), Math.round(s.after.pHp)] })) };
  execSync(`ffmpeg -v error -y -framerate 30 -i "${dir}/f%05d.jpg" -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart "${path.join(OUT, `demo-${el}.mp4`)}"`);
  console.log(el, frameN, 'frames', errors.length ? 'ERRORS ' + errors.join(' | ') : '');
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, 'demo-log.json'), JSON.stringify({ base: BASE, summary }, null, 1));
await browser.close();
