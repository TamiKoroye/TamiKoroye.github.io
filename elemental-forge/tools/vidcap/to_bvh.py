# Markerless motion capture, step 2: MediaPipe world landmarks -> a BVH skeleton animation (the "humanoid" rig of
# tools/retarget/retarget.js: Hips, Spine, Chest, Neck, Head, LeftShoulder, LeftUpperArm, LeftForeArm, LeftHand,
# LeftIndex1, LeftUpperLeg, LeftLowerLeg, LeftFoot, LeftToe, and the Right side).
# Each bone's world rotation is solved from the landmark positions: the bone points from its joint to the next joint,
# and its twist comes from the plane of the bent limb (elbow, knee) or from the hip / shoulder / ear lines for the
# body. Positions are smoothed first (Savitzky-Golay, gaps filled). Frame 0 is the rest T-pose (the baker uses it as
# the rest). The root has no travel (the capture is hip-centred); its height keeps the lower foot on the floor.
# Usage: python to_bvh.py <track.npz> <out.bvh> <start_s> <end_s> [smooth_window=9]
import sys, numpy as np
from scipy.signal import savgol_filter
from scipy.spatial.transform import Rotation as Rot
npz, out, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
win = int(sys.argv[5]) if len(sys.argv) > 5 else 9
d = np.load(npz); W, t, fps = d['world'].astype(np.float64), d['t'], float(d['fps'])
sel = (t >= a) & (t <= b); P = W[sel].copy()
# camera space (x right, y down, z away) -> game space (Y up, the performer facing +Z towards the camera, their left +X)
P = np.stack([P[..., 0], -P[..., 1], -P[..., 2]], -1)
# fill gaps, then smooth every coordinate over time
for j in range(33):
  for k in range(3):
    v = P[:, j, k]; bad = np.isnan(v)
    if bad.all(): continue
    if bad.any(): v[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), v[~bad])
    if len(v) > win: P[:, j, k] = savgol_filter(v, win, 2)
N = len(P)
L = lambda i: P[:, i]
mid = lambda i, j: (P[:, i] + P[:, j]) / 2
hip = mid(23, 24); sho = mid(11, 12); ear = mid(7, 8)
J = {   # joint positions per frame
  'Hips': hip, 'Spine': hip + (sho - hip) * 0.35, 'Chest': hip + (sho - hip) * 0.72, 'Neck': sho, 'Head': sho + (ear - sho) * 0.5,
  'HeadEnd': ear + (ear - sho) * 0.6,
  'LeftShoulder': sho + (L(11) - sho) * 0.25, 'LeftUpperArm': L(11), 'LeftForeArm': L(13), 'LeftHand': L(15), 'LeftIndex1': mid(17, 19),
  'RightShoulder': sho + (L(12) - sho) * 0.25, 'RightUpperArm': L(12), 'RightForeArm': L(14), 'RightHand': L(16), 'RightIndex1': mid(18, 20),
  'LeftUpperLeg': L(23), 'LeftLowerLeg': L(25), 'LeftFoot': L(27), 'LeftToe': L(31),
  'RightUpperLeg': L(24), 'RightLowerLeg': L(26), 'RightFoot': L(28), 'RightToe': L(32),
}
nrm = lambda v: v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)
def frame_from(x, y):   # rotation matrices with columns x, y, z from an x direction and an approximate y
  x = nrm(x); y = nrm(y - x * np.sum(x * y, -1, keepdims=True)); z = np.cross(x, y); return np.stack([x, y, z], -1)
def aim(dirv, side, rest_dir, rest_side):
  # world rotation taking rest_dir to dirv and rest_side (perpendicular) to side (orthogonalised)
  A = frame_from(dirv, side); B = frame_from(np.broadcast_to(rest_dir, dirv.shape), np.broadcast_to(rest_side, dirv.shape))
  return A @ np.transpose(B, (0, 2, 1))
up = np.array([0, 1.0, 0]); X = np.array([1.0, 0, 0]); Z = np.array([0, 0, 1.0])
WR = {}
WR['Hips'] = aim(L(23) - L(24), J['Chest'] - hip, X, up)
WR['Spine'] = aim(L(23) * 0.5 + L(11) * 0.5 - (L(24) * 0.5 + L(12) * 0.5), J['Chest'] - J['Spine'], X, up)
WR['Chest'] = aim(L(11) - L(12), J['Neck'] - J['Chest'], X, up)
WR['Neck'] = WR['Chest']
WR['Head'] = aim(L(7) - L(8), J['HeadEnd'] - J['Head'], X, up)
for S, sg in (('Left', 1), ('Right', -1)):
  chest_fwd = WR['Chest'][:, :, 2]
  # arm: rest points along +-X; the elbow's bend plane gives the twist (rest: the forearm bends forward, +Z)
  ua, fa = J[S + 'ForeArm'] - J[S + 'UpperArm'], J[S + 'Hand'] - J[S + 'ForeArm']
  bend = np.cross(ua, fa); weak = np.linalg.norm(bend, axis=-1) < 1e-3 * np.linalg.norm(ua, axis=-1) * np.linalg.norm(fa, axis=-1) + 1e-6
  ref = np.where(weak[:, None], np.cross(ua, chest_fwd), bend)
  rest_bend = np.cross(sg * X, Z)
  WR[S + 'Shoulder'] = aim(J[S + 'UpperArm'] - J[S + 'Shoulder'], WR['Chest'][:, :, 1], sg * X, up)
  WR[S + 'UpperArm'] = aim(ua, ref, sg * X, rest_bend)
  WR[S + 'ForeArm'] = aim(fa, ref, sg * X, rest_bend)
  hd = J[S + 'Index1'] - J[S + 'Hand']
  thumb = L(21 if S == 'Left' else 22) - J[S + 'Hand']
  WR[S + 'Hand'] = aim(hd, np.cross(hd, thumb) * sg, sg * X, -up)
  # leg: rest points down; the knee's bend plane gives the twist (rest: the shin bends back, -Z)
  th, sh = J[S + 'LowerLeg'] - J[S + 'UpperLeg'], J[S + 'Foot'] - J[S + 'LowerLeg']
  kb = np.cross(th, sh); hipx = WR['Hips'][:, :, 0]
  kweak = np.linalg.norm(kb, axis=-1) < 0.02 * np.linalg.norm(th, axis=-1) * np.linalg.norm(sh, axis=-1) + 1e-6
  kref = np.where(kweak[:, None], hipx, kb)
  rest_kb = np.cross(-up, -Z)
  WR[S + 'UpperLeg'] = aim(th, kref, -up, rest_kb)
  WR[S + 'LowerLeg'] = aim(sh, kref, -up, rest_kb)
  ft = J[S + 'Toe'] - J[S + 'Foot']
  WR[S + 'Foot'] = aim(ft, np.cross(ft, up) * -1 + 1e-6, Z, np.cross(Z, up) * -1)
  WR[S + 'Toe'] = WR[S + 'Foot']; WR[S + 'Index1'] = WR[S + 'Hand']
