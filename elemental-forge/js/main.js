// Elemental Forge: bootstrap, game loop, player input mapping, aiming, HUD and round flow.
import * as THREE from 'three';
import { Arena, HALF } from './arena.js';
import { Fighter } from './fighter.js';
import { Combat } from './combat.js';
import { Bending } from './elements.js';
import { STYLES, ELEMENTS } from './styles.js';
import { FollowCam } from './camera.js';
import { Controls } from './controls.js';
import { AI } from './ai.js';
import { FX } from './fx.js';
import { loadIce } from './ice.js';
import { Audio } from './audio.js';
import { clamp, damp } from './util.js';
import { loadHeroAssets, TOON_RAMP, heroReady } from './hero.js';
import { loadMocap, adoptTiming, MOCAP, PACK_STATUS, requiredClips } from './mocap.js';
import { BUILD } from './build.js';

const $ = (id) => document.getElementById(id);
window.addEventListener('error', (e) => { const el = $('err'); el.textContent = 'Error: ' + e.message + '\n' + (e.filename || '') + ':' + (e.lineno || ''); el.classList.remove('hidden'); });

// ------------------------------------------------------------------ renderer / scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
// cel-shaded look (as in the references): no filmic tone curve, which desaturates and darkens flat colours
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8c2cf);
scene.fog = new THREE.Fog(0xb8c2cf, 55, 130);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);

const hemi = new THREE.HemisphereLight(0xf2f4ff, 0x9a8470, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e2, 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = sun.shadow.camera; SC.left = -22; SC.right = 22; SC.top = 22; SC.bottom = -22; SC.near = 1; SC.far = 70;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xc8d4ff, 0.45); fill.position.set(-10, 8, -14); scene.add(fill);

// Cel shading for every lit material in a subtree: same colours and textures, three-step light ramp.
function toonify(root) {
  const cache = new Map();
  root.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const conv = (m) => {
      if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial)) return m;
      if (!cache.has(m)) cache.set(m, new THREE.MeshToonMaterial({ color: m.color, map: m.map, gradientMap: TOON_RAMP, transparent: m.transparent, opacity: m.opacity, side: m.side, vertexColors: m.vertexColors, emissive: m.emissive, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor }));
      return cache.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}
// ------------------------------------------------------------------ world
const world = {
  scene, renderer, camera, fighters: [], fighting: false,
  fx: new FX(scene, camera), audio: new Audio(),
  hitStopT: 0,
  hitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); },
  shake(a, at) { const d = at ? at.distanceTo(camera.position) : 0; camCtl.shake(a * clamp(1.4 - d / 25, 0.3, 1)); },
  popup(f, text, block) { popup(f, text, block); },
};
world.arena = new Arena(scene, renderer);
world.combat = new Combat(world);
toonify(world.arena.group);
world.bending = new Bending(world);
const camCtl = new FollowCam(camera, world.arena);

