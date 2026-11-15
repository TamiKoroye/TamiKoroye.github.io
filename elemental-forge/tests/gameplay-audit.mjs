// Gameplay animation audit. Plays the game ONLY through the on-screen touch controls (CDP multi-touch on the real
// buttons and joystick, like a phone), with the rival AI fighting back, human-like tap lengths, the joystick held
// while attacking, combinations, dodges, guards and element switches. Every frame logs which animation clip the
// player's character is actually showing, how far into it, its speed and how much of the body is authored versus
// procedural. A second run performs the same moves the way the earlier demo recorder did (scripted presses,
// passive rival, standing still) so the two can be compared move by move.
// Output: audit.json (per-technique table), frames + MP4 of the touch session (gameplay camera, full-body side
// inset, active clip and finger positions drawn on every frame).
// Usage: node tests/gameplay-audit.mjs [baseUrl] [outDir] [--no-video]
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = path.resolve(process.argv[3] || './gameplay-audit'); fs.mkdirSync(OUT, { recursive: true });
const VIDEO = !process.argv.includes('--no-video');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const tapLen = () => 2 + Math.floor(rnd() * 7);          // 2-8 frames = 70-270 ms, like real thumb taps

// ---- the move script: one continuous session through all four elements
const ELS = ['earth', 'fire', 'water', 'air'];
function buildScript() {
  const ev = []; let f = 20;
  const tap = (btn) => { const l = tapLen(); ev.push([f, 'down', btn]); ev.push([f + l, 'up', btn]); f += l + 4 + Math.floor(rnd() * 6); };
  const hold = (btn, n) => { ev.push([f, 'down', btn]); ev.push([f + n, 'up', btn]); f += n + 6; };
  const stick = (dx, dy) => ev.push([f, 'stick', dx, dy]);
  const stickUp = () => ev.push([f, 'stickUp']);
  const wait = (n) => { f += n; };
  for (let i = 0; i < ELS.length; i++) {
    const el = ELS[i];
    ev.push([f, 'element', el]); wait(12);
    ev.push([f, 'mark', `${el}: run in, attack while running`]);
    stick(0, -78); wait(18); tap('hand'); tap('hand'); tap('hand'); wait(4);
    ev.push([f, 'mark', `${el}: combination, standing`]);
    stickUp(); wait(6); tap('hand'); tap('leg'); tap('leg'); tap('hand'); wait(10);
    ev.push([f, 'mark', `${el}: dodge sideways and counter`]);
    stick(80, 0); wait(4); tap('dodge'); stickUp(); wait(4); tap('hand'); tap('leg'); wait(8);
    ev.push([f, 'mark', `${el}: guard`]);
    hold('guard', 30); wait(4);
    ev.push([f, 'mark', `${el}: special`]);
    tap('special'); wait(14);
    ev.push([f, 'mark', `${el}: strafe and attack`]);
    stick(-80, -20); wait(6); tap('leg'); tap('hand'); tap('hand'); stickUp(); wait(10);
    ev.push([f, 'mark', `${el}: hold HAND, then charged LEG`]);
    hold('hand', 34); wait(6); hold('leg', 30); wait(24);
  }
  return { ev, total: f + 10 };
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(BASE) ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
async function session(mode) {
  const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const fingers = new Map();
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  const settle = async () => { await sleep(25); if (fingers.size) await touch('touchMove', [...fingers.values()].map(q => ({ ...q, x: q.x + 0.01 }))); await sleep(25); };
  await page.goto(BASE); await page.waitForFunction(() => window.__EF);
  await page.locator('#btn-start').click();
  const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const btnPos = {}; for (const a of ['hand', 'leg', 'guard', 'dodge', 'jump', 'special']) btnPos[a] = await centre('#btn-' + a);
  for (const e of ELS) btnPos['el-' + e] = await centre(`.el[data-el="${e}"]`);
  await page.evaluate((mode) => {
    const E = window.__EF; E.state.manual = true;
    if (mode === 'demo') E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); };
    for (let i = 0; i < 40; i++) E.step(1 / 30);
    const p = E.player, o = E.opp; p.pos.set(0, 0, -10); o.pos.set(0, 0, -2); p.faceYaw = p.yaw = 0; E.camCtl.snapBehind(p); E.state.locked = true;
    window.__log = []; window.__f = 0;
  }, mode);
  const { ev, total } = buildScript();
  const byFrame = new Map(); for (const e of ev) { if (!byFrame.has(e[0])) byFrame.set(e[0], []); byFrame.get(e[0]).push(e); }
  const marks = []; const shots = [];
  const ids = { hand: 11, leg: 12, guard: 13, dodge: 14, special: 15, jump: 16 };
  for (let f = 0; f < total; f++) {
    const list = byFrame.get(f) || [];
    let touched = false;
    for (const e of list) {
      if (e[1] === 'mark') { marks.push([f, e[2]]); continue; }
      if (mode === 'touch') {
        if (e[1] === 'down') { const p = btnPos[e[2]]; fingers.set(ids[e[2]], { x: p.x, y: p.y, id: ids[e[2]], label: e[2] }); await touch('touchStart', [...fingers.values()]); touched = true; }
        if (e[1] === 'up') { const q = fingers.get(ids[e[2]]); fingers.delete(ids[e[2]]); if (q) await touch('touchEnd', [q]); touched = true; }
        if (e[1] === 'stick') { if (!fingers.has(1)) { fingers.set(1, { x: 160, y: 300, id: 1, label: 'stick' }); await touch('touchStart', [...fingers.values()]); await settle(); } fingers.set(1, { x: 160 + e[2], y: 300 + e[3], id: 1, label: 'stick' }); await touch('touchMove', [...fingers.values()]); touched = true; }
        if (e[1] === 'stickUp') { const q = fingers.get(1); fingers.delete(1); if (q) await touch('touchEnd', [q]); touched = true; }
        if (e[1] === 'element') { const p = btnPos['el-' + e[2]]; const q = { x: p.x, y: p.y, id: 20 }; await touch('touchStart', [...fingers.values(), q]); await sleep(20); await touch('touchEnd', [q]); touched = true; }
      } else {
        // demo mode: the earlier recorder's method - presses written straight into the controls, no movement
        await page.evaluate((e) => { const E = window.__EF, C = E.controls;
          if (e[1] === 'down') { C.btn[e[2]] = true; C.pressed[e[2]] = true; }
          if (e[1] === 'up') C.btn[e[2]] = false;
          if (e[1] === 'element') E.player.setElement(e[2]);
        }, e);
      }
    }
    if (touched) await settle();
    const shot = await page.evaluate(([video, fingersNow, mode]) => {
      const E = window.__EF, p = E.player, o = E.opp, h = p.hero;
      p.hp = Math.max(p.hp, 50); o.hp = Math.max(o.hp, 40);   // energy is NOT refilled: it runs down exactly as in a real match
      const d = o.pos.distanceTo(p.pos); if (d > 6) o.pos.lerp(p.pos, 0.04);
      E.step(1 / 30);
      const c = h && h.cur, dur = c ? c.getClip().duration : 1;
      const row = { f: window.__f++, el: p.el, act: p.action, tech: p.tech ? p.tech.name : null, techN: p.techN, u: p.action ? +p.actionU.toFixed(2) : null,
        clip: h ? h.curName : null, ct: c ? +(c.time / dur).toFixed(2) : null, ts: c ? +c.timeScale.toFixed(2) : null, wU: h ? +h.wU.toFixed(2) : 1, wL: h ? +h.wL.toFixed(2) : 1,
        sp: +Math.hypot(p.vel.x, p.vel.z).toFixed(1), en: Math.round(p.en), unp: !!(p.unpowered && p.action === 'tech'), guard: p.guarding, hold: p.holding, charge: p.charging, dodge: p.dodgeT > 0, hit: p.reacting() };
      window.__log.push(row);
      if (!video) return null;
      // main view, then a full-body side inset
      const R = E.renderer, W = R.domElement.width, H = R.domElement.height;
      R.render(E.scene, E.camera);
      const side = window.__sideCam || (window.__sideCam = E.camera.clone());
      const yaw = p.yaw, rx = Math.cos(yaw), rz = -Math.sin(yaw);
      side.aspect = 1; side.near = 2.2; side.updateProjectionMatrix();   // clip anything between the inset camera and the fighter
      side.position.set(p.pos.x + rx * 3.4 + Math.sin(yaw) * 0.6, p.pos.y + 1.25, p.pos.z + rz * 3.4 + Math.cos(yaw) * 0.6); side.lookAt(p.pos.x, p.pos.y + 0.9, p.pos.z);
      const s = Math.round(H * 0.58);
      R.setScissorTest(true); R.setViewport(W - s - 6, 6, s, s); R.setScissor(W - s - 6, 6, s, s); R.setClearColor(0x9fb0c4, 1); R.clear(); R.render(E.scene, side);
      R.setScissorTest(false); R.setViewport(0, 0, W, H);
      const cv = window.__cv || (window.__cv = document.createElement('canvas')); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(R.domElement, 0, 0);
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(W - s - 6, H - s - 6, s, s);
      g.font = 'bold 15px sans-serif'; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 4;
      const m = E.MOCAP[(row.clip || '').split('|')[0]], lowN = h && h.low ? h.lowName.split('|')[0] : null;
      const LD = window.__LOAD || {};
      g.fillText(`${mode === 'touch' ? 'TOUCH CONTROLS, AI fighting back (Normal)' : 'DEMO METHOD (scripted presses, passive rival)'}  -  ${p.el.toUpperCase()}   [${location.host}${location.pathname}  clips decoded ${LD.clipsDecoded}/${LD.clipsExpected}]`, 10, 22);
      g.fillText(`technique: ${row.tech || row.act || (row.guard ? 'GUARD' : row.hold ? 'HOLD' : row.charge ? 'CHARGE' : row.dodge ? 'DODGE' : '-')}`, 10, 44);
      g.fillText(`clip: ${(row.clip || '').split('|')[0]}${(row.clip || '').endsWith('|U') ? ' (upper body)' : ''}  [${m ? m.src.replace(/ \[.*\]/, '') : 'core library'}]  ${Math.round((row.ct || 0) * 100)}%  x${row.ts}`, 10, 64);
      if (lowN) g.fillText(`legs: ${lowN} [${E.MOCAP[lowN] ? E.MOCAP[lowN].src.replace(/ \[.*\]/, '') : 'core library'}]`, 10, 104);
      g.fillText(`authored: upper ${Math.round((1 - row.wU) * 100)}%  lower ${Math.round((1 - row.wL) * 100)}%   energy ${row.en}${row.unp ? '  (strike without bending: out of energy)' : ''}`, 10, 84);
      g.fillText('full body (side)', W - s, H - s - 12);
      for (const q of fingersNow) { g.beginPath(); g.arc(q.x, q.y, 16, 0, 7); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill(); g.fillStyle = '#fff'; g.fillText(q.label || '', q.x + 18, q.y + 5); }
      return cv.toDataURL('image/jpeg', 0.82);
    }, [VIDEO, [...fingers.values()], mode]);
    if (shot) shots.push(shot);
    if (VIDEO && shots.length >= 30) { flushShots(mode, shots); }
  }
  if (VIDEO) flushShots(mode, shots);
  const log = await page.evaluate(() => window.__log);
  const trace = await page.evaluate(() => window.__EF.player.hero ? window.__EF.player.hero.trace : []);
  await ctx.close();
  return { log, marks, errors, trace };
}
const counters = {};
function flushShots(mode, shots) {
  const dir = path.join(OUT, 'frames-' + mode); fs.mkdirSync(dir, { recursive: true });
  counters[mode] ??= 0;
  for (const s of shots.splice(0)) fs.writeFileSync(path.join(dir, `f${String(counters[mode]++).padStart(5, '0')}.jpg`), Buffer.from(s.split(',')[1], 'base64'));
}