# hierarchy (rest offsets: mean bone lengths along the rest directions)
H = [('Hips', None), ('Spine', 'Hips'), ('Chest', 'Spine'), ('Neck', 'Chest'), ('Head', 'Neck')]
for S in ('Left', 'Right'):
  H += [(S + 'Shoulder', 'Chest'), (S + 'UpperArm', S + 'Shoulder'), (S + 'ForeArm', S + 'UpperArm'), (S + 'Hand', S + 'ForeArm'), (S + 'Index1', S + 'Hand')]
for S in ('Left', 'Right'):
  H += [(S + 'UpperLeg', 'Hips'), (S + 'LowerLeg', S + 'UpperLeg'), (S + 'Foot', S + 'LowerLeg'), (S + 'Toe', S + 'Foot')]
blen = lambda c, p: float(np.nanmedian(np.linalg.norm(J[c] - J[p], axis=-1)))
def rest_off(c, p):
  if p is None: return np.zeros(3)
  l = blen(c, p); sg = 1 if c.startswith('Left') else -1
  if c in ('Spine', 'Chest', 'Neck', 'Head'): return np.array([0, l, 0])
  if c.endswith('Shoulder'): return np.array([sg * 0.04, blen('Neck', 'Chest') * 0.85, 0])
  if c.endswith(('UpperArm', 'ForeArm', 'Hand', 'Index1')): return np.array([sg * l, 0, 0])
  if c.endswith('UpperLeg'): return np.array([sg * blen(c, 'Hips'), -0.05, 0])
  if c.endswith(('LowerLeg', 'Foot')): return np.array([0, -l, 0])
  if c.endswith('Toe'): return np.array([0, 0, l])
OFF = {c: rest_off(c, p) for c, p in H}
# local rotations
LR = {}
for c, p in H:
  LR[c] = WR[c] if p is None else np.transpose(WR[p], (0, 2, 1)) @ WR[c]
# root height: the hips sit at the height that keeps the lower ankle just above the floor
footY = np.minimum(J['LeftFoot'][:, 1], J['RightFoot'][:, 1]) - hip[:, 1]
root = np.zeros((N, 3)); root[:, 1] = -footY + 0.08
children = {}
for c, p in H: children.setdefault(p, []).append(c)
lines = ['HIERARCHY']
def write(c, depth):
  ind = '  ' * depth; o = OFF[c]
  lines.append(f'{ind}{"ROOT" if depth == 0 else "JOINT"} {c}'); lines.append(ind + '{')
  lines.append(f'{ind}  OFFSET {o[0]:.5f} {o[1]:.5f} {o[2]:.5f}')
  lines.append(f'{ind}  CHANNELS {"6 Xposition Yposition Zposition " if depth == 0 else "3 "}Zrotation Xrotation Yrotation')
  kids = children.get(c, [])
  for k in kids: write(k, depth + 1)
  if not kids: lines.extend([ind + '  End Site', ind + '  {', ind + '    OFFSET 0 0 0.02', ind + '  }'])
  lines.append(ind + '}')
write('Hips', 0)
order = []; walk = lambda c: (order.append(c), [walk(k) for k in children.get(c, [])]); walk('Hips')
lines += ['MOTION', f'Frames: {N + 1}', f'Frame Time: {1 / fps:.6f}']
rest = '0 ' + f'{root[:, 1].mean():.5f}' + ' 0 ' + ' '.join(['0 0 0'] * len(order))
lines.append(rest)
E = {c: Rot.from_matrix(LR[c]).as_euler('ZXY', degrees=True) for c in order}
for i in range(N):
  row = [f'0 {root[i, 1]:.5f} 0']
  for c in order: row.append(' '.join(f'{v:.3f}' for v in E[c][i]))
  lines.append(' '.join(row))
open(out, 'w').write('\n'.join(lines) + '\n')
print('wrote', out, N, 'frames', f'{N / fps:.2f} s')
