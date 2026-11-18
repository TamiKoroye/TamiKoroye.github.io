// Jitter check for baked clips, run before any clip goes into the game.
// For every rotation track it samples the clip at the game's frame rate (60 fps of game time at the given playback
// speed) and measures each joint's angular velocity frame to frame. A "reversal" is a frame where a joint that is
// moving clearly (above MIN deg/frame) swings back the way it came on the very next frame. Real motion reverses a few
// times per move (a punch out and back); the twitching Tai Chi captures reversed many times per second on many joints.
// Usage: node tools/retarget/jitter.mjs <pack.json> [names,comma,separated | all] [speed=1.5] [--json]
// Prints per clip: reversals per second (all joints), the worst joint, and the largest single-frame step.
// This is information for review, not the gate: fast clean moves (the shipped whips at speed 2.5: 40-47 reversals/s) score as
// high as noisy ones, because a snap or a spin reverses by design. The gate is tests/jitter-play-test.mjs, which
// measures the rendered fighter in play and was calibrated on the twitching r18 build.
import fs from 'node:fs';
const [PACK, NAMES = 'all', SPEED = '1.5'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const asJson = process.argv.includes('--json');
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const MIN = 1.5;           // deg per frame below which a joint counts as still (noise on a still joint is not visible)

const slerp = (q, i0, i1, f) => {
  let [ax, ay, az, aw] = q.slice(i0 * 4, i0 * 4 + 4), [bx, by, bz, bw] = q.slice(i1 * 4, i1 * 4 + 4);
  let d = ax * bx + ay * by + az * bz + aw * bw; if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
  // normalised lerp is enough between 30 fps keys
  const x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f, w = aw + (bw - aw) * f, n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
};
const sample = (tr, t) => {
  const T = tr.times; if (t <= T[0]) return slerp(tr.values, 0, 0, 0);
  if (t >= T[T.length - 1]) return slerp(tr.values, T.length - 1, T.length - 1, 0);
  let i = 0; while (T[i + 1] < t) i++;
  return slerp(tr.values, i, i + 1, (t - T[i]) / (T[i + 1] - T[i]));
};
// angular velocity (axis * angle, degrees) taking q0 to q1: log(q1 * conj(q0))
const omega = (a, b) => {
  const [x0, y0, z0, w0] = a, [x1, y1, z1, w1] = b;
  let x = w1 * -x0 + x1 * w0 + y1 * -z0 - z1 * -y0, y = w1 * -y0 + y1 * w0 + z1 * -x0 - x1 * -z0,
      z = w1 * -z0 + z1 * w0 + x1 * -y0 - y1 * -x0, w = w1 * w0 - x1 * -x0 - y1 * -y0 - z1 * -z0;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z); if (s < 1e-9) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, w) * 57.2958; return [x / s * ang, y / s * ang, z / s * ang];
};

// the game pack stores tracks as base64 int16 (see js/mocap.js unpack); raw bakes are AnimationClip.toJSON
const unpackTrack = (t, fps) => {
  if (!t.d) return t;
  const b = Buffer.from(t.d, 'base64'), a = new Int16Array(b.buffer, b.byteOffset, b.length / 2), st = t.k === 'q' ? 4 : 3;
  const k = t.k === 'q' ? 1 / 32767 : 1 / 1000, n = a.length / st;
  return { name: t.n + (t.k === 'q' ? '.quaternion' : '.position'), times: Array.from({ length: n }, (_, i) => i / fps), values: Array.from(a, v => v * k) };
};
for (const c of pack.clips) c.tracks = c.tracks.map(t => unpackTrack(t, pack.fps || 30));
const want = NAMES === 'all' ? null : new Set(NAMES.split(','));
const rows = [];
for (const c of pack.clips) {
  if (want && !want.has(c.name)) continue;
  const dur = c.duration, dt = (1 / 60) * +SPEED;
  const qt = c.tracks.filter(t => t.name.endsWith('.quaternion') && !/finger|thumb|f_|palm/i.test(t.name));
  let rev = 0, worstStep = 0; const perJoint = {};
  for (const tr of qt) {
    const tt = { times: tr.times, values: tr.values };
    let prev = null, n = 0;
    for (let t = 0; t + dt <= dur + 1e-6; t += dt) {
      const w = omega(sample(tt, t), sample(tt, t + dt)), m = Math.hypot(...w);
      worstStep = Math.max(worstStep, m);
      if (prev) {
        const pm = Math.hypot(...prev), cos = (w[0] * prev[0] + w[1] * prev[1] + w[2] * prev[2]) / (m * pm || 1);
        if (m > MIN && pm > MIN && cos < -0.3) n++;
      }
      prev = w;
    }
    rev += n; perJoint[tr.name.replace('.quaternion', '')] = n;
  }
  const secs = dur / +SPEED || 1;
  const [wj, wn] = Object.entries(perJoint).sort((a, b) => b[1] - a[1])[0] || ['-', 0];
  const rate = rev / secs, jrate = wn / secs;
  rows.push({ name: c.name, dur: +dur.toFixed(2), revPerSec: +rate.toFixed(1), worstJoint: wj, worstJointPerSec: +jrate.toFixed(1), maxStepDeg: +worstStep.toFixed(1) });
}
if (asJson) console.log(JSON.stringify(rows, null, 1));
else for (const r of rows) console.log(`${r.name.padEnd(24)} ${String(r.revPerSec).padStart(5)} rev/s  worst ${r.worstJoint} ${r.worstJointPerSec}/s  max step ${r.maxStepDeg} deg`);
