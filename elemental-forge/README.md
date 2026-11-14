# Elemental Forge

A browser-playable 3D elemental combat game built with Three.js (r170, vendored locally, no build step). It is designed for a Samsung Galaxy S25 Ultra in landscape, using Chrome on Android.

**Current build: Milestone 1, complete.** It also includes the core of Milestone 2 (rock raise/suspend/throw and the stone shield) and a first-pass opponent AI with three difficulty settings, so the aiming and the defence have something real to test against.

## Launching

### On the phone (recommended)
The repository is a GitHub Pages site (`tamikoroye.github.io`). Once this branch is merged into the branch Pages serves from (or Pages is pointed at it under *Settings > Pages*), open:

    https://tamikoroye.github.io/elemental-forge/

Tap **FIGHT**. The game asks for fullscreen and landscape lock. To install it like an app, use Chrome's menu and choose *Add to Home screen*. It launches fullscreen in landscape (a web manifest is included).

### Locally on a computer
Any static file server works. ES modules don't load from `file://`, so double-clicking `index.html` won't work.

    cd elemental-forge
    python3 -m http.server 8765
    # open http://localhost:8765/

To play the local copy on the phone over Wi-Fi, use `http://<computer-ip>:8765/`. Fullscreen and orientation lock may be refused over plain http on a LAN address. The game still runs.

## Controls

| Action | Touch | Keyboard / mouse |
|---|---|---|
| Move (360°, analogue) | Left thumb anywhere on the left 45% of the screen (floating stick) | WASD / arrows |
| Aim / turn camera | Drag anywhere on the right side | Mouse (click the game to capture the pointer) |
| Strike combo (jab, cross, spinning kick) | STRIKE | Left click / F |
| Earth bend: raise a rock | BEND: tap = raise and throw at the reticle; hold = keep it suspended, release to throw | Right click / E |
| Stone shield | GUARD (hold) | Q (hold) |
| Jump | JUMP | Space |
| Dodge roll (in the stick direction, brief invulnerability) | DODGE | Shift |
| Target lock on/off | LOCK | Tab / T |
| Pause, sensitivity, auto-camera | II | Esc / P |

The stick and the aim drag are tracked per finger. You can run with one thumb while aiming, bending or guarding with the other.

## What is implemented

**Rendering and arena**
- Real-time WebGL with ACES tone mapping, hemisphere and sun lighting, and soft shadow maps that follow the action.
- The hall is laid out after the reference video: blue-grey and orange tiled courts, a raised yin-yang dais, stepped stone platforms (two heights, walkable), wooden crates, rock spires and boulders (all solid cover), element banners, framed wall panels, raised stands and a 900-figure instanced crowd.

**Fighters**
- Articulated humanoids with 17 animated joints each: hips, spine, chest, neck, head, shoulders, elbows, wrists, hips, knees and ankles. Bodies have muscle masses, pants, sash, wraps and a face.
- All animation is procedural and blended, with no canned clips:
  - combat idle stance, with feet placed by two-bone leg IK
  - run cycle with arm counter-swing and body lean
  - strafe and back-pedal
  - jump/air tuck and landing crouch
  - forward roll in any direction
  - jab, cross and a 360° spinning roundhouse
  - earth raise, push-throw, guard stance and suspend pose
  - hit reaction and knockdown
- Upper-body actions layer over the run, so you can punch or throw while moving.

**Movement**
- Camera-relative, analogue, full 360° movement with acceleration and deceleration.
- Jump with air control, and a dodge roll with i-frames.
- Collision against rocks, crates, walls and platforms. You can step up and down the platforms and jump onto crates.
- Facing is independent of movement. While locked on or recently attacking, the fighter faces the aim point and strafes.

**Camera**
- Over-the-shoulder follow camera with smoothing.
- Collision pull-in against cover.
- Auto-follow behind the direction of travel, and auto-turn to keep the rival in view.
- During lock-on the camera stays behind you, framing the rival above and beside your shoulder.
- Manual drag works in both modes. In lock mode it's a temporary offset that springs back.
- Screen shake on impacts.

**Aiming**
- A centre reticle backed by a real ray cast. The ray hits the floor, cover or the rival, and the aim point is where the rock goes. Gravity is compensated, so the rock lands where the reticle points.
- Aim assist snaps to the rival when the reticle is near them (the reticle turns red).
- During lock-on the reticle tracks the rival, with light target leading.

