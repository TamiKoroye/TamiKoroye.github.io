# Builds the game's sound bank from the downloaded CC0 packs (OpenGameArt; listed in assets/sfx/CREDITS.md).
# Every chosen take is cut from its source (onset to a set length), faded out, levelled to its category's loudness,
# and packed with silence between takes into one mono Ogg Vorbis file (assets/sfx/bank.ogg) plus an index
# (assets/sfx/bank.json: name -> list of [start, duration] in seconds). Loops are made seamless by cross-fading
# their tail into their head.
# Usage: python3 -I tools/sfx-build.py <extracted packs dir> <downloads dir> <out dir>
import sys, os, json, subprocess, numpy as np

X, DL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SR = 32000
FS = 'legit_audio_fire_staff_-_free_0/LEGIT Audio_FIRE STAFF - FREE/Wavs/LEGIT_FIR_Fire_Staff %d-Audio.wav'
H = 'hits/hits/hit%02d.mp3.flac'
SW = 'swishes/swishes/swish-%d.wav'
B = 'sfx_breaking_and_falling/bfh1_%s.ogg'
C1 = '100-CC0-SFX_0/%s.ogg'
C2 = 'sfx_100_v2/sfx100v2_%s.ogg'
RPG = '80-CC0-RPG-SFX_0/%s.ogg'
WS = 'water-splash-slime-sfx/%s.ogg'
K = 'RPGsounds_Kenney/OGG/%s.ogg'

# name: (target RMS in dBFS, [(source, max length s, start offset from onset s), ...], loop?)
BANK = {
  # combat
  'swing':     (-20, [(SW % i, 0.2, 0) for i in (1, 10, 11, 12, 13, 5)], False),
  'swingHeavy':(-18, [(SW % i, 0.25, 0) for i in (3, 7, 9, 4)], False),
  'punch':     (-16, [(H % i, 0.4, 0) for i in (1, 3, 9, 10, 12, 14, 17, 28, 31)], False),
  'kick':      (-14, [(H % i, 0.5, 0) for i in (19, 21, 22, 23, 35, 37)], False),
  'block':     (-17, [(C1 % 'slam_04', 0.3, 0), (C1 % 'slam_05', 0.3, 0), (B % 'hit_06', 0.3, 0), (B % 'hit_08', 0.25, 0)], False),
  'bodyfall':  (-14, [(C1 % 'slam_02', 0.5, 0), (C1 % 'slam_03', 0.5, 0), (B % 'hit_02', 0.55, 0), (C1 % 'hit_04', 0.4, 0)], False),
  # movement
  'step':      (-24, [(K % ('footstep0%d' % i), 0.25, 0) for i in range(10)], False),
  'jump':      (-22, [(K % 'cloth1', 0.45, 0), (K % 'cloth2', 0.35, 0), (K % 'cloth3', 0.4, 0)], False),
  'land':      (-17, [('@jumpland.wav', 0.35, 0), (C1 % 'hit_03', 0.35, 0), (C1 % 'hit_04', 0.4, 0)], False),
  'dodge':     (-19, [(SW % i, 0.25, 0) for i in (3, 8, 9)], False),
  # fire
  'fireCast':  (-17, [(FS % i, 0.6, 0) for i in (6, 7, 8, 11, 3, 20)], False),
  'fireBlast': (-14, [(FS % 4, 1.8, 0), (FS % 15, 1.6, 0), (FS % 18, 1.8, 0), ('@105016__julien-matthey__jm-fx-fireball-01.wav', 1.5, 0)], False),
  'fireHit':   (-16, [(FS % i, 0.7, 0) for i in (9, 13, 1)], False),
  'fireLoop':  (-21, [('@fire_sound_effect.mp3', 3.0, 0.6)], True),
  # water and ice
  'waterWhip': (-18, [(WS % s, 0.35, 0) for s in ('splash_09', 'splash_10', 'splash_15', 'splash_06')], False),
  'waterCast': (-18, [(WS % s, 0.6, 0) for s in ('splash_02', 'splash_03', 'splash_14', 'splash_12')], False),
  'waterBig':  (-15, [(WS % 'splash_04', 0.9, 0), (WS % 'splash_08', 0.7, 0), ('@wave_01_cc0-11505__transitking__wavesound.flac', 1.4, 0)], False),
  'waterLoop': (-22, [(WS % 'loop_water_01', 3.0, 0)], True),
  'iceForm':   (-17, [('@freeze.wav', 1.3, 0)], False),
  'iceBreak':  (-16, [(B % s, 0.6, 0) for s in ('glass_breaking_02', 'glass_breaking_05', 'glass_breaking_06')], False),
  'iceHit':    (-17, [(B % s, 0.3, 0) for s in ('glass_hit_01', 'glass_hit_02')], False),
  # earth
  'rockLift':  (-18, [(RPG % s, 0.6, 0) for s in ('stones_01', 'stones_02', 'stones_03', 'item_stone_01')], False),
  'rockCrash': (-14, [(B % s, 0.8, 0) for s in ('rock_breaking_01', 'rock_breaking_02', 'rock_breaking_03', 'breaking_02', 'rock_falling_01')], False),
  'quake':     (-15, [(C2 % 'thunder_01', 2.0, 0.0), (C1 % 'explosion', 0.6, 0)], False),
  # air
  'gust':      (-18, [(C2 % 'air_03', 0.3, 0), (C2 % 'air_02', 0.9, 0)], False),
  'gustBig':   (-16, [(C2 % 'air_01', 1.8, 0)], False),
  'windLoop':  (-22, [('@wind woosh loop.ogg', 4.0, 0.5)], True),
}