// ---- loading check: the rigged character and every martial-arts clip the game uses must decode before combat can
// start. Nothing falls back to the old procedural bodies or techniques silently; a failure is shown on the menu.
// (?mocap=0 is an explicit comparison mode that uses the procedural techniques on purpose and says so.)
const LOAD = { mode: /[?&]mocap=0/.test(location.search) ? 'procedural comparison (?mocap=0)' : 'authored', character: 'pending', clipsDecoded: 0, clipsExpected: 0, missing: [], errors: [], ok: false };
try { await loadHeroAssets(); LOAD.character = 'ok'; } catch (e) { LOAD.character = 'failed'; LOAD.errors.push('Character: ' + (e && e.message || e)); }
if (LOAD.character === 'ok' && LOAD.mode === 'authored') {
  try { await loadMocap(); } catch (e) { LOAD.errors.push('Animations: ' + (e && e.message || e)); }
  await loadIce();   // the downloaded ice cluster model and the ice-surf crest (procedural fallback if it fails)
  LOAD.clipsDecoded = PACK_STATUS.decoded; LOAD.clipsExpected = PACK_STATUS.expected;
  for (const er of PACK_STATUS.errors) if (!LOAD.errors.some(x => x.includes(er))) LOAD.errors.push('Animations: ' + er);
  if (LOAD.clipsDecoded) adoptTiming(STYLES);
  LOAD.missing = requiredClips(STYLES);
  if (LOAD.missing.length) LOAD.errors.push(`Animations: ${LOAD.missing.length} clips the game needs are missing (${LOAD.missing.slice(0, 6).join(', ')}${LOAD.missing.length > 6 ? ', ...' : ''})`);
}
LOAD.ok = LOAD.character === 'ok' && (LOAD.mode !== 'authored' || (LOAD.clipsDecoded > 0 && LOAD.clipsDecoded === LOAD.clipsExpected && !LOAD.missing.length));
window.__LOAD = LOAD;
const player = new Fighter(world, { name: 'YOU', team: 0, skin: 0x8c5a3c, pants: 0x26324f, sash: 0xd88a2a, wrap: 0xd8cbb0, build: 1.04, bulk: 1.05 });
const opp = new Fighter(world, { name: 'RIVAL', team: 1, skin: 0x6e4630, pants: 0x4a5531, sash: 0x3a7fc4, wrap: 0xb9c3cf, build: 1.0, bulk: 0.97 });
player.target = opp; opp.target = player;
world.fighters.push(player, opp);
const controls = new Controls(canvas);
const ai = new AI(world, opp, player, 'normal');

// ------------------------------------------------------------------ settings / state
const state = {
  difficulty: 'normal', quality: 'high', locked: true, aimHold: 0, rivalEl: 'random', btnSize: 1, btnSpread: 1,
  round: 1, wins: [0, 0], phase: 'menu', phaseT: 0, paused: false,
  pixelRatio: 1, frameAvg: 16, perfT: 0, stickFullT: 0, manual: false,
};
// Intelligent lock-on: prefer the living enemy closest to the centre of view, then the nearest.
function pickTarget() {
  let best = null, bestScore = Infinity;
  camera.getWorldDirection(_f0);
  for (const f of world.fighters) {
    if (f.team === player.team || f.dead) continue;
    _c0.subVectors(f.chestPos(_t0), camera.position);
    const d = _c0.length(); if (d > 40) continue;
    const ang = Math.acos(clamp(_c0.dot(_f0) / d, -1, 1));
    const score = ang * 2 + d / 20;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}
const _f0 = new THREE.Vector3(), _c0 = new THREE.Vector3(), _t0 = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const aimPoint = new THREE.Vector3();
let aimOnTarget = false;

function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  state.pixelRatio = state.quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.25);
  renderer.setPixelRatio(state.pixelRatio);
  const ms = state.quality === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camCtl.fovBase = w / h < 1.2 ? 75 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ rounds
function placeFighters() {
  world.bending.clear();
  player.reset(0, -12, 0);
  opp.reset(0, 12, Math.PI);
  camCtl.snapBehind(player);
  controls.reset();
}
function startMatch() {
  state.wins = [0, 0]; state.round = 1;
  ai.setDifficulty(state.difficulty);
  startRound();
  opp.setElement(state.rivalEl === 'random' ? ELEMENTS[Math.floor(Math.random() * 4)] : state.rivalEl, true);
  $('opp-name').textContent = 'RIVAL · ' + opp.style.name.toUpperCase();
}
function startRound() {
  placeFighters();
  state.phase = 'intro'; state.phaseT = 0; world.fighting = false;
  $('round-label').textContent = `ROUND ${state.round}  ·  BEST OF 3`;
  banner(`ROUND ${state.round}`);
  updatePips();
}
function updatePips() {
  $('pip-p').classList.toggle('won', state.wins[0] > 0);
  $('pip-o').classList.toggle('won', state.wins[1] > 0);
}
let bannerTimer = 0;
function banner(text, dur = 1.2) { const b = $('banner'); b.textContent = text; b.classList.add('show'); bannerTimer = dur; }

