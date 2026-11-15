// Stage 1 acceptance test. Run it against the DEPLOYED build (or a local server):
//   node tests/acceptance-test.mjs https://tamikoroye.github.io/elemental-forge-dev/ ./acceptance
// It fails if the animation pack is unavailable or the game falls back to procedural combat.
// All gameplay is driven through the on-screen touch controls (CDP multi-touch on the real buttons and joystick)
// with the rival AI fighting back (Training difficulty, set in the menu); energy and health are NEVER refilled.
// Checks:
//   load    1 the character and the complete pack load (build stamp, decoded count == expected, nothing missing)
//           1b the same with fetch/XHR blocked by a Content-Security-Policy (as some embedded viewers do)
//           1c a missing pack blocks the start with a visible error (no silent fallback)
//   play    3 punch  4 kick  5 sustained bending  6 guard + counterattack  7 attack while moving
//           8 repeated attacks without refilling energy  9 switching through all four elements  10 touch only
//           and, throughout: every technique frame shows an authored clip from the pack (never procedural)
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = path.resolve(process.argv[3] || './acceptance'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (opts.csp || opts.block) await page.route('**/*', async (route) => {
    const u = route.request().url();
    if (opts.block && u.includes(opts.block)) return route.abort();
    const r = await route.fetch(); const h = { ...r.headers() };
    if (opts.csp && route.request().resourceType() === 'document') h['content-security-policy'] = opts.csp;
    await route.fulfill({ response: r, headers: h });
  });
  await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
  await page.waitForFunction(() => window.__LOAD || document.getElementById('load-error'), null, { timeout: 60000 }).catch(() => {});
  await sleep(500);
  return { ctx, page, errors };
}
const status = (page) => page.evaluate(() => ({ load: window.__LOAD, stamp: (document.getElementById('build-stamp') || {}).textContent, err: (document.getElementById('load-error') || {}).textContent || null, startDisabled: document.getElementById('btn-start').disabled }));