**Earth combat**
- Rocks burst out of the ground (debris and a crater decal), hover and bob while held, then fly with spin and a dust trail.
- Rocks shatter on fighters, shields, cover, the floor and walls.
- The stone shield erupts in front of you in 0.16 s and turns to follow your aim while held. It physically stops rocks and blocks melee hits from the front. It has HP and cracks apart if overloaded, which briefly stuns its owner. It sinks back into the floor on release.

**Feedback**
- Damage numbers and BLOCK pop-ups.
- Hit flash on the body, hit-stop, sparks, shockwave rings and dust.
- Synthesised sound effects (Web Audio, no audio files).

**Opponent**
- Keeps a preferred range, circle-strafes and steers around obstacles.
- Throws rocks with target leading and aim error.
- Melees up close, and reacts to incoming rocks by dodging or raising a shield.
- Retreats when low on health.
- Difficulty settings: Training, Normal (default) and Master.

**Match flow**
- Best of 3 rounds, KO, round banners, and a victory/defeat screen.
- Pause menu.
- "Turn your phone sideways" prompt in portrait.
- Adaptive resolution: drops the pixel ratio if frames run slow. A Battery graphics mode is also available.

## Testing

### What was tested automatically (in this build environment)
`tests/play-test.mjs` launches the real game in headless Chromium at the S25 Ultra's CSS viewport in landscape (891×412, touch enabled, mobile mode). It drives the game with genuine Chrome DevTools multi-touch events: it presses the real on-screen buttons and drags the real stick and aim area. It then checks game state and saves screenshots. Latest run: **27/27 checks passed** (see `tests/evidence/results.json`). The checks:

- page loads with no errors; WebGL context created; fight phase starts; scene populated
- player and opponent both inside the camera view
- left stick moves the player (13+ m in about 1.2 s at 6.6 m/s); player decelerates to a stop on release
- right-side drag rotates the camera while the stick finger is still held (multi-touch)
- locked strafe: the fighter faces the rival (error 0.03 rad) while moving at about 100° to its facing
- jump leaves the ground; dodge roll travels 7+ m
- BEND raises a rock; a thrown rock hits the locked rival; holding BEND keeps the rock suspended
- free aim: the rock impacts within about 1.2 m of the reticle's world point at roughly 12 m range (the residual is the rock's radius at a shallow angle)
- GUARD raises a shield; the shield intercepts a rock aimed at the player (player HP unchanged, shield HP reduced); the shield sinks on release; the same rock without the guard does damage
- the STRIKE combo damages the rival
- the stick stays active while another finger taps BEND
- after a page reload, both fighters stay finite and visible during a live AI round (regression test for a bug found during testing, described below)
- portrait orientation shows the rotate prompt

`tests/pose-gallery.mjs` renders close-up stills of every pose. These were inspected and used to fix anatomy problems.

Screenshots from the test runs are in `tests/evidence/`.

**Bug found and fixed during testing:** on some page loads the first animation-frame timestamp precedes the start-up clock. The resulting negative time step produced NaN in the fighters' pose smoothing, which made both fighters invisible. Fixes: the time step is now clamped, the acceleration maths is guarded, and the pose buffers reset each round. A regression check was added to the test suite.

Re-run the tests with:

    cd elemental-forge && python3 -m http.server 8765 &
    node tests/play-test.mjs http://localhost:8765/ ./test-shots

### What was NOT tested
- **Nothing has been run on a physical Samsung Galaxy S25 Ultra.** The automated tests use a software GPU (SwiftShader) at about 20 fps, so they show nothing about real frame rate, thermals or battery on the phone. Real touch feel (latency, thumb reach, button sizes) also needs your hands on the device.
- Fullscreen and orientation lock are requested but couldn't be verified on Android Chrome.
- Audio was not listened to. It is synthesised and only starts after the first tap, which browsers require.

## Known limitations / next milestones
- Fire, Water and Air buttons are visible but locked (Milestone 4).
- Earthbending still to come (Milestone 2):
  - earth pillars under enemies
  - free-standing stone walls
  - steering a suspended rock through 3D space
  - orbiting-rock 360° attack
  - using held rocks defensively
- The AI is a first pass (Milestone 3 will deepen it with combos, flanking and smarter guarding). It does not jump, and its obstacle avoidance is steering-based (no path-finding).
- Terrain is not yet reshaped by attacks beyond crater decals. Environmental destruction and elemental interactions are Milestone 5.
- The fighters are built from primitive shapes and animated procedurally, with no skinned meshes or motion capture. Silhouettes and poses read clearly, but they are not as smooth as hand-authored animation.
- The free-aim impact point lands up to about 1 m short on very shallow floor shots, because of the rock's radius.