function roundLogic(dt) {
  state.phaseT += dt;
  if (state.phase === 'intro' && state.phaseT > 1.3) { state.phase = 'fight'; world.fighting = true; banner('FIGHT!', 0.7); }
  if (state.phase === 'fight' && (player.dead || opp.dead)) {
    state.phase = 'ko'; state.phaseT = 0; world.fighting = false;
    const pw = opp.dead;
    state.wins[pw ? 0 : 1]++;
    banner(pw ? 'K.O.!' : 'DOWN!', 1.8);
    updatePips();
  }
  if (state.phase === 'ko' && state.phaseT > 2.6) {
    if (state.wins[0] >= 2 || state.wins[1] >= 2) {
      state.phase = 'end';
      const won = state.wins[0] >= 2;
      $('end-title').textContent = won ? 'VICTORY' : 'DEFEAT';
      $('end-sub').textContent = `${state.wins[0]} - ${state.wins[1]} against ${state.difficulty.toUpperCase()} rival`;
      $('end').classList.remove('hidden'); controls.enabled = false; controls.reset();
    } else { state.round++; startRound(); }
  }
}

// ------------------------------------------------------------------ player input + aim
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
function computeAim() {
  const target = player.target || opp;
  aimOnTarget = false;
  if (state.locked && !target.dead) {
    target.chestPos(aimPoint).y -= 0.1;
    // light lead so rocks meet a moving rival
    const d = aimPoint.distanceTo(player.pos);
    aimPoint.x += target.vel.x * d / 30 * 0.6; aimPoint.z += target.vel.z * d / 30 * 0.6;
    aimOnTarget = true;
    return;
  }
  camera.getWorldDirection(_f);
  const origin = camera.position;
  // aim assist: if the reticle is near the rival, aim at them with the same lead the AI uses (the rival AI aims
  // at the player with lead at every difficulty above training, so the player gets the same help)
  if (!target.dead) {
    target.chestPos(_t);
    _c.subVectors(_t, origin);
    const along = _c.dot(_f);
    if (along > camCtl.curDist) {
      const perp = _p.copy(origin).addScaledVector(_f, along).distanceTo(_t);
      const ang = Math.atan2(perp, along);
      if (perp < 1.6 || ang < 0.18) {
        aimPoint.copy(_t); aimPoint.y -= 0.1;
        const d = aimPoint.distanceTo(player.pos); aimPoint.x += target.vel.x * d / 30 * 0.6; aimPoint.z += target.vel.z * d / 30 * 0.6;
        aimOnTarget = true; return;
      }
    }
  }
  raycaster.set(origin, _f); raycaster.near = camCtl.curDist + 0.6; raycaster.far = 80;
  const hits = raycaster.intersectObjects([world.arena.floor, ...world.arena.cameraBlockers], false);
  if (hits.length) aimPoint.copy(hits[0].point);
  else aimPoint.copy(origin).addScaledVector(_f, 60);
}

