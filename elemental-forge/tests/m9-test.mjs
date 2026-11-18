// M9 checks, played through the keyboard controls (F hand, G leg, Q guard, Shift dodge, Space jump, W/A/S/D stick),
// stepped at 1/60 s. Each check prints PASS/FAIL with the measured values.
// Usage: node tests/m9-test.mjs [baseUrl] [check,check]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'rec=1');
await page.waitForFunction(() => window.__EF && window.__EF.LOAD && (window.__EF.LOAD.ok || window.__EF.LOAD.errors.length), null, { timeout: 60000 });
await page.locator('#btn-start').click(); await page.waitForFunction(() => window.__EF.state.phase === 'fight', null, { timeout: 120000 });
await page.evaluate(() => {
  const E = window.__EF; E.state.manual = true;
  E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.dodgeHeld = i.jump = i.jumpHeld = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); };
  E.state.locked = true; E.player.target = E.opp;
});
const step = (n, probe) => page.evaluate(([n, probe]) => {
  const E = window.__EF, out = [];
  for (let i = 0; i < n; i++) { E.player.hp = Math.max(E.player.hp, 50); E.opp.hp = Math.max(E.opp.hp, 50); E.player.en = Math.max(E.player.en, 60); E.step(1 / 60); if (probe) out.push((new Function('E', 'P', 'O', 'return ' + probe))(E, E.player, E.opp)); }
  return out;
}, [n, probe || null]);
const ev = (code) => page.evaluate((c) => (new Function('E', 'P', 'O', 'return ' + c))(window.__EF, window.__EF.player, window.__EF.opp), code);
const setup = (pel, oel, d = 4) => page.evaluate(([pel, oel, d]) => {
  const E = window.__EF, P = E.player, O = E.opp; P.setElement(pel, true); O.setElement(oel, true);
  P.reset(0, 0, 0); O.reset(0, d, Math.PI); E.world.bending.clear && E.world.bending.clear();
}, [pel, oel, d]);
const tap = async (code, hold = 2) => { await page.keyboard.down(code); await step(hold); await page.keyboard.up(code); };
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}  ${info}`); if (!ok) fails++; };
const CHECKS = {
  async fireGlide() {
    await setup('fire', 'earth', 5); await step(30);
    const probe = "({ d: P.dodgeT > 0 ? 1 : 0, kind: P.dodgeKind, h: +(P.pos.y - P.groundY).toFixed(3), py: +P.pos.y.toFixed(3), gy: +P.groundY.toFixed(3), vy: +P.vel.y.toFixed(2), fl: +(P.footPos('L', new P.pos.constructor()).y - P.groundY).toFixed(3), fr: +(P.footPos('R', new P.pos.constructor()).y - P.groundY).toFixed(3), x: +P.pos.x.toFixed(2), tech: P.tech && P.tech.name, lo: P.hero.lowName, cur: P.hero.curName, orbs: E.world.bending.objs.filter(o => o.owner === P && /fire/.test(o.kind) && o.state !== 'dead').length, ll: (() => { const h = P.hero.bones['DEF-hips'].getWorldPosition(new P.pos.constructor()); const a = P.footPos('L', new P.pos.constructor()), b = P.footPos('R', new P.pos.constructor()); const c = Math.cos(P.yaw), s = Math.sin(P.yaw), L = (p) => [(p.x - h.x) * c - (p.z - h.z) * s, (p.x - h.x) * s + (p.z - h.z) * c]; return [...L(a), ...L(b)].map(v => +v.toFixed(2)); })() })";
    await page.keyboard.down('KeyD'); await page.keyboard.down('ShiftLeft'); const a = await step(2, probe); await page.keyboard.up('ShiftLeft');
    const b = await step(16, probe);
    await tap('KeyF'); const c = await step(10, probe); await tap('KeyF'); const c2 = await step(10, probe);
    await tap('KeyG'); const d = await step(30, probe); await page.keyboard.up('KeyD');
    const all = [...a, ...b, ...c, ...c2, ...d], glide = all.filter(r => r.d && r.kind === 'rocket');
    const mid = glide.slice(8, -9);
    const minFoot = Math.min(...mid.map(r => Math.min(r.fl, r.fr))), maxH = Math.max(...glide.map(r => r.h));
    // stepping legs would swing each foot back and forth relative to the hips; on the board they stay put
    const sw = [0, 1, 2, 3].map(i => Math.max(...mid.map(r => r.ll[i])) - Math.min(...mid.map(r => r.ll[i])));
    const punchedInGlide = glide.some(r => r.tech === 'Fire Fist'), blastInGlide = glide.some(r => r.tech === 'Jet Blast');
    const legs = [...new Set(glide.map(r => r.lo))], uppers = [...new Set(glide.map(r => r.cur))];
    if (process.env.DEBUG) console.log(all.map(r => r.py + '/' + r.gy + '/' + r.vy + (r.d ? '' : '*') + (r.tech ? '!' : '')).join(' '));
    const dur = glide.length / 60, travel = Math.abs(glide[glide.length - 1].x - glide[0].x);
    check('Fire glide: about 1 s, half a metre up, feet off the floor', dur > 0.85 && maxH > 0.4 && maxH < 0.65 && minFoot > 0.15, `glide ${dur.toFixed(2)} s, height up to ${maxH.toFixed(2)} m, lowest foot mid-glide ${minFoot.toFixed(2)} m, travel ${travel.toFixed(1)} m`);
    check('Fire glide: legs locked in the board crouch (no steps)', legs.every(n => n === 'skate_ride|L') && Math.max(...sw) < 0.12, `leg clips ${legs.join(',')}, foot swing relative to hips (fighter's frame) ${sw.map(v => v.toFixed(2)).join('/')} m`);
    check('Fire glide: punches and a blast thrown while it carries on', punchedInGlide && blastInGlide, `upper clips ${uppers.join(', ')}, flame shots in flight ${Math.max(...all.map(r => r.orbs))}`);
  },
  async lingerEarth() {
    await setup('earth', 'fire', 4); await step(20);
    await page.keyboard.down('KeyQ'); await step(40); await page.keyboard.up('KeyQ'); await step(30);
    const up = await ev('!!(P.defense && !P.defense.dead && P.defense.lingering && P.defense.rise > 0.9)');
    const rocks0 = await ev('P.defense ? P.defense.rocks.length : -1');
    let thrown = 0;
    for (let i = 0; i < 3; i++) { await tap('KeyF'); const r = await step(40, "(P.defense && P.defense.rocks) ? P.defense.rocks.length : 0"); thrown = rocks0 - r[r.length - 1]; }
    check('Earth: rocks stay up after GUARD is let go, three punches throw all three', up && rocks0 === 3 && thrown === 3, `up 0.5 s after release ${up}, rocks ${rocks0}, thrown ${thrown}`);
    await setup('earth', 'fire', 4); await step(20);
    await page.keyboard.down('KeyQ'); await step(40); await page.keyboard.up('KeyQ');
    const life = await step(200, '!!(P.defense && !P.defense.dead)'); const t = life.indexOf(false) / 60;
    check('Earth: unused rocks crumble about 2 s after release', t > 1.8 && t < 2.6, `gone after ${t.toFixed(2)} s`);
  },
  async lingerWater() {
    await setup('water', 'fire', 5); await step(20);
    await page.keyboard.down('KeyQ'); await step(40); await page.keyboard.up('KeyQ'); await step(10);
    const ice = await ev('!!(P.defense && P.defense.ice && P.defense.lingering)');
    const hp0 = await ev('O.hp');
    let spears = 0;
    for (let i = 0; i < 4; i++) { await tap('KeyF'); const r = await step(24, "E.world.bending.objs.filter(o => o.kind === 'iceSpear' && o.owner === P && o.state !== 'dead').length"); spears = Math.max(spears, Math.max(...r)); }
    await step(40);
    const left = await ev('P.defense ? P.defense.iceShots : 0'), hp1 = await ev('O.hp');
    check('Water: shield turns to ice on release; four punches shoot four spikes off it', ice && left === 0, `ice ${ice}, spikes left ${left}, most spikes in flight at once ${spears}, rival hp ${hp0} -> ${hp1}`);
  },
  async lingerFire() {
    await setup('fire', 'earth', 5); await step(20);
    await page.keyboard.down('KeyQ'); await step(40); await page.keyboard.up('KeyQ'); await step(20);
    const up = await ev('!!(P.defense && P.defense.lingering && !P.defense.dead)');
    await tap('KeyF');
    const r = await step(30, "E.world.bending.objs.filter(o => o.kind === 'fireOrb' && o.owner === P && o.state !== 'dead').length");
    const gone = await ev('!P.defense');
    check('Fire: wall stays up after release; a punch throws it as three flame orbs', up && Math.max(...r) >= 3 && gone, `up ${up}, orbs ${Math.max(...r)}, wall gone ${gone}`);
  },
};
for (const [name, fn] of Object.entries(CHECKS)) if (!ONLY || ONLY.includes(name)) { try { await fn(); } catch (e) { check(name, false, 'threw ' + e.message); } }
if (errors.length) { console.log('page errors:', errors.slice(0, 5)); fails++; }
await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
