// Fighter: skinned martial artist driven by an element style (stance, locomotion, keyframed techniques),
// plus movement physics, stamina, dodges, reactions and the HAND / LEG / GUARD / SPECIAL input model.
import * as THREE from 'three';
import { clamp, dampAngle, angleDiff, smooth01, rand } from './util.js';
import { buildSkinnedFighter } from './character.js';
import { JOINTS, JI, PN, POSE_LEN, PX, PY, PZ, LEG_START, S, add, arm, legRaw, legIK, hipDown, seg, stanceLegs, HIP_H } from './pose.js';
import { STYLES } from './styles.js';
import { Hero, heroReady } from './hero.js';

// Reactions and shared moves (element techniques live in styles.js)
export const ACTIONS = {
  counter: { dur: 0.4,  upper: false, active: { from: 0.2, to: 0.55, dmg: 14, range: 2.1, arc: -1.1, knock: 9, level: 1 }, cancel: 0.65, lunge: 10 },
  hit:     { dur: 0.3,  react: true },
  stagger: { dur: 0.62, react: true },
  down:    { dur: 0.85, react: true },
  getup:   { dur: 0.45, react: true },
  land:    { dur: 0.14, soft: true },
  landHigh:{ dur: 0.42, soft: true },
  ko:      { dur: 99,   react: true },
};