function playerInput(inp) {
  const pi = player.input;
  // camera-relative movement
  const yaw = camCtl.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  pi.mx = rx * inp.mx + fx * inp.my;
  pi.mz = rz * inp.mx + fz * inp.my;
  const b = inp.btn, pr = inp.pressed;
  pi.hand = pr.hand; pi.handHeld = b.hand; pi.leg = pr.leg; pi.legHeld = b.leg; pi.special = pr.special; pi.specialHeld = b.special;
  pi.jump = pr.jump; pi.jumpHeld = b.jump; pi.dodge = pr.dodge; pi.dodgeHeld = b.dodge; pi.guard = b.guard;
  // sprint: push the stick to its rim and hold (or hold C on a keyboard)
  const mag = Math.hypot(inp.mx, inp.my);
  state.stickFullT = mag > 0.92 ? state.stickFullT + inp.dt : 0;

  if (pr.hand || pr.leg || pr.special || b.hand || b.leg || b.guard) state.aimHold = 1.4;
  // the rival AI always squares up to the player; the player does the same whenever the rival is close (within
  // 7 m) and they are not sprinting away, so strikes and whips at close range go where the opponent is
  const tgt = player.target || opp, near = tgt && !tgt.dead && Math.hypot(tgt.pos.x - player.pos.x, tgt.pos.z - player.pos.z) < 7;
  pi.strafe = state.locked || state.aimHold > 0 || (near && state.stickFullT < 0.35);
  // auto-sprint only when not strafing (lock-on or aiming), so full-stick strafing stays locked to the target
  pi.sprint = (!pi.strafe && state.stickFullT > 0.35) || controls.keys.has('KeyC');
  if (player.sprinting) camCtl.fovKick = Math.max(camCtl.fovKick, 6);
  computeAim();
  pi.aimPoint.copy(aimPoint);
  pi.faceYaw = Math.atan2(aimPoint.x - player.pos.x, aimPoint.z - player.pos.z);
  if (Math.hypot(aimPoint.x - player.pos.x, aimPoint.z - player.pos.z) < 0.8) pi.faceYaw = yaw;
  if (near && !aimOnTarget && !(state.aimHold > 0)) pi.faceYaw = Math.atan2(tgt.pos.x - player.pos.x, tgt.pos.z - player.pos.z);
}

