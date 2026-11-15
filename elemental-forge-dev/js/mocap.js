// Authored martial-arts motion, retargeted offline onto the mannequin by tools/retarget
// (tools/retarget/martial-spec.json lists every take). Sources: the Mixamo and Rokoko files supplied for this
// project, plus a few CMU motion-capture takes. Strikes are stored twice, as captured and mirrored ("_M"), so
// either side can strike. A technique opts in with `clip: 'name'` (or a list that alternates); adoptTiming()
// retimes the technique so the clip's impact frame lines up with its event and hit window. Each element also
// has authored loops for its stance, guard and sustained bending (LOOPS).
import * as THREE from 'three';

export const MOCAP = {};
export const hasMocap = () => Object.keys(MOCAP).length > 0;

// The pack is an ES module (assets/animations/martial.js), loaded like the game's own code: no fetch/XHR, which
// some embedded hosts block. Every clip is decoded and checked; the result reports what actually decoded.
export const PACK_STATUS = { expected: 0, decoded: 0, errors: [] };
export async function loadMocap() {
  let mod;
  try { mod = await import('../assets/animations/martial.js'); }
  catch (e) { PACK_STATUS.errors.push('animation pack module assets/animations/martial.js did not load: ' + (e && e.message || e)); throw new Error(PACK_STATUS.errors[0]); }
  const d = mod.default; PACK_STATUS.expected = mod.CLIP_COUNT || (d && d.clips ? d.clips.length : 0);
  if (!d || !Array.isArray(d.clips)) throw new Error('animation pack has no clips');
  for (const j of d.clips) {
    try {
      const clip = j.q ? unpack(j, d.fps || 30) : THREE.AnimationClip.parse(j);
      if (!(clip.duration > 0) || !clip.tracks.length) throw new Error('empty clip');
      for (const t of clip.tracks) if (!t.values.length || t.values.some(v => !Number.isFinite(v))) throw new Error('bad values in ' + t.name);
      MOCAP[j.name] = { clip, impact: j.impact, limb: j.limb, loop: !!j.loop, travel: j.travel, src: j.src };
      PACK_STATUS.decoded++;
    } catch (e) { PACK_STATUS.errors.push(`clip ${j.name}: ${e.message || e}`); }
  }
  return MOCAP;
}
// every clip the game refers to (techniques, stances, guards, holds, reactions); used by the loading check
export function requiredClips(styles) {
  const need = new Set(['hit_a', 'hit_b', 'ko', 'getup', 'dodge_side', 'dodge_side_M', 'dodge_back', 'block_hit', 'strafe', 'strafe_M', 'water_redirect']);
  for (const L of Object.values(LOOPS)) for (const n of Object.values(L)) need.add(n);
  for (const st of Object.values(styles)) { const t = st.tech; for (const T of [t.hand, ...(t.leg || []), t.charged, t.special]) if (T && T.clip) for (const n of (Array.isArray(T.clip) ? T.clip : [T.clip])) need.add(n); }
  return [...need].filter(n => !MOCAP[n]);
}