// ---------------------------------------------------------------- 1, 1b, 1c loading
{
  const { ctx, page, errors } = await open(); const s = await status(page);
  check('1 complete animation pack loads (decoded == expected, nothing missing, character OK)', s.load && s.load.ok && s.load.character === 'ok' && s.load.clipsDecoded === s.load.clipsExpected && s.load.clipsDecoded >= 68 && !s.load.missing.length, `stamp "${s.stamp}"`);
  check('1 no page errors while loading', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await open({ csp: "connect-src 'none'" }); const s = await status(page);
  check('1b pack loads with fetch/XHR blocked (embedded-viewer conditions)', s.load && s.load.ok && s.load.clipsDecoded === s.load.clipsExpected, `stamp "${s.stamp}"`);
  await ctx.close();
}
{
  const { ctx, page } = await open({ block: 'animations/martial.js' }); const s = await status(page);
  await page.locator('#btn-start').click({ force: true }).catch(() => {}); await sleep(400);
  const started = await page.evaluate(() => window.__EF ? window.__EF.state.phase !== 'menu' : false);
  check('1c missing pack: start is blocked with a visible error, no procedural fallback', s.startDisabled && s.err && /martial\.js|Animations/.test(s.err) && !started, `error shown: "${(s.err || '').slice(0, 140)}"`);
  await ctx.close();
}

// ---------------------------------------------------------------- 3-10 gameplay through touch controls
const { ctx, page, errors } = await open();
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
const fingers = new Map();
const settle = async () => { await sleep(25); if (fingers.size) await touch('touchMove', [...fingers.values()].map(q => ({ ...q, x: q.x + 0.01 }))); await sleep(25); };
const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// the rival on Training difficulty (chosen in the menu, as a player would): it still attacks, but rarely enough that
// a scripted player is not knocked out mid-test; the evidence recording uses Normal
await page.locator('#difficulty button[data-d="training"]').tap();
await page.locator('#btn-start').tap();
await page.evaluate(() => { const E = window.__EF; E.state.manual = true; for (let i = 0; i < 60; i++) E.step(1 / 30); });
const pos = {}; for (const a of ['hand', 'leg', 'guard', 'dodge', 'special']) pos[a] = await centre('#btn-' + a);
for (const e of ['earth', 'fire', 'water', 'air']) pos['el-' + e] = await centre(`.el[data-el="${e}"]`);
const ids = { hand: 11, leg: 12, guard: 13, dodge: 14, special: 15 };
// one frame of game time, logging what the player's character shows
const frame = () => page.evaluate(() => {
  const E = window.__EF, p = E.player, h = p.hero; E.opp.hp = Math.max(E.opp.hp, 30);   // the rival is kept from being knocked out so the match lasts the whole test (the player is never refilled)
  E.step(1 / 30);
  const name = h ? (h.curName || '').split('|')[0] : null;
  return { el: p.el, act: p.action, tech: p.tech ? p.tech.name : null, guard: p.guarding, hold: p.holding, charge: p.charging, moving: Math.hypot(p.vel.x, p.vel.z) > 1, en: p.en, unp: !!(p.unpowered && p.action === 'tech'),
    hero: !!h, clip: name, layer: h && h.low ? h.lowName.split('|')[0] : null, authored: !!(name && E.MOCAP[name]), wU: h ? h.wU : 1, wL: h ? h.wL : 1, counter: p.action === 'counter', hp: p.hp, ohp: E.opp.hp };
});
const log = [];
const run = async (n) => { for (let i = 0; i < n; i++) log.push(await frame()); };
const down = async (b) => { fingers.set(ids[b], { ...pos[b], id: ids[b] }); await touch('touchStart', [...fingers.values()]); await settle(); };
const up = async (b) => { const q = fingers.get(ids[b]); fingers.delete(ids[b]); if (q) await touch('touchEnd', [q]); await settle(); };
const tap = async (b, len = 4) => { await down(b); await run(len); await up(b); await run(3); };
const stick = async (dx, dy) => { if (!fingers.has(1)) { fingers.set(1, { x: 160, y: 300, id: 1 }); await touch('touchStart', [...fingers.values()]); await settle(); } fingers.set(1, { x: 160 + dx, y: 300 + dy, id: 1 }); await touch('touchMove', [...fingers.values()]); await settle(); };
const stickUp = async () => { const q = fingers.get(1); fingers.delete(1); if (q) await touch('touchEnd', [q]); await settle(); };
const element = async (e) => { const q = { ...pos['el-' + e], id: 20 }; await touch('touchStart', [...fingers.values(), q]); await sleep(20); await touch('touchEnd', [q]); await settle(); await run(4); };
const mark = () => log.length;
// a player presses when their fighter can act: wait (in game time) until not trapped, stunned, hit or mid-move
const whenFree = async () => { for (let i = 0; i < 90; i++) { const ok = await page.evaluate(() => { const p = window.__EF.player; return !p.action && !(p.restrainT > 0) && !(p.stunT > 0) && p.dodgeT <= 0 && window.__EF.state.phase === 'fight'; }); if (ok) return; log.push(await frame()); } };
const seg = (a, b = log.length) => log.slice(a, b);
const reachAuthored = (s, pred) => s.filter(pred).length > 0 && s.filter(pred).every(r => r.hero && r.authored && r.wU < 0.05 && r.wL < 0.05);
const perEl = {};
// between rounds (after a knockout) the game ignores input until the next round starts, as it does for a player
const waitFight = async () => { for (let i = 0; i < 400; i++) { const ph = await page.evaluate(() => { const E = window.__EF; E.step(1 / 30); return E.state.phase; }); if (ph === 'fight') return; } };
for (const el of ['earth', 'fire', 'water', 'air']) {
  await waitFight(); await element(el); await run(10);
  const R = perEl[el] = {};
  await whenFree(); let m = mark(); await tap('hand', 4); await run(18); R.punch = seg(m);
  await whenFree(); m = mark(); await tap('leg', 5); await run(22); R.kick = seg(m);
  await whenFree(); m = mark(); await down('hand'); await run(36); await up('hand'); await run(8); R.hold = seg(m);
  await whenFree(); m = mark(); await down('guard'); await run(10);
  await page.evaluate(() => { const E = window.__EF, p = E.player, o = E.opp; o.pos.set(p.pos.x + Math.sin(p.faceYaw) * 1.5, 0, p.pos.z + Math.cos(p.faceYaw) * 1.5); o.buf.hand = 0.35; });   // the rival strikes into the guard
  await run(12); await up('guard'); await whenFree(); await tap('hand', 3); await run(16); R.guard = seg(m);
  await waitFight(); m = mark(); await stick(0, -78); await run(10); await tap('hand', 3); await tap('hand', 3); await run(6); await stickUp(); await run(6); R.moving = seg(m);
  await waitFight(); m = mark(); for (let i = 0; i < 6; i++) { await tap(i % 2 ? 'leg' : 'hand', 3); await run(3); } await run(12); R.repeat = seg(m);
  await waitFight(); await whenFree(); m = mark(); await tap('special', 3); await run(26); R.special = seg(m);
}
await page.screenshot({ path: path.join(OUT, 'acceptance-end.png') });
const els = Object.keys(perEl);
const all = (k, pred) => els.every(el => reachAuthored(perEl[el][k], pred));
const isTech = (r) => r.act === 'tech';
check('3 punch plays its authored clip in every element', all('punch', isTech), els.map(el => `${el}: ${[...new Set(perEl[el].punch.filter(isTech).map(r => r.clip))].join('/')}`).join('; '));
check('4 kick plays its authored clip in every element', all('kick', isTech), els.map(el => `${el}: ${[...new Set(perEl[el].kick.filter(isTech).map(r => r.clip))].join('/')}`).join('; '));
check('5 sustained bending (held HAND) plays the authored hold loop', all('hold', r => r.hold), els.map(el => `${el}: ${[...new Set(perEl[el].hold.filter(r => r.hold).map(r => r.clip))].join('/')}`).join('; '));
check('6 guard plays the authored guard and the follow-up strike lands as a technique', els.every(el => reachAuthored(perEl[el].guard, r => r.guard) && perEl[el].guard.some(r => r.act === 'tech' || r.counter)), els.map(el => `${el}: ${[...new Set(perEl[el].guard.filter(r => r.guard).map(r => r.clip))].join('/')}`).join('; '));
// attacks while moving, anywhere in the session (the rival's hits make any fixed window unreliable); every element
// must have some, and every such frame must be authored for both halves of the body
const movingTech = (el) => log.filter(r => r.el === el && r.act === 'tech' && r.moving);
check('7 attacks while moving: authored upper body over authored footwork', els.every(el => movingTech(el).length > 0 && movingTech(el).every(r => r.authored && r.wU < 0.05 && r.wL < 0.05)),
  els.map(el => `${el}: ${movingTech(el).length} frames, legs ${[...new Set(movingTech(el).map(r => r.layer || r.clip))].join('/')}`).join('; '));
const repeatTechs = els.map(el => new Set(perEl[el].repeat.filter(isTech).map(r => r.tech + r.clip)).size);
check('8 six quick attacks per element without refilling energy all play authored clips', els.every(el => reachAuthored(perEl[el].repeat, isTech)) && repeatTechs.every(n => n >= 2), `distinct strikes ${repeatTechs.join('/')}, energy at the end ${els.map(el => Math.round(perEl[el].repeat.at(-1).en)).join('/')}, strikes without bending ${log.filter(r => r.unp).length} frames`);
check('9 switching through all four elements via the element buttons', els.every(el => perEl[el].punch.some(r => r.el === el)), els.join(' -> '));
check('SPECIAL plays its authored clip in every element', all('special', isTech), els.map(el => `${el}: ${[...new Set(perEl[el].special.filter(isTech).map(r => r.clip))].join('/')}`).join('; '));
const techFrames = log.filter(r => r.act === 'tech' || r.guard || r.hold || r.charge);
const procedural = techFrames.filter(r => !r.hero || !r.authored || r.wU > 0.05 || r.wL > 0.05);
check('NO procedural fallback: every technique/guard/hold frame shows a clip from the pack', techFrames.length > 100 && procedural.length === 0, `${techFrames.length} frames checked, ${procedural.length} procedural${procedural.length ? ' e.g. ' + JSON.stringify(procedural[0]) : ''}`);
// whole session: the procedural body must never be what is shown (a short crossfade is tolerated: weight < 0.5)
const anyProc = log.filter(r => !r.hero || r.wU > 0.5 || r.wL > 0.5);
check('NO procedural body in ANY frame of the session (stance, movement, reactions included)', anyProc.length === 0, `${log.length} frames, ${anyProc.length} procedural${anyProc.length ? ' e.g. ' + JSON.stringify(anyProc[0]) : ''}`);
check('10 all of the above through touch controls only, no page errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync(path.join(OUT, 'acceptance-results.json'), JSON.stringify({ base: BASE, results }, null, 1));
fs.writeFileSync(path.join(OUT, 'acceptance-log.json'), JSON.stringify(log));
console.log(`${results.filter(r => r.ok).length}/${results.length} acceptance checks passed against ${BASE}`);
await browser.close();
process.exit(results.every(r => r.ok) ? 0 : 1);