// ------------------------------------------------------------------ HUD
const hud = { php: $('p-hp'), pen: $('p-en'), ohp: $('o-hp'), oen: $('o-en'), omini: $('o-hp-mini'), ret: $('reticle'), lock: $('lock-marker'), tag: $('opp-tag'), lockBtn: $('btn-lock'), leg: $('btn-leg'), hand: $('btn-hand'), stick: $('stick-base'), pad: $('action-pad') };
// Element HUD: button sub-labels, active element, held-object pips
let hudEl = null;
function refreshElementHUD() {
  const st = player.style;
  hudEl = player.el;
  for (const b of document.querySelectorAll('.el')) b.classList.toggle('active', b.dataset.el === player.el);
  const set = (id, t) => { const sm = $(id).querySelector('small'); if (sm) sm.textContent = t; };
  set('btn-hand', st.labels.hand); set('btn-leg', st.labels.leg); set('btn-guard', st.labels.guard); set('btn-special', st.labels.special);
  hud.pad.style.setProperty('--elc', '#' + st.color.toString(16).padStart(6, '0'));
  $('style-tag').textContent = st.art.toUpperCase();
}
// Star layout: JUMP top, GUARD upper-left, DODGE upper-right, HAND lower-left, LEG lower-right, SPECIAL centre.
function layoutStar() {
  const W = window.innerWidth, H = window.innerHeight;
  let k = state.btnSize, R = 92 * state.btnSpread * Math.max(k, 0.9);
  // keep the whole star below the HUD bars (top 92 px) and above the bottom edge
  const need = R + 30 * k + R * Math.sin(54 * Math.PI / 180) + 40 * k + 12, avail = H - 92;
  if (need > avail) { const f = avail / need; R *= f; k *= f; }
  const sz = { jump: 58, guard: 62, dodge: 62, hand: 80, leg: 80, special: 66 };
  const ang = { jump: 90, dodge: 18, leg: -54, hand: 234, guard: 162 };
  const safeR = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-r')) || 0;
  const halfW = R * Math.cos(18 * Math.PI / 180) + 40 * k, below = R * Math.sin(54 * Math.PI / 180) + 40 * k;
  const cx = W - 14 - safeR - halfW, cy = H - 12 - below;
  for (const id of Object.keys(sz)) {
    const el = $('btn-' + id), d = sz[id] * k;
    let x = cx, y = cy;
    if (ang[id] !== undefined) { const a = ang[id] * Math.PI / 180; x = cx + Math.cos(a) * R; y = cy - Math.sin(a) * R; }
    el.style.width = el.style.height = d + 'px'; el.style.left = (x - W) + 'px'; el.style.top = (y - H) + 'px';
    el.style.fontSize = (d > 70 ? 13 : 10.5) * Math.min(1.15, k) + 'px';
  }
}
window.addEventListener('resize', layoutStar);
const _s = new THREE.Vector3();
function toScreen(v) { _s.copy(v).project(camera); return { x: (_s.x * 0.5 + 0.5) * window.innerWidth, y: (-_s.y * 0.5 + 0.5) * window.innerHeight, vis: _s.z < 1 && _s.z > -1 }; }
function popup(f, text, block) {
  const s = toScreen(_p.set(f.pos.x, f.pos.y + 2.0, f.pos.z));
  if (!s.vis) return;
  const el = document.createElement('div'); el.className = 'pop' + (block ? ' block' : ''); el.textContent = text;
  el.style.left = (s.x + (Math.random() - 0.5) * 30) + 'px'; el.style.top = s.y + 'px';
  $('popups').appendChild(el); setTimeout(() => el.remove(), 850);
}
let retX = 0, retY = 0;
function updateHUD(dt) {
  hud.php.style.width = (player.hp / player.maxHp * 100) + '%';
  hud.pen.style.width = (player.en / player.maxEn * 100) + '%';
  hud.ohp.style.width = (opp.hp / opp.maxHp * 100) + '%';
  hud.oen.style.width = (opp.en / opp.maxEn * 100) + '%';
  hud.omini.style.width = (opp.hp / opp.maxHp * 100) + '%';
  hud.lockBtn.classList.toggle('on', state.locked);
  hud.leg.style.setProperty('--charge', player.charging ? Math.min(1, player.chargeT / 0.55).toFixed(2) : 0);
  hud.leg.classList.toggle('charged', player.charging && player.chargeT >= 0.3 && player.legHoldT >= 0.85);
  hud.hand.classList.toggle('sustain', player.holding);
  if (hudEl !== player.el) refreshElementHUD();
  for (const b of document.querySelectorAll('.el')) {
    const n = world.bending.held(player, b.dataset.el), pips = b.querySelector('.pips');
    if (pips.childElementCount !== n) pips.innerHTML = '<span></span>'.repeat(n);
  }
  hud.stick.classList.toggle('sprint', player.sprinting);
  const W = window.innerWidth, H = window.innerHeight;
  let tx = W / 2, ty = H / 2;
  const os = toScreen(opp.chestPos(_c));
  if (state.locked && !opp.dead && os.vis) {
    hud.lock.style.display = 'block'; hud.lock.style.left = os.x + 'px'; hud.lock.style.top = os.y + 'px';
    const as = toScreen(aimPoint); if (as.vis) { tx = as.x; ty = as.y; }
  } else hud.lock.style.display = 'none';
  retX = damp(retX || tx, tx, 18, dt); retY = damp(retY || ty, ty, 18, dt);
  hud.ret.style.left = retX + 'px'; hud.ret.style.top = retY + 'px';
  hud.ret.classList.toggle('on-target', aimOnTarget && !opp.dead);
  const hs = toScreen(_p.set(opp.pos.x, opp.pos.y + 2.05, opp.pos.z));
  if (hs.vis && !opp.dead) { hud.tag.style.display = 'block'; hud.tag.style.left = hs.x + 'px'; hud.tag.style.top = hs.y + 'px'; }
  else hud.tag.style.display = 'none';
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $('banner').classList.remove('show'); }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
const stats = { frames: 0, fps: 0, acc: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; // rAF time can precede performance.now() on the first frame
  stats.acc += dt; stats.frames++;
  if (stats.acc > 1) { stats.fps = stats.frames / stats.acc; stats.frames = 0; stats.acc = 0; }
  // adaptive resolution
  state.frameAvg = state.frameAvg * 0.95 + dt * 1000 * 0.05;
  state.perfT += dt;
  if (state.phase !== 'menu' && state.perfT > 3 && state.frameAvg > 24 && state.pixelRatio > 1) {
    state.pixelRatio = Math.max(1, state.pixelRatio - 0.25); renderer.setPixelRatio(state.pixelRatio); resize(); state.perfT = 0;
  }
  if (state.paused || state.manual) { renderer.render(scene, camera); return; }
  step(dt);
  renderer.render(scene, camera);
}
function step(dt) {
  if (world.hitStopT > 0) { world.hitStopT -= dt; dt *= 0.08; }
  const inp = controls.frame();
  inp.dt = dt;
  if (inp.pressed.lock) { state.locked = !state.locked; if (state.locked) { const t = pickTarget(); if (t) { player.target = t; } else state.locked = false; } }
  if (opp.dead && state.locked) state.locked = state.phase === 'fight';
  if (inp.pressed.el && state.phase !== 'menu') player.setElement(inp.pressed.el);
  state.aimHold -= dt;

  const active = state.phase === 'fight' || state.phase === 'intro' || state.phase === 'ko';
  if (state.phase === 'fight') playerInput(inp);
  else { const pi = player.input; pi.mx = pi.mz = 0; pi.hand = pi.handHeld = pi.leg = pi.legHeld = pi.special = pi.specialHeld = pi.jump = pi.jumpHeld = pi.dodge = pi.dodgeHeld = pi.guard = false; computeAim(); }
  ai.update(dt);
  for (const f of world.fighters) f.update(dt);
  // fighter-fighter separation
  const dx = opp.pos.x - player.pos.x, dz = opp.pos.z - player.pos.z, d = Math.hypot(dx, dz), m = player.radius + opp.radius;
  if (d < m && d > 1e-4 && Math.abs(opp.pos.y - player.pos.y) < 1.5) {
    const push = (m - d) / 2; player.pos.x -= dx / d * push; player.pos.z -= dz / d * push; opp.pos.x += dx / d * push; opp.pos.z += dz / d * push;
  }
  world.bending.update(dt);
  world.fx.update(dt, (x, z, y) => world.arena.groundAt(x, z, y));
  world.audio.update(dt);
  // Fire holding GUARD: the SPECIAL button reads DRAGON BREATH (GUARD + SPECIAL breathes fire) and glows
  { const br = player.el === 'fire' && player.guarding, b = $('btn-special');
    if (b && br !== b._breath) { b._breath = br; const sm = b.querySelector('small'); if (sm) sm.textContent = br ? "DRAGON'S BREATH" : player.style.labels.special; b.classList.toggle('breath', br); } }
  if (active) {
    const look = { x: inp.lookX, y: inp.lookY };
    { const tg = player.target || opp; camCtl.update(dt, player, tg, state.locked && !tg.dead, look); }
    roundLogic(dt);
  }
  // shadow light follows the action
  sun.position.set(player.pos.x + 14, 24, player.pos.z + 9);
  sun.target.position.set(player.pos.x, 0, player.pos.z);
  updateHUD(dt);
}