// tracks stored as base64 int16 (quaternions x 32767, positions in millimetres), sampled at a fixed rate
export function unpack(j, fps) {
  const tracks = j.tracks.map(t => {
    const bin = atob(t.d), a = new Int16Array(bin.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    const st = t.k === 'q' ? 4 : 3, n = a.length / st, times = new Float32Array(n), vals = new Float32Array(a.length);
    for (let i = 0; i < n; i++) times[i] = i / fps;
    const k = t.k === 'q' ? 1 / 32767 : 1 / 1000;
    for (let i = 0; i < a.length; i++) vals[i] = a[i] * k;
    if (st === 4) for (let i = 0; i < n; i++) { const o = i * 4, l = Math.hypot(vals[o], vals[o + 1], vals[o + 2], vals[o + 3]) || 1; for (let c = 0; c < 4; c++) vals[o + c] /= l; }
    return t.k === 'q' ? new THREE.QuaternionKeyframeTrack(t.n, times, vals) : new THREE.VectorKeyframeTrack(t.n, times, vals);
  });
  return new THREE.AnimationClip(j.name, j.duration, tracks);
}

// per element: combat stance, guard hold and sustained-bending hold
export const LOOPS = {
  earth: { idle: 'earth_idle', guard: 'earth_guard', hold: 'earth_lift' },
  fire: { idle: 'fire_idle', guard: 'fire_guard', hold: 'fire_stream' },
  water: { idle: 'water_idle', guard: 'water_guard', hold: 'water_draw' },
  air: { idle: 'air_idle', guard: 'air_guard', hold: 'air_push' },
};

// playback speed relative to the capture, per style (earth heavy, fire and air quick, water measured);
// individual clips can override it (the tai chi take is performed very slowly)
const SPEED = { earth: 1.45, fire: 1.75, water: 1.45, air: 1.65 };
const CLIP_SPEED = { water_palm: 2.3, water_tidal: 2.0, water_sphere: 1.5, earth_stomp: 1.6, earth_pillar: 1.7, fire_orb: 1.5, air_vortex: 1.6, earth_sweep: 1.5, fire_spin: 1.5 };

const names = (T) => (Array.isArray(T.clip) ? T.clip : [T.clip]);
function techList(st) {
  const t = st.tech; return [t.hand, ...(t.leg || []), t.charged, t.special].filter(Boolean);
}

// Rewrites dur / events / active window / jump / cancel of every technique that names a clip, keeping each
// timing's offset from the impact in seconds. Spins come from the captured body rotation, so the
// procedural whole-body spin is dropped for those techniques.
export function adoptTiming(styles) {
  for (const st of Object.values(styles)) for (const T of techList(st)) {
    if (!T.clip) continue;
    const list = names(T).filter(n => MOCAP[n]); if (!list.length) continue;
    const orig = { dur: T.dur, events: T.events, active: T.active, jumpAt: T.jumpAt, cancel: T.cancel };
    // every alternative take gets its own timing, so each plays at its proper speed with its impact on the hit
    const timings = list.map(n => timing(orig, n, T.clipSpeed || CLIP_SPEED[n] || SPEED[st.key] || 1.5));
    Object.assign(T, timings[0]); T.clip = list[0];
    if (T.spin) delete T.spin;
    if (list.length > 1) T.variants = timings.map(tm => Object.assign(Object.create(T), tm, { variantOf: T }));
  }
}
function timing(orig, name, sp) {
  const m = MOCAP[name];
  const dur = m.clip.duration / sp;
  const u0 = orig.events && orig.events.length ? orig.events[0][0] : (orig.active ? orig.active.from : 0.4);
  const evU = m.impact / m.clip.duration;
  const map = (u) => THREE.MathUtils.clamp(evU + (u - u0) * orig.dur / dur, 0, 0.98);
  const out = { clip: name, dur, impactT: evU * dur };
  if (orig.events) out.events = orig.events.map(([u, n]) => [map(u), n]);
  if (orig.active) out.active = { ...orig.active, from: map(orig.active.from), to: Math.max(map(orig.active.to), map(orig.active.from) + 0.08) };
  if (orig.jumpAt) out.jumpAt = [map(orig.jumpAt[0]), orig.jumpAt[1]];
  // the next technique can start 0.22 s after the impact: the strike's follow-through shows, the next one
  // crossfades over the rest of the recovery
  if (orig.cancel !== undefined) out.cancel = THREE.MathUtils.clamp(Math.min(map(orig.cancel), evU + 0.22 / dur), evU + 0.05, 0.95);
  return out;
}

// which stored clip to play: (for alternating techniques) which take, then the captured one or its mirror, so the
// striking limb matches the side the game's effects launch from (side > 0: right hand / left foot).
// Returns [clip name, time scale that lands the clip's impact on the technique's impact time]
export function clipFor(T, side) {
  const base = T.clip, m = MOCAP[base]; if (!m) return [null, 1];
  let name = base;
  if (m.limb) {
    const kind = m.limb[0], want = kind + (kind === 'p' ? (side > 0 ? 'R' : 'L') : (side > 0 ? 'L' : 'R'));
    if (m.limb !== want && MOCAP[base + '_M']) name = base + '_M';
  }
  const ts = m.impact !== undefined && T.impactT ? THREE.MathUtils.clamp(m.impact / T.impactT, 0.6, 3) : 1;
  return [name, ts];
}
