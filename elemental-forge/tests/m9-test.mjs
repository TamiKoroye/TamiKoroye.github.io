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
  async review19() {
    // 19 Nov: Earth's pillars no longer stack (each rises from the real floor and drops any pillar on its spot), the
    // uppercut's rising rock sinks back, and a pillar in front of Earth can be punched out as a boulder
    await setup('earth', 'fire', 3); await step(20);
    const towers = await page.evaluate(() => { const E = window.__EF, B = E.world.bending, P = E.player, O = E.opp; for (let i = 0; i < 3; i++) { B.raisePillar(P, O.pos.x, O.pos.z); for (let k = 0; k < 30; k++) E.step(1 / 60); } return B.pillars.filter(p => !p.col.dead).map(p => +p.gy.toFixed(2)); });
    check('Earth pillars raised on the same spot do not stack', towers.every(g => g < 0.3) && towers.length <= 1, `standing pillars' bases ${JSON.stringify(towers)}`);
    await setup('earth', 'fire', 2.2); await step(20);
    await page.evaluate(() => { const E = window.__EF, B = E.world.bending, P = E.player; const fw = P.forward(new P.pos.constructor()); B.raisePillar(P, P.pos.x + fw.x * 1.4, P.pos.z + fw.z * 1.4); });
    await step(30); const before = await ev("E.world.bending.pillars.filter(p => !p.col.dead).length");
    let thrown = 0; for (let i = 0; i < 3 && !thrown; i++) { await tap('KeyF'); const r = await step(40, "E.world.bending.objs.filter(o => o.owner === P && o.kind === 'boulder' && o.state !== 'dead').length"); thrown = Math.max(...r); }
    const after = await ev("E.world.bending.pillars.filter(p => !p.col.dead).length");
    check('Earth punches a pillar in front of him out as a boulder', before === 1 && after === 0 && thrown > 0, `pillars ${before} -> ${after}, boulders thrown ${thrown}`);
    // Water's kicks bring ice up out of the floor (no whips, no breaking-wave blocks)
    await setup('water', 'earth', 5); await step(60);
    let spikes = 0, whips = 0, waves = 0;
    for (let i = 0; i < 5; i++) { await tap('KeyG'); for (const r of await step(40, "E.world.bending.spikes.filter(s => s.owner === P && s.ice).length + ':' + (E.world.bending.weapons.whips || []).filter(W => W.f === P).length + ':' + E.world.bending.weapons.waves.filter(V => V.f === P).length")) { const [a, b2, c] = r.split(':').map(Number); spikes = Math.max(spikes, a); whips = Math.max(whips, b2); waves = Math.max(waves, c); } }
    check("Water's kicks send ice spikes up out of the floor; no whips or waves from the kicks", spikes > 3 && whips === 0 && waves === 0, `ice spikes ${spikes}, whips ${whips}, waves ${waves}`);
  },
  async review18c() {
    // 18 Nov, third review
    await setup('water', 'fire', 6); const ws = (await step(50, 'P.hero.curName')).slice(20);
    check("Water's fighting stance is the crouched ready stance (water_ready)", ws.every(c => c === 'water_ready'), `clips ${[...new Set(ws)].join(', ')}`);
    await setup('fire', 'earth', 6); await step(10);
    const fl = await step(60, "E.world.fx.flip.sheets ? Object.values(E.world.fx.flip.sheets).reduce((s, sh) => s + (sh.n || 0), 0) : -1");
    check('Fire at rest: no flames on the hands', Math.max(...fl) === 0, `flame sprites alive at rest: up to ${Math.max(...fl)}`);
    await setup('water', 'earth', 4); await step(20); await page.keyboard.down('Space'); await step(40); await page.keyboard.up('Space'); await tap('KeyG');
    // (19 Nov: from the new reference videos, the water comes up out of the ground: ice and water erupt under the rival)
    const ice = Math.max(...await step(60, "E.world.bending.spikes.filter(s => s.owner === P && s.ice).length"));
    check('Water somersault brings ice up out of the floor under the rival', ice >= 5, `ice spikes ${ice}`);
    await setup('air', 'earth', 2.5); await step(20);
    await page.evaluate(() => { const E = window.__EF, P = E.player, O = E.opp; P.invuln = 0; E.world.combat.damage(P, 8, new P.pos.constructor(0, 0, -1), O, 'melee', P.chestPos(new P.pos.constructor()), 5, 2); });
    const gu = await step(240, "P.action"), downT = gu.filter(a => a === 'down').length / 60, upT = gu.filter(a => a === 'getup').length / 60;
    check('Air gets up quickly (corkscrew kip-up, about 1.1 s)', upT > 0.5 && upT < 1.3, `down ${downT.toFixed(2)} s, getting up ${upT.toFixed(2)} s`);
    await setup('air', 'earth', 6); await step(20);
    // (20 Nov, Airbending brief: "Air Propulsion ... no excessive spinning") the Corkscrew Evade and Cartwheel dodges are
    // removed; every DODGE is now the short lateral wind burst, and this check now asks that it moves inside its whirl of
    // wind (was: the corkscrew / cartwheel inside the whirl)
    await page.keyboard.down('ShiftLeft'); await step(2); await page.keyboard.up('ShiftLeft');
    const cw = await step(30, "(P.dodgeKind === 'propel' && P.dodgeT > 0 ? 'propel' : '-') + ':' + E.world.bending.weapons.whirls.filter(W => W.f === P).length");
    check('Air Propulsion moves inside a whirl of wind', cw.some(x => x === 'propel:1'), `${[...new Set(cw)].join(' ')}`);
  },
  async fireWallStays() {
    // 18 Nov: Fire's wall stays where it was raised while the bender moves (it is only punched forward)
    await setup('fire', 'earth', 6); await step(20);
    await page.keyboard.down('KeyQ'); await step(20);
    const a = await ev('({ x: P.defense.pos.x, z: P.defense.pos.z, px: P.pos.x, pz: P.pos.z })');
    await page.keyboard.down('KeyA'); await step(60); await page.keyboard.up('KeyA');
    const b = await ev('({ x: P.defense ? P.defense.pos.x : NaN, z: P.defense ? P.defense.pos.z : NaN, px: P.pos.x, pz: P.pos.z })');
    await page.keyboard.up('KeyQ'); await step(150);
    const wallMoved = Math.hypot(b.x - a.x, b.z - a.z), walked = Math.hypot(b.px - a.px, b.pz - a.pz);
    check('Fire wall stays where it was raised while the bender walks', walked > 1 && wallMoved < 0.05, `bender walked ${walked.toFixed(2)} m, wall moved ${wallMoved.toFixed(2)} m`);
  },
  async headOnRival() {
    // where the head points against the direction to the rival (horizontal angle, degrees), in the stance and through a
    // HAND / LEG combo, for every element; measured with the head turn on and, for comparison, off (window.__noLook)
    const probe = "(() => { const h = P.hero, b = h.bones['DEF-head']; if (!h._headFwd) return -1; const q = b.getWorldQuaternion(new E.camera.quaternion.constructor()), f = h._headFwd.clone().applyQuaternion(q), p = b.getWorldPosition(new P.pos.constructor()); const a = Math.atan2(f.x, f.z), w = Math.atan2(O.pos.x - p.x, O.pos.z - p.z); return Math.abs(Math.atan2(Math.sin(a - w), Math.cos(a - w))) * 57.3; })()";
    const rows = [];
    for (const off of [true, false]) for (const el of ['earth', 'fire', 'water', 'air']) {
      await page.evaluate((off) => { window.__noLook = off; }, off);
      await setup(el, 'fire', 3); const st = (await step(60, probe)).slice(20);
      const cb = []; for (let i = 0; i < 4; i++) { await tap(i % 2 ? 'KeyG' : 'KeyF'); cb.push(...await step(30, probe)); }
      const m = (a) => (a.reduce((s, v) => s + v, 0) / a.length).toFixed(0), mx = (a) => Math.max(...a).toFixed(0);
      rows.push({ off, el, st: +m(st), stMax: +mx(st), cb: +m(cb) });
    }
    await page.evaluate(() => { window.__noLook = false; });
    const on = rows.filter(r => !r.off), off = rows.filter(r => r.off);
    check('Head on the rival: in the stance within 12 degrees for every element, and closer in combat than without the turn', on.every(r => r.stMax <= 12) && on.reduce((s, r) => s + r.cb, 0) < off.reduce((s, r) => s + r.cb, 0), rows.map(r => `${r.off ? 'off' : 'on'} ${r.el}: stance ${r.st} (max ${r.stMax}), combo ${r.cb}`).join(' | '));
  },
  async review18b() {
    // 18 Nov, second review (phone recording r21)
    // 1. Water lifted on its column stands in the water stance (no Falling Into Pool flailing)
    await setup('water', 'earth', 6); await step(20); await page.keyboard.down('Space'); const lift = await step(70, 'P.hero.curName'); await page.keyboard.up('Space'); await step(90);
    check('Water lift: stands on the column in the water stance (no flailing pose)', !lift.some(c => /water_pool/.test(c)) && lift.slice(30).filter(c => /water_ready/.test(c)).length > 25, `clips ${[...new Set(lift)].join(', ')}`);
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
    // (19 Nov, r27: after the user's recording of r26, "I am close to opponent, yet I don't grab them", the grab is
    // decided on the throw: the first HAND at a close rival grabs. The lash is checked separately at 5 m, where it
    // must hit without grabbing.)
    let lashHit = false;
    { await setup('water', 'earth', 5); await step(70); const hp0 = await ev('O.hp'); await tap('KeyF'); await step(40); lashHit = (await ev('O.hp')) < hp0 && !(await ev('(E.world.bending.weapons.grabs || []).length')); }
    await setup('water', 'earth', 3.2); await step(70);
    await tap('KeyF'); for (const r of await step(110, "({ g: (E.world.bending.weapons.grabs || []).length, oy: O.pos.y - O.groundY, oa: O.action, dz: (O.pos.x - P.pos.x) * Math.sin(P.yaw) + (O.pos.z - P.pos.z) * Math.cos(P.yaw) })")) { if (r.g) grabbed = true; if (r.g) peak = Math.max(peak, r.oy); if (r.oa === 'down') landedDown = true; }
    check('Water whip grabs a close rival on the ground, lifts them over the head and slams them down (and lashes at 5 m)', lashHit && grabbed && peak > 2.4 && landedDown, `lash hit ${lashHit}, grabbed ${grabbed}, lifted to ${peak.toFixed(2)} m, knocked down ${landedDown}`);
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
    // (19 Nov, later: the breath was rebuilt with an inhale and a 1.75 s roar after the user's review; the roar now starts
    //  about 1.2 s after the press, so the check watches 4 s instead of 2; the requirements are unchanged)
    const br = await step(240, "({ n: (E.world.bending.breaths || []).length, hp: O.hp, eng: O.engulfT || 0 })");
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
      E.world.combat.damage(P, 8, new P.pos.constructor(0, 0, -1), O, 'melee', P.chestPos(new P.pos.constructor()), 5, lvl);   // (the blow travels from the rival, in front at +z, towards the player)
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
    // (18 Nov, second review: blows from the front knock the fighter backwards; Fall Flat only from behind, so the
    //  scripted frontal blows here all show the backward knockdown)
    // (20 Nov, changed with the Earth brief's falling section: a sweep that takes the legs now plays Mixamo Sweep Fall,
    //  feet up and down flat on the back, instead of Hit To The Legs; either still shows the legs being taken)
    const ok = /hit_legs|sweep_fall/.test(out.sweep) && /knockback/.test(out['punch knockdown']) && /knockback/.test(out['plain knockdown'] + out['plain knockdown 2']) && !/fall_flat|hit_head_down/.test(out['punch knockdown'] + out['plain knockdown']) && /hit_head/.test(out['light punch']) && /trip/.test(out['hit while dodging']) && /getup/.test(out['hit while dodging']) && !/kip/.test(Object.values(out).join(' '));   // (18 Nov, after review: the flip get-ups are Air's only; Water and Earth get up plainly)
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
      const p0 = await step(1, "({ x: P.pos.x, z: P.pos.z })");
      await page.keyboard.down('ShiftLeft'); await step(2); await page.keyboard.up('ShiftLeft');
      const r = await step(50, "({ k: P.dodgeT > 0 ? P.dodgeKind : null, c: P.hero.curName, g: P.onGround, x: P.pos.x, z: P.pos.z })");
      kinds.push(r.find(x => x.k) ? r.find(x => x.k).k : 'none'); for (const x of r) if (x.k) clips.add(x.c);
      // (the distance is measured from where the bender stood before the press: the burst is fastest in its first frames)
      const on = r.filter(x => x.k); if (on.length) slide = Math.max(slide, Math.hypot(on[on.length - 1].x - p0[0].x, on[on.length - 1].z - p0[0].z)); if (on.some(x => !x.g)) kinds.push('airborne');
    }
    // (20 Nov, Airbending brief: "Air Propulsion: tap dodge bursts sideways; no running, no flight, no excessive
    // spinning") the alternation of the two-second glide with the Corkscrew Evade / Cartwheel flips is removed; this check
    // now asks that all four dodges are the burst, with the feet on the floor, no flip clip, and 3.5 to 6 m of travel
    // (was: glide, flip, glide, flip with both flip clips seen)
    check('Air: every dodge is the lateral wind burst, feet on the floor, no flips', kinds.length === 4 && kinds.every(k => k === 'propel') && ![...clips].some(c => /air_cork|cartwheel/.test(c)) && slide > 3.5 && slide < 6, `dodges ${kinds.join(', ')}; clips ${[...clips].join(', ')}; longest ${slide.toFixed(1)} m`);
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
    check('Water lift: water round the body and under the feet raises the bender high, standing in the water stance', peak > 4.5 && lifted.length > 20 && lifted.slice(10).every(r => r.wrap) && lifted.slice(15).every(r => r.cur === 'water_ready')   /* (18 Nov, second review: Falling Into Pool flailed; the water stance on the column; third review: that stance is now water_ready) */, `peak ${peak} m, lifted ${lifted.length} frames, wrap ${lifted.slice(10).every(r => r.wrap)}, pose ${[...new Set(lifted.map(r => r.cur))].join(',')}`);
    const arch = [...b, ...c, ...dd].filter(r => r.d);
    check('Water lift: DODGE up there slides down on an ice arch, striking on the way', arch.length > 30 && arch[0].h > 3 && arch.some(r => r.tech) && [...c, ...dd].at(-1).h < 0.3, `arch from ${arch.length ? arch[0].h : '-'} m over ${arch.length} frames, strike ${[...new Set(arch.map(r => r.tech).filter(Boolean))]}, end height ${[...c, ...dd].at(-1).h}`);
  },
  async waterMoves() {
    await setup('water', 'earth', 2.2); await step(30);
    const seen = new Set();
    for (let i = 0; i < 8; i++) { await tap('KeyF'); for (const r of await step(40, 'P.hero.curName')) seen.add(r); }
    // (presses spaced to the kicks' length: a press made during the 1.25 s twirl expires from the 0.45 s buffer, as in play)
    for (let i = 0; i < 9; i++) { await tap('KeyG'); for (const r of await step(50, 'P.hero.curName')) seen.add(r); }
    // (18 Nov, second review: the arm wave, water_ripple, is out of the HAND chain: it contorted the body mid-combo)
    const want = ['water_twirl', 'water_spin'], got = want.filter(n => [...seen].some(c => c.split('|')[0].replace(/_M$/, '') === n));
    if (process.env.DEBUG) console.log([...seen].join(' '));
    check('Water: the twirl and spin kicks are in the LEG chain (the arm wave is out)', got.length === 2 && ![...seen].some(c => /water_ripple/.test(c)), `played ${got.join(', ')}`);
  },
  async fireGlide() {
    await setup('fire', 'earth', 5); await step(30);
    const probe = "({ d: P.dodgeT > 0 ? 1 : 0, kind: P.dodgeKind, h: +(P.pos.y - P.groundY).toFixed(3), py: +P.pos.y.toFixed(3), gy: +P.groundY.toFixed(3), vy: +P.vel.y.toFixed(2), fl: +(P.footPos('L', new P.pos.constructor()).y - P.groundY).toFixed(3), fr: +(P.footPos('R', new P.pos.constructor()).y - P.groundY).toFixed(3), x: +P.pos.x.toFixed(2), tech: P.tech && P.tech.name, lo: P.hero.lowName, cur: P.hero.curName, orbs: E.world.bending.objs.filter(o => o.owner === P && /fire/.test(o.kind) && o.state !== 'dead').length, ll: (() => { const h = P.hero.bones['DEF-hips'].getWorldPosition(new P.pos.constructor()); const a = P.footPos('L', new P.pos.constructor()), b = P.footPos('R', new P.pos.constructor()); const q = P.hero.bones['DEF-hips'].getWorldQuaternion(new P.root.quaternion.constructor()).invert(), L = (p) => { const v = p.clone().sub(h).applyQuaternion(q); return [v.x, v.z]; }; return [...L(a), ...L(b)].map(v => +v.toFixed(2)); })() })";
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
    // (20 Nov, changed with the user's review: the glide stance is now one held frame of Mixamo Running Arc, chosen by
    // the user, instead of the skateboard crouch, so the expected leg clip is run_arc_l. The body is also pitched and
    // turned into the flight on purpose, so the feet are measured in the hips' own frame (rotation included) rather
    // than an upright frame that turns only with yaw: the check still fails if the legs step or cycle under the hips.)
    check('Fire glide: legs locked in the held Running Arc stance (no steps)', legs.every(n => n === 'run_arc_l|L') && Math.max(...sw) < 0.12, `leg clips ${legs.join(',')}, foot swing relative to hips (hips' frame) ${sw.map(v => v.toFixed(2)).join('/')} m`);
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