// ------------------------------------------------------------------ menus
function segment(id, key, cb) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset[key]);
  });
}
segment('difficulty', 'd', v => { state.difficulty = v; });
segment('quality', 'q', v => { state.quality = v; applyQuality(); });
segment('autocam', 'a', v => { camCtl.autoCam = v === 'on'; });
$('sens').addEventListener('input', e => { controls.sens = parseFloat(e.target.value); });
segment('rival-el', 'r', v => { state.rivalEl = v; });
// venue: chosen in the menu (or ?venue=barn); FIGHT waits until the venue has loaded
state.venueReady = Promise.resolve();
const chooseVenue = (v) => { state.venueReady = world.arena.setVenue(v).catch(e => { LOAD.errors.push('Venue: ' + (e && e.message || e)); console.error(e); }); $('venue').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === v)); return state.venueReady; };
segment('venue', 'v', v => chooseVenue(v));
{ const m = /[?&]venue=(\w+)/.exec(location.search); if (m) chooseVenue(m[1]); }
const loadPrefs = () => { try { const p = JSON.parse(localStorage.getItem('ef-controls') || '{}'); if (p.size) state.btnSize = p.size; if (p.spread) state.btnSpread = p.spread; } catch (_) {} $('btn-size').value = state.btnSize; $('btn-spread').value = state.btnSpread; };
const savePrefs = () => { try { localStorage.setItem('ef-controls', JSON.stringify({ size: state.btnSize, spread: state.btnSpread })); } catch (_) {} };
$('btn-size').addEventListener('input', e => { state.btnSize = parseFloat(e.target.value); layoutStar(); savePrefs(); });
$('btn-spread').addEventListener('input', e => { state.btnSpread = parseFloat(e.target.value); layoutStar(); savePrefs(); });
loadPrefs();