// ---- per-technique analysis from the frame log
function analyse(log) {
  const out = []; let cur = null;
  const close = (end, why) => { if (!cur) return; cur.endReason = why; cur.frames = end - cur.start; out.push(cur); cur = null; };
  for (let i = 0; i < log.length; i++) {
    const r = log[i], prev = log[i - 1];
    const kind = r.act === 'tech' ? 'tech:' + r.tech + '#' + r.techN : r.guard ? 'guard' : r.hold ? 'hold' : r.charge ? 'charge' : r.dodge ? 'dodge' : null;
    if (!cur || kind !== cur.key) {
      if (cur) close(i, kind ? (kind.startsWith('tech') ? 'next technique' : kind) : prev && prev.hit ? 'hit reaction' : (r.hit ? 'hit reaction' : 'finished'));
      if (kind) cur = { key: kind, el: r.el, name: r.act === 'tech' ? r.tech : kind, start: i, clips: {}, authU: 0, authL: 0, n: 0, maxU: 0, moving: 0, ts: null, maxCt: 0 };
    }
    if (cur) {
      cur.clips[r.clip] = (cur.clips[r.clip] || 0) + 1; cur.authU += 1 - r.wU; cur.authL += 1 - r.wL; cur.n++; cur.maxU = Math.max(cur.maxU, r.u || 0);
      if (r.sp > 1) cur.moving++; if (r.ts) cur.ts = r.ts; if (r.ct !== null) cur.maxCt = Math.max(cur.maxCt, r.ct);
    }
  }
  close(log.length, 'end');
  return out.map(t => {
    const main = Object.entries(t.clips).sort((a, b) => b[1] - a[1])[0];
    return { el: t.el, action: t.name, clip: main ? main[0] : null, clipShare: main ? +(main[1] / t.n).toFixed(2) : 0, frames: t.frames, techProgress: +t.maxU.toFixed(2), clipProgress: +t.maxCt.toFixed(2),
      speed: t.ts, authoredUpper: +(t.authU / t.n).toFixed(2), authoredLower: +(t.authL / t.n).toFixed(2), movingShare: +(t.moving / t.n).toFixed(2), endedBy: t.endReason };
  });
}

