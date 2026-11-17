# Lays the game's sounds under the capture videos. The capture script (tests/record-m5-closeups.mjs) steps the game
# faster than real time, so the live audio cannot be recorded; instead it logs every sound the game played (which
# take, pitch, volume, pan, and on which frame) and every looping sound held per frame. This renders exactly those
# takes from the sound bank onto each scenario's timeline and muxes the result into <scenario>_sound.mp4.
# Usage: python3 -I tools/sfx-mux.py <capture dir> [assets/sfx]
import sys, os, json, subprocess, numpy as np

CAP = sys.argv[1]; SFX = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'sfx')
SR = 44100; FPS = 30
bank = json.load(open(os.path.join(SFX, 'bank.json')))['sounds']
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SFX, 'bank.ogg'), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
B = np.frombuffer(raw, np.float32)
ev = json.load(open(os.path.join(CAP, 'sound-events.json')))

def clip(name, take):
  t0, d = bank[name]['takes'][take]; return B[int(t0 * SR): int((t0 + d) * SR)]

def resample(a, rate):
  if abs(rate - 1) < 1e-3: return a
  n = int(len(a) / rate); return np.interp(np.arange(n) * rate, np.arange(len(a)), a).astype(np.float32)

def put(out, a, at, vol, pan):
  i = int(at * SR); a = a * vol
  if i >= out.shape[1]: return
  a = a[: out.shape[1] - i]
  l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)   # equal-power pan, like the StereoPanner
  out[0, i:i + len(a)] += a * l * np.sqrt(2) * 0.707; out[1, i:i + len(a)] += a * r * np.sqrt(2) * 0.707

made = []
for mp4 in sorted(f for f in os.listdir(CAP) if f.endswith('.mp4') and f != 'all.mp4' and not f.endswith('_sound.mp4')):
  scen = mp4[:-4]
  dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', os.path.join(CAP, mp4)], capture_output=True, text=True).stdout)
  out = np.zeros((2, int((dur + 1) * SR)), np.float32)
  import re; key = lambda s: re.sub(r'[^a-zA-Z0-9]+', '_', s or '')
  n = 0
  for e in ev['plays']:
    if key(e['scen']) != scen: continue
    put(out, resample(clip(e['name'], e['take']), e['rate']), (e['f'] - 1) / FPS + e['delay'], e['vol'], e['pan'] or 0); n += 1
  # loops: a continuous loop per key, its gain following the held volume frame by frame (fading out when released)
  holds = {}
  for h in ev['holds']:
    if key(h['scen']) == scen: holds.setdefault(h['key'], []).append(h)
  for k, hs in holds.items():
    name = hs[0]['name']; loop = clip(name, 0)
    g = np.zeros(out.shape[1], np.float32); pan = 0
    for h in hs:
      i = int((h['f'] - 1) / FPS * SR); g[i:i + SR // FPS] = h['vol']; pan = h['pan'] or 0
    # smooth like the game's setTargetAtTime (about 0.1 s)
    a = 1 - np.exp(-1 / (0.1 * SR)); s = 0.0
    for i in range(len(g)): s += (g[i] - s) * a; g[i] = s
    on = np.nonzero(g > 1e-4)[0]
    if not len(on): continue
    reps = int(np.ceil(len(g) / len(loop))) + 1; L = np.tile(loop, reps)[:len(g)]
    put(out, L * g, 0, 1, pan)
  # the game's limiter, approximately: soft clip
  out = (np.tanh(out * 1.1) / np.tanh(1.1)).astype(np.float32)
  wav = os.path.join(CAP, scen + '_sound.wav'); dst = os.path.join(CAP, scen + '_sound.mp4')
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', wav], input=np.ascontiguousarray(out.T).tobytes(), check=True)
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(CAP, mp4), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', dst], check=True)
  os.remove(wav); made.append(dst); print(scen, 'sounds', n, 'loops', len(holds))
print('\n'.join(made))