async function goFullscreen() {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) return;
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) {}
  try { await screen.orientation.lock('landscape'); } catch (_) {}
}
function showGame() {
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden'); $('rotate').classList.add('armed'); layoutStar();
  controls.enabled = true; state.paused = false;
}
world.audio.setListener(camera);
// installable app: offline support, and an INSTALL APP button on the menu where the browser offers installation
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('offline support unavailable', e));
  // once everything has loaded, hand the worker the list of files so the whole game is stored for offline play
  const store = () => navigator.serviceWorker.ready.then(r => r.active && r.active.postMessage({ type: 'cache', urls: [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(e => e.name)] }));
  window.addEventListener('load', () => setTimeout(store, 4000));
  if (state.venueReady && state.venueReady.then) state.venueReady.then(() => setTimeout(store, 1000));
}
{ let ask = null; const b = $('btn-install');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ask = e; if (b) b.style.display = ''; });
  window.addEventListener('appinstalled', () => { ask = null; if (b) b.style.display = 'none'; });
  if (b) b.addEventListener('click', async () => { if (!ask) return; ask.prompt(); await ask.userChoice; ask = null; b.style.display = 'none'; }); }
$('btn-start').addEventListener('click', async () => { if (!LOAD.ok) return; world.audio.unlock(); goFullscreen(); await state.venueReady; showGame(); startMatch(); });
$('btn-again').addEventListener('click', () => { showGame(); startMatch(); });
const toMenu = () => {
  state.phase = 'menu'; state.paused = false; world.fighting = false; controls.enabled = false;
  $('pause').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden');
  $('rotate').classList.remove('armed');
};
$('btn-menu2').addEventListener('click', toMenu);
$('btn-quit').addEventListener('click', toMenu);
const pause = () => { if (state.phase === 'menu' || state.phase === 'end') return; state.paused = true; controls.reset(); $('pause').classList.remove('hidden'); document.exitPointerLock?.(); };
$('btn-pause').addEventListener('pointerdown', (e) => { e.stopPropagation(); pause(); });
$('btn-resume').addEventListener('click', () => { state.paused = false; $('pause').classList.add('hidden'); last = performance.now(); });
window.addEventListener('keydown', e => { if (e.code === 'Escape' || e.code === 'KeyP') { if (state.paused) { state.paused = false; $('pause').classList.add('hidden'); } else pause(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });


// ------------------------------------------------------------------ boot
applyQuality();
placeFighters();
layoutStar();
refreshElementHUD();
state.phase = 'menu';
// idle menu camera: slow orbit around the dais
const menuOrbit = (t) => { const a = t * 0.00008; camera.position.set(Math.sin(a) * 20, 7, Math.cos(a) * 20); camera.lookAt(0, 1, 0); };
(function menuLoop(t) { if (state.phase === 'menu') { menuOrbit(t); } requestAnimationFrame(menuLoop); })(0);
$('loading').classList.add('hidden');
requestAnimationFrame(frame);

// test / debug handle (used by the automated browser tests)
window.__EF = { world, player, opp, camCtl, controls, state, ai, renderer, scene, camera, MOCAP, LOAD, aimPoint: () => aimPoint.clone(), stats, layoutStar, STYLES,
  // deterministic stepping for frame-accurate gameplay capture in tests
  step: (dt) => step(dt), render: () => renderer.render(scene, camera), info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs.length }) };

