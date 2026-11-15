// Authored martial-arts motion, retargeted offline onto the mannequin by tools/retarget
// (tools/retarget/martial-spec.json lists every take). Sources: the Mixamo and Rokoko files supplied for this
// project, plus a few CMU motion-capture takes. Strikes are stored twice, as captured and mirrored ("_M"), so
// either side can strike. A technique opts in with `clip: 'name'` (or a list that alternates); adoptTiming()
// retimes the technique so the clip's impact frame lines up with its event and hit window. Each element also
// has authored loops for its stance, guard and sustained bending (LOOPS).
import * as THREE from 'three';

export const MOCAP = {};
export const hasMocap = () => Object.keys(MOCAP).length > 0;

export async function loadMocap(url = 'assets/animations/martial.json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error('mocap pack ' + r.status);
  const d = await r.json();
  for (const j of d.clips) MOCAP[j.name] = { clip: j.q ? unpack(j, d.fps || 30) : THREE.AnimationClip.parse(j), impact: j.impact, limb: j.limb, loop: !!j.loop, travel: j.travel };
  return MOCAP;
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
    const m = T.clip && MOCAP[names(T)[0]]; if (!m) continue;
    const sp = T.clipSpeed || CLIP_SPEED[names(T)[0]] || SPEED[st.key] || 1.5;
    const oldDur = T.dur, dur = m.clip.duration / sp;
    const u0 = T.events && T.events.length ? T.events[0][0] : (T.active ? T.active.from : 0.4);
    const evU = m.impact / m.clip.duration;
    const map = (u) => THREE.MathUtils.clamp(evU + (u - u0) * oldDur / dur, 0, 0.98);
    if (T.events) T.events = T.events.map(([u, n]) => [map(u), n]);
    if (T.active) T.active = { ...T.active, from: map(T.active.from), to: Math.max(map(T.active.to), map(T.active.from) + 0.08) };
    if (T.jumpAt) T.jumpAt = [map(T.jumpAt[0]), T.jumpAt[1]];
    // combos open shortly after the impact frame; the next clip crossfades over the remaining recovery
    if (T.cancel !== undefined) T.cancel = THREE.MathUtils.clamp(Math.min(map(T.cancel), evU + 0.15 / dur), evU + 0.05, 0.95);
    if (T.spin) delete T.spin;
    T.dur = dur; T.impactT = evU * dur;
  }
}

// which stored clip to play: (for alternating techniques) which take, then the captured one or its mirror, so the
// striking limb matches the side the game's effects launch from (side > 0: right hand / left foot).
// Returns [clip name, time scale that lands the clip's impact on the technique's impact time]
export function clipFor(T, side, n = 0) {
  const list = names(T), base = list[n % list.length], m = MOCAP[base]; if (!m) return [null, 1];
  let name = base;
  if (m.limb) {
    const kind = m.limb[0], want = kind + (kind === 'p' ? (side > 0 ? 'R' : 'L') : (side > 0 ? 'L' : 'R'));
    if (m.limb !== want && MOCAP[base + '_M']) name = base + '_M';
  }
  const ts = m.impact !== undefined && T.impactT ? THREE.MathUtils.clamp(m.impact / T.impactT, 0.6, 3) : 1;
  return [name, ts];
}
