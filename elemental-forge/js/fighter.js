// Fighter: skinned martial artist driven by an element style (stance, locomotion, keyframed techniques),
// plus movement physics, stamina, dodges, reactions and the HAND / LEG / GUARD / SPECIAL input model.
import * as THREE from 'three';
import { clamp, dampAngle, angleDiff, smooth01, rand } from './util.js';
import { buildSkinnedFighter } from './character.js';
import { JOINTS, JI, PN, POSE_LEN, PX, PY, PZ, LEG_START, S, add, arm, legRaw, legIK, hipDown, seg, stanceLegs, HIP_H } from './pose.js';
import { STYLES } from './styles.js';
import { Hero, heroReady } from './hero.js';
import { MOCAP } from './mocap.js';
import { HALF } from './arena.js';
import { JetSet } from './firefx.js';

// Reactions and shared moves (element techniques live in styles.js)
export const ACTIONS = {
  counter: { dur: 0.4,  upper: false, active: { from: 0.2, to: 0.55, dmg: 14, range: 2.1, arc: -1.1, knock: 9, level: 1 }, cancel: 0.65, lunge: 10 },
  hit:     { dur: 0.36, react: true },
  stagger: { dur: 0.72, react: true },
  down:    { dur: 0.8,  react: true },   // (20 Nov: up sooner)   // Mixamo Knocked Down (1.05 s at 1.25x) lands on the back, then is held
  getup:   { dur: 0.8,  react: true },   // (20 Nov: a brisk rise, not a struggle)   // the authored get-up at about 1.8x its captured speed
  land:    { dur: 0.14, soft: true },
  landHigh:{ dur: 0.42, soft: true },
  ko:      { dur: 99,   react: true },
};

// Elemental mobility (DODGE held). All values are tunable: speeds in m/s, accelerations in m/s^2, turn in rad/s,
// drains in energy per second, flight duration in seconds, maximum altitude in metres above the ground below.
export const MOBILITY = {
  water: { top: 12.5, accel: 9, turn: 3.0, brake: 14, cruise: 5, coast: 3, drain: 4, launch: 12.5, lift: 3.0, last: 8 },     // ice surfing: riding a sculpted crest of ice that holds the feet 3 m off the floor; DODGE held starts it, it keeps going after DODGE is let go (so the thumb is free to attack), DODGE tapped again ends it
  earth: { top: 10.5, accel: 5, turn: 2.4, brake: 9, cruise: 5, coast: 2, drain: 7, launch: 13.5, lift: 1.0, last: 4 },     // rock slide (heavy, on a slab of rock held 1 m off the floor; DODGE starts and ends it)
  flame: { top: 13, accel: 30, turn: 6, drain: 14, launch: 11 },                                         // flame-propelled run
  fly:   { duration: 6, takeoff: 8, ascent: 7, sink: 1.2, maxAlt: 14, speed: 9.5, accel: 14, drain: 8, recover: 1.5 }, // airbending flight
};

export class Fighter {
  constructor(world, opts) {
    this.world = world;
    this.name = opts.name; this.team = opts.team;
    const body = buildSkinnedFighter({ skin: opts.skin, pants: opts.pants, sash: opts.sash, wrap: opts.wrap, build: opts.build || 1, bulk: opts.bulk || 1 });
    this.root = body.root; this.tumble = body.tumble; this.J = body.J; this.material = body.material; this.mesh = body.mesh;
    this.triangles = body.triangles; this.sashIdx = body.sashIdx;
    world.scene.add(this.root);
    // visible body: the rigged mannequin (authored clips + retargeted martial-arts poses); the procedural
    // rig stays as the invisible pose driver. Falls back to the procedural body if the asset failed to load.
    if (heroReady()) {
      this.hero = new Hero(this.J.hips.parent, this.J, { skin: opts.skin, pants: opts.pants, sash: opts.sash, wrap: opts.wrap ?? 0xd8cbb0 });
      this.mesh.visible = false; this.material = this.hero.material;
    }

    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.faceYaw = 0; this.spinYaw = 0;
    this.radius = 0.42; this.height = 1.75;
    this.onGround = true; this.groundY = 0; this.airTime = 0; this.airJumps = 0;
    this.maxHp = 100; this.hp = 100; this.maxEn = 100; this.en = 100;
    this.action = null; this.tech = null; this.actionT = 0; this.evIdx = 0; this.hitDone = false; this.jumped = false;
    this.handSide = 1; this.techSide = 1; this.legIdx = 0; this.comboTimer = 0;
    this.handHoldT = -1; this.legHoldT = -1; this.holding = false; this.holdPh = 0;
    this.charging = false; this.chargeT = 0;
    this.ext = new THREE.Vector3();   // external push (wind, blasts): decays on its own, footwork cannot cancel it
    this.dodgeT = 0; this.dodgeDur = 0.42; this.dodgeKind = 'roll'; this.dodgeDir = new THREE.Vector3(); this.dodgeCd = 0;
    this.guarding = false; this.guardT = 0; this.guardCd = 0; this.defense = null;
    this.counterT = 0; this.lungeT = 0; this.lungeDir = new THREE.Vector3();
    this.invuln = 0; this.flash = 0; this.stunT = 0; this.restrainT = 0;
    this.sprinting = false;
    this.buf = { hand: 0, leg: 0, special: 0, dodge: 0, jump: 0 };
    this.runPhase = 0; this.time = Math.random() * 10;
    this.moveLocal = new THREE.Vector2(0, 1);
    this.speedNorm = 0; this.bank = 0; this.accLean = 0; this.prevFace = 0; this.prevVel = new THREE.Vector3();
    this.dead = false;
    this.mob = null; this.dodgeHoldT = -1; this.highJump = false; this.jetFuel = 0;
    this.input = Fighter.blankInput();
    this.target = null;
    this.stats = { hitsLanded: 0, blocks: 0, perfect: 0, techniques: {} };
    this.pose = new Float32Array(POSE_LEN); this.cur = new Float32Array(POSE_LEN);
    this.tmpA = new Float32Array(POSE_LEN); this.tmpB = new Float32Array(POSE_LEN); this.tmpPose = new Float32Array(POSE_LEN);
    this.el = null; this.setElement(opts.element || 'earth', true);
  }

  static blankInput() {
    return { mx: 0, mz: 0, strafe: false, faceYaw: null, hand: false, handHeld: false, leg: false, legHeld: false, special: false, guard: false, jump: false, jumpHeld: false, dodge: false, dodgeHeld: false, sprint: false, aimPoint: new THREE.Vector3() };
  }

  setElement(el, quiet) {
    if (el === this.el || !STYLES[el]) return;
    const old = this.el;
    if (old && this.world.bending) { this.world.bending.dropAll(this, old); this.guarding = false; this.world.bending.guardEnd(this, true); }
    this.holding = false; this.charging = false; this.handHoldT = -1; this.legHoldT = -1;
    // a ride of the old element (ice surf, rock slide, flame run, flight) ends: the new element cannot keep it up
    if (this.mob && this.mob.el !== el) this.endMob();
    if (this.action === 'tech') { this.action = null; this.tech = null; }   // switching is instant: the technique in progress stops
    this.el = el; this.style = STYLES[el];
    // the sash takes the element's colour
    const col = this.mesh.geometry.attributes.color, c = new THREE.Color(this.style.sash);
    for (const i of this.sashIdx) col.setXYZ(i, c.r, c.g, c.b);
    col.needsUpdate = true;
    if (this.hero) this.hero.setSash(this.style.sash);
    if (!quiet) { this.world.popup(this, this.style.name.toUpperCase(), true); this.world.audio.whoosh(0.3); }
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = this.faceYaw = this.prevFace = yaw; this.spinYaw = 0;
    this.hp = this.maxHp; this.en = this.maxEn; this.dead = false;
    this.action = null; this.tech = null; this.guarding = false; this.holding = false; this.charging = false; this.handHoldT = this.legHoldT = -1;
    this.dodgeT = 0; this.stunT = 0; this.invuln = 0; this.flash = 0; this.counterT = 0; this.lungeT = 0; this.restrainT = 0; this.airJumps = 0; if (this.wall && this.wall.slab) this.world.scene.remove(this.wall.slab); this.wall = null;
    this.endMob(); this.highJump = false; this.jetFuel = 0; this.dodgeHoldT = -1;
    for (const k in this.buf) this.buf[k] = 0;
    this.tumble.quaternion.identity(); this.tumble.position.y = 0.6;
    this.pose.fill(0); this.cur.fill(0); this.runPhase = 0; this.bank = 0; this.accLean = 0;
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
  }

  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.3, this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  // the last ~0.3 s of each hand and foot position (bone positions after the animation), so an effect can be
  // shaped from the path the limb actually travelled
  recLimbs() {
    const H = this.limbHist || (this.limbHist = { i: 0, n: 0, t: new Float64Array(20), p: { hL: [], hR: [], fL: [], fR: [] } });
    const i = H.i; H.t[i] = this.time;
    for (const k of ['hL', 'hR', 'fL', 'fR']) { const a = H.p[k]; if (!a[i]) a[i] = new THREE.Vector3(); (k[0] === 'h' ? this.handPos(k[1], a[i]) : this.footPos(k[1], a[i])); }
    H.i = (i + 1) % 20; H.n = Math.min(20, H.n + 1);
  }
  // positions of one limb over the last `span` seconds, oldest first
  limbPath(limb, side, span = 0.2) {
    const H = this.limbHist; if (!H) return [];
    const a = H.p[(limb === 'foot' ? 'f' : 'h') + side], out = [];
    for (let j = H.n; j >= 1; j--) { const k = (H.i - j + 20) % 20; if (this.time - H.t[k] <= span + 1e-6) out.push(a[k].clone()); }
    return out;
  }
  handPos(side, out = new THREE.Vector3()) { return (this.hero ? this.hero.bones['DEF-hand' + side] : this.J['w' + side]).getWorldPosition(out); }
  footPos(side, out = new THREE.Vector3()) { return (this.hero ? this.hero.bones['DEF-foot' + side] : this.J['a' + side]).getWorldPosition(out); }
  // (20 Nov, after review: "the flames do not all come from the back of the leg, especially the bent leg ... the back
  // of the leg is the heel. Investigate.") The rig's foot bone starts at the lower shin, about 0.29 m above the floor
  // when standing, so a point a few centimetres from it was on the shin, not the heel. The heel is now found on the
  // character's own mesh: in the rest pose, the lowest and rearmost vertex skinned to each foot, stored in the foot
  // bone's local space, so it turns with the foot through every pose (bent, pointed, tucked).
  heelPos(side, out = new THREE.Vector3()) {
    if (!this.hero) return this.footPos(side, out);
    const bone = this.hero.bones['DEF-foot' + side];
    if (!this._heelOff) this._heelOff = {};
    if (this._heelOff[side] === undefined) this._heelOff[side] = findHeel(this.hero, side);
    const o = this._heelOff[side];
    if (!o) return this.footPos(side, out);
    bone.updateWorldMatrix(true, false);
    return out.copy(o).applyMatrix4(bone.matrixWorld);
  }
  // the fist: the middle of the closed hand, about where the knuckles fold (wrist to the base of the middle finger)
  fistPos(side, out = new THREE.Vector3()) {
    this.handPos(side, out); if (!this.hero) return out;
    const k = this.hero.bones['DEF-f_middle01' + side]; if (!k) return out;
    k.getWorldPosition(_heelT); return out.lerp(_heelT, 0.85);
  }

  get A() { return this.action === 'tech' ? this.tech : (this.action ? ACTIONS[this.action] : null); }
  get actionU() { const A = this.A; return A ? this.actionT / A.dur : 1; }
  reacting() { const A = this.A; return !!(A && A.react); }
  free(kind) {
    if (this.dead || this.stunT > 0 || this.restrainT > 0 || this.reacting()) return false;
    // Air's glide can be broken off into a strike once it has carried the bender clear (0.3 s)
    // Fire's jet glide: punches and blasts are thrown while gliding (the glide carries on under them)
    if (this.dodgeT > 0) return kind === 'attack' ? (this.dodgeKind === 'glide' ? this.dodgeDur - this.dodgeT > 0.3 : (this.dodgeKind === 'rocket' || this.dodgeKind === 'arch') ? this.dodgeDur - this.dodgeT > 0.06 : this.dodgeKind === 'flip' ? this.dodgeT < 0.1 : this.dodgeT < this.dodgeDur * 0.3) : false;   // (Air's flips: only once back on the feet)
    const A = this.A;
    if (!A || A.soft) return true;
    return A.cancel !== undefined && this.actionU >= A.cancel;
  }
  busy() { return !this.free('jump'); }

  startAction(name) { this.action = name; this.tech = null; this.actionT = 0; this.evIdx = 0; this.hitDone = false; this.jumped = false; this.spinYaw = 0; }
  // basic: a HAND / LEG strike. Strikes always happen: without the energy for bending they are performed as plain
  // martial-arts blows (same movement, physical damage only, no elemental effect).
  startTech(def, side, basic = false) {
    if (!def) return false;
    // (20 Nov) Earth's punches: the striking fist and forearm armour themselves in rock (earth.js gauntlet)
    if (this.el === 'earth' && this.world.bending && this.world.bending.earth && (def === this.style.tech.hand || def.variantOf === this.style.tech.hand)) this.world.bending.earth.gauntlet(this, (side ?? 1) > 0 ? 'R' : 'L');
    // alternating authored takes (e.g. hook / lunge punch) each carry their own timing
    // (a chain of alternating takes starts again from its first once the bender has been back in stance for 0.9 s
    //  after the previous take ended)
    // (19 Nov) Water's HAND when a grab is possible (rival close, or in the air within 12 m) throws the overhead whip
    // whatever its place in the chain (a punch there would throw a ball and no grab could happen)
    const grabWhip = def.variants && this.el === 'water' && def === this.style.tech.hand && this.world.bending && this.world.bending.weapons.canWhipGrab(this)
      ? def.variants.find(v => /^whip_v/.test(v.clip)) : null;
    this.grabArmed = grabWhip;   // (the grab is armed at the press: "close" means close when HAND is pressed; the lunge does not turn a lash into a grab)
    if (grabWhip) { def = grabWhip; this.altN = (this.altN || 0) + 1; this.lastAltEnd = this.time + def.dur; }   // (the chain still moves on)
    else if (def.variants) { if (this.time - (this.lastAltEnd ?? -9) > 0.9 * (this.style.tempo || 1)) this.altN = 0;   /* (21 Nov: Air's strikes end sooner at its faster tempo, so its chain window is as much longer) */ const n = this.altN || 0; this.altN = n + 1; def = def.variants[n % def.variants.length]; this.lastAltEnd = this.time + def.dur; }
    if (this.dodgeKind === 'glide' && this.dodgeT > 0) { this.dodgeT = 0; this.vel.y = Math.min(this.vel.y, 0); }   // a strike ends the glide
    const powered = this.en >= (def.cost || 0);
    if (!powered) {
      if ((this.noEnPopT || 0) <= 0) { this.world.popup(this, 'NO ENERGY', true); this.noEnPopT = 1; }
      if (!basic) return false;
    } else this.en -= def.cost || 0;
    this.unpowered = !powered;
    this.action = 'tech'; this.tech = def; this.actionT = 0; this.evIdx = 0; this.hitDone = false; this.jumped = false; this.spinYaw = 0;
    this.techSide = side || 1; this.techN = (this.techN || 0) + 1;
    if (!this.mob) this.world.combat.lunge(this, def);
    if (def.onStart && powered) this.world.bending.event(this, def.onStart, def);
    // the limb's swing, timed just before the strike lands (kicks heavier than punches)
    { const u = def.events && def.events.length ? def.events[0][0] : (def.active ? def.active.from : 0.4), leg = /kick|sweep|hurricane|teep|front|heel|body|round|axe|crescent|whirl|flip/i.test(def.clip || '');
      this.world.audio.play(leg ? 'swingHeavy' : 'swing', { vol: leg ? 0.8 : 0.6, pos: this.pos, delay: Math.max(0, u * def.dur - 0.1) }); }
    const n = def.name || 'tech'; this.stats.techniques[n] = (this.stats.techniques[n] || 0) + 1;
    return true;
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    if (!(dt > 0)) return;
    const w = this.world, inp = this.input, st = this.style, B = w.bending;
    this.time += dt;
    this.dodgeCd -= dt; this.guardCd -= dt; this.noEnPopT = (this.noEnPopT || 0) - dt; this.perfectT = (this.perfectT || 0) - dt; this.blockPopT = (this.blockPopT || 0) - dt; this.invuln -= dt; this.comboTimer -= dt; this.stunT -= dt; this.counterT -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.soundLoops(); this.fistFlames(dt);
    for (const k in this.buf) this.buf[k] = Math.max(0, this.buf[k] - dt);
    // input buffer: long enough to queue the next technique during an authored recovery
    if (inp.hand) this.buf.hand = 0.45;
    if (inp.leg) this.buf.leg = 0.45;
    if (inp.special) this.buf.special = 0.45;
    if (inp.dodge) this.buf.dodge = 0.18;
    if (inp.jump) this.buf.jump = 0.15;
    if (this.guarding) this.guardT += dt;
    // (20 Nov, after review: "the rock man should be part of guard, and easy to get") Earth: GUARD held 0.6 s raises the
    // Rock Man around the bender (30 energy, 14 s cooldown): the close-quarters form
    if (this.el === 'earth' && !this.dead && !this.armour && (this.armourCd || 0) <= this.time && this.en >= 30 && ((this.guarding && this.guardT > 0.6) || this.aiArmour)) {
      this.aiArmour = false; this.en -= 30; this.armourCd = this.time + 14; this.world.bending.earth.armour(this);
    }
    if (this.slamFall && this.onGround && this.action !== 'down' && !(this.restrainT > 0)) this.slamFall = false;   // a slam's fall ends on landing
    if (this.bombDive && (this.onGround || this.reacting() || this.dead)) { const landed = this.onGround && !this.reacting() && !this.dead; this.bombDive = false; if (landed) { this.vel.x = this.vel.z = 0; if (this.earthSlam) { this.en -= this.style.tech.special.cost; this.startTech(this.style.tech.special, 1); this.world.fx.crater(this.pos, 2.5); this.world.audio.rumble(1.2, this.pos); } else this.world.bending.fireBomb(this); } this.earthSlam = false; }
    if (this.floatT > 0) this.floatT -= dt;   // lifted by wind: the Floating clip (hero.js)
    // footwork cues for hero.js (M9): the ground speed at take-off picks Running Jump / Standing Jump; the first stride
    // of a run from standing is the Male Locomotion Pose lunge; reversing the stick at a run plants and turns
    // (Change Direction's braking steps)
    { const hs = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround) { if (hs < 0.6) { this.stillAt = this.time; this.burstDone = false; } else if (hs > 1.2 && !this.burstDone && this.time - (this.stillAt ?? -9) < 0.3 && !this.action && this.dodgeT <= 0) { this.burstT = 0.22; this.burstDone = true; } this.lastGroundSp = hs; }
      this.burstT = (this.burstT || 0) - dt; this.turnT = (this.turnT || 0) - dt;
      const ml = Math.hypot(inp.mx, inp.mz);
      if (this.onGround && !this.action && this.dodgeT <= 0 && !this.mob && hs > 4.5 && ml > 0.6 && (inp.mx * this.vel.x + inp.mz * this.vel.z) / (ml * hs) < -0.5 && this.turnT < -0.3) { this.turnT = 0.42; this.turnSide = Math.sign(inp.mx * this.vel.z - inp.mz * this.vel.x) || 1; }
    }