def load(src):
  p = os.path.join(DL, src[1:]) if src.startswith('@') else os.path.join(X, src)
  raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
  return np.frombuffer(raw, np.float32).copy(), p

def take(a, maxlen, off, loop):
  pk = np.abs(a).max() or 1
  on = int(np.argmax(np.abs(a) > pk * (0.02 if loop else 0.06)))
  on = max(0, on - int(0.004 * SR)) + int(off * SR)   # keep a few ms before the onset so the attack is not clipped
  n = int(maxlen * SR)
  if loop:
    xf = int(0.35 * SR); seg = a[on:on + n + xf]
    if len(seg) < n + xf: seg = np.pad(seg, (0, n + xf - len(seg)))
    out = seg[:n].copy(); r = np.linspace(0, 1, xf)
    out[:xf] = seg[:xf] * np.sqrt(r) + seg[n:n + xf] * np.sqrt(1 - r)   # tail cross-faded into the head: seamless
    return out
  seg = a[on:on + n].copy()
  # trim the quiet tail, then fade out over the last 40 % (at least 30 ms)
  env = np.abs(seg); last = len(seg) - int(np.argmax(env[::-1] > pk * 0.02)); seg = seg[:max(int(0.05 * SR), min(len(seg), last + int(0.03 * SR)))]
  f = max(int(0.03 * SR), int(len(seg) * 0.4)); seg[-f:] *= np.linspace(1, 0, f) ** 1.5
  seg[:int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
  return seg

def level(seg, db):
  # loudness of the loud part (frames above -30 dB of the peak), so short hits and long sweeps sit together
  fr = int(0.02 * SR); m = len(seg) // fr
  if m == 0: return seg
  r = np.sqrt((seg[:m * fr].reshape(m, fr) ** 2).mean(1)); loud = r[r > r.max() * 0.03]
  g = 10 ** (db / 20) / max(np.sqrt((loud ** 2).mean()), 1e-6)
  seg = seg * g
  pk = np.abs(seg).max()
  return seg * (0.95 / pk) if pk > 0.95 else seg

GAP = int(0.12 * SR)
parts, index, used = [np.zeros(GAP, np.float32)], {}, set()
pos = GAP
for name, (db, srcs, loop) in BANK.items():
  index[name] = {'loop': loop, 'takes': []}
  for src, ml, off in srcs:
    a, p = load(src); used.add(os.path.relpath(p, os.path.dirname(X.rstrip('/'))))
    seg = level(take(a, ml, off, loop), db)
    index[name]['takes'].append([round(pos / SR, 4), round(len(seg) / SR, 4)])
    parts += [seg.astype(np.float32), np.zeros(GAP, np.float32)]; pos += len(seg) + GAP
bank = np.concatenate(parts)
os.makedirs(OUT, exist_ok=True)
wav = os.path.join(OUT, 'bank.f32')
bank.tofile(wav)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', os.path.join(OUT, 'bank.ogg')], check=True)
os.remove(wav)
json.dump({'sampleRate': SR, 'sounds': index}, open(os.path.join(OUT, 'bank.json'), 'w'), indent=0)
print('sounds', len(index), 'takes', sum(len(v['takes']) for v in index.values()), 'length %.1f s' % (len(bank) / SR), 'size', os.path.getsize(os.path.join(OUT, 'bank.ogg')))
print('\n'.join(sorted(used)))
