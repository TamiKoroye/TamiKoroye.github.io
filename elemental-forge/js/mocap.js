// Authored martial-arts motion: motion-capture clips (CMU Graphics Lab Motion Capture Database) retargeted
// offline onto the mannequin skeleton by tools/retarget (see tools/retarget/martial-spec.json for the takes).
// Each clip is stored twice: as captured and mirrored ("_M"), so either side can strike.
// A technique opts in with `clip: '<name>'`; adoptTiming() then retimes the technique to the clip so the
// clip's impact frame lines up with the technique's event and hit window.
import * as THREE from 'three';

export const MOCAP = {};
export const hasMocap = () => Object.keys(MOCAP).length > 0;

export async function loadMocap(url = 'assets/animations/martial.json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error('mocap pack ' + r.status);
  const d = await r.json();
  for (const j of d.clips) MOCAP[j.name] = { clip: THREE.AnimationClip.parse(j), impact: j.impact, limb: j.limb };
  return MOCAP;
}

// playback speed relative to the capture, per style (earth heavy, fire and air quick, water measured)
const SPEED = { earth: 1.5, fire: 1.8, water: 1.45, air: 1.7 };

function techList(st) {
  const t = st.tech; return [t.hand, ...(t.leg || []), t.charged, t.special].filter(Boolean);
}

// Rewrites dur / events / active window / jump / cancel of every technique that names a clip, keeping each
// timing's offset from the impact in seconds. Spins come from the captured body rotation, so the
// procedural whole-body spin is dropped for those techniques.
export function adoptTiming(styles) {
  for (const st of Object.values(styles)) for (const T of techList(st)) {
    const m = T.clip && MOCAP[T.clip]; if (!m) continue;
    const sp = T.clipSpeed || SPEED[st.key] || 1.5;
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
    T.dur = dur; T.clipTS = sp;
  }
}

// which stored clip to play: the captured one or its mirror, so the striking limb matches the side the
// game's effects launch from (side > 0: right hand / left foot)
export function clipFor(T, side) {
  const m = MOCAP[T.clip]; if (!m) return null;
  const kind = m.limb[0], want = kind + (kind === 'p' ? (side > 0 ? 'R' : 'L') : (side > 0 ? 'L' : 'R'));
  return m.limb === want ? T.clip : T.clip + '_M';
}