    // ---- action / technique timeline
    if (this.action) {
      const A = this.A;
      this.actionT += dt;
      const u = this.actionT / A.dur;
      if (A.active && !this.hitDone && u >= A.active.from && u <= A.active.to) {
        if (w.combat.meleeCheck(this, this.unpowered && this.action === 'tech' && A.active ? { ...A.active, dmg: Math.round(A.active.dmg * 0.6) } : A.active, this.action === 'tech' ? this.el : 'counter')) this.hitDone = true;
      }
      if (A.events) while (this.evIdx < A.events.length && u >= A.events[this.evIdx][0]) { if (!(this.unpowered && this.action === 'tech')) B.event(this, A.events[this.evIdx][1], A); this.evIdx++; }
      if (A.spin) this.spinYaw = A.spin[2] * Math.PI * 2 * seg(u, A.spin[0], A.spin[1]);
      if (this.action === 'counter') this.spinYaw = Math.PI * 2 * seg(u, 0, 0.55);
      if (A.jumpAt && !this.jumped && u >= A.jumpAt[0]) { this.jumped = true; if (this.onGround) { this.vel.y = A.jumpAt[1]; this.onGround = false; } }
      if (u >= 1 && this.action !== 'ko') {
        const was = this.action; this.action = null; this.tech = null; this.spinYaw = 0;
        // getting up is protected for most of the rise, so a fighter cannot be kept on the floor by blows timed to it
        if (was === 'down') {
          // (20 Nov) Getting Thrown already rolls and stands up: no second get-up after it
          if (this.downClip === 'thrown_fall') { this.downClip = null; this.invuln = Math.max(this.invuln, 0.2); }
          else {
          this.floorHit = false; this.startAction('getup');
          // Air gets up with the corkscrew kip-up (longer, so time is added in front); the others with the plain get-up;
          // (20 Nov) face down after a fall forwards, everyone pushes up from the front (Getting Up 2)
          const faceDown = this.downClip === 'fall_flat' || this.downClip === 'trip';
          this.getupClip = faceDown ? 'getup2' : this.el === 'air' ? 'getup_cork' : 'getup';   // (18 Nov, after review: the flip get-up is Air's only; Fire's double-kick kip-up took too long)
          this.actionT = faceDown ? -0.35 : 0;   // (20 Nov: the face-down push-up plays quicker, about 1.1 s)   // (18 Nov, after review: Air's get-up took too long; the corkscrew starts at the flip now and fits the plain get-up's time)
          this.invuln = Math.max(this.invuln, (this.A.dur - this.actionT) * 0.8);
          }
        }
      }
    }

    const live = !this.dead, restrained = this.restrainT > 0;
    // ---- commands (buffered so slightly early presses still land)
    if (live && !restrained) {
      // DODGE held: the element's own mobility (ice / rock surfing, flight, flame-propelled run)
      if (inp.dodgeHeld) this.dodgeHoldT = this.dodgeHoldT < 0 ? 0 : this.dodgeHoldT + dt; else { this.dodgeHoldT = -1; this.mobLock = false; if (this.mob && !this.mob.tap && (this.onGround || this.mob.kind === 'fly')) this.endMob(); }
      this.mobCd = (this.mobCd || 0) - dt;
      // a spent mobility needs DODGE released (and, for flight, a recovery time) before it can start again
      // DODGE held: Water's ice surfing and Fire's flame run (Earth's rock slide and Air's flight start on a tap)
      if (!this.mob && !this.mobLock && this.mobCd <= 0 && this.dodgeHoldT > 0.28 && this.el === 'water' && !this.guarding && !this.charging && !this.reacting() && this.en > 12) { this.startMob(); if (this.mob && this.el === 'water') { this.mob.tap = true; this.mobLock = true; } }
      // tap-started mobility ends by itself: the rock slide after a few seconds, flight when its fuel is spent
      if (this.mob && this.mob.tap && this.mob.kind === 'surf' && (this.mob.t > (MOBILITY[this.mob.el].last || 4) || this.en < 2)) { this.endMob(); this.mobCd = 0.4; }
      // (an Earth slab beside a wall goes onto the wall instead of launching: see the wall checks below)
      if (this.buf.jump && this.mob && (this.mob.kind === 'surf' || this.mob.kind === 'flame') && this.onGround && !(this.el === 'earth' && this.mob.kind === 'surf' && this.wallNear(1.4))) {
        // the element launches the bender: a rising ice pillar / rock slab, or a burst of flame from the feet
        const M = MOBILITY[this.mob.kind === 'surf' ? this.mob.el : 'flame'];
        if (this.mob.kind === 'surf') B.weapons.surfLaunch(this, this.mob.el); else this.jumpFx(false);   // (the rising pillar would set its own lift)
        this.buf.jump = 0; this.vel.y = M.launch; this.onGround = false; this.highJump = true; this.jetFuel = this.el === 'fire' ? 1.1 : 0;
        if (this.mob.kind === 'flame') this.endMob();
      }
      if (this.mob && this.mob.kind === 'fly') this.buf.jump = 0;   // in flight JUMP means climb
      // water GUARD combinations: HAND throws an ice spear, LEG sends a stream to capture the opponent
      // (only while GUARD is still held: a HAND pressed as the guard is released is the counter-strike, not a spear)
      // a guard let go stays up for a moment (elements.js guardEnd): Earth punches its rocks out as while guarding,
      // Water punches spikes off the ice it froze into, Fire's punch throws the wall (elements.js fire.hand)
      const lgE = B.lingering(this, 'earth'), lgW = B.lingering(this, 'water');
      if (lgW && lgW.ice && lgW.iceShots > 0 && this.el === 'water' && this.buf.hand && this.free('attack') && this.en >= 3) { this.buf.hand = 0; this.startTech(st.tech.icePunch, this.handSide = -this.handSide, true); }
      if (lgE && this.el === 'earth' && this.buf.hand && this.free('attack') && this.en >= 8) { if (B.guardShatter(this)) { this.buf.hand = 0; this.en -= 8; this.startTech(st.tech.hand, this.handSide = -this.handSide, true); } }
      if (this.guarding && inp.guard && this.el === 'earth' && this.buf.hand && this.en >= 8) { if (B.guardShatter(this)) { this.buf.hand = 0; this.en -= 8; this.startTech(st.tech.hand, this.handSide = -this.handSide, true); } }
      // (20 Nov, added Air skills) GUARD + HAND: Air Blast; GUARD + LEG: Air Blades; (21 Nov) GUARD + SPECIAL: Suction
      // (5 s cooldown). Air did nothing with these before.
      if (this.guarding && inp.guard && this.el === 'air' && st.tech.airBlast && !this.charging && !this.reacting()) {
        const T = this.buf.hand ? st.tech.airBlast : this.buf.leg ? st.tech.airBlades : this.buf.special && (this.suctionCd || 0) <= this.time ? st.tech.suction : null;
        if (T === st.tech.suction && this.en >= T.cost) this.suctionCd = this.time + 5;
        if (T && this.en >= T.cost) { this.buf.hand = this.buf.leg = this.buf.special = 0; this.guarding = false; B.guardEnd(this, true); this.guardCd = 0.4; this.startTech(T, this.handSide = -this.handSide, true); }
      }
      if (this.guarding && inp.guard && this.el === 'water') {
        if (this.buf.hand && this.en >= 10) { this.buf.hand = 0; this.en -= 10; B.iceSpear(this); }
        if (this.buf.leg && this.en >= 15 && (this.captureCd || 0) <= 0) { this.buf.leg = 0; this.captureCd = 4; if (B.weapons.capture(this)) this.en -= 15; }
      }
      this.captureCd = (this.captureCd || 0) - dt;
      if (this.input.roll) this.buf.dodge = 0.2;   // the AI asks for a roll directly
      if (this.buf.dodge && this.dodgeCd <= 0 && this.free('dodge') && !this.charging) {
        const T = st.tech;
        if ((this.guarding || this.input.roll) && this.onGround && T.roll && this.en >= 6) {
          // GUARD + DODGE: a roll in the stick direction (every element)
          this.buf.dodge = 0; this.endHold(); this.guarding = false; B.guardEnd(this); this.rollDir();
          this.startTech(T.roll, 1, true); this.invuln = 0.45; this.dodgeCd = 0.4; this.guardCd = 0.7;   // the roll is not cut short by the still-held GUARD
        } else if (!this.onGround && T.flip && this.en >= 6 && !(this.el === 'water' && this.en >= 10) && !(this.el === 'fire' && this.pos.y - this.groundY < 1.2 && this.en >= 10)) {   // (Fire just off the floor, e.g. at the end of a glide, glides again)
          // DODGE in the air: a somersault, forward if the stick points ahead, otherwise backward (Water instead slides
          // down on an ice arch, from any height; Fire just off the floor glides again: doDodge)
          this.buf.dodge = 0; this.startTech(this.input.mz * Math.cos(this.faceYaw) + this.input.mx * Math.sin(this.faceYaw) > 0.3 ? T.flip : T.flipBack, 1, true);
          this.vel.y = Math.max(this.vel.y, 4.5); this.invuln = 0.35; this.dodgeCd = 0.35;
        } else if (this.el === 'earth' && this.onGround && this.mobCd <= 0) {
          // Earth: DODGE raises a slab of rock and slides the bender on it; DODGE again steps off
          this.buf.dodge = 0;
          if (this.mob && this.mob.kind === 'surf') { this.endMob(); this.mobCd = 0.3; }
          else if (this.en >= 12 && !this.reacting()) { this.endHold(); this.startMob(); if (this.mob) this.mob.tap = true; }
        } else if (this.el === 'water' && this.mob && this.mob.kind === 'surf') {
          // Water: a DODGE tap while riding the ice steps off it
          this.buf.dodge = 0; this.endMob(); this.mobCd = 0.3;
        } else if (this.en >= 10 && !(this.mob && this.mob.kind === 'surf' && this.el === 'earth')) { this.buf.dodge = 0; this.endHold(); this.doDodge(); }
      }
      // Fire, Earth and Air: JUMP next to a wall while moving runs along it (or, heading straight into it, up it
      // and off in a back somersault). JUMP again during the run kicks off the wall.
      this.wallCd = (this.wallCd || 0) - dt;
      // Earth's slab steered into a wall climbs onto it
      if (!this.wall && this.el === 'earth' && this.mob && this.mob.kind === 'surf' && this.wallCd <= 0) {
        const W = this.wallNear(0.55), hs = Math.hypot(this.vel.x, this.vel.z);
        if (W && hs > 3 && -(this.vel.x * W.n.x + this.vel.z * W.n.z) / hs > 0.2) this.wallStart(W, hs);
      }
      if (this.wall && this.wall.kind === 'surf' && this.buf.dodge) { this.buf.dodge = 0; this.wallOff(true); }
      if (this.wall && this.buf.jump && this.wall.T > 0.15) { this.buf.jump = 0; this.wallOff(); }
      if (this.buf.jump && !this.wall && this.el !== 'water' && this.wallCd <= 0 && this.free('jump') && !this.charging && !this.guarding && !(this.mob && this.mob.kind === 'fly') && this.en >= 8) {
        const W = this.wallNear(this.el === 'earth' && this.mob && this.mob.kind === 'surf' ? 1.4 : 0.9), hs = Math.hypot(this.vel.x, this.vel.z);
        if (W && hs > 3) { this.buf.jump = 0; this.wallStart(W, hs); }
      }
      const gliding = this.dodgeKind === 'glide' && this.dodgeT > 0;
      if (this.buf.jump && (this.free('jump') || gliding) && !this.charging && !this.guarding && (this.onGround || gliding) && !this.mob && this.el === 'air' && this.en > 12 && this.mobCd <= 0) {
        // (from the whirlwind glide, JUMP takes off straight into flight)
        if (gliding) this.dodgeT = 0;
        // Air: JUMP takes off into sustained, steerable flight (JUMP held climbs; it lands when the wind runs out)
        this.buf.jump = 0; this.action = null; this.startMob(); if (this.mob) { this.mob.tap = true; for (const s of ['L', 'R']) B.weapons.footJet(this, 'air', s, { down: true, len: 2.2, dur: 0.4, r: 0.32 }); w.fx.dust(this.pos, 10, 3); }
      }
      if (this.buf.jump && this.free('jump') && !this.charging && !this.guarding && this.onGround && !this.mob && this.el === 'earth') {
        // Earth: the ground thrusts up under the feet and launches the bender straight up (the column stays as a platform)
        // (20 Nov, Earth brief: Earth Launch as a sequence) first the crouch: knees bend, hips drop, arms draw back over
        // the launch spot (0.18 s, launchPrepT); then the column erupts under the feet and drives him up (earthLaunch)
        this.buf.jump = 0; this.action = null; this.launchPrepT = 0.18; this.vel.x *= 0.2; this.vel.z *= 0.2;
      }
      if (this.launchPrepT > 0) {
        this.launchPrepT -= dt; this.vel.x *= 0.5; this.vel.z *= 0.5;
        if (this.launchPrepT <= 0 || !this.onGround) { this.launchPrepT = 0; if (this.onGround && this.el === 'earth') this.earthLaunch(); }
      }
      // JUMP while jet-gliding: the jets throw the bender up out of the glide (hold JUMP to keep the flame jets going)
      if (this.buf.jump && this.dodgeKind === 'rocket' && this.dodgeT > 0 && !this.charging) {
        this.buf.jump = 0; this.dodgeT = 0; this.action = null; this.vel.y = st.jump.v; this.onGround = false; this.highJump = true; this.jetFuel = 1.1; this.jetUsed = false; this.jumpFx(true);
      }
      if (this.buf.jump && this.free('jump') && !this.charging && !this.guarding) {
        if (this.onGround) { this.buf.jump = 0; this.action = null; this.vel.y = st.jump.v; this.onGround = false; this.airJumps = 0; this.jetFuel = 1.1; this.jetUsed = false; this.highJump = false; this.jumpFx(false); }
        else if (this.airJumps < st.jump.air && this.vel.y < 5) { this.buf.jump = 0; this.airJumps++; this.vel.y = 7.2; this.jumpFx(true); }
      }
      // Fire can punch and kick out of its fire wall without dropping it
      const canStrike = this.free('attack') && (!this.guarding || this.el === 'fire') && !this.holding;
      // one buffered strike starts per frame, the earlier press first (more buffer time used up); the other stays
      // queued for the next opening instead of replacing this one in the same frame
      // with both waiting, the opposite of the last strike goes first, so alternating presses (hand, leg, hand, leg)
      // come out alternating even when a slow strike's recovery lets both queue up
      const handFirst = this.buf.hand && (!this.buf.leg || (this.lastStrike ? this.lastStrike === 'leg' : this.buf.hand <= this.buf.leg));
      let struck = false;
      if (this.buf.hand && handFirst && !this.charging && canStrike) {
        struck = true; this.lastStrike = 'hand';
        // (the Air Swipe is chosen while the dodge still runs, before the strike ends it)
        this.airSwipeNow = this.el === 'air' && !!this.airHandTech();
        this.buf.hand = 0; if (this.dodgeKind !== 'rocket' && this.dodgeKind !== 'arch') this.dodgeT = 0;
        if (this.counterT > 0) { this.counterT = 0; this.startAction('counter'); w.combat.lunge(this, ACTIONS.counter); w.popup(this, 'COUNTER', true); w.audio.whoosh(0.9); }
        else if (B.spiralRelease && B.spiralRelease(this)) { w.popup(this, 'RELEASE', true); }
        else { this.handSide = -this.handSide; const riding = this.el === 'water' && st.tech.surfPunch && ((this.dodgeKind === 'arch' && this.dodgeT > 0) || (this.mob && this.mob.kind === 'surf')); this.startTech(riding ? st.tech.surfPunch : (this.el === 'fire' && this.fireHandTech()) || (this.el === 'earth' && this.earthHandTech()) || (this.airSwipeNow && st.tech.airSwipe) || st.tech.hand, this.handSide, true); }
        this.handHoldT = 0;
      }
      // (20 Nov, Earth brief) Earth: LEG while GUARD is held: Slab Shackles (8 s cooldown); LEG with the stick pulled away
      // from the rival: Ground Shift (5 s cooldown)
      if (this.buf.leg && this.el === 'earth' && this.onGround && !this.charging && st.tech.shackles) {
        const t = this.target, inp2 = this.input, sl = Math.hypot(inp2.mx, inp2.mz);
        const away = t && !t.dead && sl > 0.5 && (inp2.mx * (t.pos.x - this.pos.x) + inp2.mz * (t.pos.z - this.pos.z)) / (sl * (Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) || 1)) < -0.5;
        if (this.guarding && inp2.guard && (this.shackleCd || 0) <= this.time && this.en >= st.tech.shackles.cost) { this.buf.leg = 0; this.guarding = false; B.guardEnd(this, true); this.guardCd = 0.4; this.shackleCd = this.time + 8; this.startTech(st.tech.shackles, 1); }
        else if ((away || this.aiShift) && canStrike && (this.shiftCd || 0) <= this.time && this.en >= st.tech.shift.cost) { this.buf.leg = 0; this.shiftCd = this.time + 5; this.startTech(st.tech.shift, this.handSide = -this.handSide, true); }
        this.aiShift = false;
      }
      if (this.buf.leg && !struck && !this.charging && canStrike) {
        this.buf.leg = 0; this.lastStrike = 'leg';
        const jetGlide = (this.dodgeKind === 'rocket' || this.dodgeKind === 'arch') && this.dodgeT > 0 && st.tech.glideBlast;
        if (!jetGlide) this.dodgeT = 0;
        // LEG while jet-gliding (Fire) or riding the ice arch (Water): the legs stay on the jets / the ice, both palms
        // drive a blast (Jet Blast; Ice Volley)
        if (jetGlide) this.startTech(st.tech.glideBlast, this.handSide = -this.handSide, true);
        // high in the air, Water and Fire somersault and smash a wave down on the rival (once per jump)
        else if (!this.onGround && st.tech.airFlip && this.pos.y - this.groundY > 1.0 && !this.airFlipped && !(this.mob && this.mob.kind === 'surf')) { this.airFlipped = true; this.startTech(st.tech.airFlip, 1, true); this.vel.y = Math.max(this.vel.y, 2.5); }
        else if (!this.onGround && (this.pos.y - this.groundY > 0.4 || this.airTime > 0.12) && this.vel.y > -12 && st.tech.airKick && !(this.mob && this.mob.kind === 'surf')) {
          // in the air: a jumping kick, the right foot first, then the left, then the right again
          this.airKickN = (this.airKickN || 0) + 1; this.startTech(st.tech.airKick, this.airKickN % 2 ? -1 : 1, true);
          this.vel.y = Math.max(this.vel.y, this.airKickN < (this.el === 'fire' ? 4 : 3) ? 3.2 : 0);   // the kick lifts a little, so another fits before landing (Fire: four)
        } else if (st.tech.legMove && this.onGround && this.speedNorm > 0.45 && !this.action && this.comboTimer <= 0) {
          // LEG while running: a kick delivered on the move, keeping the run's momentum
          this.comboTimer = 0.9; this.legIdx = -1; this.startTech(st.tech.legMove, 1, true);
        } else {
          this.legIdx = this.comboTimer > 0 ? (this.legIdx + 1) % st.tech.leg.length : 0;
          this.startTech(st.tech.leg[this.legIdx], this.legIdx === 0 ? -1 : 1, true);
          this.comboTimer = Math.max(0.9, (this.tech ? this.tech.dur : 0) + 0.45);   // a long kick (the hurricane) keeps the chain open
        }
        this.legHoldT = 0;
      }
      // icebending: SPECIAL while the water wall is up freezes it into an ice wall (progression flag iceUnlocked)
      if (this.buf.special && this.guarding && this.el === 'water' && this.defense && this.defense.arc && !this.defense.ice && this.iceUnlocked !== false && this.en >= 15) {
        this.buf.special = 0; this.en -= 15; B.freeze(this.defense);
      }
      // SPECIAL while sustaining twin water whips freezes them into ice blades (heavier, knock down, shatter)
      if (this.buf.special && this.holding && this.el === 'water' && this.en >= 10) { const h = B.holds.get(this); if (h && !h.frozen) { this.buf.special = 0; this.en -= 10; h.frozen = true; w.audio.ice("form", 0.9, this.pos); w.popup(this, 'ICE BLADES', true); w.audio.splash(0.8); } }
      // Fire: SPECIAL with GUARD held breathes Dragon's Breath out of the wall (the wall drops)
      if (this.buf.special && this.guarding && inp.guard && this.el === 'fire' && st.tech.breath && this.en >= st.tech.breath.cost && !this.charging) {
        this.buf.special = 0; this.guarding = false; B.guardEnd(this, true); this.guardCd = 0.6; this.startTech(st.tech.breath, 1);
      }
      // (19 Nov, after review: "WHY IS THERE NO DRAGON'S BREATH FOR FIRE STILL?") GUARD + SPECIAL was never found on the
      // phone. SPECIAL on its own now breathes it, standing or walking; Dragon Descent stays on SPECIAL at a run or in the air
      // (19 Nov, phase one) Fire on the floor: SPECIAL tapped breathes Dragon's Breath; held 0.3 s and let go, the Fire
      // Comet (40 energy, 8 s cooldown; without them it breathes instead). The breath waits for the release (at most 0.3 s).
      if (this.el === 'fire' && st.tech.breath) {
        if (this.buf.special && !this.charging && canStrike && this.onGround && this.speedNorm < 0.45 && (this.spT ?? -1) < 0) { this.buf.special = 0; this.spT = 0; }
        if ((this.spT ?? -1) >= 0) {
          if (inp.specialHeld && this.spT < 0.3) { this.spT += dt; if (this.spT >= 0.3) w.popup(this, 'FIRE COMET', false); }
          else {
            const comet = this.spT >= 0.3 && st.tech.comet && this.en >= st.tech.comet.cost && (this.cometCd || 0) <= this.time;
            this.spT = -1;
            if (comet) { this.cometCd = this.time + 8; this.startTech(st.tech.comet, 1); }
            else if (this.en >= st.tech.breath.cost) this.startTech(st.tech.breath, 1);
          }
        }
      }
      // (20 Nov, after review: "the new moves are too hidden ... this is a phone game") Earth's SPECIAL, like Fire's:
      // tapped, the Dust Storm (12 s cooldown); held 0.3 s and let go, Quicksand under the rival (7 s). On cooldown or
      // short of energy it falls back to the Ground Rupture.
      if (this.el === 'earth' && st.tech.storm) {
        if (this.buf.special && !this.charging && canStrike && this.onGround && (this.spT ?? -1) < 0) { this.buf.special = 0; this.spT = 0; }
        if ((this.spT ?? -1) >= 0) {
          const aiHold = this.aiEarthPick === 'quicksand';
          const aiUlt = this.aiEarthPick === 'breaker';
          const lim = aiUlt ? 1.0 : aiHold ? 0.3 : 1.0;
          if ((inp.specialHeld || aiHold || aiUlt) && this.spT < lim) { const was = this.spT; this.spT += dt; if (was < 0.3 && this.spT >= 0.3) w.popup(this, 'QUICKSAND', false); if (was < 1.0 && this.spT >= 1.0) w.popup(this, 'EARTHBREAKER', false); }
          else {
            // (20 Nov) held 1 s: the Earthbreaker (50 energy, 16 s cooldown); 0.3 to 1 s: Quicksand; tapped: the Dust Storm
            const tier = this.spT >= 1.0 && (this.breakerCd || 0) <= this.time && this.en >= st.tech.breaker.cost ? 2 : this.spT >= 0.3 ? 1 : 0;
            this.spT = -1; this.aiEarthPick = undefined;
            const T = [st.tech.storm, st.tech.quicksand, st.tech.breaker][tier], cdKey = ['stormCd', 'sandCd', 'breakerCd'][tier];
            if ((this[cdKey] || 0) <= this.time && this.en >= T.cost) { this[cdKey] = this.time + [12, 7, 16][tier]; this.startTech(T, 1); }
            else if (this.en >= st.tech.special.cost) this.startTech(st.tech.special, this.handSide);
          }
        }
      }
      // (20 Nov, added Air skills) Air on the floor: SPECIAL tapped is the Tornado as before; held 0.3 s and let go, the Air
      // Bomb (4 s cooldown); (21 Nov) held 1 s and let go, the Air Vortex (45 energy, 12 s cooldown). Without the energy
      // or on cooldown it falls back a step. The Tornado waits for the release.
      if (this.el === 'air' && st.tech.airBomb && !this.guarding) {
        if (this.buf.special && !this.charging && canStrike && this.onGround && (this.spT ?? -1) < 0) { this.buf.special = 0; this.spT = 0; }
        if ((this.spT ?? -1) >= 0) {
          if (inp.specialHeld && this.spT < 1.0) { const was = this.spT; this.spT += dt; if (was < 0.3 && this.spT >= 0.3) w.popup(this, 'AIR BOMB', false); if (was < 1.0 && this.spT >= 1.0) w.popup(this, 'AIR VORTEX', false); }
          else {
            const vortex = this.spT >= 1.0 && this.en >= st.tech.airVortex.cost && (this.vortexCd || 0) <= this.time;
            const bomb = !vortex && this.spT >= 0.3 && this.en >= st.tech.airBomb.cost && (this.bombCd || 0) <= this.time;
            this.spT = -1;
            if (vortex) { this.vortexCd = this.time + 12; this.startTech(st.tech.airVortex, 1); }
            else if (bomb) { this.bombCd = this.time + 4; this.startTech(st.tech.airBomb, 1); }
            else if (this.en >= st.tech.special.cost) this.startTech(st.tech.special, this.handSide);
          }
        }
      }
      if (this.buf.special && !this.charging && canStrike) { this.buf.special = 0; this.startTech(st.tech.special, this.handSide); }

