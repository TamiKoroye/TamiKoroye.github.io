// Records one continuous combat encounter per element in the real game: on-screen touch controls only (CDP touch
// events on the HUD buttons and the move stick), the opponent run by the game's own AI on Normal, every frame
// stepped at 1/30 s and captured. The player follows the milestone's ten-step sequence; the opponent is not
// scripted, so each step's outcome is whatever actually happened and is written to encounter-log.json.
// Recording condition (shown on every frame): both fighters' health is floored at 30 so the round does not end
// before the sequence finishes. Nothing else about the fight is altered.
// Usage: node tests/record-encounter.mjs <baseUrl> <outDir> [earth,fire,water,air]
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots/encounters';
const ELS = (process.argv[4] || 'earth,fire,water,air').split(',');
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

  await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'rec=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__EF && window.__EF.LOAD && (window.__EF.LOAD.ok || window.__EF.LOAD.errors.length), null, { timeout: 60000 });
  const LOAD = await page.evaluate(() => window.__EF.LOAD);
  await page.locator('#btn-start').tap();
  await page.evaluate(([el, rival]) => {
    const E = window.__EF; E.state.manual = true; E.ai.setDifficulty('normal');
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
        window.__rec.push({ step: stepName, p: { act: P.action, tech: P.tech && P.tech.name, guard: P.guarding, hold: P.holding, dodge: P.dodgeT > 0 ? P.dodgeKind : null, y: +(P.pos.y - P.groundY).toFixed(2), hp: P.hp, en: Math.round(P.en), jet: !!P.jetting },
          o: { act: O.action, tech: O.tech && O.tech.name, guard: O.guarding, dodge: O.dodgeT > 0 ? O.dodgeKind : null, hp: O.hp }, d: +P.pos.distanceTo(O.pos).toFixed(1) });
        const R = E.renderer; R.render(E.scene, E.camera);
        const W = R.domElement.width, H = R.domElement.height;
        const cv = window.__cv || (window.__cv = document.createElement('canvas')); cv.width = W; cv.height = H;
        const g = cv.getContext('2d'); g.drawImage(R.domElement, 0, 0);
        g.font = 'bold 15px sans-serif'; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 4;
        g.fillText(`${P.el.toUpperCase()} vs ${O.el.toUpperCase()} rival (game AI, Normal)  -  touch controls  -  ${location.host}${location.pathname}  -  clips ${LOADc}`, 10, 22);
        g.font = 'bold 19px sans-serif'; g.fillStyle = '#ffe28a'; g.fillText(stepName, 10, 48);
        g.font = '14px sans-serif'; g.fillStyle = '#fff';
        g.fillText(`you: ${P.tech ? P.tech.name : P.guarding ? 'GUARD' : P.holding ? 'sustained bending' : P.dodgeT > 0 ? 'dodge (' + P.dodgeKind + ')' : P.jetting ? 'flame jets' : P.action || '-'}   hp ${Math.round(P.hp)} energy ${Math.round(P.en)}`, 10, 70);
        g.fillText(`rival: ${O.tech ? O.tech.name : O.guarding ? 'GUARD' : O.dodgeT > 0 ? 'dodge' : O.action || '-'}   hp ${Math.round(O.hp)}`, 10, 90);
        g.fillText('recording condition: health floored at 30 for both fighters', 10, H - 10);
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

  await run(45);
  // 1 approach
  await begin('1. Approach'); await stick(0, -85);
  for (let i = 0; i < 40 && (await st()).d > 4.2; i++) await run(3);
  await stickUp(); await end();
  // 2 the opponent attacks (not scripted: wait for the AI's own technique)
  await begin('2. Opponent attacks'); let attacked = null;
  for (let i = 0; i < 60; i++) { await stick(i % 20 < 10 ? 50 : -50, -20); await run(2); const s = await st(); if (s.oAct === 'tech') { attacked = s.oTech; break; } }
  await stickUp(); await end(attacked ? `rival used ${attacked}` : 'rival did not attack within 4 s');
  // 3 evade or defend, in the element's own way
  await begin('3. Evade / defend');
  if (el === 'earth' || el === 'water') { await holdDown('guard'); await run(14); await fUp(6); }
  else if (el === 'air') { await stick(85, 0); await press('dodge', 2); await run(10); await stickUp(); }
  else { await stick(-85, 30); await press('dodge', 2); await run(8); await stickUp(); }
  await end();
  // 4 hand counter, 5 leg follow-up
  await begin('4. Hand counter'); await stick(0, -60); await run(3); await stickUp(); await press('hand', 2); await run(10); await end();
  await begin('5. Leg follow-up'); await press('leg', 2); await run(16); await end();
  // 6 sustained / steered bending
  await begin('6. Sustained bending, steered'); await holdDown('hand'); await run(12); await stick(70, 0); await run(20); await stick(-70, 0); await run(16); await stickUp(); await fUp(6); await end();
  // 7 the opponent reacts and counters: watch it, guard if it strikes
  await begin('7. Opponent reacts / counters'); let oppMoves = [];
  for (let i = 0; i < 20; i++) { const s = await st(); if (s.oAct === 'tech' && !oppMoves.includes(s.oTech)) oppMoves.push(s.oTech); if (s.oAct === 'tech' && s.oU < 0.4 && !fingers.has(6)) { await holdDown('guard'); await run(8); await fUp(6); } else await run(2); }
  await end(oppMoves.length ? `rival: ${oppMoves.join(', ')}` : 'rival did not strike');
  // 8 tactical positioning / structure
  await begin('8. Positioning / structure');
  if (el === 'earth') { await stick(85, 0); await run(8); await stickUp(); await press('special', 2); await run(20); }
  else if (el === 'fire') { await press('jump', 1); await holdDown('jump'); await stick(0, -60); await run(22); await fUp(6); await stickUp(); await run(14); }
  else if (el === 'water') { await holdDown('leg'); await run(30); await fUp(6); await run(30); }
  else { await press('jump', 1); await holdDown('jump'); await stick(70, 0); await run(30); await fUp(6); await stickUp(); await run(10); }
  await end();
  // 9 respond
  await begin('9. Respond'); await stick(0, -60); await run(4); await stickUp(); await press('hand', 2); await run(8); await press('leg', 2); await run(14); await end();
  // 10 culminating technique
  await begin('10. Culminating SPECIAL');
  if (el === 'water') { await press('special', 2); await run(36); await press('hand', 2); await run(30); }
  else if (el === 'air') { for (let i = 0; i < 3; i++) { await press('special', 2); await run(14); } await run(30); }
  else { await holdDown('leg'); await run(30); await fUp(6); await run(36); }
  await end();
  await run(20);

  const rec = await page.evaluate(() => window.__rec);
  summary[el] = { load: LOAD, errors, frames: frameN, steps: steps.map(s => ({ step: s.step, frames: [s.startFrame, s.endFrame], note: s.note || null,
    rivalHp: [Math.round(s.before.oHp), Math.round(s.after.oHp)], playerHp: [Math.round(s.before.pHp), Math.round(s.after.pHp)],
    playerTechniques: [...new Set(rec.slice(s.startFrame, s.endFrame).map(r => r.p.tech || (r.p.guard ? 'GUARD' : r.p.hold ? 'sustained' : r.p.dodge ? 'dodge:' + r.p.dodge : r.p.jet ? 'flame jets' : null)).filter(Boolean))],
    rivalActions: [...new Set(rec.slice(s.startFrame, s.endFrame).map(r => r.o.tech || (r.o.guard ? 'GUARD' : r.o.dodge ? 'dodge' : r.o.act)).filter(Boolean))] })) };
  fs.writeFileSync(path.join(OUT, `log-${el}.json`), JSON.stringify(rec));
  execSync(`ffmpeg -v error -y -framerate 30 -i "${dir}/f%05d.jpg" -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart "${path.join(OUT, `encounter-${el}.mp4`)}"`);
  console.log(el, frameN, 'frames', errors.length ? 'ERRORS ' + errors.join(' | ') : '');
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, 'encounter-log.json'), JSON.stringify({ base: BASE, summary }, null, 1));
await browser.close();
