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
  async review18b() {
    // 18 Nov, second review (phone recording r21)
    // 1. Water lifted on its column stands in the water stance (no Falling Into Pool flailing)
    await setup('water', 'earth', 6); await step(20); await page.keyboard.down('Space'); const lift = await step(70, 'P.hero.curName'); await page.keyboard.up('Space'); await step(90);
    check('Water lift: stands on the column in the water stance (no flailing pose)', !lift.some(c => /water_pool/.test(c)) && lift.slice(30).filter(c => /water_stance/.test(c)).length > 25, `clips ${[...new Set(lift)].join(', ')}`);
    // 2. riding the ice: HAND punches throw water / ice balls, no whips
    await setup('water', 'earth', 5); await step(20);
    // (DODGE held: the arch runs on into the ice surf, so all three punches are thrown while riding)
    await page.keyboard.down('KeyD'); await page.keyboard.down('ShiftLeft'); await step(30);
    const techs = new Set(); for (let i = 0; i < 3; i++) { await tap('KeyF'); for (const r of await step(30, "(P.tech ? P.tech.name : '') + '|' + E.world.bending.objs.filter(o => o.owner === P && (o.kind === 'water' || o.kind === 'iceBall') && o.state !== 'dead').length + '|' + (E.world.bending.weapons.whips || []).filter(W => W.f === P).length")) techs.add(r); }
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyD'); await step(40);
    const rows = [...techs], balls = Math.max(...rows.map(r => +r.split('|')[1])), whips = Math.max(...rows.map(r => +r.split('|')[2]));
    check('Riding the ice: HAND throws water and ice punches, no whips', rows.some(r => r.startsWith('Water Punch')) && !rows.some(r => r.startsWith('Water Whip')) && balls > 0 && whips === 0, `techs ${[...new Set(rows.map(r => r.split('|')[0]).filter(Boolean))].join(', ')}, balls ${balls}, whips ${whips}`);
    // 3. the whip grabs a rival standing on the ground, lifts over the head and slams
    await setup('water', 'earth', 3.2); await step(70);   // (the HAND chain starts again from the whip after 0.9 s back in stance)
    let peak = 0, grabbed = false, landedDown = false;
    await tap('KeyF'); for (const r of await step(110, "({ g: (E.world.bending.weapons.grabs || []).length, oy: O.pos.y - O.groundY, oa: O.action, dz: (O.pos.x - P.pos.x) * Math.sin(P.yaw) + (O.pos.z - P.pos.z) * Math.cos(P.yaw) })")) { if (r.g) grabbed = true; if (r.g) peak = Math.max(peak, r.oy); if (r.oa === 'down') landedDown = true; }
    check('Water whip grabs a rival on the ground, lifts them over the head and slams them down', grabbed && peak > 2.4 && landedDown, `grabbed ${grabbed}, lifted to ${peak.toFixed(2)} m, knocked down ${landedDown}`);
    // 4. somersault smash from the air, Water and Fire
    for (const el of ['water', 'fire']) {
      await setup(el, 'earth', 3.5); await step(20);
      await page.keyboard.down('Space'); await step(el === 'water' ? 40 : 24); await page.keyboard.up('Space'); await tap('KeyG');
      const r = await step(80, "({ t: P.tech && P.tech.name, oa: O.action, hp: O.hp })");
      check(`${el}: in the air LEG is a somersault kick that smashes a wave down on the rival`, r.some(x => x.t === 'Somersault Smash') && r.at(-1).hp < r[0].hp, `techs ${[...new Set(r.map(x => x.t).filter(Boolean))].join(', ')}, rival hp ${r[0].hp} -> ${r.at(-1).hp}, rival ${[...new Set(r.map(x => x.oa).filter(Boolean))].join(',')}`);
    }
    // 5. nothing sinks into the floor: every knockdown, measured on the lowest joint (not the feet)
    let worst = 9, which = '';
    for (const [expr, lvl] of [['null', 2], ['O.style.tech.hand', 2], ["O.style.tech.leg.find(t => /Sweep/.test(t.name))", 2], ['null', 2]]) {
      await setup('earth', 'earth', 2); await step(10);
      await page.evaluate(([expr, lvl]) => { const E = window.__EF, P = E.player, O = E.opp, T = (new Function('O', 'return ' + expr))(O); O.action = T ? 'tech' : null; O.tech = T; P.invuln = 0; E.world.combat.damage(P, 8, new P.pos.constructor(0, 0, -1), O, 'melee', P.chestPos(new P.pos.constructor()), 5, lvl); O.action = null; O.tech = null; }, [expr, lvl]);
      for (const r of await step(140, "(() => { let mn = 9; for (const k in P.hero.bones) { if (/foot|toe|heel/i.test(k)) continue; mn = Math.min(mn, P.hero.bones[k].getWorldPosition(new P.pos.constructor()).y - P.groundY); } return mn + ':' + P.hero.curName; })()")) { const v = +r.split(':')[0]; if (v < worst) { worst = v; which = r.split(':')[1]; } }
    }
    check('Knockdowns stay on the floor (lowest joint at or above the floor)', worst > 0.0, `lowest joint ${worst.toFixed(3)} m (${which})`);
    // 6. standing stances are not lifted
    const lifts = []; for (const el of ['fire', 'water', 'earth', 'air']) { await setup(el, 'earth', 6); await step(40); lifts.push(el + ' ' + (await ev('P.floorLift || 0')).toFixed(3)); }
    check('Standing stances are not lifted by the floor guard', lifts.every(x => +x.split(' ')[1] < 0.01), lifts.join(', '));
  },
  async review18() {
    // 18 Nov review: Earth's stance, Fire's plain get-up, Air flight upright (no reclined Flying), Dragon's Breath torrent
    await setup('earth', 'fire', 5); const st = await step(40, 'P.hero.curName');
    await setup('fire', 'earth', 2); await step(10);
    await page.evaluate(() => { const E = window.__EF, P = E.player, O = E.opp; P.invuln = 0; E.world.combat.damage(P, 8, new P.pos.constructor(0, 0, -1), O, 'melee', P.chestPos(new P.pos.constructor()), 5, 2); });
    const gu = await step(200, "P.hero.curName + ':' + P.action"), getupFrames = gu.filter(x => x.endsWith(':getup')).length;
    // (Air takes flight with JUMP held)
    await setup('air', 'earth', 8); await step(10); await page.keyboard.down('Space'); await step(30); await page.keyboard.down('KeyW'); const fl = await step(90, "(P.mob ? P.mob.kind : '-') + ':' + P.hero.lowName + ':' + P.hero.curName"); await page.keyboard.up('KeyW'); await page.keyboard.up('Space'); await step(30);
    await setup('fire', 'earth', 5); await step(30);
    await page.keyboard.down('KeyQ'); await step(20); await page.keyboard.down('KeyE'); await step(2); await page.keyboard.up('KeyE'); await page.keyboard.up('KeyQ');
    const br = await step(120, "({ n: (E.world.bending.breaths || []).length, hp: O.hp, eng: O.engulfT || 0 })");
    check('Earth stance is the fighting idle (Bouncing Fight Idle)', st.slice(-10).every(c => c === 'earth_fight'), `clips ${[...new Set(st)].join(', ')}`);
    check('Fire gets up with the plain get-up (no flip), in about 1.1 s', gu.some(x => x.startsWith('getup:')) && !gu.some(x => /kip/.test(x)) && getupFrames < 80, `clips ${[...new Set(gu.map(x => x.split(':')[0]))].join(', ')}, ${getupFrames} frames getting up`);
    check('Air flight stays upright (no reclined Flying pose)', fl.some(x => x.startsWith('fly')) && !fl.some(x => /air_fly/.test(x)), `${[...new Set(fl)].slice(0, 4).join(' | ')}`);
    check("Dragon's Breath: a torrent from the mouth that burns the rival, then engulfs", br.some(r => r.n > 0) && br.at(-1).hp <= br[0].hp - 15 && Math.max(...br.map(r => r.eng)) > 1.5, `torrent frames ${br.filter(r => r.n > 0).length}, rival hp ${br[0].hp} -> ${br.at(-1).hp}, engulfed up to ${Math.max(...br.map(r => r.eng)).toFixed(1)} s`);
  },
  async turn() {
    await page.evaluate(() => { window.__EF.state.locked = false; window.__EF.player.target = null; });
    await setup('fire', 'earth', 14); await step(20);
    await page.keyboard.down('KeyW'); await step(60); await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS');
    const r = await step(40, 'P.hero.curName'); await page.keyboard.up('KeyS');
    await page.evaluate(() => { window.__EF.state.locked = true; window.__EF.player.target = window.__EF.opp; });
    check('Footwork: reversing at a run plants and turns (Change Direction)', r.some(c => /turn_back/.test(c)), `clips ${[...new Set(r)].join(', ')}`);
  },
  async reactions() {
    // scripted blows (labelled): the attacker is put in the named technique so the reaction is chosen from it
    const blow = (techExpr, lvl) => page.evaluate(([techExpr, lvl]) => {
      const E = window.__EF, P = E.player, O = E.opp, T = (new Function('O', 'return ' + techExpr))(O);
      O.action = T ? 'tech' : null; O.tech = T; P.invuln = 0;
      E.world.combat.damage(P, 8, new P.pos.constructor(0, 0, 1), O, 'melee', P.chestPos(new P.pos.constructor()), 5, lvl);
      O.action = null; O.tech = null;
    }, [techExpr, lvl]);
    const out = {};
    for (const [name, el, expr, lvl, pre] of [
      ['sweep', 'earth', "O.style.tech.leg.find(t => /Sweep/.test(t.name))", 2],
      ['punch knockdown', 'earth', 'O.style.tech.hand', 2],
      ['plain knockdown', 'earth', 'null', 2],
      ['plain knockdown 2', 'earth', 'null', 2],
      ['light punch', 'earth', 'O.style.tech.hand', 0],
      ['hit while dodging', 'water', 'null', 0, 'dodge'],
    ]) {
      await setup(el, 'earth', 2); await step(20);
      if (pre === 'dodge') { await page.keyboard.down('KeyD'); await page.keyboard.down('ShiftLeft'); await step(2); await page.keyboard.up('ShiftLeft'); await step(22); await page.keyboard.up('KeyD'); }
      await blow(expr, lvl);
      const r = await step(200, "P.hero.curName + ':' + P.action");
      out[name] = [...new Set(r.map(x => x.split(':')[0].replace(/\|.*/, '')))].filter(c => /hit|fall|trip|knock|getup|kip/.test(c)).join(' > ');
    }
    const ok = /hit_legs/.test(out.sweep) && /hit_head_down/.test(out['punch knockdown']) && /fall_flat/.test(out['plain knockdown'] + out['plain knockdown 2']) && /hit_head/.test(out['light punch']) && /trip/.test(out['hit while dodging']) && /getup/.test(out['hit while dodging']) && !/kip/.test(Object.values(out).join(' '));   // (18 Nov, after review: the flip get-ups are Air's only; Water and Earth get up plainly)
    check('Reactions chosen from the blow: sweep, punch, knockdowns, head snap, tripped mid-dodge; plain get-ups (not Air)', ok, Object.entries(out).map(([k, v]) => `${k}: ${v}`).join(' | '));
  },
  async footwork() {
    await setup('water', 'earth', 12); await step(20);
    const seen = new Set();
    await page.keyboard.down('KeyW'); for (const c of await step(50, 'P.hero.curName')) seen.add(c);
    await tap('Space'); for (const c of await step(40, 'P.hero.curName')) seen.add(c);
    await page.keyboard.up('KeyW'); await step(10); await page.keyboard.down('KeyS'); for (const c of await step(30, 'P.hero.curName')) seen.add(c); await page.keyboard.up('KeyS'); await step(60);
    const j2 = await step(1, "P.onGround + ' ' + P.action + ' ' + P.lastGroundSp"); await tap('Space', 2); const j3 = await step(50, "P.hero.curName + ' ' + (P.pos.y - P.groundY).toFixed(2)"); for (const c of j3) seen.add(c.split(' ')[0]); if (process.env.DEBUG) console.log(j3.join(' / '));
    if (process.env.DEBUG) console.log('before 2nd jump', j2);
    const want = ['loco_pose', 'run_jump', 'stand_jump'];
    check('Footwork: the first stride lunges (Male Locomotion Pose), Running Jump off a run, Standing Jump off the spot', want.every(n => [...seen].some(c => c.startsWith(n))), `clips ${[...seen].filter(c => /loco|jump|turn|Jog|sprint|Walk/.test(c)).join(', ')}`);
  },
  async airDodges() {
    await setup('air', 'earth', 5); await step(30);
    const kinds = [], clips = new Set(); let slide = 0;
    for (let i = 0; i < 4; i++) {
      await page.keyboard.down('ShiftLeft'); await step(2); await page.keyboard.up('ShiftLeft');
      const r = await step(140, "({ k: P.dodgeT > 0 ? P.dodgeKind : null, c: P.hero.curName, g: P.onGround })");
      kinds.push(r.find(x => x.k) ? r.find(x => x.k).k : 'none'); for (const x of r) if (x.k === 'flip') clips.add(x.c);
    }
    check('Air: the whirlwind glide stays, and every second dodge is a Corkscrew Evade or a Cartwheel', kinds[0] === 'glide' && kinds[1] === 'flip' && kinds[2] === 'glide' && kinds[3] === 'flip' && [...clips].some(c => /air_cork/.test(c)) && [...clips].some(c => /cartwheel/.test(c)), `dodges ${kinds.join(', ')}; flip clips ${[...clips].join(', ')}`);
  },
  async airFloat() {
    await setup('earth', 'air', 3); await step(20);
    await page.evaluate(() => { const E = window.__EF; E.world.bending.weapons.column(E.opp, 'air', E.player.pos.clone(), { warn: 0.05, dmg: 4, lift: 10 }); });
    const r = await step(70, 'P.hero.curName');
    check('Air: a fighter thrown up by a wind column floats (Floating clip)', r.includes('air_float'), `clips ${[...new Set(r)].join(', ')}`);
  },
  async fireBreath() {
    await setup('fire', 'earth', 6); await step(30);
    await page.keyboard.down('KeyQ'); await step(20); await page.keyboard.down('KeyE'); await step(2); await page.keyboard.up('KeyE'); await page.keyboard.up('KeyQ');
    const r = await step(150, "({ c: P.hero.curName, t: P.tech && P.tech.name, eng: +(O.engulfT || 0).toFixed(2), hp: O.hp })");
    const engulfed = Math.max(...r.map(x => x.eng));
    check("Fire: GUARD + SPECIAL breathes Dragon's Breath (Zombie Scream) and the fireball engulfs the rival", r.some(x => x.t === "Dragon's Breath") && r.some(x => /fire_breath/.test(x.c)) && engulfed > 1.5, `tech seen ${r.some(x => x.t === "Dragon's Breath")}, engulfed for up to ${engulfed} s, rival hp ${r[0].hp} -> ${r.at(-1).hp}`);
  },
  async fireAir() {
    await setup('fire', 'earth', 6); await step(30);
    await tap('Space'); const r = await step(50, 'P.hero.curName');
    check('Fire: in the air the Male Dynamic Pose', r.includes('fire_air_pose'), `clips ${[...new Set(r)].join(', ')}`);
  },
  async earthFlair() {
    await setup('earth', 'fire', 2.2); await step(30);
    const seen = new Set(); for (let i = 0; i < 7; i++) { await tap('KeyG'); for (const c of await step(40, 'P.hero.curName')) seen.add(c); }
    check('Earth: the Flair is in the LEG chain', [...seen].some(c => /earth_flair/.test(c)), `clips ${[...seen].filter(c => /earth|flair|kick|sweep|teep/.test(c)).join(', ')}`);
  },
  async waterArch() {
    await setup('water', 'earth', 5); await step(30);
    const probe = "({ d: P.dodgeT > 0 && P.dodgeKind === 'arch', h: +(P.pos.y - P.groundY).toFixed(2), x: +P.pos.x.toFixed(2), z: +P.pos.z.toFixed(2), tech: P.tech && P.tech.name, lo: P.hero.lowName, ice: !!(P._arch && P._arch.post), spears: E.world.bending.objs.filter(o => o.owner === P && o.kind === 'iceSpear' && o.state !== 'dead').length })";
    await page.keyboard.down('KeyD'); await page.keyboard.down('ShiftLeft'); const a = await step(2, probe); await page.keyboard.up('ShiftLeft');
    const b = await step(20, probe); await tap('KeyF'); const c = await step(14, probe); await tap('KeyG'); const d = await step(40, probe); await page.keyboard.up('KeyD');
    const all = [...a, ...b, ...c, ...d], arch = all.filter(r => r.d);
    const peak = Math.max(...arch.map(r => r.h)), side = Math.abs(arch[arch.length - 1].x - arch[0].x);
    check('Water ice arch: ice under the feet lifts the bender up and to the side, surfing stance', peak > 1.2 && side > 4 && arch.every(r => r.lo === 'surf_stance|L') && arch.slice(3).every(r => r.ice), `peak ${peak} m, sideways ${side.toFixed(1)} m, legs ${[...new Set(arch.map(r => r.lo))]}, ice under feet ${arch.slice(3).every(r => r.ice)}`);
    check('Water ice arch: strikes while riding (a whip, then the Ice Volley)', arch.some(r => r.tech && r.tech !== 'Ice Volley') && arch.some(r => r.tech === 'Ice Volley') && Math.max(...all.map(r => r.spears)) >= 3, `strikes ${[...new Set(arch.map(r => r.tech).filter(Boolean))].join(', ')}, ice spikes in flight ${Math.max(...all.map(r => r.spears))}`);
  },
  async waterLift() {
    await setup('water', 'earth', 6); await step(30);
    const probe = "({ h: +(P.pos.y - P.groundY).toFixed(2), cur: P.hero.curName, wrap: !!P._wrap, jet: P.jetting, d: P.dodgeT > 0 && P.dodgeKind === 'arch', tech: P.tech && P.tech.name })";
    await page.keyboard.down('Space'); const a = await step(90, probe);
    await page.keyboard.down('KeyA'); await page.keyboard.down('ShiftLeft'); const b = await step(2, probe); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('Space');
    const c = await step(12, probe); await tap('KeyF'); const dd = await step(60, probe); await page.keyboard.up('KeyA');
    const peak = Math.max(...a.map(r => r.h)), lifted = a.filter(r => r.jet);
    check('Water lift: water round the body and under the feet raises the bender high, Falling Into Pool pose', peak > 4.5 && lifted.length > 20 && lifted.slice(10).every(r => r.wrap) && lifted.slice(15).every(r => r.cur === 'water_pool'), `peak ${peak} m, lifted ${lifted.length} frames, wrap ${lifted.slice(10).every(r => r.wrap)}, pose ${[...new Set(lifted.map(r => r.cur))].join(',')}`);
    const arch = [...b, ...c, ...dd].filter(r => r.d);
    check('Water lift: DODGE up there slides down on an ice arch, striking on the way', arch.length > 30 && arch[0].h > 3 && arch.some(r => r.tech) && [...c, ...dd].at(-1).h < 0.3, `arch from ${arch.length ? arch[0].h : '-'} m over ${arch.length} frames, strike ${[...new Set(arch.map(r => r.tech).filter(Boolean))]}, end height ${[...c, ...dd].at(-1).h}`);
  },
  async waterMoves() {
    await setup('water', 'earth', 2.2); await step(30);
    const seen = new Set();
    for (let i = 0; i < 8; i++) { await tap('KeyF'); for (const r of await step(40, 'P.hero.curName')) seen.add(r); }
    for (let i = 0; i < 6; i++) { await tap('KeyG'); for (const r of await step(30, 'P.hero.curName')) seen.add(r); }
    const want = ['water_ripple', 'water_twirl', 'water_spin'], got = want.filter(n => [...seen].some(c => c.split('|')[0].replace(/_M$/, '') === n));
    check('Water: the dance moves are in the HAND and LEG chains', got.length === 3, `played ${got.join(', ')}`);
  },
  async fireGlide() {
    await setup('fire', 'earth', 5); await step(30);
    const probe = "({ d: P.dodgeT > 0 ? 1 : 0, kind: P.dodgeKind, h: +(P.pos.y - P.groundY).toFixed(3), py: +P.pos.y.toFixed(3), gy: +P.groundY.toFixed(3), vy: +P.vel.y.toFixed(2), fl: +(P.footPos('L', new P.pos.constructor()).y - P.groundY).toFixed(3), fr: +(P.footPos('R', new P.pos.constructor()).y - P.groundY).toFixed(3), x: +P.pos.x.toFixed(2), tech: P.tech && P.tech.name, lo: P.hero.lowName, cur: P.hero.curName, orbs: E.world.bending.objs.filter(o => o.owner === P && /fire/.test(o.kind) && o.state !== 'dead').length, ll: (() => { const h = P.hero.bones['DEF-hips'].getWorldPosition(new P.pos.constructor()); const a = P.footPos('L', new P.pos.constructor()), b = P.footPos('R', new P.pos.constructor()); const c = Math.cos(P.yaw), s = Math.sin(P.yaw), L = (p) => [(p.x - h.x) * c - (p.z - h.z) * s, (p.x - h.x) * s + (p.z - h.z) * c]; return [...L(a), ...L(b)].map(v => +v.toFixed(2)); })() })";
    // (18 Nov, after review: the glide lasts while DODGE is held and rides higher, about 1.2 m; held for 2 s here, with
    //  punches and a blast thrown during it, then let go; the old check was a 1 s tap glide at half a metre)
    await page.keyboard.down('KeyD'); await page.keyboard.down('ShiftLeft'); const a = await step(2, probe);
    const b = await step(30, probe);
    await tap('KeyF'); const c = await step(20, probe); await tap('KeyF'); const c2 = await step(20, probe);
    await tap('KeyG'); const d0 = await step(46, probe); await page.keyboard.up('ShiftLeft'); const d = [...d0, ...await step(40, probe)]; await page.keyboard.up('KeyD');
    const mobs = await ev('P.mob ? P.mob.kind : null');
    const all = [...a, ...b, ...c, ...c2, ...d], glide = all.filter(r => r.d && r.kind === 'rocket');
    const mid = glide.slice(8, -9);
    const minFoot = Math.min(...mid.map(r => Math.min(r.fl, r.fr))), maxH = Math.max(...glide.map(r => r.h));
    // stepping legs would swing each foot back and forth relative to the hips; on the board they stay put
    const sw = [0, 1, 2, 3].map(i => Math.max(...mid.map(r => r.ll[i])) - Math.min(...mid.map(r => r.ll[i])));
    const punchedInGlide = glide.some(r => r.tech === 'Fire Fist'), blastInGlide = glide.some(r => r.tech === 'Jet Blast');
    const legs = [...new Set(glide.map(r => r.lo))], uppers = [...new Set(glide.map(r => r.cur))];
    if (process.env.DEBUG) console.log(all.map(r => r.py + '/' + r.gy + '/' + r.vy + (r.d ? '' : '*') + (r.tech ? '!' : '')).join(' '));
    const dur = glide.length / 60; let travel = 0; for (let i = 1; i < glide.length; i++) travel += Math.hypot(glide[i].x - glide[i - 1].x, (glide[i].z ?? 0) - (glide[i - 1].z ?? 0));   // path length (with lock-on a sideways glide arcs round the rival)
    check('Fire glide: lasts while DODGE is held (2 s here), about 1.2 m up, feet off the floor, no flame run', dur > 1.9 && dur < 2.6 && maxH > 1.0 && maxH < 1.5 && minFoot > 0.5 && travel > 12 && !mobs, `glide ${dur.toFixed(2)} s, mob after ${mobs}, height up to ${maxH.toFixed(2)} m, lowest foot mid-glide ${minFoot.toFixed(2)} m, travel ${travel.toFixed(1)} m`);
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
