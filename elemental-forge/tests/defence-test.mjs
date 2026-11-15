// Defensive bending checks (Stage 3). Drives the real game deterministically (exact 1/30 s steps) and reads
// health, defences and colliders. Usage: node tests/defence-test.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/', OUT = path.resolve(process.argv[3] || './defence-shots'); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 890, height: 412 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE); await page.waitForFunction(() => window.__EF);
await page.locator('#btn-start').click();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -- ' + detail : '')); };
const S = (fn, arg) => page.evaluate(fn, arg);
await S(() => { const E = window.__EF; E.state.manual = true; E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.jump = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); }; for (let i = 0; i < 40; i++) E.step(1 / 30); });
// helpers installed in the page
await S(() => {
  const E = window.__EF; const V = E.player.pos.constructor;
  window.T = {
    setup(el, oel, pz = -12, oz = -6) {
      const { player: p, opp: o, world } = E; world.bending.clear(); E.state.locked = true;
      for (const f of [p, o]) { f.vel.set(0, 0, 0); f.ext && f.ext.set(0, 0, 0); f.action = null; f.tech = null; f.stunT = 0; f.dodgeT = 0; f.hp = 100; f.en = 100; f.guarding = false; f.holding = false; f.charging = false; f.handHoldT = -1; f.legHoldT = -1; f.counterT = 0; f.invuln = 0; f.dead = false; f.guardCd = 0; f.perfectT = 0; f.stats = { hitsLanded: 0, blocks: 0, perfect: 0, techniques: {} }; }
      p.setElement(el, true); o.setElement(oel || 'fire', true);
      p.pos.set(0, 0, pz); o.pos.set(0, 0, oz); p.faceYaw = p.yaw = 0; o.faceYaw = o.yaw = Math.PI;
      for (const k of Object.keys(E.controls.btn)) E.controls.btn[k] = false;
    },
    step(n) { for (let i = 0; i < n; i++) E.step(1 / 30); },
    guard(on) { E.controls.btn.guard = on; },
    fire(kind, from, at) { const o = E.opp; return E.world.bending.fire(kind, o, new V(...from), { target: at || E.player.chestPos() }); },
    melee(dir, dmg = 8, el = 'fire') { const p = E.player, o = E.opp; o.setElement(el, true); E.world.combat.damage(p, dmg, new V(...dir).normalize(), o, 'melee', p.chestPos(new V()), 3, 0); },
  };
});
const ELS = ['earth', 'fire', 'water', 'air'];

