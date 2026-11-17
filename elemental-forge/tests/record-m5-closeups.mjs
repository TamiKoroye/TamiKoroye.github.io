// M5 close-up captures and animation trace. Each scenario is played with the keyboard controls (F hand, G leg,
// Space jump, Shift dodge, Q guard, E special, W/A/S/D stick; the same commands as the touch buttons), stepped at
// 1/30 s, and filmed by a camera placed close to the part of the body the scenario is about (hands, the falling
// rival, the kicking fighter from the side). Every frame's caption names the clips the mixer is blending, with their
// weights, the procedural layer weights and the hand-shape layer weight, so any fallback or override is visible.
// A few blows are scripted (labelled "scripted" in the caption) where the point is the reaction, not the attack.
// Output: <outDir>/<scenario>.mp4, all.mp4 and trace.json (per frame: clips + weights, both fighters).
// Usage: node tests/record-m5-closeups.mjs <baseUrl> <outDir> [scenario,scenario...]
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = process.argv[3] || './test-shots/m5';
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(BASE) ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'rec=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__EF && window.__EF.LOAD && (window.__EF.LOAD.ok || window.__EF.LOAD.errors.length), null, { timeout: 60000 });
await page.locator('#btn-start').click(); await page.waitForFunction(() => window.__EF.state.phase === 'fight', null, { timeout: 120000 });
await page.evaluate(() => {
  const E = window.__EF; E.state.manual = true;
  E.ai.update = function () { const i = this.f.input; i.mx = i.mz = 0; i.hand = i.handHeld = i.leg = i.legHeld = i.special = i.guard = i.dodge = i.dodgeHeld = i.jump = i.jumpHeld = false; i.faceYaw = Math.atan2(this.foe.pos.x - this.f.pos.x, this.foe.pos.z - this.f.pos.z); i.strafe = true; };
  E.state.locked = true; E.player.target = E.opp;
});