const results = {};
// --modes touch,demo (default both); a mode whose log already exists in outDir is reused unless --fresh
const MODES = process.argv.includes('--modes') ? process.argv[process.argv.indexOf('--modes') + 1].split(',') : ['touch', 'demo'];
for (const mode of ['touch', 'demo']) {
  const logFile = path.join(OUT, `log-${mode}.json`), metaFile = path.join(OUT, `meta-${mode}.json`);
  if (MODES.includes(mode) && (process.argv.includes('--fresh') || !fs.existsSync(logFile))) {
    console.log('session', mode);
    const s = await session(mode);
    fs.writeFileSync(logFile, JSON.stringify(s.log)); fs.writeFileSync(metaFile, JSON.stringify({ marks: s.marks, errors: s.errors, trace: s.trace.slice(-200) }));
  }
  if (!fs.existsSync(logFile)) continue;
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { marks: [], errors: [], trace: [] };
  results[mode] = { techniques: analyse(JSON.parse(fs.readFileSync(logFile, 'utf8'))), ...meta };
  const frames = path.join(OUT, 'frames-' + mode), mp4 = path.join(OUT, 'gameplay-' + mode + '.mp4');
  if (VIDEO && fs.existsSync(frames) && !(fs.existsSync(mp4) && fs.statSync(mp4).size > 0))
    execSync(`ffmpeg -v error -y -framerate 30 -i "${frames}/f%05d.jpg" -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "${mp4}"`);
}
fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(results, null, 1));
for (const mode of Object.keys(results)) {
  console.log(`\n== ${mode}`);
  for (const t of results[mode].techniques) console.log(`${t.el.padEnd(6)} ${String(t.action).padEnd(22)} clip ${String(t.clip).padEnd(18)} share ${t.clipShare} frames ${String(t.frames).padStart(3)} tech ${t.techProgress} clip ${t.clipProgress} x${t.speed} authU ${t.authoredUpper} authL ${t.authoredLower} moving ${t.movingShare} end: ${t.endedBy}`);
  if (results[mode].errors.length) console.log('ERRORS', results[mode].errors);
}
await browser.close();