      // HAND held -> sustained technique (stream / lift / draw / push)
      if (this.handHoldT >= 0) {
        if (!inp.handHeld) { this.handHoldT = -1; if (this.holding && this.el === 'earth') this.compRelease = true; this.endHold(); }
        else {
          this.handHoldT += dt;
          // a held HAND turns into the sustained technique straight away: a punch that has not landed yet is abandoned
          const T = this.tech, ev = T && T.events && T.events.length ? T.events[0][0] : 0.3;
          const ready = !this.action || (this.action === 'tech' && (T === st.tech.hand || T.variantOf === st.tech.hand) && (this.actionU < ev || this.actionU > (T.cancel || 0.6)));
          if (!this.holding && this.handHoldT > 0.3 && ready && !this.guarding && !this.reacting()) {
            this.holding = true; this.holdPh = 0; this.action = null; this.tech = null; B.holdStart(this);
          }
        }
      }
      if (this.holding) {
        this.holdPh = (this.holdPh + dt / st.tech.handHold.period) % 1;
        this.en -= st.tech.handHold.drain * dt;
        B.holdTick(this, dt);
        if (this.en <= 0 || !B.holds.has(this)) this.endHold();
      }
      // LEG held -> gather force, release for the element's charged technique
      if (this.legHoldT >= 0) {
        if (!inp.legHeld) {
          if (this.charging) { this.charging = false; if (this.chargeT >= 0.3 && this.legHoldT >= 0.85) this.startTech(st.tech.stomp && this.onGround ? st.tech.stomp : st.tech.charged, 1); }   // judged on the whole hold, so a kick's hit-stop cannot eat it
          this.legHoldT = -1;
        } else {
          this.legHoldT += dt;
          // a held LEG starts gathering force straight away: a kick that has not landed yet is abandoned
          const K = this.tech, kev = K && K.events && K.events.length ? K.events[0][0] : 0.3;
          const kickDone = !this.action || (this.action === 'tech' && (this.actionU < kev || this.actionU > Math.min(0.6, K.cancel ?? 0.6)));
          // Fire in the air: LEG held is the Fire Bomb: drive down feet first, explode on landing (the tap kick is dropped)
          if (this.el === 'fire' && st.tech.bomb && !this.onGround && !this.bombDive && this.legHoldT > 0.18 && this.pos.y - this.groundY > 0.35 && this.en >= st.tech.bomb.cost && !this.reacting()) {
            this.legHoldT = -1; this.action = null; this.tech = null; this.startTech(st.tech.bomb, 1); this.bombDive = true;
            const t = this.target, to = t && !t.dead ? _v.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z) : null;
            this.vel.y = -24; if (to && to.length() < 9) { this.vel.x = to.x * 2; this.vel.z = to.z * 2; } else { this.vel.x *= 0.3; this.vel.z *= 0.3; }
            this.dodgeT = 0; this.jetFuel = 0;
          }
          // (20 Nov) Earth in the air: LEG held drives him down feet first and the Ground Rupture bursts out where he lands
          if (this.el === 'earth' && !this.onGround && !this.bombDive && this.legHoldT > 0.18 && this.pos.y - this.groundY > 0.6 && this.en >= st.tech.special.cost && !this.reacting()) {
            this.legHoldT = -1; this.action = null; this.tech = null; this.bombDive = true; this.earthSlam = true; this.vel.y = -24; this.vel.x *= 0.3; this.vel.z *= 0.3; this.dodgeT = 0;
          }
          // Fire: LEG held is the stomp, straight away (the tap kick is dropped if it has not landed yet)
          if (this.el === 'fire' && st.tech.stomp && this.onGround && !this.mob && this.legHoldT > 0.3 && !this.charging && !this.guarding && !this.reacting() && (!this.action || this.action === 'land' || (this.action === 'tech' && this.tech !== st.tech.stomp && this.actionU < kev))) {
            this.legHoldT = -1; this.action = null; this.tech = null; this.startTech(st.tech.stomp, 1);
          }
          else if (!this.charging && this.legHoldT > 0.38 && kickDone && !this.guarding && !this.reacting()) { this.charging = true; this.chargeT = 0; this.action = null; this.tech = null; }
        }
      }
      if (this.charging) {
        this.chargeT += dt;
        if (this.stunT > 0 || this.reacting() || this.dodgeT > 0) { this.charging = false; this.legHoldT = -1; }
        // on the ground a full charge stamps at once (Earth and Fire stomps), without waiting for LEG to be let go
        // (M6) Earth's eruption is marked under the rival: while LEG is held it waits until the rival is out of a hit
        // reaction, so the marked ground can be read and left (letting go of LEG still stamps at once)
        else if (st.tech.stomp && this.onGround && this.chargeT >= 0.4 && this.legHoldT >= 0.7 && !(this.el === 'earth' && this.target && !this.target.dead && this.target.reacting() && this.legHoldT < 2.5)) { this.charging = false; this.legHoldT = -1; this.startTech(st.tech.stomp, 1); }
        else if (Math.random() < dt * 16) this.chargeFx();
      }
      // GUARD: the element's defence
      if (inp.guard && !this.guarding && this.guardCd <= 0 && this.en > 5 && !this.charging && (this.free('guard') || this.action === 'tech')) {
        if (this.action && !(this.A && this.A.soft)) { this.action = null; this.tech = null; }
        this.endHold();
        this.guarding = true; this.guardT = 0; B.guardStart(this);
      }
    }
    if (this.guarding && (!inp.guard || this.dead || this.en <= 0 || this.stunT > 0 || this.reacting() || restrained)) {
      this.guarding = false; this.guardCd = 0.25; B.guardEnd(this);
    }
    if ((this.dead || this.stunT > 0 || this.reacting() || restrained) && this.holding) this.endHold();

    // ---- energy / stamina
    let mx = live && !restrained ? inp.mx : 0, mz = live && !restrained ? inp.mz : 0;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; }
    this.sprinting = live && inp.sprint && mlen > 0.85 && this.onGround && !this.guarding && !this.holding && !this.charging && !this.action && this.en > 2;
    if (this.guarding) this.en -= 8 * dt;
    else if (this.sprinting) this.en -= 7 * dt;
    else if (!this.holding && !this.charging && !this.jetting) this.en += (this.onGround ? 20 : 10) * dt;
    this.en = clamp(this.en, 0, this.maxEn);

    // ---- movement
    const L = st.loco;
    let maxSpeed = this.sprinting ? L.sprint : L.run;
    if (this.guarding) maxSpeed = 2.4;
    else if (this.charging) maxSpeed = 1.6;
    else if (this.holding) maxSpeed = st.tech.handHold.move;
    const A = this.A;
    if (A && !A.soft) maxSpeed = A.react ? 0 : (A.move !== undefined ? A.move : (A.upper ? 3.5 : 0.5));
    // on the ground a strike is delivered from planted feet: at most a shuffle (the running kick, whose clip steps
    // forward, keeps its own speed)
    if (A && !A.soft && !A.react && this.onGround && !this.mob && !(this.tech && this.tech.travels)) maxSpeed = Math.min(maxSpeed, 1.0);
    if (this.stunT > 0 || restrained) maxSpeed = 0;
    if (this.launchPrepT > 0) maxSpeed = 0;   // (crouched for the Earth Launch)
    if (this.armour) maxSpeed *= 0.8;   // (20 Nov) the weight of the Rock Armour

    if (this.mob && this.mobMove(dt, mx, mz)) {
      // velocity set by the element's mobility
    } else if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const k = smooth01(this.dodgeT / this.dodgeDur), D = st.dodge;
      if (this.dodgeKind === 'glide') {
        // Air: a two-second glide inside the whirlwind, held about 0.7 m off the floor, fast at first and easing;
        // the stick steers it
        if (Math.hypot(mx, mz) > 0.3) { const l = Math.hypot(mx, mz), kk = 1 - Math.exp(-3 * dt); this.dodgeDir.x += (mx / l - this.dodgeDir.x) * kk; this.dodgeDir.z += (mz / l - this.dodgeDir.z) * kk; const n = Math.hypot(this.dodgeDir.x, this.dodgeDir.z) || 1; this.dodgeDir.x /= n; this.dodgeDir.z /= n; }
        const gsp = 4 + 9 * k;
        this.vel.x = this.dodgeDir.x * gsp; this.vel.z = this.dodgeDir.z * gsp;
        this.vel.y = (0.7 - (this.pos.y - this.groundY)) * 6 + 21 * dt; this.onGround = false;
      } else if (this.dodgeKind === 'flip') {
        // Air's corkscrew / cartwheel: along the stick (or the clip's path), fastest at the start, a small hop
        const u = 1 - this.dodgeT / this.dodgeDur, fsp = this.flipSpeed * 2 * (1 - u);   // fastest at the start: a dodge gets away first
        this.vel.x = this.dodgeDir.x * fsp; this.vel.z = this.dodgeDir.z * fsp;
        if (u < 0.15 && this.onGround) { this.vel.y = 3.2; this.onGround = false; }
      } else if (this.dodgeKind === 'arch') {
        // Water's ice arch: ice shoots up under the feet and the bender surfs along it, up and to the side, then down
        // (from high on the water column, down and across to the floor); the stick steers; strikes go on over it
        if (Math.hypot(mx, mz) > 0.3) { const l = Math.hypot(mx, mz), kk = 1 - Math.exp(-4 * dt); this.dodgeDir.x += (mx / l - this.dodgeDir.x) * kk; this.dodgeDir.z += (mz / l - this.dodgeDir.z) * kk; const n = Math.hypot(this.dodgeDir.x, this.dodgeDir.z) || 1; this.dodgeDir.x /= n; this.dodgeDir.z /= n; }
        const u = 1 - this.dodgeT / this.dodgeDur, asp = 7 + 6 * k;
        this.vel.x = this.dodgeDir.x * asp; this.vel.z = this.dodgeDir.z * asp;
        const h = (this.archH0 || 0) * (1 - smooth01(u)) + ARCH_H * Math.sin(Math.PI * Math.min(1, u * 1.05));
        this.vel.y = (h - (this.pos.y - this.groundY)) * 10 + 21 * dt; this.onGround = false;
        B.weapons.archTick(this, Math.max(0, h - 0.02), dt);
      } else if (this.dodgeKind === 'rocket') {
        // Fire's jet glide: the bender rides the flames from the soles like a board, half a metre off the floor, legs
        // locked in the riding stance (hero.js), driven fast at first and easing; the stick steers it like a board
        // carving, and punches / blasts go on over it
        if (Math.hypot(mx, mz) > 0.3) { const l = Math.hypot(mx, mz), kk = 1 - Math.exp(-4 * dt); this.dodgeDir.x += (mx / l - this.dodgeDir.x) * kk; this.dodgeDir.z += (mz / l - this.dodgeDir.z) * kk; const n = Math.hypot(this.dodgeDir.x, this.dodgeDir.z) || 1; this.dodgeDir.x /= n; this.dodgeDir.z /= n; }
        // (18 Nov, after review) held DODGE keeps the glide going, steered by the stick, for as long as it is held and
        // there is energy; the flames carry the bender higher (about 1.2 m); let go, it eases down over 0.3 s
        const el = this.dodgeDur - this.dodgeT, held = this.input.dodgeHeld && this.en > 1 && el > 0.2;
        if (held) { this.dodgeT = Math.max(this.dodgeT, 0.3); this.en -= 9 * dt; this.glideHeld = true; }
        const rsp = held || this.glideHeld ? Math.max(9, 6 + 12 * k) : 6 + 12 * k;
        this.vel.x = this.dodgeDir.x * rsp; this.vel.z = this.dodgeDir.z * rsp;
        const hov = 1.36 * Math.min(1, el / 0.2) * Math.min(1, this.dodgeT / 0.3);   // (20 Nov: 1.36 m, so the trailing foot of the held Running Arc stance clears the floor by half a metre)
        this.vel.y = (hov - (this.pos.y - this.groundY)) * 8 + 21 * dt; this.onGround = false;
        // the jets: rocket exhaust from both feet and both hands, driven against the direction of travel (fireJets)
      } else {
      const sp = this.dodgeKind === 'side' ? 2 + (this.el === 'air' ? 19 : 13) * k : this.dodgeKind === 'back' ? 2 + 10 * k : 2.5 + (D.speed - 2.5) * k;
      this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
      }
      const tg = this.target;
      if (this.dodgeKind === 'circle' && tg) {
        // move along the circle around the opponent (about 110 degrees over the dodge), facing them throughout
        const ang = Math.atan2(this.pos.x - tg.pos.x, this.pos.z - tg.pos.z) + this.circleDir * (1.9 / this.dodgeDur) * dt * (0.4 + 1.2 * k);
        const nx = tg.pos.x + Math.sin(ang) * this.circleR, nz = tg.pos.z + Math.cos(ang) * this.circleR;
        this.vel.x = (nx - this.pos.x) / dt; this.vel.z = (nz - this.pos.z) / dt;
        const l = Math.hypot(this.vel.x, this.vel.z) || 1; this.dodgeDir.set(this.vel.x / l, 0, this.vel.z / l);
        this.faceYaw = Math.atan2(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z);
      }
      if (this.dodgeKind === 'back' && this.dodgeT > this.dodgeDur * 0.5 && this.onGround) { this.vel.y = 2.6; this.onGround = false; }
      if (this.dodgeKind === 'airdash' && this.dodgeT > this.dodgeDur * 0.6) this.vel.y = Math.max(this.vel.y, 1.2);
      this.dodgeTrail();
    } else if (this.wall) {
      this.wallTick(dt);
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.vel.x = this.lungeDir.x; this.vel.z = this.lungeDir.z;
    } else {
      // on foot, facing the opponent: backing away and side-stepping are slower than running forward, so the
      // authored backpedal and strafe clips play near their captured pace instead of skating
      if (this.onGround && !this.mob) {
        const fc = mx * Math.sin(this.faceYaw) + mz * Math.cos(this.faceYaw), lc = mx * Math.cos(this.faceYaw) - mz * Math.sin(this.faceYaw);
        maxSpeed *= (1 - 0.45 * clamp(-fc, 0, 1)) * (1 - 0.2 * clamp(Math.abs(lc), 0, 1));
      }
      const tx = mx * maxSpeed, tz = mz * maxSpeed;
      const wantMove = tx * tx + tz * tz > 0.01;
      const accel = this.onGround ? (wantMove ? (this.sprinting ? L.accel * 0.6 : L.accel) : (this.reacting() ? 9 : L.accel * 0.8)) : (this.el === 'air' ? 16 : 10);
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz), step = accel * dt;
      if (dl <= step || dl < 1e-6) { this.vel.x = tx; this.vel.z = tz; }
      else { this.vel.x += dx / dl * step; this.vel.z += dz / dl * step; }
    }
    // firebenders: holding JUMP after take-off drives flame jets from the feet. The thrust is real upward force
    // (it beats gravity for up to ~1 s), costs energy, steers in the air, and scorches whoever is underneath.
    this.jetting = false;
    // waterbenders: the same hold raises a column of water under the feet, strong near the ground and weaker
    // the higher it has to reach (it needs to stay connected to the ground)
    const alt = this.pos.y - this.groundY;
    // (M9: the water wraps round the body as well as under the feet, and lifts the bender higher: up to about 6.5 m;
    //  from up there DODGE slides down on an ice arch and strikes go on over it)
    if (this.el === 'water' && live && !restrained && !this.onGround && inp.jumpHeld && this.jetFuel > 0 && this.en > 1 && this.dodgeT <= 0 && !this.mob && !(this.A && this.A.react) && alt < 6.5) {
      this.jetting = true; this.waterJetT = (this.waterJetT || 0) + dt; if (this.waterJetT > 0.12) this.highJump = true; this.jetFuel -= dt * 0.7; this.en -= 20 * dt;   // (a quick tap of JUMP stays an ordinary jump)
      this.vel.y = Math.min(this.vel.y + 34 * (1 - alt / 7) * dt, 6.5);
      this.vel.x += mx * 10 * dt; this.vel.z += mz * 10 * dt;
      B.weapons.selfColumn(this, alt);
    } else if (this.el === 'water') B.weapons.selfColumn(this, -1);
    // (20 Nov, after review: "the jump should last longer ... not as long as Air, but a little longer") a tap keeps the
    // heel jets burning for 0.5 s after take-off on its own (autoJetT), and holding JUMP has 1.1 s of fuel (was 0.8 s)
    this.autoJetT = Math.max(0, (this.autoJetT || 0) - dt);
    if (this.el === 'fire' && live && !restrained && !this.onGround && (inp.jumpHeld || this.autoJetT > 0) && this.jetFuel > 0 && this.en > 1 && this.dodgeT <= 0 && !(this.A && this.A.react)) {
      this.jetting = true; this.jetUsed = true; this.highJump = true;
      this.jetFuel -= dt; this.en -= 32 * dt;
      this.vel.y = Math.min(this.vel.y + 30 * dt, 4.6);
      this.vel.x += mx * 14 * dt; this.vel.z += mz * 14 * dt;
      const hs = Math.hypot(this.vel.x, this.vel.z); if (hs > 7.5) { this.vel.x *= 7.5 / hs; this.vel.z *= 7.5 / hs; }
      this.jetBurstT = Math.max(this.jetBurstT || 0, 0.05);   // the jets burn while JUMP is held (fireJets)
      this.jetTick = (this.jetTick || 0) - dt;
      if (this.jetTick <= 0) {
        this.jetTick = 0.2; w.audio.fireWhoosh(0.35);
        for (const t of w.fighters) if (t !== this && !t.dead && t.invuln <= 0 && Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < 1.2 && t.pos.y < this.pos.y - 0.4 && this.pos.y - t.pos.y < 3.2)
          w.combat.damage(t, 3, _v.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize(), this, 'jet', t.chestPos(new THREE.Vector3()), 2, 0);
      }
    }
    // airbenders fall more slowly while holding JUMP after the peak (air-assisted glide)
    const glide = this.el === 'air' && !this.onGround && inp.jumpHeld && this.vel.y < 0;
    const flying = this.mob && this.mob.kind === 'fly';
    if (!flying && !this.wall) this.vel.y -= (glide ? 7 : 21) * dt;
    if (glide && Math.random() < dt * 20) w.fx.wind(this.pos.clone().setY(this.pos.y + 0.2), _v.set(rand(-1, 1), -2, rand(-1, 1)), 0.5, 0.4);
    this.pos.addScaledVector(this.vel, dt);
    if (this.ext.lengthSq() > 1e-4) { this.pos.addScaledVector(this.ext, dt); this.ext.multiplyScalar(Math.exp(-(this.onGround ? 4 : 1.5) * dt)); } else this.ext.set(0, 0, 0);

    w.arena.collide(this);
    // surfing rides on a raised slab or ice sheet: the bender is carried that far above the floor
    const lift = this.mob && this.mob.kind === 'surf' ? (MOBILITY[this.mob.el].lift || 0) * Math.min(1, this.mob.t / 0.2) : 0;
    const gy = w.arena.groundAt(this.pos.x, this.pos.z, this.pos.y - lift) + lift;
    if (this.pos.y <= gy + 0.001) {
      if (!this.onGround && this.airTime > 0.28 && (!this.A || this.A.soft) && this.dodgeT <= 0 && !flying) { this.startAction(this.highJump && this.airTime > 0.5 ? 'landHigh' : 'land'); w.fx.dust(this.pos, this.highJump ? 12 : 6, 1.4); w.audio.land(this.highJump ? 1 : 0.6, this.pos); }
      if (!this.onGround && this.highJump && this.el === 'earth' && this.airTime > 0.5 && !this.dead) { B.weapons.burst.spawn(this.pos.x, gy, this.pos.z, 0.3); w.shake(0.2, this.pos); w.audio.rumble(0.7); }   // heavy earth landing cracks the ground
      if (!this.onGround) { this.highJump = false; this.jetFuel = 1.1; }
      if (!this.onGround && this.jetUsed && this.el === 'fire' && !this.dead) {
        // a jet landing: the flames hit the ground and burst outward
        this.jetUsed = false; B.ring(this, 'fire', 2.4, 9, { dmg: 6, knock: 6, level: 1 }); w.shake(0.12, this.pos); w.audio.fireWhoosh(0.9);
      }
      this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; this.airTime = 0; this.airJumps = 0; this.airKickN = 0; this.waterJetT = 0; this.airFlipped = false;
    } else if (this.pos.y > gy + 0.03) {
      if (this.onGround && this.vel.y <= 0 && this.pos.y - gy < 0.5) { this.pos.y = gy; this.vel.y = 0; }
      else { this.onGround = false; this.airTime += dt; }
    } else this.pos.y = gy;
    this.groundY = gy - lift;   // the real floor (a surf slab lifts the bender above it)

    // ---- facing
    let wantYaw = null;
    if (this.dead || this.reacting() || restrained) wantYaw = null;
    else if (this.lungeT > 0) wantYaw = Math.atan2(this.lungeDir.x, this.lungeDir.z);
    else if (this.sprinting && mlen > 0.15) wantYaw = Math.atan2(mx, mz);
    else if (inp.strafe || this.guarding || this.holding || this.charging || (this.action && this.action !== 'land')) wantYaw = inp.faceYaw;
    else if (mlen > 0.15 && this.dodgeT <= 0) wantYaw = Math.atan2(mx, mz);
    // (20 Nov, after review: the dash is a flight, not a sidestep) in Fire's rocket dodge the body turns to the way the
    // jets carry it and dives into it; a strike thrown on the way turns him back to the rival (inp.faceYaw above)
    if (!this.dead && this.dodgeKind === 'rocket' && this.dodgeT > 0 && this.action !== 'tech') wantYaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    if (wantYaw !== null && wantYaw !== undefined && (this.dodgeT <= 0 || this.dodgeKind === 'glide' || this.dodgeKind === 'rocket' || this.dodgeKind === 'arch')) {   // (the glide keeps turning to face the rival)
      const rate = this.action && this.action !== 'land' ? 18 : (inp.strafe ? 14 : (this.sprinting ? 7 : 11));
      this.faceYaw = dampAngle(this.faceYaw, wantYaw, rate, dt);
    }
    this.yaw = this.faceYaw + this.spinYaw;

    // ---- motion analysis for animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speedNorm = clamp(sp / 6.6, 0, 1.6);
    const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
    if (sp > 0.05) this.moveLocal.set((this.vel.x * c - this.vel.z * s) / sp, (this.vel.x * s + this.vel.z * c) / sp);
    const yawRate = angleDiff(this.prevFace, this.faceYaw) / dt; this.prevFace = this.faceYaw;
    const ax = (this.vel.x - this.prevVel.x) / dt, az = (this.vel.z - this.prevVel.z) / dt; this.prevVel.copy(this.vel);
    const kk = 1 - Math.exp(-8 * dt);
    this.bank += (clamp(-yawRate * this.speedNorm * 0.07, -0.32, 0.32) - this.bank) * kk;
    this.accLean += (clamp((ax * s + az * c) * 0.012, -0.28, 0.2) - this.accLean) * kk;
    const stride = (1.5 + 1.1 * Math.min(this.speedNorm, 1.4)) * L.stride;
    const prevPh = this.runPhase;
    this.runPhase += sp * dt * (Math.PI * 2 / stride);
    if (this.onGround && !this.mob && sp > 1.2 && Math.floor(prevPh / Math.PI) !== Math.floor(this.runPhase / Math.PI)) w.audio.step(Math.min(1, sp / 7) * L.heavy, this.pos);

    this.animate(dt);
    this.root.position.copy(this.pos);
    if (this.sinkY || this.sandSink) this.root.position.y -= (this.sinkY || 0) + (this.sandSink || 0);   // (20 Nov) pulled into the ground (Earth Sinking, Quicksand)
    if (this.blindT > 0) this.blindT -= dt;
    this.root.rotation.set(0, this.yaw, 0);
    // on a wall the whole body tips over so the feet meet the face: sideways for a run along it, backwards for a
    // run up it (eased in and out)
    const W = this.wall, wantRoll = W && (W.kind === 'run' || W.kind === 'surf') ? W.side * (W.kind === 'surf' ? 1.35 : 0.95) * Math.min(1, W.T / 0.12) : 0, wantPitch = W && W.kind === 'up' ? -0.8 * Math.min(1, W.T / 0.12) : 0;
    // rocket dodge: the jets at the feet push the body sideways, so the upper body leans away from the travel (about
    // 14 degrees, in and out with the thrust) while the stance holds
    let rocketRoll = 0, rocketPitch = 0;
    // (20 Nov) Earth riding its slab: the body leans into the slab's acceleration (forward as it speeds up, back as it
    // slows) and banks into turns, so the held stance reads as balancing on moving rock rather than standing still
    if (this.el === 'earth' && this.mob && this.mob.kind === 'surf' && this.onGround) {
      const m = this.mob, acc = (m.speed - (m.prevSpeed ?? m.speed)) / Math.max(dt, 1e-3), turn = angleDiff(m.prevHeading ?? m.heading, m.heading) / Math.max(dt, 1e-3);
      m.prevSpeed = m.speed; m.prevHeading = m.heading;
      const k = 1 - Math.exp(-5 * dt);
      this.surfPitch = (this.surfPitch || 0) + (clamp(0.06 + acc * 0.012, -0.12, 0.22) - (this.surfPitch || 0)) * k;
      this.surfRoll = (this.surfRoll || 0) + (clamp(-turn * 0.12, -0.25, 0.25) - (this.surfRoll || 0)) * k;
      rocketPitch += this.surfPitch; rocketRoll += this.surfRoll;
    } else { this.surfPitch = 0; this.surfRoll = 0; }
    if (this.dodgeKind === 'rocket' && this.dodgeT > 0) {
      const lx = this.dodgeDir.x * Math.cos(this.yaw) - this.dodgeDir.z * Math.sin(this.yaw);   // + : towards the fighter's left
      // (19 Nov, after review: "he simply just leans a little ... I want it like he is fleeing from the attack") the body
      // is thrown into the direction of flight, about 35 degrees to the side (back if he flees backwards), with a jolt
      // over the first 0.15 s as the jets fire, settling to about 28 degrees while the glide holds
      const lz = this.dodgeDir.x * Math.sin(this.yaw) + this.dodgeDir.z * Math.cos(this.yaw), el = this.dodgeDur - this.dodgeT;
      const jolt = el < 0.15 ? 0.7 + 0.4 * Math.sin(Math.PI * el / 0.15) : 0.8, ease = Math.min(1, this.dodgeT / 0.25);
      // (19 Nov, the user's dodge picture: thrown low and forward into the dash) the body also pitches forward over the
      // feet whatever the direction, so he dives into the escape
      // (20 Nov) facing the travel now, the held Running Arc frame already leans the chest forward; the root adds a
      // slight forward pitch with the jolt of the jets, and banks a little only while a strike keeps him side-on
      rocketRoll = this.action === 'tech' ? Math.sign(lx || 1) * 0.25 * jolt * ease * Math.min(1, Math.abs(lx) * 1.4) : 0;
      rocketPitch = (this.action === 'tech' ? lz * 0.2 + 0.1 : 0.14) * jolt * ease;
    }
    const kw = 1 - Math.exp(-14 * dt);
    this.wallRoll = (this.wallRoll || 0) + (wantRoll + rocketRoll - (this.wallRoll || 0)) * kw; this.wallPitch = (this.wallPitch || 0) + (wantPitch + rocketPitch - (this.wallPitch || 0)) * kw;
    if (Math.abs(this.wallRoll) > 1e-3 || Math.abs(this.wallPitch) > 1e-3) {
      this.root.quaternion.setFromAxisAngle(_up, this.yaw).multiply(_qw.setFromAxisAngle(_zx.set(0, 0, 1), this.wallRoll)).multiply(_qw.setFromAxisAngle(_zx.set(1, 0, 0), this.wallPitch));
    }
    if (this.hero) { this.root.updateMatrixWorld(true); this.hero.drive(this, dt); this.floorGuard(dt); this.lookAtFoe(dt); }
    this.fireJets(dt);
    this.recLimbs();
    const f = this.flash, ch = this.charging ? Math.min(1, this.chargeT / 0.55) * (0.15 + 0.1 * Math.sin(this.time * 30)) : 0;
    const ec = new THREE.Color(this.style.color);
    this.material.emissive.setRGB(f * 0.9 + ch * ec.r, f * 0.25 + ch * ec.g, f * 0.15 + ch * ec.b);
  }

  // The eyes stay on the rival (18 Nov, after review: in some clips, the boxer's stance and mid-combat turns, the head
  // looked off to the side). After the clip is applied, the neck and head are turned together towards the rival, at
  // most 70 degrees and up / down 25, smoothed; off while down, getting up or knocked out.
  lookAtFoe(dt) {
    const h = this.hero, t = this.target, head = h && h.bones['DEF-head'], neck = h && h.bones['DEF-neck'];
    const on = !!(head && neck && t && !t.dead && !this.dead && this.action !== 'down' && this.action !== 'getup' && !(this.restrainT > 0));
    this.lookW = (this.lookW || 0) + ((on ? 1 : 0) - (this.lookW || 0)) * (1 - Math.exp(-8 * dt));
    if (!head || !neck || this.lookW < 0.02 || !t || (typeof window !== 'undefined' && window.__noLook)) return;   // (__noLook: tests compare with it off)
    // the head's own forward axis, from the bind pose (the model is bound facing +Z)
    if (!h._headFwd) { const sk = h.meshes[0].skeleton, i = sk.bones.indexOf(head); const bw = new THREE.Matrix4().copy(sk.boneInverses[i]).invert(); h._headFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(bw).invert()).normalize(); }
    head.updateWorldMatrix(true, false);
    const hq = head.getWorldQuaternion(_qa), hp = head.getWorldPosition(_va);
    const cur = _vb.copy(h._headFwd).applyQuaternion(hq), want = t.chestPos(_vc).setY(t.pos.y + 1.55).sub(hp).normalize();
    // limit: yaw 70 degrees either side of where the head already looks, pitch 25 degrees
    const yc = Math.atan2(cur.x, cur.z), yw = Math.atan2(want.x, want.z), dy = clamp(Math.atan2(Math.sin(yw - yc), Math.cos(yw - yc)), -1.22, 1.22);
    const pc = Math.asin(clamp(cur.y, -1, 1)), pw = Math.asin(clamp(want.y, -1, 1)), dp = clamp(pw - pc, -0.44, 0.44);
    const yawQ = _qb.setFromAxisAngle(_up, dy * this.lookW);
    const side = _vd.set(Math.cos(yc + dy), 0, -Math.sin(yc + dy));   // pitch about the turned head's sideways axis
    const full = _qc.setFromAxisAngle(side, -dp * this.lookW).multiply(yawQ);
    // shared between neck (40 %) and head (60 %), each as a world-space turn converted into the bone's parent space
    for (const [b, k] of [[neck, 0.4], [head, 0.6]]) {
      const part = _qd.identity().slerp(full, k), pw0 = b.parent.getWorldQuaternion(_qe), bw = _qf.copy(pw0).multiply(b.quaternion);
      b.quaternion.copy(pw0.invert().multiply(part.multiply(bw))); b.updateWorldMatrix(false, true);
    }
  }
  // Nothing sinks into the floor: the captured falls, get-ups and floor moves were recorded on other bodies, and on ours
  // their lowest points went up to half a metre below the floor (measured joint by joint). Each frame, if any joint
  // of the body is lower than the floor plus the thickness of a limb, the whole body is raised by the difference
  // (quickly up, slowly back down, so the correction itself never jumps).
  floorGuard(dt) {
    const h = this.hero, sc = h && h.scene; if (!sc) return;
    sc.position.y = this.floorLift || 0; sc.updateMatrixWorld(true);
    const floor = this.groundY + 0.06 - (this.sinkY || 0) - (this.sandSink || 0); let mn = Infinity;   // (20 Nov: sinking in Earth Sinking / Quicksand, the floor that the body is kept above goes down with it)   // a joint is about a limb's half-thickness inside the skin
    if (!h._guardBones) h._guardBones = Object.keys(h.bones).filter(k => /^DEF-/.test(k) && !/foot|toe|heel/i.test(k)).map(k => h.bones[k]);   // body joints only (the rig's root sits on the floor; feet stand on it)
    for (const b of h._guardBones) { const e = b.matrixWorld.elements; if (e[13] < mn) mn = e[13]; }
    const need = (this.pos.y - this.groundY < 0.6) ? Math.max(0, (this.floorLift || 0) + floor - mn) : 0;
    const cur = this.floorLift || 0, k = need > cur ? 1 : 1 - Math.exp(-6 * dt);   // up at once, back down gently
    this.floorLift = cur + (need - cur) * k;
    sc.position.y = this.floorLift; sc.updateMatrixWorld(true);
  }
  endHold() { if (this.holding) { this.holding = false; this.world.bending.holdEnd(this); } }

  // ------------------------------------------------------------ elemental mobility
  startMob() {
    const el = this.el, w = this.world, sp = Math.hypot(this.vel.x, this.vel.z);
    if (el === 'air') {
      this.mob = { kind: 'fly', el, t: 0, fuel: MOBILITY.fly.duration };
      this.vel.y = Math.max(this.vel.y, MOBILITY.fly.takeoff); this.onGround = false; this.dodgeT = 0;
      w.fx.ring(this.pos, 2.2, 0xffffff, 0.4); for (let i = 0; i < 12; i++) w.fx.wind(this.pos.clone().setY(this.pos.y + 0.1), _v.set(rand(-4, 4), rand(1, 4), rand(-4, 4)), 0.6, 0.4);
      w.audio.gust(1.1); w.popup(this, 'FLIGHT', false); return;
    }
    // (Fire may go straight from the rocket dodge, a little off the floor, into the flame run; Water from its ice arch
    //  into the ice surf, when DODGE is held)
    if (!this.onGround && !((el === 'fire' && this.dodgeKind === 'rocket' || el === 'water' && this.dodgeKind === 'arch') && this.dodgeT > 0)) return;
    const heading = sp > 1 ? Math.atan2(this.vel.x, this.vel.z) : this.faceYaw;
    if (el === 'fire') { this.mob = { kind: 'flame', el, t: 0, heading, speed: Math.max(sp, 6) }; this.dodgeT = 0; w.audio.fireWhoosh(1); return; }
    this.mob = { kind: 'surf', el, t: 0, speed: Math.max(sp, 4), heading }; this.dodgeT = 0; this.en -= 6;
    w.popup(this, el === 'water' ? 'ICE SURF' : 'ROCK SURF', false);
    if (el === 'water') { w.fx.splash(this.pos, 14); w.audio.splash(0.8); } else { w.fx.debrisBurst(this.pos.clone().setY(this.pos.y + 0.1), 14, 3, 0.1, 0x7a6a58); w.audio.rumble(0.8); }
  }
  // ------------------------------------------------------------ wall running
  // nearest wall face within reach: the arena's perimeter walls and any tall box or rock (top at least 1.8 m above
  // the feet). Returns { n: outward normal, d: distance from the body's centre to the face }
  wallNear(reach) {
    const p = this.pos, r = this.radius, lim = HALF;
    let best = null;
    const take = (nx, nz, d) => { if (d - r < reach && (!best || d < best.d)) best = { n: new THREE.Vector3(nx, 0, nz), d }; };
    take(-1, 0, lim - p.x); take(1, 0, p.x + lim); take(0, -1, lim - p.z); take(0, 1, p.z + lim);
    for (const c of this.world.arena.colliders) {
      if (c.dead || c.top - p.y < 1.8) continue;
      if (c.kind === 'c') { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz) || 1; take(dx / d, dz / d, d - c.r); }
      else {
        const cx = clamp(p.x, c.x - c.hx, c.x + c.hx), cz = clamp(p.z, c.z - c.hz, c.z + c.hz), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d > 1e-4) take(dx / d, dz / d, d);
      }
    }
    return best;
  }
  wallStart(W, hs) {
    const n = W.n, vx = this.vel.x / hs, vz = this.vel.z / hs;
    const into = -(vx * n.x + vz * n.z);
    let t = new THREE.Vector3(-n.z, 0, n.x); if (t.x * vx + t.z * vz < 0) t.negate();
    const along = t.x * vx + t.z * vz;
    // Earth riding its slab surfs along the wall on it; otherwise a run along it, or up it when heading straight in
    const surf = this.el === 'earth' && this.mob && this.mob.kind === 'surf';
    const kind = surf ? 'surf' : into > 0.75 || along < 0.45 ? 'up' : 'run';
    // which side the wall is on, seen from the running direction (left: +1)
    const side = Math.sign(t.x * n.z - t.z * n.x) || 1;
    this.wall = { n: n.clone(), t, T: 0, kind, side, dur: kind === 'surf' ? 3.2 : kind === 'run' ? 0.9 : 0.5, speed: Math.max(hs, kind === 'surf' ? 7 : 6.5), step: 0 };
    this.endHold(); this.endMob(); this.action = null; this.tech = null; this.onGround = false; this.airJumps = 0; this.en -= 8;
    this.faceYaw = this.yaw = kind !== 'up' ? Math.atan2(t.x, t.z) : Math.atan2(-n.x, -n.z);
    if (surf) {
      // the slab goes onto the wall: rock held flat against the face under the feet
      const Wp = this.world.bending.weapons; this.wall.slab = new THREE.Mesh(Wp.slabGeo, Wp.rockMat); this.wall.slab.castShadow = true; this.world.scene.add(this.wall.slab);
      this.world.fx.debrisBurst(this.pos.clone().setY(this.pos.y + 0.5), 12, 3, 0.1, 0x7a6a58); this.world.audio.rumble(0.8);
    }
    this.world.popup(this, kind === 'surf' ? 'WALL SURF' : kind === 'run' ? 'WALL RUN' : 'WALL FLIP', false);
    this.world.audio.whoosh(0.7);
  }
  wallTick(dt) {
    const W = this.wall, w = this.world; W.T += dt;
    const u = W.T / W.dur;
    if (W.kind === 'surf') {
      // Earth on its slab, along the wall at about 1.4 m: the stick along the wall speeds it up or slows it
      const inp = this.input, along = inp.mx * W.t.x + inp.mz * W.t.z;
      W.speed = clamp(W.speed + along * 8 * dt - 1.2 * dt, 4, 11);
      const alt = this.pos.y - this.groundY;
      this.vel.set(W.t.x * W.speed, (1.4 - alt) * 4, W.t.z * W.speed);
      this.faceYaw = Math.atan2(W.t.x, W.t.z);
      if (W.slab) {
        const n = W.n, t = W.t, x = _v.crossVectors(n, t);
        W.slab.matrix.makeBasis(x, n, t); W.slab.quaternion.setFromRotationMatrix(W.slab.matrix);
        W.slab.position.copy(this.pos).addScaledVector(n, -0.22).add(_v2.set(0, 0.05, 0));
      }
    } else if (W.kind === 'run') {
      // along the wall on a shallow arc (up, then easing down), held against the face
      this.vel.set(W.t.x * W.speed, 4.4 * (1 - 1.7 * u), W.t.z * W.speed);
      this.faceYaw = Math.atan2(W.t.x, W.t.z);
    } else this.vel.set(-W.n.x * 0.6, 7.5 * (1 - 0.6 * u), -W.n.z * 0.6);
    // keep contact: pull back to the face if the body has drifted off it
    const near = this.wallNear(1.2);
    if (near && near.n.dot(W.n) > 0.9) this.pos.addScaledVector(W.n, -(near.d - this.radius - 0.02) * Math.min(1, dt * 20));
    else if (W.T > 0.12) { this.wallOff(true); return; }   // ran off the end of the wall
    // footfalls on the wall: each element marks them its own way
    W.step -= dt;
    if (W.step <= 0) {
      W.step = 0.14; W.foot = W.foot === 'L' ? 'R' : 'L';
      const fp = this.footPos(W.foot, _v2), out = _v.copy(W.n);
      if (this.el === 'fire') for (let i = 0; i < 4; i++) w.fx.fire(fp, out.clone().multiplyScalar(rand(2, 4)).add(_fwd.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))), rand(0.3, 0.45), 0.25);
      else if (this.el === 'earth') { w.fx.debrisBurst(fp.clone().addScaledVector(W.n, -0.05), W.kind === 'surf' ? 3 : 5, 3, 0.1, 0x7a746c, 0.5); if (W.kind !== 'surf') w.audio.step(0.8); }
      else w.fx.wind(fp, out.clone().multiplyScalar(3).add(_fwd.set(0, 1, 0)), 0.6, 0.35);
    }
    if (W.T >= W.dur) this.wallOff();
  }
  // leave the wall: a push off its face (a back somersault after running up it)
  wallOff(quiet) {
    const W = this.wall; if (!W) return; this.wall = null; this.wallCd = 0.35; this.highJump = true;
    if (W.slab) { this.world.scene.remove(W.slab); W.slab = null; this.world.fx.debrisBurst(this.pos.clone(), 10, 3, 0.1, 0x7a6a58); }
    if (quiet) { this.vel.y = Math.max(this.vel.y, 1); return; }
    if (W.kind === 'run') { this.vel.set(W.n.x * 6 + W.t.x * W.speed * 0.6, 7, W.n.z * 6 + W.t.z * W.speed * 0.6); }
    else {
      this.vel.set(W.n.x * 6.5, 6.5, W.n.z * 6.5);
      const T = this.style.tech.flipBack; if (T) { this.startTech(T, 1, true); this.invuln = 0.3; }
    }
    this.jumpFx(true);
  }

  endMob() { if (!this.mob) return; if (this.world.bending && this.world.bending.weapons) this.world.bending.weapons.surfEnd(this.mob); this.mob = null; }
  // sets the fighter's velocity while a mobility mode is active; returns false to fall back to normal movement
  mobMove(dt, mx, mz) {
    const m = this.mob, w = this.world, B = w.bending; m.t += dt;
    const stick = Math.hypot(mx, mz);
    if (m.kind === 'fly') {
      const F = MOBILITY.fly; m.fuel -= dt; this.en -= F.drain * dt;
      const tx = mx * F.speed, tz = mz * F.speed, k = Math.min(1, F.accel * dt / Math.max(1, F.speed));
      this.vel.x += (tx - this.vel.x) * k * 1.6; this.vel.z += (tz - this.vel.z) * k * 1.6;
      const alt = this.pos.y - this.groundY;
      let vy = this.input.jumpHeld ? F.ascent : -F.sink;
      if (alt > F.maxAlt && vy > 0) vy = 0;
      if (m.t < 0.35) vy = Math.max(vy, F.takeoff * (1 - m.t / 0.35));
      this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 5);
      this.highJump = false;
      B.weapons.flyTick(this, dt);
      if (m.fuel <= 0 || this.en <= 1) { this.endMob(); this.mobLock = true; this.mobCd = MOBILITY.fly.recover; w.popup(this, 'WIND SPENT', false); }
      else if (this.onGround && m.t > 0.6 && !this.input.jumpHeld) this.endMob();
      return true;
    }
    if (!this.onGround) return m.kind === 'surf';   // launched: momentum carries, the surf resumes on landing
    if (m.kind === 'flame') {
      const M = MOBILITY.flame; this.en -= M.drain * dt;
      if (stick > 0.3) m.heading += THREE.MathUtils.clamp(angleDiff(m.heading, Math.atan2(mx, mz)), -M.turn * dt, M.turn * dt);
      m.speed = Math.min(M.top, m.speed + M.accel * dt);
      this.vel.x = Math.sin(m.heading) * m.speed; this.vel.z = Math.cos(m.heading) * m.speed;
      for (const sd of ['L', 'R']) { const fp = this.heelPos(sd, _v); w.fx.fire(fp, _v2.set(-this.vel.x * 0.3 + rand(-0.5, 0.5), rand(0.5, 2), -this.vel.z * 0.3 + rand(-0.5, 0.5)), 0.4, 0.22); }
      if (Math.random() < dt * 8) B.burn(this.pos.x, this.pos.z, this.groundY, this);
      if (this.en <= 1) this.endMob();
      return true;
    }
    // surfing
    const M = MOBILITY[m.el];
    if (stick > 0.3) {
      const diff = angleDiff(m.heading, Math.atan2(mx, mz));
      if (Math.abs(diff) > 2.4) m.speed = Math.max(0, m.speed - M.brake * dt);   // stick pulled back: brake
      else { m.heading += THREE.MathUtils.clamp(diff, -M.turn * dt, M.turn * dt); m.speed = Math.min(M.top, m.speed + M.accel * dt * stick); }
    } else m.speed += (M.cruise - m.speed) * Math.min(1, M.coast * dt / Math.max(1, Math.abs(M.cruise - m.speed)));
    // slopes: climbing costs speed, descending gives it (more for the heavy rock)
    const ahead = w.arena.groundAt(this.pos.x + Math.sin(m.heading) * 0.8, this.pos.z + Math.cos(m.heading) * 0.8, this.pos.y + 0.6);
    m.speed = THREE.MathUtils.clamp(m.speed - (ahead - this.groundY) * (m.el === 'earth' ? 9 : 6) * dt * 4, 0, M.top + 2);
    // ran into something solid: the board stops dead
    if (m.last && m.speed > 5) { const moved = Math.hypot(this.pos.x - m.last.x, this.pos.z - m.last.z); if (moved < m.speed * m.lastDt * 0.35) { m.speed *= 0.25; w.shake(0.15, this.pos); w.audio.impact(0.5); } }
    m.last = (m.last || new THREE.Vector3()).copy(this.pos); m.lastDt = dt;
    this.vel.x = Math.sin(m.heading) * m.speed; this.vel.z = Math.cos(m.heading) * m.speed;
    this.en -= M.drain * dt;
    B.weapons.surfTick(this, m, dt);
    if (this.en <= 1) this.endMob();
    return true;
  }

  // looping sounds that last as long as the move: the fire wall, the flame run and fire stream, the water surf and
  // sustained whips, the wind of a glide, flight or sustained air
  soundLoops() {
    const A = this.world.audio, key = this === this.world.fighters[0] ? 'p' : 'o', m = this.mob, el = this.el;
    if (this.dead) return;
    // (20 Nov, after review: "the sounds for gliding have been removed") the rocket glide and the jump's jets lost their
    // fire roar when the glide was rebuilt on 18 Nov; it plays again for as long as the jets burn
    const jets = el === 'fire' && ((this.dodgeKind === 'rocket' && this.dodgeT > 0) || ((this.jetBurstT || 0) > 0 && !this.onGround));
    if ((this.guarding && el === 'fire') || (m && m.kind === 'flame') || (this.holding && el === 'fire') || jets) A.hold(key + 'fire', 'fireLoop', this.guarding ? 1 : jets ? 1.5 : 0.8, this.pos);
    // Earth riding its slab, on the floor or along a wall: the grinding of the rock under the feet (never had a sound)
    if (el === 'earth' && ((m && m.kind === 'surf') || (this.wall && this.wall.kind === 'surf'))) { const sp = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 9); A.hold(key + 'rock', 'rockLift', 0.8 + 0.4 * sp, this.pos); A.gravel(key + 'grav', 0.7 + 0.8 * sp, this.pos); }
    if ((m && m.kind === 'surf' && el === 'water') || (this.holding && el === 'water')) A.hold(key + 'water', 'waterLoop', 0.85, this.pos);
    if ((this.dodgeKind === 'glide' && this.dodgeT > 0) || (m && m.kind === 'fly') || (this.holding && el === 'air')) A.hold(key + 'wind', 'windLoop', 1, this.pos);
  }
  // Fire: on a punch the striking fist flares and trails flame along the strike (at rest the hands are bare)
  // (the fireball itself leaves the fist on the impact frame, elements.js fire.hand)
  fistFlames(dt) {
    if (this.el !== 'fire' || this.dead || !this.hero || !this.world.fighting) return;
    const F = this.world.fx.flip, punching = this.action === 'tech' && this.tech && this.tech.upper;
    for (const sd of ['L', 'R']) {
      const strike = punching && (this.techSide > 0 ? 'R' : 'L') === sd;
      if (!strike) continue;   // (18 Nov, after review: no flames on the fists at rest; they flare only on the strike)
      const h = this.handPos(sd, _v2);
      F.spawn('fire_flames', { pos: h, vel: _v.set(rand(-0.3, 0.3), rand(0.8, 1.6), rand(-0.3, 0.3)), size: strike ? [0.2, 0.26] : [0.16, 0.22], grow: 1.4, life: strike ? 0.18 : 0.18, f0: 8, f1: 30, fadeIn: 0.02, rot: rand(-0.4, 0.4) });
    }
  }
  // Fire's rocket jets (firefx JetSet): on the jump's blast-off and while JUMP holds the jets, straight down out of both
  // heels, and out of the fists once he is up with the arms pointing down; in the rocket dodge, back against the travel out of the heels alone
  fireJets(dt) {
    if (this.el !== 'fire' && !this.jets) return;
    if (!this.jets) this.jets = new JetSet(this.world.scene);
    this.jetBurstT = Math.max(0, (this.jetBurstT || 0) - dt);
    const live = !this.dead && this.el === 'fire';
    // (20 Nov, after review: "the flames during jump/dodge ONLY come from their heels ... nowhere else"; "powerful and
    // cohesive") one thick plume out of each heel, and nothing from the hands. Heard as the three-layer jet roar.
    let burning = false;
    if (live && this.dodgeKind === 'rocket' && this.dodgeT > 0) {
      // the dash: each heel blasts back and a little down against the travel; the plume's ragged end rolls out into
      // billows that spread to the sides behind him like wings (the user's reference)
      const back = _v.set(-this.dodgeDir.x, 0, -this.dodgeDir.z), side = _axis.set(-back.z, 0, back.x), ease = Math.min(1, this.dodgeT / 0.25);
      for (const sd of ['L', 'R']) {
        const hp = this.heelPos(sd, _v2), s = sd === 'L' ? 1 : -1;
        this.jets.fire('f' + sd, hp, _fwd.copy(back).add(_zx.set(0, -0.35, 0)), 3.2 * ease + 0.4, 0.3);
        if (Math.random() < 0.85) {
          const d = rand(1.6, 3.0);
          this.world.fx.fire(_zx.copy(hp).addScaledVector(back, d).setY(hp.y - 0.1 * d), _fwd.copy(back).multiplyScalar(rand(2, 5)).addScaledVector(side, s * rand(1.5, 4)).add(_qwv.set(0, rand(0.6, 2), 0)), rand(0.45, 0.8), 0.32);
        }
      }
      burning = true;
    } else if (live && this.jetBurstT > 0 && !this.onGround) {
      // the jump: straight down out of both heels (a touch against the drift)
      for (const sd of ['L', 'R']) this.jets.fire('f' + sd, this.heelPos(sd, _v2), _fwd.set(-this.vel.x * 0.04, -1, -this.vel.z * 0.04), 2.4, 0.21);
      burning = true;
    }
    if (burning) this.world.audio.jet('jet' + (this === this.world.fighters[0] ? 0 : 1), this.dodgeKind === 'rocket' && this.dodgeT > 0 ? 1 : 0.85, this.pos);
    this.jets.update(dt);
  }
  jumpFx(air) {
    const w = this.world;
    if (this.el === 'fire') { this.vel.y += air ? 0 : 0.6; this.jetBurstT = 0.35; this.autoJetT = 0.5; w.audio.fireWhoosh(1.0); }   // the blast-off: rocket jets from the heels and the fists (fireJets), nothing else
    // (19 Nov, from the reference: the jump is driven by a blast out of the soles) Water: a gush of water from each
    // foot down into the floor; Air: a blast of wind from each foot that raises dust
    if ((this.el === 'water' || this.el === 'air') && w.bending) for (const s of ['L', 'R']) w.bending.weapons.footJet(this, this.el, s, { down: true, len: air ? 1.4 : 1.8, dur: 0.32, r: this.el === 'air' ? 0.3 : 0.22 });
    // (20 Nov, after review: "a little bit of air bending in Earth when he jumps off a gliding rock on the side of the
    // wall") a jump in the air or off a wall used Air's ring and gusts for every element; wind is Air's alone now. Earth
    // pushes off in a burst of stone and dust with the crack of rock
    if (this.el === 'air') { w.fx.ring(this.pos, 1.6, 0xffffff, 0.35); for (let i = 0; i < 8; i++) w.fx.wind(this.pos.clone().setY(this.pos.y + 0.2), _v.set(rand(-3, 3), -1, rand(-3, 3)), 0.6, 0.4); w.audio.gust(air ? 0.7 : 0.4); }
    else if (this.el === 'earth' && air) { w.fx.debrisBurst(this.pos.clone(), 10, 3, 0.09, 0x6a5d50, 1); w.fx.dust(this.pos, 8, 2, 0xa08a6c); w.audio.rumble(0.6); }
    else w.audio.whoosh(0.4, this.pos);
    w.audio.jump(air ? 0.5 : 0.7, this.pos);
  }
  chargeFx() {
    const w = this.world, h = this.handPos(Math.random() < 0.5 ? 'L' : 'R', _v), full = this.chargeT >= 0.3 && this.legHoldT >= 0.85;
    if (this.el === 'fire') { if (Math.random() < 0.6) w.fx.fire(h, _v2.set(rand(-0.4, 0.4), 1, rand(-0.4, 0.4)), full ? 0.3 : 0.18, 0.25); }   // small: the body must stay readable
    else if (this.el === 'water') w.fx.splash(h, 1);
    else if (this.el === 'air') w.fx.wind(h, _v2.set(rand(-2, 2), 0.5, rand(-2, 2)), 0.4, 0.3);
    else w.fx.debrisBurst(this.pos.clone().setY(this.pos.y + 0.05), 1, 1.2, 0.06, 0x7a6a58, 0.5);
  }
  dodgeTrail() {
    if (this.dodgeKind === 'rocket' || this.dodgeKind === 'glide' || this.dodgeKind === 'arch') return;   // these draw their own jets / whirlwind / ice
    const w = this.world, t = this.style.dodge.trail, p = _v.copy(this.pos).setY(this.pos.y + 0.3);
    if (t === 'fire') { for (let i = 0; i < 3; i++) w.fx.fire(p, _v2.set(-this.vel.x * 0.1 + rand(-0.5, 0.5), rand(0, 1.5), -this.vel.z * 0.1 + rand(-0.5, 0.5)), 0.5, 0.35); }
    else if (t === 'water') { if (Math.random() < 0.7) w.fx.splash(p, 2); }
    else if (t === 'air') { for (let i = 0; i < 2; i++) w.fx.wind(p.setY(this.pos.y + rand(0.2, 1.6)), _v2.set(-this.vel.x * 0.2, 0, -this.vel.z * 0.2), 0.5, 0.35); }
  }

  // faces the roll along the stick (or straight ahead without it)
  // Fire's HAND (19 Nov, phase one): the stick pulled away from the rival throws the Fire Whip; within 2.3 m on the
  // floor the HAND chain is the melee family (dagger, dagger, Fire Blade); otherwise the fire jabs (null)
  fireHandTech() {
    const st = this.style, t = this.target, inp = this.input;
    if (!t || t.dead) return null;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1, sl = Math.hypot(inp.mx, inp.mz);
    if (st.tech.whip && sl > 0.5 && (inp.mx * dx + inp.mz * dz) / (sl * d) < -0.5) return st.tech.whip;
    // once the melee chain has started it carries on to its finisher while the rival is within 3.5 m
    const inChain = this.time - (this.lastMeleeT ?? -9) < 0.9;
    // (20 Nov, after review: "standing dagger attacks must never play against grounded opponents") the knives are chosen
    // from the rival's state: standing, staggering or kneeling, the standing stabs; on the floor (knocked down or getting
    // up), the grounded stab, driven down into them; in the air or falling, no knife work (the HAND chain throws fire)
    const lying = t.action === 'down' || t.action === 'getup', airborne = !t.onGround && t.pos.y - t.groundY > 0.5;
    if (st.tech.groundStab && lying && this.onGround && d < 2.6) { this.lastMeleeT = this.time + 0.6; return st.tech.groundStab; }
    if (st.tech.melee && this.onGround && !lying && !airborne && d < (inChain ? 3.5 : 2.3) && Math.abs(t.pos.y - this.pos.y) < 1.2) { this.lastMeleeT = this.time + 0.6; return st.tech.melee; }
    return null;
  }
  // (20 Nov, after review) Earth: HAND with the stick pulled away from the rival is the Ground Rupture (the fissure;
  // it was SPECIAL before Dust Storm and Quicksand took that button)
  // the Earth Launch itself: the rock column erupts under the feet and throws the bender up (the legs drive out of the
  // crouch as it rises: hero plays Standing Jump from its spring)
  earthLaunch() {
    const w = this.world; w.bending.weapons.surfLaunch(this, 'earth'); this.vel.y = 15.5; this.onGround = false; this.highJump = true; this.airJumps = 0;
    w.audio.rumble(1.0); w.fx.dust(this.pos, 12, 3, 0xa08a6c);
  }
  // (21 Nov, added Air skill) HAND during the dodge (the glide, or the corkscrew / cartwheel as it lands): the Air Swipe
  // thrown out of it; otherwise the Air Whip
  airHandTech() {
    const st = this.style;
    return st.tech.airSwipe && (this.dodgeKind === 'glide' || this.dodgeKind === 'flip') && this.dodgeT > 0 && this.en >= st.tech.airSwipe.cost ? st.tech.airSwipe : null;
  }
  earthHandTech() {
    const st = this.style, t = this.target, inp = this.input;
    if (!t || t.dead || !this.onGround) return null;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1, sl = Math.hypot(inp.mx, inp.mz);
    const want = this.aiDust || (sl > 0.5 && (inp.mx * dx + inp.mz * dz) / (sl * d) < -0.5); this.aiDust = false;
    if (want && (this.handCd || 0) <= this.time && this.en >= st.tech.earthHand.cost) { this.handCd = this.time + 6; return st.tech.earthHand; }
    return null;
  }
  rollDir() { const inp = this.input; if (Math.hypot(inp.mx, inp.mz) > 0.3) this.faceYaw = this.yaw = Math.atan2(inp.mx, inp.mz); this.lungeDir.set(Math.sin(this.faceYaw), 0, Math.cos(this.faceYaw)).multiplyScalar(9); this.lungeT = 0.45; }   // about 4 m
  doDodge() {
    const inp = this.input, D = this.style.dodge;
    let dx = inp.mx, dz = inp.mz;
    if (Math.hypot(dx, dz) < 0.2) { dx = -Math.sin(this.faceYaw); dz = -Math.cos(this.faceYaw); }
    const l = Math.hypot(dx, dz); this.dodgeDir.set(dx / l, 0, dz / l);
    const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
    const lz = this.dodgeDir.x * s + this.dodgeDir.z * c;
    const strafing = inp.strafe || this.guarding;
    // earth rolls (or sidesteps / backsteps while locked on); fire dashes; water slides; air dashes
    if (D.kind === 'roll') this.dodgeKind = !strafing ? 'roll' : lz < -0.6 ? 'back' : Math.abs(lz) < 0.6 ? 'side' : 'roll';
    else this.dodgeKind = D.kind;
    // Air: a whirlwind wraps round the bender and carries them away in a two-second glide: in the stick's
    // direction, or without it back and to the side, away from the attack
    // (M9: every second Air dodge on the ground is a flip instead: the Corkscrew Evade, then the Cartwheel, in turn; the
    //  body travels along the clip's own captured path, so the feet do not slide)
    this.airDodgeN = this.el === 'air' ? (this.airDodgeN || 0) + 1 : 0;
    if (this.el === 'air' && this.onGround && this.airDodgeN % 2 === 0 && MOCAP.air_cork && MOCAP.cartwheel) {
      const base = this.airDodgeN % 4 === 2 ? 'air_cork' : 'cartwheel';
      // which side: the stick's, else alternating; the mirrored take travels to the other side
      const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw), lx = inp.mx * c - inp.mz * s;
      const want = Math.abs(lx) > 0.3 ? Math.sign(lx) : (this.whirlSide = -(this.whirlSide || 1));
      const pick = [base, base + '_M'].find(n => { const t = MOCAP[n].travel; return Math.sign(t[t.length - 2]) === want; }) || base;
      const t = MOCAP[pick].travel, tx = t[t.length - 2], tz = t[t.length - 1], len = Math.hypot(tx, tz) || 1;
      // the clip's local path (x to the left, z forward) turned into the world
      // with the stick held the flip goes the stick's way (the dodge always follows the stick); without it, the clip's path
      if (Math.hypot(inp.mx, inp.mz) > 0.3) this.dodgeDir.set(inp.mx, 0, inp.mz).normalize();
      else this.dodgeDir.set(tx * c + tz * s, 0, -tx * s + tz * c).normalize();
      this.dodgeKind = 'flip'; this.flipClip = pick; this.flipSpeed = Math.max(len, 2.2) * 1.6 / 0.95;
      this.world.bending.weapons.whirlwind(this, 0.95);   // the corkscrew / cartwheel spins inside a whirl of wind
    } else if (this.el === 'air') {
      if (Math.hypot(inp.mx, inp.mz) < 0.2) { this.whirlSide = -(this.whirlSide || 1); const sx = Math.cos(this.faceYaw) * this.whirlSide, sz = -Math.sin(this.faceYaw) * this.whirlSide, bx = -Math.sin(this.faceYaw), bz = -Math.cos(this.faceYaw); this.dodgeDir.set(sx * 0.7 + bx * 0.7, 0, sz * 0.7 + bz * 0.7).normalize(); }
      this.dodgeKind = 'glide'; this.world.bending.weapons.whirlwind(this, 2.0);
    }
    // Fire: a rocket dodge. The legs hold a stable stance a little off the floor while flame jets from both feet
    // drive the bender fast to the side (or the stick's direction); no steps
    if (this.el === 'fire') {
      if (Math.hypot(inp.mx, inp.mz) < 0.2) { this.whirlSide = -(this.whirlSide || 1); this.dodgeDir.set(Math.cos(this.faceYaw) * this.whirlSide, 0, -Math.sin(this.faceYaw) * this.whirlSide); }
      this.dodgeKind = 'rocket'; this.glideHeld = false;
    }
    // Water: an arch of ice forms under the feet and slides the bender up and to the side (or the stick's way), from the
    // floor or from high on the water column
    if (this.el === 'water') {
      if (Math.hypot(inp.mx, inp.mz) < 0.2) { this.whirlSide = -(this.whirlSide || 1); this.dodgeDir.set(Math.cos(this.faceYaw) * this.whirlSide, 0, -Math.sin(this.faceYaw) * this.whirlSide); }
      this.dodgeKind = 'arch'; this.archH0 = Math.max(0, this.pos.y - this.groundY); this.vel.y = Math.max(this.vel.y, 0);
      this.world.audio.ice('form', 0.8, this.pos);
    }
    this.dodgeDur = this.dodgeKind === 'glide' ? 2.0 : this.dodgeKind === 'rocket' ? 0.95 : this.dodgeKind === 'arch' ? 1.0 : this.dodgeKind === 'flip' ? 0.95 : this.dodgeKind === 'side' ? 0.26 : this.dodgeKind === 'back' ? 0.3 : this.dodgeKind === 'circle' ? 0.42 : D.dur;
    this.dodgeT = this.dodgeDur; this.dodgeCd = this.dodgeKind === 'glide' ? 0.6 : 0.42; this.invuln = this.dodgeKind === 'glide' ? 0.6 : (this.dodgeKind === 'rocket' || this.dodgeKind === 'arch') ? 0.35 : this.dodgeDur * (D.iframes || 0.75); this.en -= this.dodgeKind === 'glide' ? 16 : 10;
    this.action = null; this.tech = null; this.spinYaw = 0;
    this.world.fx.dust(this.pos, 5, 1.2);
    if (this.el === 'air') this.world.audio.gust(0.6, this.pos); else if (this.el === 'fire') this.world.audio.fireWhoosh(0.6, this.pos); else this.world.audio.dodge(0.7, this.pos);
  }

  // level: -1 damage only, 0 flinch, 1 stagger, 2 knockdown
  takeHit(dmg, dir, knock, level) {
    level = level === true ? 1 : (level ?? 0);
    // (20 Nov) the Rock Armour takes 60 % of the blow and one step off the reaction (earth.js armourHit)
    if (this.armour && level >= 0) { [dmg, level] = this.world.bending.earth.armourHit(this, dmg, level); knock *= 0.4; if (level < 0) { this.hp = Math.max(0, this.hp - dmg); this.flash = Math.max(this.flash, 0.5); if (this.hp <= 0) this.die(dir.lengthSq() ? dir : _v.set(0, 0, 1)); return; } }
    this.hp = Math.max(0, this.hp - dmg);
    if (level < 0) { this.flash = Math.max(this.flash, 0.35); if (this.hp <= 0) this.die(dir.lengthSq() ? dir : _v.set(0, 0, 1)); return; }
    this.flash = 1;
    this.vel.x += dir.x * knock; this.vel.z += dir.z * knock;
    if (level >= 1) this.vel.y = Math.max(this.vel.y, level === 2 ? 4.5 : 2.5);
    this.hitDir = dir.clone(); this.koDir = dir.clone(); this.hitAlt = !this.hitAlt; if (this.wall) this.wallOff(true);
    if (this.hp <= 0) { this.die(dir); return; }
    const wasDodging = this.dodgeT > 0;
    this.endHold(); this.charging = false; this.legHoldT = -1; this.lungeT = 0; this.dodgeT = 0;
    // the reaction depends on the blow (M9): hit while dodging, the legs are taken and the fighter pitches forward
    // (Soccer Trip); a sweep takes the legs (Hit To The Legs); a punch snaps the head (Head Hit, or Hit To Head when it
    // knocks down); struck in the air the fighter drops flat (Falling Flat Impact); other knockdowns alternate the
    // Mixamo Knocked Down and Fall Flat
    const src = this.lastHitFrom, T = src && src !== this && src.action === 'tech' ? src.tech : null;
    const legBlow = !!(T && !T.upper && /sweep|flair/i.test(T.name || '')) || !!this.shiftFall, headBlow = !!(T && T.upper && !/^(Air Blast|Air Blades|Suction)$/.test(T.name || ''));   // (the added wind palms strike the body)
    const alt = this.pos.y - this.groundY;
    this.headHit = level === 0 && headBlow;
    // (20 Nov, after review: "characters struck with fire blades must not flail around but respond to the attack") a
    // cut or stab of the Fire Daggers doubles the body over the blow (Mixamo Stomach Hit); the Fire Blade's spinning
    // slash drives it back, doubled over (Big Stomach Hit). hero.js plays them, mirrored to the side the blow came from.
    const M = src && src.style && src.style.tech.melee, cut = T && M && (T === M || T.variantOf === M) ? T.clip : null;
    this.cutClip = cut && level < 2 ? (/blade_spin/.test(cut) ? 'hit_stomach_big' : 'hit_stomach') : null;
    if (wasDodging && level >= 0 && this.action !== 'down' && this.action !== 'getup') { level = 2; this.downClip = 'trip'; }
    // (18 Nov, second review: Fall Flat and Hit To Head pitch the body forward, onto the face; struck from the front
    //  that read as a leap into the blow. A blow from the front now knocks the fighter backwards (Knocked Down); Fall
    //  Flat only when struck from behind)
    // (20 Nov, Earth brief: "the reaction chosen from the actual combat circumstances") the fall follows where the blow
    // came from relative to the body and how hard it was: legs taken out, the feet go up and the body lands on the back
    // (Sweep Fall); from behind, forwards onto the front (Fall Flat); from the side, down sideways (Death From Right,
    // mirrored to the side, hero.downName); from the front, onto the back (Knocked Down), or for a very heavy blow
    // thrown off the feet onto the back, rolling to hands and knees and up again (Getting Thrown)
    else if (level === 2) {
      const fwdC = dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw), latC = dir.x * Math.cos(this.yaw) - dir.z * Math.sin(this.yaw);
      const fromBehind = fwdC > 0.3, fromSide = Math.abs(latC) > 0.7 && Math.abs(fwdC) < 0.6;
      this.downClip = alt > 1.2 ? 'fall_impact' : legBlow ? 'sweep_fall' : fromBehind ? 'fall_flat' : fromSide ? 'side_fall' : knock >= 13 ? 'thrown_fall' : 'knockback';
    }
    // already on the floor (knocked down or getting up): the blow keeps them down in the lying pose; they do not
    // spring up into a standing hit reaction or replay the fall from standing
    if (this.action === 'down' || this.action === 'getup') {
      this.vel.y = Math.min(this.vel.y, 0); this.startAction('down'); this.floorHit = true; this.actionT = this.A.dur * 0.5; this.invuln = 0.5; return;
    }
    if (level >= 1) this.endMob();
    if (level === 2) {
      this.startAction('down'); this.stunT = 0; this.invuln = 0.9; this.onGround = false;
      // the longer falls get longer on the floor (time added before the get-up), so they play near their captured pace
      // (20 Nov, after review: "characters who fall should get up quickly, not spend time struggling to stand") less time on
      // the floor for every fall; the falls play faster to fit
      this.actionT = -({ fall_flat: 0.2, hit_head_down: 0.2, hit_legs: 0.3, trip: 0.05, side_fall: 0.3, sweep_fall: 0.2, thrown_fall: 1.2 }[this.downClip] || 0);
      if (this.downClip === 'thrown_fall') this.invuln = 1.9;   // (the throw carries its own roll and rise: protected through it)
    }
    else if (level === 1) { this.startAction('stagger'); this.stunT = 0.5; }
    else { this.startAction('hit'); this.stunT = 0.2; if (this.cutClip) this.actionT = -0.22; }   // (a knife hit holds the doubled-over bend a little longer, about 0.58 s)
  }

  die(dir) {
    this.dead = true; this.guarding = false; this.charging = false; this.endHold();
    this.world.bending.guardEnd(this, true);
    this.startAction('ko'); this.koDir = dir.clone();
    this.vel.x = dir.x * 6; this.vel.z = dir.z * 6; this.vel.y = 4;
  }

  // ------------------------------------------------------------ animation
  animate(dt) {
    const p = this.pose; p.fill(0);
    const t = this.time, onG = this.onGround, spd = this.speedNorm, st = this.style;

    // ---- base: the element's stance blended with its locomotion cycle
    st.stance(p, t);
    if (onG && spd > 0.04 && this.dodgeT <= 0) {
      const q = this.tmpPose; q.fill(0);
      this.runPose(q, this.runPhase, spd);
      const wRun = clamp(spd * 3, 0, 1);
      for (let i = 0; i < POSE_LEN; i++) p[i] += (q[i] - p[i]) * wRun;
    }
    if (!onG && this.dodgeT <= 0 && this.action !== 'down' && !(this.action === 'tech' && this.tech.jumpAt)) this.airPose(p);

    // ---- motion dynamics: bank into turns, lean with acceleration
    add(p, 'spine', this.accLean * 0.9, 0, this.bank * 0.6);
    add(p, 'hips', this.accLean * 0.3, 0, this.bank * 0.4);
    add(p, 'neck', -this.accLean * 0.5, 0, -this.bank * 0.5);
    if (this.accLean < -0.05 && spd > 0.15) p[PY] -= -this.accLean * 0.25;

    // ---- sustained stances (legs keep stepping while moving)
    const moving = spd > 0.2 && onG;
    const layer = (fn) => { const q = this.tmpPose; q.set(p); fn(q); for (let i = 0; i < POSE_LEN; i++) { const lower = (i >= LEG_START && i < PN) || i < 3 || i >= PN; if (lower && moving) continue; p[i] = q[i]; } };
    const ctx = { s: this.techSide, t, ph: this.holdPh };
    if (this.guarding) layer(q => st.tech.guard(q, ctx));
    if (this.holding) layer(q => st.tech.handHold.pose(q, ctx));
    if (this.charging) layer(q => this.chargePose(q, t));
    if (this.restrainT > 0) this.restrainedPose(p, t);

    // ---- techniques: keyframes over the current base pose
    if (this.action === 'tech') {
      const T = this.tech, u = clamp(this.actionT / T.dur, 0, 1), keys = T.keys;
      let i = 0; while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
      const k0 = keys[i], k1 = keys[i + 1];
      const lt = smooth01((u - k0[0]) / Math.max(1e-4, k1[0] - k0[0]));
      const a = this.tmpA, b = this.tmpB; a.set(p); b.set(p);
      const c = { s: this.techSide, t, u };
      k0[1](a, c); k1[1](b, c);
      const legsToo = !T.upper || !moving;
      for (let j = 0; j < POSE_LEN; j++) {
        const lower = (j >= LEG_START && j < PN) || j < 3 || j >= PN;
        if (lower && !legsToo) continue;
        p[j] = a[j] + (b[j] - a[j]) * lt;
      }
    } else if (this.action) {
      const A = ACTIONS[this.action], u = clamp(this.actionT / A.dur, 0, 1);
      this.reactionPose(p, this.action, u);
    }
    if (this.dodgeT > 0) this.dodgePose(p, 1 - this.dodgeT / this.dodgeDur);

    // ---- smoothing towards the target pose
    const act = (this.action && !(this.A && this.A.soft)) || this.dodgeT > 0;
    const rate = act ? 26 : (this.el === 'water' ? 9 : this.el === 'earth' ? 12 : 15);   // water flows, earth settles, fire/air snap
    // critically damped approach with a joint angular-velocity cap: fast enough for whip-like kicks
    // (~20 rad/s) but never a visible snap when one technique hands over to the next
    const k = 1 - Math.exp(-rate * dt), cap = 20 * dt, capPos = 3 * dt;
    const cur = this.cur;
    for (let i = 0; i < POSE_LEN; i++) {
      let d = (p[i] - cur[i]) * k; const c = i < PN ? cap : capPos;
      if (d > c) d = c; else if (d < -c) d = -c;
      cur[i] += d;
    }
    const J = this.J;
    for (let j = 0; j < JOINTS.length; j++) { const i = j * 3; J[JOINTS[j]].rotation.set(cur[i], cur[i + 1], cur[i + 2], 'YXZ'); }
    J.hips.position.set(cur[PX], HIP_H + cur[PY], cur[PZ]);

    // ---- whole-body rotation (roll, knockdown, get-up, KO)
    const tq = this.tumble.quaternion;
    const local = (d) => { const c0 = Math.cos(this.yaw), s0 = Math.sin(this.yaw); return _axis.set(d.x * s0 + d.z * c0, 0, -(d.x * c0 - d.z * s0)).normalize(); };
    if (this.dodgeT > 0 && this.dodgeKind === 'roll' && !this.hero) {   // the hero uses the authored roll clip instead
      const prog = 1 - this.dodgeT / this.dodgeDur;
      tq.setFromAxisAngle(local(this.dodgeDir), smooth01(clamp(prog / 0.9, 0, 1)) * Math.PI * 2);
      this.tumble.position.y = 0.6;
    } else if ((this.dead || this.action === 'down' || this.action === 'getup') && !(this.hero && this.hero.actions.ko)) {   // the hero uses authored falls
      let prog;
      if (this.dead) prog = smooth01(clamp(this.actionT / 0.55, 0, 1));
      else if (this.action === 'down') prog = smooth01(clamp(this.actionT / 0.35, 0, 1));
      else prog = 1 - smooth01(clamp(this.actionT / 0.4, 0, 1));
      tq.setFromAxisAngle(local(this.koDir || _fwd.set(0, 0, -1)), prog * Math.PI / 2 * 0.97);
      this.tumble.position.y = 0.6 - prog * 0.42;
    } else {
      tq.slerp(_qi, 1 - Math.exp(-20 * dt));
      this.tumble.position.y += (0.6 - this.tumble.position.y) * (1 - Math.exp(-20 * dt));
    }
  }

  // Locomotion shaped by the style: stride, knee lift, bob, lean, arm carriage
  runPose(p, ph, spd) {
    const L = this.style.loco, f = this.moveLocal.y, s = this.moveLocal.x;
    const run = Math.min(spd, 1), sprint = clamp((spd - 1) / 0.45, 0, 1);
    const A = (0.3 + 0.5 * run + 0.22 * sprint) * L.stride;
    const sinL = Math.sin(ph), sinR = -sinL;
    p[PY] = -0.03 - 0.03 * run + Math.abs(Math.cos(ph)) * (0.025 + 0.04 * run) * L.bob - (this.el === 'earth' ? 0.05 : 0);
    const lean = (0.1 * run + 0.22 * sprint) * f * L.lean;
    S(p, 'hips', 0.04 * f, sinL * (0.12 + 0.1 * run) * f, -s * 0.12);
    S(p, 'spine', lean * 0.6, -sinL * 0.1 * f, s * 0.05);
    S(p, 'chest', lean * 0.5, -sinL * (0.08 + 0.06 * run) * f * L.swing, 0);
    S(p, 'neck', -lean * 0.6, 0, 0);
    S(p, 'head', -lean * 0.3, 0, 0);
    for (const side of [1, -1]) {
      const sn = side > 0 ? sinL : sinR, cs = side > 0 ? Math.cos(ph) : -Math.cos(ph);
      const swingFwd = sn * A * f, swingSide = sn * A * 0.7 * s;
      const lift = Math.max(0, f >= 0 ? cs : -cs);
      const knee = 0.15 + (0.6 + 0.9 * run + 0.4 * sprint) * lift * L.knee;
      legRaw(p, side, -swingFwd, swingSide * side + 0.05 + L.out, knee, -0.12 + 0.3 * Math.max(0, -sn * f));
      if (L.flow) {
        // water: arms float out to the sides and drift with the stride
        arm(p, side, -0.5 + sn * 0.25 * f, 0.55 + 0.1 * cs, 0.4, L.elbow, 0.3);
      } else {
        const elbow = L.elbow * (0.35 + 0.65 * run) + 0.25 * sprint + 0.2 * cs * run;
        arm(p, side, sn * (0.35 + 0.4 * run + 0.35 * sprint) * f * L.swing + L.carry * run, 0.1 + Math.abs(s) * 0.15 + (L.carry > 0 ? 0.15 : 0), L.carry > 0 ? -0.6 : 0, elbow, L.carry > 0 ? -0.6 : 0);
      }
    }
  }

  airPose(p) {
    const tuck = clamp(1 - Math.abs(this.vel.y) / 7, 0, 1);
    p[PY] = -0.04;
    S(p, 'spine', 0.1 + tuck * 0.15, 0, 0);
    legRaw(p, 1, -0.9 - tuck * 0.4, 0.12, 1.4 + tuck * 0.4, -0.3);
    legRaw(p, -1, 0.15, 0.1, 0.9 + tuck * 0.5, -0.2);
    if (this.el === 'air') { arm(p, 1, -0.4, 1.3, -0.8, 0.2, -1.0); arm(p, -1, -0.4, 1.3, -0.8, 0.2, -1.0); }
    else { arm(p, 1, -0.5, 0.9, 0, 0.9); arm(p, -1, -0.2, 1.0, 0, 0.7); }
  }

  chargePose(p, t) {
    const k = Math.min(1, this.chargeT / 0.55), tr = Math.sin(t * 40) * 0.015 * k, el = this.el;
    stanceLegs(p, -0.24 - 0.08 * k, 0.32, 0.22, -0.3, 0.24);
    S(p, 'hips', 0.05, 0.6, 0); S(p, 'spine', 0.2 + tr, -0.3, 0); S(p, 'chest', 0.08, -0.35 - 0.15 * k, 0); S(p, 'neck', -0.15, 0.5, 0);
    if (el === 'earth' || el === 'fire') { arm(p, 1, -0.6, 0.25, 0.2, 1.4 + tr, 0.4); arm(p, -1, 0.35 + 0.2 * k, 0.3, 0.3, 1.9, 0.4); }
    else { arm(p, 1, -0.7 - 0.3 * Math.sin(t * 4), 0.7, 0.5, 0.9, 0.3); arm(p, -1, -0.5 + 0.3 * Math.sin(t * 4), 0.7, 0.5, 0.9, 0.3); }
  }

  restrainedPose(p, t) {
    const s = Math.sin(t * 18) * 0.08;
    S(p, 'spine', -0.1 + s, 0, s); arm(p, 1, -0.6 + s, 1.0, 0, 0.8); arm(p, -1, -0.6 - s, 1.0, 0, 0.8);
  }

  dodgePose(p, u) {
    const k = this.dodgeKind;
    if (k === 'roll') {
      p[PY] = -0.25;
      S(p, 'hips', 0, 0, 0); S(p, 'spine', 0.5, 0, 0); S(p, 'chest', 0.4, 0, 0); S(p, 'neck', 0.4, 0, 0);
      legRaw(p, 1, -1.9, 0.15, 2.3, -0.4); legRaw(p, -1, -1.7, 0.15, 2.3, -0.4);
      arm(p, 1, -1.2, 0.3, 0, 2.0); arm(p, -1, -1.2, 0.3, 0, 2.0);
      return;
    }
    const c = Math.cos(this.faceYaw), s = Math.sin(this.faceYaw);
    const lx = this.dodgeDir.x * c - this.dodgeDir.z * s, lz = this.dodgeDir.x * s + this.dodgeDir.z * c;
    const e = Math.sin(u * Math.PI);
    if (k === 'side' || k === 'slide') {
      // low lateral move; water glides with arms flowing, earth shuffles with guard up
      const dir = lx >= 0 ? 1 : -1;
      p[PY] = -0.22 * e - 0.05;
      S(p, 'hips', 0.05, 0, -0.2 * dir * e); S(p, 'spine', 0.15 + 0.2 * lz * e, 0, 0.32 * dir * e); S(p, 'neck', 0, 0, -0.3 * dir * e);
      const down = hipDown(p[PY]);
      legIK(p, dir, 0.05, down - 0.05, 0.45 * e + 0.1); legIK(p, -dir, -0.05, down, 0.1 + 0.2 * e);
      if (k === 'slide') { arm(p, dir, -0.5, 1.2, 0.5, 0.4, 0.3); arm(p, -dir, -1.1, 0.4, 0.5, 0.9, 0.3); }
      else { arm(p, 1, -1.0, 0.4 + 0.3 * e, 0, 1.6); arm(p, -1, -0.8, 0.4 + 0.3 * e, 0, 1.8); }
    } else if (k === 'back') {
      p[PY] = -0.08;
      S(p, 'spine', -0.15 * e, 0, 0); S(p, 'chest', -0.1 * e, 0, 0);
      legRaw(p, 1, -0.5 * e - 0.2, 0.1, 0.8 * e + 0.4, -0.2); legRaw(p, -1, 0.1, 0.1, 0.5 * e + 0.3, -0.2);
      arm(p, 1, -1.2, 0.3, -0.3, 2.0); arm(p, -1, -1.0, 0.3, -0.3, 2.1);
    } else if (k === 'dash') {
      // fire: explosive low lunge, rear leg driving, fists forward
      p[PY] = -0.2;
      S(p, 'spine', 0.45 * Math.max(0, lz) + 0.1, 0, 0.2 * lx);
      legRaw(p, 1, -0.9, 0.1, 1.1, -0.2); legRaw(p, -1, 0.6, 0.1, 0.3, 0.3);
      arm(p, 1, -1.3, 0.2, 0, 1.6); arm(p, -1, 0.5, 0.3, 0, 1.4);
    } else {
      // air: upright gliding dash with a half turn and open palms trailing
      p[PY] = 0.0;
      S(p, 'spine', -0.05, 0.6 * e, 0.25 * lx); S(p, 'chest', 0, 0.3 * e, 0);
      legRaw(p, 1, -0.6, 0.1, 1.2, 0.3); legRaw(p, -1, 0.3, 0.1, 0.4, 0.4);
      arm(p, 1, 0.5, 0.9, -0.6, 0.2, -1.0); arm(p, -1, 0.5, 0.9, -0.6, 0.2, -1.0);
    }
  }

  reactionPose(p, name, u) {
    switch (name) {
      case 'counter': {
        const e = seg(u, 0.2, 0.4) * (1 - seg(u, 0.65, 1));
        p[PY] = -0.12;
        S(p, 'spine', 0.1, 0, 0.1 * e); S(p, 'chest', 0, 0.4 * e, 0);
        arm(p, -1, -1.45 * e - 0.4, 1.0 * e + 0.3, 0.6, 0.25 + 1.4 * (1 - e)); arm(p, 1, -0.9, 0.4, -0.3, 2.1);
        const down = hipDown(p[PY]); legIK(p, 1, 0.25, down, 0.18); legIK(p, -1, -0.25, down, 0.18);
        break;
      }
      case 'hit': {
        const k = Math.sin(u * Math.PI);
        S(p, 'spine', -0.35 * k, 0, 0.1 * k); S(p, 'chest', -0.25 * k, 0, 0);
        S(p, 'neck', -0.3 * k, 0, 0); S(p, 'head', -0.2 * k, 0.2 * k, 0);
        arm(p, 1, -0.3, 0.7 * k + 0.2, 0, 0.8); arm(p, -1, -0.2, 0.8 * k + 0.2, 0, 0.6);
        p[PY] = -0.1 * k;
        break;
      }
      case 'stagger': {
        const k = Math.sin(Math.min(1, u * 1.3) * Math.PI), st = Math.sin(u * Math.PI * 3);
        p[PY] = -0.1 - 0.08 * k;
        S(p, 'spine', -0.45 * k, 0.2 * st, 0.12 * st); S(p, 'chest', -0.2 * k, 0, 0); S(p, 'neck', -0.35 * k, 0, 0);
        arm(p, 1, -0.6 * k, 1.2 * k + 0.2, 0, 0.6); arm(p, -1, -0.3 * k, 1.3 * k + 0.2, 0, 0.5);
        legRaw(p, 1, -0.3 + 0.5 * st, 0.15, 0.4 + 0.4 * Math.max(0, st), -0.1);
        legRaw(p, -1, -0.3 - 0.5 * st, 0.15, 0.4 + 0.4 * Math.max(0, -st), -0.1);
        break;
      }
      case 'down': case 'ko': {
        S(p, 'spine', -0.2, 0, 0); S(p, 'neck', -0.2, 0, 0);
        arm(p, 1, -0.2, 1.3, 0, 0.4); arm(p, -1, -0.4, 1.1, 0, 0.6);
        legRaw(p, 1, -0.3, 0.2, 0.4, 0); legRaw(p, -1, 0.1, 0.15, 0.2, 0);
        p[PY] = 0;
        break;
      }
      case 'getup': {
        const k = 1 - seg(u, 0.4, 1);
        p[PY] = -0.3 * k;
        S(p, 'spine', 0.5 * k, 0, 0); S(p, 'neck', 0.2 * k, 0, 0);
        legRaw(p, 1, -1.4 * k, 0.15, 2.0 * k, -0.3 * k); legRaw(p, -1, -1.2 * k, 0.15, 1.9 * k, -0.3 * k);
        arm(p, 1, -0.6, 0.6, 0, 1.4); arm(p, -1, -0.6, 0.6, 0, 1.4);
        break;
      }
      case 'land': {
        const k = Math.sin(u * Math.PI);
        p[PY] = -0.07 - 0.15 * k;
        const down = hipDown(p[PY]);
        S(p, 'spine', 0.1 + 0.2 * k, 0, 0);
        legIK(p, 1, 0.22, down, 0.14); legIK(p, -1, -0.18, down, 0.14);
        break;
      }
    }
  }
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _qf = new THREE.Quaternion();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vd = new THREE.Vector3();
const ARCH_H = 1.6;   // how high Water's ice arch lifts the bender off the floor (m)
const _up = new THREE.Vector3(0, 1, 0), _zx = new THREE.Vector3(), _qw = new THREE.Quaternion();
const _axis = new THREE.Vector3(), _qwv = new THREE.Vector3(), _qi = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _heelT = new THREE.Vector3(), _heelD = new THREE.Vector3();
// the heel vertex of a foot on the hero's skinned mesh, in that foot bone's local space (see heelPos)
function findHeel(hero, side) {
  const name = 'DEF-foot' + side, toeName = 'DEF-toe' + side, p = new THREE.Vector3(), bindInv = new THREE.Matrix4();
  for (const mesh of hero.meshes || []) {
    const sk = mesh.skeleton, bi = sk.bones.findIndex(b => b.name === name), ti = sk.bones.findIndex(b => b.name === toeName);
    if (bi < 0 || ti < 0) continue;
    const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!pos || !si || !sw) continue;
    // rest-pose positions in the skeleton's bind space; the foot's and toe's rest positions give "forward"
    const footBind = new THREE.Vector3().setFromMatrixPosition(bindInv.copy(sk.boneInverses[bi]).invert());
    const toeBind = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[ti]).invert());
    const fwd = toeBind.clone().sub(footBind).setY(0).normalize();
    let best = null, score = Infinity;
    for (let v = 0; v < pos.count; v++) {
      let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === bi) w += sw.getComponent(v, k);
      if (w < 0.5) continue;
      p.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix);
      const sc = (p.y - footBind.y) * 1.0 + p.clone().sub(footBind).dot(fwd) * 1.2;   // low and to the back
      if (sc < score) { score = sc; best = p.clone(); }
    }
    if (best) return best.applyMatrix4(sk.boneInverses[bi]);   // into the foot bone's local space
  }
  return null;
}