const trace = {};
let scen = '', frameN = 0, dir = '';
const keys = new Set();
const key = async (code, down) => { if (down) { keys.add(code); await page.keyboard.down(code); } else { keys.delete(code); await page.keyboard.up(code); } };
const tap = async (code) => { await key(code, true); await run(1); await key(code, false); };
// setup: element of each fighter, positions (x, z), facing each other, health
const setup = (pel, oel, pp, op, extra = '') => page.evaluate(([pel, oel, pp, op, extra]) => {
  const E = window.__EF, P = E.player, O = E.opp;
  P.setElement(pel, true); O.setElement(oel, true);
  P.reset(pp[0], pp[1], Math.atan2(op[0] - pp[0], op[1] - pp[1])); O.reset(op[0], op[1], Math.atan2(pp[0] - op[0], pp[1] - op[1]));
  E.world.bending.clear && E.world.bending.clear(); E.state.phase = 'fight'; E.world.fighting = true;
  E.camCtl.yaw = P.yaw; window.__noFloor = false;
  if (extra) (new Function('E', 'P', 'O', extra))(E, P, O);
}, [pel, oel, pp, op, extra]);
// cam: [who, bone or 'body', distance, side angle (rad, from the fighter's facing), height offset]
let cam = ['P', 'body', 3.2, Math.PI / 2, 0.2];
let note = '';
const run = async (n) => {
  const shots = await page.evaluate(([n, cam, scen, note, keysNow]) => {
    const E = window.__EF, P = E.player, O = E.opp, out = [], recs = [];
    const V = E.camera.position.constructor;
    const mix = (f) => {
      const h = f.hero; if (!h) return [];
      return h.mixer._actions.filter(a => a.isRunning() && a.getEffectiveWeight() > 0.02).map(a => [a.getClip().name, +a.getEffectiveWeight().toFixed(2), +a.time.toFixed(2)]).sort((a, b) => b[1] - a[1]);
    };
    for (let i = 0; i < n; i++) {
      if (!window.__noFloor) { P.hp = Math.max(P.hp, 30); O.hp = Math.max(O.hp, 30); }
      E.step(1 / 30);
      const F = cam[0] === 'P' ? P : O, h = F.hero;
      const at = cam[1] === 'body' ? F.pos.clone().setY(F.pos.y + 1.0) : h.bones[cam[1]].getWorldPosition(new V());
      const a = F.yaw + cam[3];
      E.camera.position.set(at.x + Math.sin(a) * cam[2], at.y + cam[4] + 0.15, at.z + Math.cos(a) * cam[2]);
      E.camera.lookAt(at.x, at.y, at.z); E.camera.updateMatrixWorld();
      const rec = (f) => ({ cur: f.hero.curName, mix: mix(f), wU: +f.hero.wU.toFixed(2), wL: +f.hero.wL.toFixed(2), hand: +(f.hero.handBlend ?? 0.85).toFixed(2), shape: f.hero.handShape && f.hero.handShape.join('/'),
        fingers: +((f.hero.fingerMotion || {})[(f.hero.curName || '').split('|')[0]] || 0).toFixed(2), act: f.action, tech: f.tech && f.tech.name, y: +(f.pos.y - f.groundY).toFixed(2), sp: +Math.hypot(f.vel.x, f.vel.z).toFixed(1), wall: f.wall ? f.wall.kind : null });
      const r = { P: rec(P), O: rec(O) }; recs.push(r);
      const R = E.renderer; R.render(E.scene, E.camera);
      const W = R.domElement.width, H = R.domElement.height;
      const cv = window.__cv || (window.__cv = document.createElement('canvas')); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(R.domElement, 0, 0);
      g.shadowColor = '#000'; g.shadowBlur = 4;
      g.font = 'bold 18px sans-serif'; g.fillStyle = '#ffe28a'; g.fillText(scen, 10, 24);
      g.font = '14px sans-serif'; g.fillStyle = '#fff';
      if (note) g.fillText(note, 10, 44);
      const line = (who, x) => `${who} ${x.act || '-'}${x.tech ? ' (' + x.tech + ')' : ''}: ` + x.mix.slice(0, 3).map(m => `${m[0]} ${Math.round(m[1] * 100)}%`).join(' + ') + `   procedural ${x.wU}/${x.wL}   hand layer ${Math.round(x.hand * 100)}% ${x.shape || ''}${x.fingers > 0.25 ? ' (clip fingers kept)' : ''}`;
      g.fillText(line('you', r.P), 10, H - 30); g.fillText(line('rival', r.O), 10, H - 12);
      g.fillText('keys: ' + (keysNow.join(' ') || '-') + '   (F hand, G leg, Space jump, Shift dodge, Q guard, E special)', 10, 64);
      out.push(cv.toDataURL('image/jpeg', 0.82));
    }
    return { out, recs };
  }, [n, cam, scen, note, [...keys]]);
  for (const s of shots.out) fs.writeFileSync(path.join(dir, `f${String(frameN++).padStart(5, '0')}.jpg`), Buffer.from(s.split(',')[1], 'base64'));
  trace[scen].push(...shots.recs);
};
const begin = (name) => { scen = name; trace[name] = []; frameN = 0; dir = path.join(OUT, 'frames-' + name.replace(/[^a-z0-9]+/gi, '_')); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); note = ''; };
const end = () => { const f = path.join(OUT, path.basename(dir).replace('frames-', '') + '.mp4'); execSync(`ffmpeg -v error -y -framerate 30 -i ${dir}/f%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 24 ${f}`); return f; };
const want = (n) => !ONLY || ONLY.includes(n);
const made = [];