// 1. melee from the front is blocked (air deflects most of it), from behind it lands, for every element
for (const el of ELS) {
  const r = await S((el) => { T.setup(el); T.guard(true); T.step(10); const p = window.__EF.player;
    T.melee([0, 0, -1], 8); const front = p.hp; p.hp = 100;
    T.melee([0, 0, 1], 8); const back = p.hp; T.guard(false); T.step(4); return { front, back, def: !!p.defense }; }, el);
  check(`${el}: guard stops a blow from the front but not from behind`, (el === 'air' ? r.front >= 96 : r.front === 100) && r.back < 100, `front hp ${r.front}, from behind hp ${r.back}`);
}
// 2. water wall vs each element's projectile
const proj = { fire: 'fireball', water: 'water', air: 'vortex', earth: 'rock' };
for (const el of ELS) {
  const r = await S((k) => { T.setup('water', 'fire'); T.guard(true); T.step(10); T.fire(k, [0, 1.3, -6.5]); T.step(30); const p = window.__EF.player; T.guard(false); T.step(4); return { hp: p.hp, blocks: p.stats.blocks }; }, proj[el]);
  check(`water wall stops a ${proj[el]} (${el}) from the front`, r.hp === 100 && r.blocks > 0, `player hp ${r.hp}, blocks ${r.blocks}`);
}
// 3. a boulder breaks through a water wall with reduced force
{
  const r = await S(() => { T.setup('water', 'earth'); T.guard(true); T.step(10); const o = T.fire('boulder', [0, 1.3, -6.5]); const raw = Math.round(o.dmg * o.dmgMul); T.step(30); const p = window.__EF.player; T.guard(false); T.step(4); return { hp: p.hp, raw }; });
  check('a boulder breaks through the water wall at reduced force', r.hp < 100 && 100 - r.hp < r.raw, `player hp ${r.hp}, unblocked damage would be ${r.raw}`);
}
// 4. sustained attacks: fire stream and wind push are stopped by the water wall; burning ground is put out
{
  const r = await S(() => { const E = window.__EF; T.setup('water', 'fire', -12, -8); T.guard(true); T.step(10);
    const o = E.opp; o.input.handHeld = true; o.handHoldT = 0.5; o.holding = true; o.holdPh = 0; E.world.bending.holdStart(o);
    for (let i = 0; i < 45; i++) { o.holding = true; E.step(1 / 30); }
    const hpStream = E.player.hp; E.world.bending.holdEnd(o); o.holding = false;
    E.player.hp = 100; E.world.bending.burn(E.player.pos.x, E.player.pos.z, 0, o); E.step(20); const hpBurn = E.player.hp; const burns = E.world.bending.burns.length;
    T.guard(false); T.step(4); return { hpStream, hpBurn, burns }; });
  check('water wall stops a sustained fire stream', r.hpStream === 100, `player hp ${r.hpStream}`);
  check('water guard puts out burning ground underfoot', r.hpBurn === 100 && r.burns === 0, `player hp ${r.hpBurn}, burning patches left ${r.burns}`);
}
// 5. durability: repeated rocks break the water wall (guard broken, short stun), it is not permanent invulnerability
{
  const r = await S(() => { const E = window.__EF; T.setup('water', 'earth'); T.guard(true); T.step(10); let broke = false;
    for (let i = 0; i < 12 && !broke; i++) { T.fire('rock', [0, 1.3, -6.5]); T.step(14); if (!E.player.defense) broke = true; E.player.vel.set(0, 0, 0); }
    const st = { broke, guarding: E.player.guarding, cd: E.player.guardCd }; T.guard(false); T.step(10); return st; });
  check('repeated rocks wear the water wall down until the guard breaks', r.broke && !r.guarding, JSON.stringify(r));
}
// 6. ice: SPECIAL with the water wall up freezes it into an ice wall with colliders that stays after release and blocks
{
  const r = await S(() => { const E = window.__EF; T.setup('water', 'fire'); T.guard(true); T.step(10); E.controls.pressed.special = true; T.step(3);
    const d = E.world.bending.defs.find(d => d.ice); const cols = E.world.arena.colliders.filter(c => c.ice).length;
    T.guard(false); T.step(10); const still = E.world.bending.defs.some(d => d.ice && !d.dead);
    E.player.pos.set(3, 0, -12); T.step(2);
    T.fire('fireball', [0, 1.3, -6.5], new E.player.pos.constructor(0, 1.3, -14)); T.step(30);
    const iceHp = (E.world.bending.defs.find(d => d.ice) || {}).hp;
    return { ice: !!d, cols, still, iceHp }; });
  check('GUARD + SPECIAL freezes the water wall into an ice wall with solid colliders', r.ice && r.cols >= 4, JSON.stringify(r));
  check('the ice wall stays after the guard is released and absorbs a fireball', r.still && r.iceHp < 150, JSON.stringify(r));
  await S(() => T.step(1)); await page.screenshot({ path: `${OUT}/ice-wall.png` });
}
// 7. rotating streams: guard while holding water gives all-round cover (an attack from behind is stopped)
{
  const r = await S(() => { const E = window.__EF; T.setup('water', 'fire', -12, -6); const B = E.world.bending, p = E.player;
    for (let i = 0; i < 2; i++) { const o = B.spawn('water', p, p.pos.clone().setY(1.2), 'orbit'); }
    T.guard(true); T.step(8); const ring = !!(p.defense && p.defense.ring);
    T.fire('fireball', [0, 1.3, -17], p.chestPos()); T.step(30); const hp = p.hp; T.guard(false); T.step(4); return { ring, hp }; });
  check('guarding with held water forms rotating streams that stop an attack from behind', r.ring && r.hp === 100, JSON.stringify(r));
}
// 8. perfect guard redirects a projectile back at the thrower and opens a counter
{
  const r = await S(() => { const E = window.__EF; T.setup('water', 'fire'); const o = T.fire('fireball', [0, 1.3, -7]); let ok = false;
    for (let i = 0; i < 40; i++) { if (!ok && o.pos.distanceTo(E.player.chestPos()) < 3.2) { T.guard(true); ok = true; } E.step(1 / 30); }
    const res = { perfect: E.player.stats.perfect, oppHp: E.opp.hp, hp: E.player.hp }; T.guard(false); T.step(4); return res; });
  check('perfectly timed water guard redirects a fireball into the thrower', r.perfect > 0 && r.oppHp < 100 && r.hp === 100, JSON.stringify(r));
}
check('no runtime errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync(path.join(OUT, 'defence-results.json'), JSON.stringify(results, null, 1));
console.log(`${results.filter(r => r.ok).length}/${results.length} defence checks passed`);
await browser.close();