// ---- build stamp (so the build on a device can be identified) with the ACTUAL loading result, and the start gate
{
  const stamp = document.createElement('div'); stamp.id = 'build-stamp';
  stamp.textContent = `${BUILD} · ` + (LOAD.mode !== 'authored' ? LOAD.mode : LOAD.ok ? `character OK · ${LOAD.clipsDecoded}/${LOAD.clipsExpected} martial-arts clips decoded` : 'LOADING FAILED - see the menu');
  stamp.style.cssText = 'position:fixed;left:8px;bottom:6px;font:11px/1.2 system-ui,sans-serif;color:#fff;opacity:.8;z-index:50;pointer-events:none;text-shadow:0 1px 2px #000';
  document.body.appendChild(stamp);
  if (!LOAD.ok) {
    const start = $('btn-start'); start.disabled = true; start.textContent = 'CANNOT START'; start.style.opacity = '0.5';
    const box = document.createElement('div'); box.id = 'load-error';
    box.style.cssText = 'margin:10px auto 0;max-width:560px;text-align:left;font:13px/1.4 system-ui,sans-serif;color:#fff;background:#8a1f1f;border-radius:8px;padding:10px 12px';
    box.innerHTML = '<b>The game assets did not load, so the fight cannot start.</b><br>' + LOAD.errors.map(e => '&bull; ' + e.replace(/</g, '&lt;')).join('<br>') +
      '<br><small>The authored martial-arts animations need these files. Reload the page, or open the game in Chrome at its own address.</small>';
    start.parentNode.insertBefore(box, start.nextSibling);
  }
  // ?debug=anim : live readout of the player's animation state (clip, source take, speed, blend weights)
  if (/[?&]debug=anim/.test(location.search)) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:8px;top:64px;max-width:46vw;font:12px/1.35 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);padding:6px 8px;border-radius:6px;z-index:60;pointer-events:none;white-space:pre';
    document.body.appendChild(box);
    const tick = () => {
      requestAnimationFrame(tick);
      const h = player.hero; if (!h) { box.textContent = 'procedural body (character asset not loaded)'; return; }
      const c = h.cur, name = h.curName || '-', m = MOCAP[name.split('|')[0]], d = c ? c.getClip().duration : 0;
      box.textContent = [`clip   ${name}${m ? '' : ' (core library)'}`, `source ${m ? m.src : '-'}`,
        `speed  ${c ? c.timeScale.toFixed(2) : '-'}x   at ${c ? (c.time / d * 100).toFixed(0) : 0}%`,
        `legs   ${h.low ? h.lowName.split('|')[0] + ' (layer)' : 'from the clip above'}`,
        `blend  authored upper ${(100 - h.wU * 100).toFixed(0)}%  lower ${(100 - h.wL * 100).toFixed(0)}%`,
        `state  ${player.action || '-'}${player.tech ? ' ' + player.tech.name : ''}${player.guarding ? ' GUARD' : ''}${player.holding ? ' HOLD' : ''}${player.charging ? ' CHARGE' : ''}`].join('\n');
    };
    tick();
  }
}
