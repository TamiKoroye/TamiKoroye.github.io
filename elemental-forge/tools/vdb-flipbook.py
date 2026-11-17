# Renders an EmberGen (JangaFX, CC0) OpenVDB fire / explosion sequence into a flipbook sprite sheet for the game.
# Each frame is ray-marched orthographically along one axis: the flame and temperature channels give emission
# (a black-body style ramp: deep red at the edges, orange, then a pale yellow core), the density channel (smoke,
# where present) absorbs. Output: an RGBA PNG atlas (straight alpha) plus a JSON description.
# Usage: /usr/bin/python3.12 tools/vdb-flipbook.py <vdb dir> <prefix> <out.png> [frames=64] [cell=256] [axis=y]
#        [first=0] [last=-1] [gain=1.0] [smoke=1]
import sys, os, json, glob, re
import numpy as np
import pyopenvdb as vdb
from PIL import Image

src, prefix, out = sys.argv[1], sys.argv[2], sys.argv[3]
N = int(sys.argv[4]) if len(sys.argv) > 4 else 64
CELL = int(sys.argv[5]) if len(sys.argv) > 5 else 256
AXIS = sys.argv[6] if len(sys.argv) > 6 else 'y'
FIRST = int(sys.argv[7]) if len(sys.argv) > 7 else 0
LAST = int(sys.argv[8]) if len(sys.argv) > 8 else -1
GAIN = float(sys.argv[9]) if len(sys.argv) > 9 else 1.0
SMOKE = float(sys.argv[10]) if len(sys.argv) > 10 else 1.0
BASE = int(sys.argv[11]) if len(sys.argv) > 11 else 0     # voxels at the bottom faded out (the source emitter)

files = sorted(glob.glob(os.path.join(src, prefix + '*.vdb')), key=lambda f: int(re.findall(r'(\d+)\.vdb$', f)[0]))
if LAST < 0: LAST = len(files) - 1
pick = [files[int(round(FIRST + (LAST - FIRST) * i / max(1, N - 1)))] for i in range(N)]

def grids(f):
  out = {}
  for g in vdb.readAll(f)[0]:
    out[g.name] = g
  return out

# one bounding box for the whole sequence (so the effect grows inside a fixed frame)
lo = np.array([1e9] * 3); hi = np.array([-1e9] * 3)
for f in pick:
  for g in vdb.readAllGridMetadata(f):
    if g.name in ('flames', 'temperature', 'density'):
      a, b = g.metadata.get('file_bbox_min'), g.metadata.get('file_bbox_max')
      if a is None: continue
      lo = np.minimum(lo, a); hi = np.maximum(hi, b)
lo = lo.astype(int); hi = hi.astype(int)
shape = tuple((hi - lo + 1).tolist())
print('bbox', lo, hi, 'shape', shape, 'frames', len(pick))

def dense(g):
  a = np.zeros(shape, dtype=np.float32)
  g.copyToArray(a, ijk=tuple(lo.tolist()))
  return a

# emission colour ramp over normalised heat 0..1
ramp_t = np.array([0.0, 0.18, 0.4, 0.62, 0.82, 1.0])
ramp_c = np.array([[0.25, 0.02, 0.0], [0.75, 0.10, 0.01], [1.0, 0.35, 0.03], [1.0, 0.62, 0.12], [1.0, 0.86, 0.45], [1.0, 0.97, 0.85]])
def ramp(h):
  r = np.stack([np.interp(h, ramp_t, ramp_c[:, k]) for k in range(3)], -1)
  return r

ax = {'x': 0, 'y': 1, 'z': 2}[AXIS]
cols = int(np.ceil(np.sqrt(N))); rows = int(np.ceil(N / cols))
atlas = Image.new('RGBA', (cols * CELL, rows * CELL), (0, 0, 0, 0))
# global normalisation from a mid-sequence frame
mx_fl = 1e-6; mx_t = 1e-6
for f in pick[len(pick) // 3: len(pick) // 3 + 3]:
  G = grids(f)
  if 'flames' in G: mx_fl = max(mx_fl, float(np.percentile(dense(G['flames'])[dense(G['flames']) > 0], 99)) if (dense(G['flames']) > 0).any() else 1)
  if 'temperature' in G: tt = dense(G['temperature']); mx_t = max(mx_t, float(np.percentile(tt[tt > 0], 99)) if (tt > 0).any() else 1)
print('norm flames', mx_fl, 'temperature', mx_t)

for i, f in enumerate(pick):
  G = grids(f)
  fl = dense(G['flames']) / mx_fl if 'flames' in G else None
  te = dense(G['temperature']) / mx_t if 'temperature' in G else None
  de = dense(G['density']) if 'density' in G else None
  heat = np.clip(te if te is not None else fl, 0, 1.4)
  em_amt = np.clip((fl if fl is not None else te) * 1.0, 0, 2)
    # EmberGen exports Z-up: image rows follow z, the march runs along AXIS (x or y), columns along the other one
  hor = [d for d in (0, 1) if d != ax][0]
  perm = (hor, 2, ax)
  if BASE > 0:
    zf = np.clip((np.arange(shape[2]) + lo[2] - BASE * 0.4) / (BASE * 0.6), 0, 1).astype(np.float32)
    em_amt = em_amt * zf[None, None, :]; heat = heat * zf[None, None, :]
  em_amt = np.transpose(em_amt, perm); heat = np.transpose(heat, perm)
  if de is not None: de = np.transpose(de, perm)
  W, H, D = em_amt.shape
  col = np.zeros((W, H, 3), np.float32); T = np.ones((W, H), np.float32)
  step = 1.0
  for k in range(D):
    e = em_amt[:, :, k]; h = heat[:, :, k]
    hh = np.clip(h, 0, 1) ** 2.2   # most of the flame orange; only the hottest cores reach yellow-white
    c = ramp(hh) * (0.55 + 1.1 * hh)[..., None]
    a_e = 1 - np.exp(-e * 0.35 * GAIN * step)
    a_s = (1 - np.exp(-de[:, :, k] * 0.08 * SMOKE * step)) if de is not None else 0
    col += (T * a_e)[..., None] * c
    if de is not None: col += (T * a_s)[..., None] * (np.array([0.09, 0.075, 0.065]) + 0.5 * c * np.clip(e, 0, 1)[..., None]) * (1 - a_e)[..., None]   # smoke, lit from inside by the flames
    T *= (1 - np.clip(a_e + a_s, 0, 1))
  alpha = np.clip(1 - T, 0, 1)
  rgb = np.where(alpha[..., None] > 1e-4, col / np.maximum(alpha, 1e-4)[..., None], 0)
  img = np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], -1)
  img = np.transpose(img, (1, 0, 2))[::-1]          # rows = height, top first
  im = Image.fromarray((img * 255).astype(np.uint8), 'RGBA')
  s = CELL / max(im.size); im = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS)
  cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0)); cell.paste(im, ((CELL - im.size[0]) // 2, CELL - im.size[1]))
  atlas.paste(cell, ((i % cols) * CELL, (i // cols) * CELL))
  print('frame', i, os.path.basename(f), 'coverage', round(float((alpha > 0.05).mean()), 3), flush=True)

atlas.save(out, optimize=True)
json.dump({'grid': [cols, rows], 'cell': [CELL, CELL], 'frames': N, 'pivot': [0.5, 0.0], 'alpha': 'straight',
  'source': 'JangaFX EmberGen ' + prefix + ' (CC0), rendered by tools/vdb-flipbook.py', 'axis': AXIS},
  open(os.path.splitext(out)[0] + '.json', 'w'), indent=1)
print('wrote', out)