if (want('run')) {
  begin('run'); await setup('fire', 'earth', [0, -12], [0, 12]);
  cam = ['P', 'body', 4.2, Math.PI / 2, 0.1]; note = 'hold W (stick forward) 1.6 s, release';
  await key('KeyW', true); await run(48); await key('KeyW', false); await run(30);
  note = 'stick back (S) 1 s, then left (A) 1 s - backpedal and side-step while facing the rival';
  await key('KeyS', true); await run(30); await key('KeyS', false); await key('KeyA', true); await run(30); await key('KeyA', false); await run(15);
  made.push(end());
}
if (want('roundhouse')) {
  for (const fxOff of [true, false]) {
    begin('fire_roundhouse' + (fxOff ? '_effects_off' : ''));
    await setup('fire', 'earth', [0, -1.0], [0, 1.0], fxOff ? 'window.__fxOff = true; const F = E.world.fx, Wp = E.world.bending.weapons; window.__fxSaved = window.__fxSaved || { fire: F.fire, arc: Wp.limbArc }; F.fire = () => ({ alpha: 1 }); Wp.limbArc = (...a) => { const A = window.__fxSaved.arc.apply(Wp, a); if (A && A.tube) A.tube.mesh.visible = false; return A; };' : 'window.__fxOff = false; if (window.__fxSaved) { E.world.fx.fire = window.__fxSaved.fire; E.world.bending.weapons.limbArc = window.__fxSaved.arc; }');
    cam = ['P', 'body', 3.6, Math.PI / 2 + 0.35, 0.1]; note = 'LEG (G) tap at 2 m: the kick from its start through recovery, then 0.6 s of stance' + (fxOff ? '  -  elemental effects off' : '');
    await run(4); await tap('KeyG'); await run(40);
    made.push(end());
  }
}
if (want('hands')) {
  begin('fire_hands_jab_cross_hook'); await setup('fire', 'earth', [0, -1.0], [0, 1.0]);
  cam = ['P', 'DEF-spine003', 1.5, Math.PI / 2 + 0.6, 0.05]; note = 'HAND (F) three taps: jab, cross, hook  -  close on the hands';
  for (let i = 0; i < 3; i++) { await tap('KeyF'); await run(12); }
  await run(15); made.push(end());
  begin('water_hands_whips_and_cast'); await setup('water', 'earth', [0, -2.5], [0, 2.5]);
  cam = ['P', 'DEF-spine003', 1.7, Math.PI / 2 + 0.6, 0.05]; note = 'HAND (F) whip, then HAND held (sustained bending), then SPECIAL (E) cast';
  await tap('KeyF'); await run(20); await key('KeyF', true); await run(40); await key('KeyF', false); await run(10);
  await page.evaluate(() => { window.__EF.player.en = 100; });
  await tap('KeyE'); await run(45); made.push(end());
  begin('earth_hands_gather'); await setup('earth', 'fire', [0, -3], [0, 3]);
  cam = ['P', 'DEF-spine003', 1.8, Math.PI / 2 + 0.6, -0.1]; note = 'HAND held: kneels and draws rock up with the hands, then HAND taps: stone punches';
  await key('KeyF', true); await run(40); await key('KeyF', false); await run(8); await tap('KeyF'); await run(14); await tap('KeyF'); await run(18); made.push(end());
}
if (want('hits')) {
  begin('rival_hit_reactions'); await setup('fire', 'earth', [0, -1.0], [0, 1.0]);
  cam = ['O', 'body', 2.6, Math.PI / 2 - 0.4, 0.1]; note = 'you: HAND (F) jab then cross - the rival flinches (light reactions)';
  await tap('KeyF'); await run(14); await tap('KeyF'); await run(22);
  note = 'you: LEG (G) roundhouse - a stagger (heavy reaction)';
  await page.evaluate(() => { const E = window.__EF; E.player.pos.set(0, 0, -1); E.opp.pos.set(0, 0, 1); });
  await tap('KeyG'); await run(36);
  note = 'scripted blow from the rival\'s left side (stagger)';
  await page.evaluate(() => { const E = window.__EF, O = E.opp, d = new E.camera.position.constructor(Math.cos(O.yaw), 0, -Math.sin(O.yaw)); E.opp.takeHit(3, d.multiplyScalar(-1), 4, 1); });
  await run(30); made.push(end());
}
if (want('falls')) {
  begin('rival_knockdown_getup'); await setup('earth', 'fire', [0, -2], [0, 2]);
  cam = ['O', 'body', 3.4, Math.PI / 2 - 0.5, 0.0]; note = 'scripted knockdown blow (level 2, straight on): the fall, lying, then the get-up';
  await run(3);
  await page.evaluate(() => { const E = window.__EF, O = E.opp, P = E.player; const d = O.pos.clone().sub(P.pos).setY(0).normalize(); O.takeHit(5, d, 6, 2); });
  await run(40); note = 'scripted blow while lying: the rival stays down (no standing reaction)';
  await page.evaluate(() => { const E = window.__EF, O = E.opp, P = E.player; const d = O.pos.clone().sub(P.pos).setY(0).normalize(); O.invuln = 0; O.takeHit(2, d, 2, 1); });
  await run(80); made.push(end());
  begin('rival_knockout'); await setup('fire', 'water', [0, -1.0], [0, 1.0]);
  cam = ['O', 'body', 3.6, Math.PI / 2 - 0.5, 0.0]; note = 'rival on 1 hp, you: LEG (G) roundhouse - the knockout fall';
  await page.evaluate(() => { window.__noFloor = true; window.__EF.opp.hp = 1; });
  await tap('KeyG'); await run(90); made.push(end());
}
if (want('wallrun')) {
  for (const el of ['fire', 'earth', 'air']) {
    begin(el + '_wall_run'); await setup(el, 'water', [28.8, -8], [20, 8], 'P.yaw = P.faceYaw = 0; E.camCtl.yaw = 0; E.state.locked = false;');
    cam = ['P', 'body', 6.5, -Math.PI / 2 - 0.25, 0.6]; note = 'run along the arena wall (W), JUMP (Space) beside it: wall run, JUMP again: kick off';
    await page.evaluate(() => { window.__EF.state.locked = false; });
    await key('KeyW', true); await run(20); await tap('Space'); await run(16); await tap('Space'); await run(10); await key('KeyW', false); await run(30);
    made.push(end());
  }
  begin('wall_flip'); await setup('fire', 'water', [0, 27.0], [0, 10], 'P.yaw = P.faceYaw = 0; E.camCtl.yaw = 0;');
  cam = ['P', 'body', 6.5, -Math.PI / 2 - 0.5, 0.6]; note = 'run straight at the wall (W), JUMP: up the wall and off in a back somersault';
  await page.evaluate(() => { window.__EF.state.locked = false; });
  note = 'running straight at the wall (6.5 m/s, at arm length), JUMP: up the wall and off in a back somersault';
  await page.evaluate(() => { const P = window.__EF.player; P.pos.set(0, 0, 28.95); P.vel.set(0, 0, 6.5); P.yaw = P.faceYaw = 0; });
  await tap('Space'); await run(50); made.push(end());
}