// Elemental mobility (DODGE held). All values are tunable: speeds in m/s, accelerations in m/s^2, turn in rad/s,
// drains in energy per second, flight duration in seconds, maximum altitude in metres above the ground below.
export const MOBILITY = {
  water: { top: 12.5, accel: 9, turn: 3.0, brake: 14, cruise: 5, coast: 3, drain: 5, launch: 12.5 },     // ice surfing
  earth: { top: 10.5, accel: 5, turn: 1.8, brake: 9, cruise: 4, coast: 2, drain: 7, launch: 13.5 },     // rock surfing (heavy)
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
    if (old && this.world.bending) { this.world.bending.dropAll(this, old); if (this.guarding) { this.guarding = false; this.world.bending.guardEnd(this); } }
    this.holding = false; this.charging = false; this.handHoldT = -1; this.legHoldT = -1;
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
    this.dodgeT = 0; this.stunT = 0; this.invuln = 0; this.flash = 0; this.counterT = 0; this.lungeT = 0; this.restrainT = 0; this.airJumps = 0;
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

  get A() { return this.action === 'tech' ? this.tech : (this.action ? ACTIONS[this.action] : null); }
  get actionU() { const A = this.A; return A ? this.actionT / A.dur : 1; }
  reacting() { const A = this.A; return !!(A && A.react); }
  free(kind) {
    if (this.dead || this.stunT > 0 || this.restrainT > 0 || this.reacting()) return false;
    if (this.dodgeT > 0) return kind === 'attack' ? this.dodgeT < this.dodgeDur * 0.3 : false;
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
    // alternating authored takes (e.g. hook / lunge punch) each carry their own timing
    if (def.variants) { const n = this.altN || 0; this.altN = n + 1; def = def.variants[n % def.variants.length]; }
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
    for (const k in this.buf) this.buf[k] = Math.max(0, this.buf[k] - dt);
    // input buffer: long enough to queue the next technique during an authored recovery
    if (inp.hand) this.buf.hand = 0.35;
    if (inp.leg) this.buf.leg = 0.35;
    if (inp.special) this.buf.special = 0.35;
    if (inp.dodge) this.buf.dodge = 0.18;
    if (inp.jump) this.buf.jump = 0.15;
    if (this.guarding) this.guardT += dt;

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
        if (was === 'down') this.startAction('getup');
      }
    }

    const live = !this.dead, restrained = this.restrainT > 0;
    // ---- commands (buffered so slightly early presses still land)
    if (live && !restrained) {
      // DODGE held: the element's own mobility (ice / rock surfing, flight, flame-propelled run)
      if (inp.dodgeHeld) this.dodgeHoldT = this.dodgeHoldT < 0 ? 0 : this.dodgeHoldT + dt; else { this.dodgeHoldT = -1; this.mobLock = false; if (this.mob && this.onGround) this.endMob(); if (this.mob && this.mob.kind === 'fly') this.endMob(); }
      this.mobCd = (this.mobCd || 0) - dt;
      // a spent mobility needs DODGE released (and, for flight, a recovery time) before it can start again
      if (!this.mob && !this.mobLock && this.mobCd <= 0 && this.dodgeHoldT > 0.28 && !this.guarding && !this.charging && !this.reacting() && this.en > 12) this.startMob();
      if (this.buf.jump && this.mob && (this.mob.kind === 'surf' || this.mob.kind === 'flame') && this.onGround) {
        // the element launches the bender: a rising ice pillar / rock slab, or a burst of flame from the feet
        const M = MOBILITY[this.mob.kind === 'surf' ? this.mob.el : 'flame'];
        if (this.mob.kind === 'surf') B.weapons.surfLaunch(this, this.mob.el); else this.jumpFx(false);   // (the rising pillar would set its own lift)
        this.buf.jump = 0; this.vel.y = M.launch; this.onGround = false; this.highJump = true; this.jetFuel = this.el === 'fire' ? 0.8 : 0;
        if (this.mob.kind === 'flame') this.endMob();
      }
      if (this.mob && this.mob.kind === 'fly') this.buf.jump = 0;   // in flight JUMP means climb
      // water GUARD combinations: HAND throws an ice spear, LEG sends a stream to capture the opponent
      // (only while GUARD is still held: a HAND pressed as the guard is released is the counter-strike, not a spear)
      if (this.guarding && inp.guard && this.el === 'water') {
        if (this.buf.hand && this.en >= 10) { this.buf.hand = 0; this.en -= 10; B.iceSpear(this); }
        if (this.buf.leg && this.en >= 15 && (this.captureCd || 0) <= 0) { this.buf.leg = 0; this.captureCd = 4; if (B.weapons.capture(this)) this.en -= 15; }
      }
      this.captureCd = (this.captureCd || 0) - dt;
      if (this.buf.dodge && this.dodgeCd <= 0 && this.en >= 10 && this.free('dodge') && !this.charging) { this.buf.dodge = 0; this.endHold(); this.doDodge(); }
      if (this.buf.jump && this.free('jump') && !this.charging && !this.guarding) {
        if (this.onGround) { this.buf.jump = 0; this.action = null; this.vel.y = st.jump.v; this.onGround = false; this.airJumps = 0; this.jetFuel = 0.8; this.jetUsed = false; this.highJump = false; this.jumpFx(false); }
        else if (this.airJumps < st.jump.air && this.vel.y < 5) { this.buf.jump = 0; this.airJumps++; this.vel.y = 7.2; this.jumpFx(true); }
      }
      const canStrike = this.free('attack') && !this.guarding && !this.holding;
      if (this.buf.hand && !this.charging && canStrike) {
        this.buf.hand = 0; this.dodgeT = 0;
        if (this.counterT > 0) { this.counterT = 0; this.startAction('counter'); w.combat.lunge(this, ACTIONS.counter); w.popup(this, 'COUNTER', true); w.audio.whoosh(0.9); }
        else if (B.spiralRelease && B.spiralRelease(this)) { w.popup(this, 'RELEASE', true); }
        else { this.handSide = -this.handSide; this.startTech(st.tech.hand, this.handSide, true); }
        this.handHoldT = 0;
      }
      if (this.buf.leg && !this.charging && canStrike) {
        this.buf.leg = 0; this.dodgeT = 0;
        if (st.tech.legMove && this.onGround && this.speedNorm > 0.45 && !this.action && this.comboTimer <= 0) {
          // LEG while running: a kick delivered on the move, keeping the run's momentum
          this.comboTimer = 0.9; this.legIdx = -1; this.startTech(st.tech.legMove, 1, true);
        } else {
          this.legIdx = this.comboTimer > 0 ? (this.legIdx + 1) % st.tech.leg.length : 0;
          this.comboTimer = 0.9;
          this.startTech(st.tech.leg[this.legIdx], this.legIdx === 0 ? -1 : 1, true);
        }
        this.legHoldT = 0;
      }
      // icebending: SPECIAL while the water wall is up freezes it into an ice wall (progression flag iceUnlocked)
      if (this.buf.special && this.guarding && this.el === 'water' && this.defense && this.defense.arc && !this.defense.ice && this.iceUnlocked !== false && this.en >= 15) {
        this.buf.special = 0; this.en -= 15; B.freeze(this.defense);
      }
      // SPECIAL while sustaining twin water whips freezes them into ice blades (heavier, knock down, shatter)
      if (this.buf.special && this.holding && this.el === 'water' && this.en >= 10) { const h = B.holds.get(this); if (h && !h.frozen) { this.buf.special = 0; this.en -= 10; h.frozen = true; w.popup(this, 'ICE BLADES', true); w.audio.splash(0.8); } }
      if (this.buf.special && !this.charging && canStrike) { this.buf.special = 0; this.startTech(st.tech.special, this.handSide); }

      // HAND held -> sustained technique (stream / lift / draw / push)
      if (this.handHoldT >= 0) {
        if (!inp.handHeld) { this.handHoldT = -1; this.endHold(); }
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
          if (!this.charging && this.legHoldT > 0.38 && kickDone && !this.guarding && !this.reacting()) { this.charging = true; this.chargeT = 0; this.action = null; this.tech = null; }
        }
      }
      if (this.charging) {
        this.chargeT += dt;
        if (this.stunT > 0 || this.reacting() || this.dodgeT > 0) { this.charging = false; this.legHoldT = -1; }
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
    if (this.stunT > 0 || restrained) maxSpeed = 0;

    if (this.mob && this.mobMove(dt, mx, mz)) {
      // velocity set by the element's mobility
    } else if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const k = smooth01(this.dodgeT / this.dodgeDur), D = st.dodge;
      const sp = this.dodgeKind === 'side' ? 2 + 13 * k : this.dodgeKind === 'back' ? 2 + 10 * k : 2.5 + (D.speed - 2.5) * k;
      this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
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
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.vel.x = this.lungeDir.x; this.vel.z = this.lungeDir.z;
    } else {
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
    if (this.el === 'water' && live && !restrained && !this.onGround && inp.jumpHeld && this.jetFuel > 0 && this.en > 1 && this.dodgeT <= 0 && !this.mob && !(this.A && this.A.react) && alt < 5) {
      this.jetting = true; this.highJump = true; this.jetFuel -= dt; this.en -= 22 * dt;
      this.vel.y = Math.min(this.vel.y + 30 * (1 - alt / 5.5) * dt, 5.2);
      this.vel.x += mx * 10 * dt; this.vel.z += mz * 10 * dt;
      B.weapons.selfColumn(this, alt);
    } else if (this.el === 'water') B.weapons.selfColumn(this, -1);
    if (this.el === 'fire' && live && !restrained && !this.onGround && inp.jumpHeld && this.jetFuel > 0 && this.en > 1 && this.dodgeT <= 0 && !(this.A && this.A.react)) {
      this.jetting = true; this.jetUsed = true; this.highJump = true;
      this.jetFuel -= dt; this.en -= 32 * dt;
      this.vel.y = Math.min(this.vel.y + 30 * dt, 4.6);
      this.vel.x += mx * 14 * dt; this.vel.z += mz * 14 * dt;
      const hs = Math.hypot(this.vel.x, this.vel.z); if (hs > 7.5) { this.vel.x *= 7.5 / hs; this.vel.z *= 7.5 / hs; }
      for (const sd of ['L', 'R']) { const fp = this.footPos(sd, _v); for (let i = 0; i < 2; i++) w.fx.fire(fp, _v2.set(rand(-0.5, 0.5), rand(-7, -4.5), rand(-0.5, 0.5)), rand(0.35, 0.55), 0.28); }
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
    if (!flying) this.vel.y -= (glide ? 7 : 21) * dt;
    if (glide && Math.random() < dt * 20) w.fx.wind(this.pos.clone().setY(this.pos.y + 0.2), _v.set(rand(-1, 1), -2, rand(-1, 1)), 0.5, 0.4);
    this.pos.addScaledVector(this.vel, dt);
    if (this.ext.lengthSq() > 1e-4) { this.pos.addScaledVector(this.ext, dt); this.ext.multiplyScalar(Math.exp(-(this.onGround ? 4 : 1.5) * dt)); } else this.ext.set(0, 0, 0);

    w.arena.collide(this);
    const gy = w.arena.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gy + 0.001) {
      if (!this.onGround && this.airTime > 0.28 && (!this.A || this.A.soft) && this.dodgeT <= 0 && !flying) { this.startAction(this.highJump && this.airTime > 0.5 ? 'landHigh' : 'land'); w.fx.dust(this.pos, this.highJump ? 12 : 6, 1.4); w.audio.step(1); }
      if (!this.onGround && this.highJump && this.el === 'earth' && this.airTime > 0.5 && !this.dead) { B.weapons.burst.spawn(this.pos.x, gy, this.pos.z, 0.3); w.shake(0.2, this.pos); w.audio.rumble(0.7); }   // heavy earth landing cracks the ground
      if (!this.onGround) { this.highJump = false; this.jetFuel = 0.8; }
      if (!this.onGround && this.jetUsed && this.el === 'fire' && !this.dead) {
        // a jet landing: the flames hit the ground and burst outward
        this.jetUsed = false; B.ring(this, 'fire', 2.4, 9, { dmg: 6, knock: 6, level: 1 }); w.shake(0.12, this.pos); w.audio.fireWhoosh(0.9);
      }
      this.pos.y = gy; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; this.airTime = 0; this.airJumps = 0;
    } else if (this.pos.y > gy + 0.03) {
      if (this.onGround && this.vel.y <= 0 && this.pos.y - gy < 0.5) { this.pos.y = gy; this.vel.y = 0; }
      else { this.onGround = false; this.airTime += dt; }
    } else this.pos.y = gy;
    this.groundY = gy;

    // ---- facing
    let wantYaw = null;
    if (this.dead || this.reacting() || restrained) wantYaw = null;
    else if (this.lungeT > 0) wantYaw = Math.atan2(this.lungeDir.x, this.lungeDir.z);
    else if (this.sprinting && mlen > 0.15) wantYaw = Math.atan2(mx, mz);
    else if (inp.strafe || this.guarding || this.holding || this.charging || (this.action && this.action !== 'land')) wantYaw = inp.faceYaw;
    else if (mlen > 0.15 && this.dodgeT <= 0) wantYaw = Math.atan2(mx, mz);
    if (wantYaw !== null && wantYaw !== undefined && this.dodgeT <= 0) {
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
    if (this.onGround && sp > 1.2 && Math.floor(prevPh / Math.PI) !== Math.floor(this.runPhase / Math.PI)) w.audio.step(Math.min(1, sp / 7) * L.heavy);

    this.animate(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    if (this.hero) { this.root.updateMatrixWorld(true); this.hero.drive(this, dt); }
    this.recLimbs();
    const f = this.flash, ch = this.charging ? Math.min(1, this.chargeT / 0.55) * (0.15 + 0.1 * Math.sin(this.time * 30)) : 0;
    const ec = new THREE.Color(this.style.color);
    this.material.emissive.setRGB(f * 0.9 + ch * ec.r, f * 0.25 + ch * ec.g, f * 0.15 + ch * ec.b);
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
    if (!this.onGround) return;
    const heading = sp > 1 ? Math.atan2(this.vel.x, this.vel.z) : this.faceYaw;
    if (el === 'fire') { this.mob = { kind: 'flame', el, t: 0, heading, speed: Math.max(sp, 6) }; this.dodgeT = 0; w.audio.fireWhoosh(1); return; }
    this.mob = { kind: 'surf', el, t: 0, speed: Math.max(sp, 4), heading }; this.dodgeT = 0; this.en -= 6;
    w.popup(this, el === 'water' ? 'ICE SURF' : 'ROCK SURF', false);
    if (el === 'water') { w.fx.splash(this.pos, 14); w.audio.splash(0.8); } else { w.fx.debrisBurst(this.pos.clone().setY(this.pos.y + 0.1), 14, 3, 0.1, 0x7a6a58); w.audio.rumble(0.8); }
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
      for (const sd of ['L', 'R']) { const fp = this.footPos(sd, _v); w.fx.fire(fp, _v2.set(-this.vel.x * 0.3 + rand(-0.5, 0.5), rand(0.5, 2), -this.vel.z * 0.3 + rand(-0.5, 0.5)), 0.4, 0.22); }
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

  jumpFx(air) {
    const w = this.world;
    if (this.el === 'fire') { this.vel.y += air ? 0 : 0.6; for (let i = 0; i < 10; i++) w.fx.fire(this.pos.clone().setY(this.pos.y + 0.1), _v.set(rand(-1.5, 1.5), rand(-2, 0.5), rand(-1.5, 1.5)), 0.5, 0.35); }
    if (this.el === 'air' || air) { w.fx.ring(this.pos, 1.6, 0xffffff, 0.35); for (let i = 0; i < 8; i++) w.fx.wind(this.pos.clone().setY(this.pos.y + 0.2), _v.set(rand(-3, 3), -1, rand(-3, 3)), 0.6, 0.4); w.audio.gust(air ? 0.7 : 0.4); }
    else w.audio.whoosh(0.4);
  }
  chargeFx() {
    const w = this.world, h = this.handPos(Math.random() < 0.5 ? 'L' : 'R', _v), full = this.chargeT >= 0.3 && this.legHoldT >= 0.85;
    if (this.el === 'fire') { if (Math.random() < 0.6) w.fx.fire(h, _v2.set(rand(-0.4, 0.4), 1, rand(-0.4, 0.4)), full ? 0.3 : 0.18, 0.25); }   // small: the body must stay readable
    else if (this.el === 'water') w.fx.splash(h, 1);
    else if (this.el === 'air') w.fx.wind(h, _v2.set(rand(-2, 2), 0.5, rand(-2, 2)), 0.4, 0.3);
    else w.fx.debrisBurst(this.pos.clone().setY(this.pos.y + 0.05), 1, 1.2, 0.06, 0x7a6a58, 0.5);
  }
  dodgeTrail() {
    const w = this.world, t = this.style.dodge.trail, p = _v.copy(this.pos).setY(this.pos.y + 0.3);
    if (t === 'fire') { for (let i = 0; i < 3; i++) w.fx.fire(p, _v2.set(-this.vel.x * 0.1 + rand(-0.5, 0.5), rand(0, 1.5), -this.vel.z * 0.1 + rand(-0.5, 0.5)), 0.5, 0.35); }
    else if (t === 'water') { if (Math.random() < 0.7) w.fx.splash(p, 2); }
    else if (t === 'air') { for (let i = 0; i < 2; i++) w.fx.wind(p.setY(this.pos.y + rand(0.2, 1.6)), _v2.set(-this.vel.x * 0.2, 0, -this.vel.z * 0.2), 0.5, 0.35); }
  }

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
    // Baguazhang: a sideways air dodge near the opponent walks a fast arc around them, ending at their flank
    const tg = this.target;
    if (this.el === 'air' && tg && !tg.dead && Math.abs(lz) < 0.7 && tg.pos.distanceTo(this.pos) < 7) {
      const lx = this.dodgeDir.x * c - this.dodgeDir.z * s;
      this.dodgeKind = 'circle'; this.circleDir = lx >= 0 ? -1 : 1;
      this.circleR = Math.max(1.8, Math.hypot(this.pos.x - tg.pos.x, this.pos.z - tg.pos.z));
      this.counterT = 0.75;   // ending at the flank opens a counter window
    }
    this.dodgeDur = this.dodgeKind === 'side' ? 0.26 : this.dodgeKind === 'back' ? 0.3 : this.dodgeKind === 'circle' ? 0.42 : D.dur;
    this.dodgeT = this.dodgeDur; this.dodgeCd = 0.42; this.invuln = this.dodgeDur * (D.iframes || 0.75); this.en -= 10;
    this.action = null; this.tech = null; this.spinYaw = 0;
    this.world.fx.dust(this.pos, 5, 1.2);
    if (this.el === 'air') this.world.audio.gust(0.6); else if (this.el === 'fire') this.world.audio.fireWhoosh(0.6); else this.world.audio.whoosh(0.6);
  }

  // level: -1 damage only, 0 flinch, 1 stagger, 2 knockdown
  takeHit(dmg, dir, knock, level) {
    level = level === true ? 1 : (level ?? 0);
    this.hp = Math.max(0, this.hp - dmg);
    if (level < 0) { this.flash = Math.max(this.flash, 0.35); if (this.hp <= 0) this.die(dir.lengthSq() ? dir : _v.set(0, 0, 1)); return; }
    this.flash = 1;
    this.vel.x += dir.x * knock; this.vel.z += dir.z * knock;
    if (level >= 1) this.vel.y = Math.max(this.vel.y, level === 2 ? 4.5 : 2.5);
    this.hitDir = dir.clone(); this.koDir = dir.clone(); this.hitAlt = !this.hitAlt;
    if (this.hp <= 0) { this.die(dir); return; }
    this.endHold(); this.charging = false; this.legHoldT = -1; this.lungeT = 0; this.dodgeT = 0;
    if (level >= 1) this.endMob();
    if (level === 2) { this.startAction('down'); this.stunT = 0; this.invuln = 0.9; this.onGround = false; }
    else if (level === 1) { this.startAction('stagger'); this.stunT = 0.5; }
    else { this.startAction('hit'); this.stunT = 0.2; }
  }

  die(dir) {
    this.dead = true; this.guarding = false; this.charging = false; this.endHold();
    this.world.bending.guardEnd(this);
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
const _axis = new THREE.Vector3(), _qi = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