if (want('stomp')) {
  begin('fire_stomp_wave'); await setup('fire', 'earth', [0, -3.5], [0, 3.5]);
  cam = ['P', 'body', 9, Math.PI / 2 + 0.5, 2.2]; note = 'LEG (G) held: the stomp; the foot plant sends one rolling wave of fire out in a full circle';
  await key('KeyG', true); await run(26); await key('KeyG', false); await run(50); made.push(end());
}
if (want('firekicks')) {
  begin('fire_kick_chain'); await setup('fire', 'earth', [0, -1.6], [0, 1.6]);
  cam = ['P', 'body', 5.2, Math.PI / 2 + 0.4, 0.4]; note = 'LEG (G) nine taps: flame kick, high front kick, spinning kick, body kick, flaming sweep, hurricane kick, jumping front kick, spinning heel kick, flip kick';
  for (let i = 0; i < 9; i++) { await page.evaluate(() => { const E = window.__EF, P = E.player, O = E.opp; O.hp = 100; O.action = null; O.stunT = 0; O.pos.set(P.pos.x + Math.sin(P.yaw) * 2.2, 0, P.pos.z + Math.cos(P.yaw) * 2.2); O.vel.set(0, 0, 0); }); await tap('KeyG'); await run(i === 5 ? 34 : 22); }
  await run(15); made.push(end());
}
if (want('fireguard')) {
  begin('fire_guard_wall'); await setup('fire', 'earth', [0, -4], [0, 4]);
  cam = ['P', 'body', 7, Math.PI / 2 + 0.6, 1.2]; note = 'GUARD (Q) held: the wall of fire rises from the feet; HAND (F) twice and LEG (G) from behind it';
  await key('KeyQ', true); await run(30); await tap('KeyF'); await run(14); await tap('KeyF'); await run(14); await tap('KeyG'); await run(22); await key('KeyQ', false); await run(20); made.push(end());
}
if (want('rocket')) {
  begin('fire_rocket_dodge'); await setup('fire', 'earth', [0, -3], [0, 3]);
  cam = ['P', 'body', 5.5, Math.PI + 0.25, 0.6]; note = 'DODGE (Shift) tap twice: the rocket dodge, flame jets from both feet, legs braced';
  await run(4); await tap('ShiftLeft'); await run(24); await tap('ShiftLeft'); await run(26); made.push(end());
}
if (want('water')) {
  begin('water_punches_and_whips'); await setup('water', 'earth', [0, -3.5], [0, 3.5]);
  cam = ['P', 'body', 4.2, Math.PI / 2 + 0.5, 0.2]; note = 'HAND (F) six taps: whip, jab (water ball), overhead whip, cross (ice ball), diagonal whip, hook (water ball)  -  no droplets';
  for (let i = 0; i < 6; i++) { await tap('KeyF'); await run(16); }
  await run(10); made.push(end());
}
if (want('surf')) {
  begin('water_ice_surf'); await setup('water', 'earth', [0, -14], [0, 14]);
  cam = ['P', 'body', 4.5, Math.PI / 2, 0.0]; note = 'DODGE (Shift) held with the stick forward: riding a ridge of ice, feet 1 m off the floor';
  await key('KeyW', true); await key('ShiftLeft', true); await run(60); await key('ShiftLeft', false); await key('KeyW', false); await run(20); made.push(end());
  begin('earth_rock_surf'); await setup('earth', 'fire', [0, -14], [0, 14]);
  cam = ['P', 'body', 4.5, Math.PI / 2, 0.0]; note = 'DODGE (Shift) tap: a slab of rock lifts the bender 1 m and slides; DODGE again steps off';
  await key('KeyW', true); await tap('ShiftLeft'); await run(60); await tap('ShiftLeft'); await key('KeyW', false); await run(25); made.push(end());
}
if (want('glide')) {
  begin('air_whirlwind_glide'); await setup('air', 'earth', [0, -3], [0, 3]);
  cam = ['P', 'body', 6, Math.PI / 2 + 0.3, 0.4]; note = 'DODGE (Shift) tap: a two-second glide inside the whirlwind, back and to the side, away from the rival';
  await run(5); await tap('ShiftLeft'); await run(70); made.push(end());
}
if (want('caught')) {
  begin('caught_in_tornado'); await setup('air', 'earth', [0, -3], [0, 3]);
  cam = ['O', 'body', 6, Math.PI / 2 - 0.4, 0.8]; note = 'Air SPECIAL (E): the rival is drawn into the tornado, lifted and thrown';
  await tap('KeyE'); await run(20); await tap('KeyE'); await run(90); made.push(end());
  begin('caught_in_drowning_sphere'); await setup('water', 'fire', [0, -3], [0, 3]);
  cam = ['O', 'body', 4.5, Math.PI / 2 - 0.4, 0.4]; note = 'Water SPECIAL (E): the rival is engulfed, frozen and the ice shatters';
  await tap('KeyE'); await run(100); made.push(end());
}
fs.writeFileSync(path.join(OUT, 'trace.json'), JSON.stringify(trace));
// a compact clip sequence per scenario (each change of the main clip, with the frame it started)
const seq = {};
for (const [k, fr] of Object.entries(trace)) for (const who of ['P', 'O']) {
  const s = []; let last = null;
  fr.forEach((r, i) => { const top = r[who].mix[0] ? r[who].mix[0][0] : r[who].cur; if (top !== last) { s.push(`${(i / 30).toFixed(2)}s ${top}`); last = top; } });
  seq[k + ' ' + (who === 'P' ? 'you' : 'rival')] = s;
}
fs.writeFileSync(path.join(OUT, 'sequence.json'), JSON.stringify(seq, null, 1));
if (made.length > 1) { fs.writeFileSync(path.join(OUT, 'list.txt'), made.map(f => `file '${path.resolve(f)}'`).join('\n')); execSync(`ffmpeg -v error -y -f concat -safe 0 -i ${OUT}/list.txt -c copy ${OUT}/all.mp4`); }
console.log(JSON.stringify(seq, null, 1));
console.log('errors', errors);
await browser.close();
