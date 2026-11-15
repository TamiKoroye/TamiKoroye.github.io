# Elemental Forge

A browser-playable third-person elemental martial-arts game for Android phones, played in landscape in Chrome on a Samsung Galaxy S25 Ultra. It uses Three.js r170, vendored locally, with no build step and no external downloads at runtime.

Live build: https://tamikoroye.github.io/elemental-forge/

**Current build:** visual-quality rebuild (development branch). This milestone is a combat demo that can be compared directly with the reference footage. See `docs/QUALITY-GAP.md` for the five-video analysis and the engine and asset assessment.

- **Characters:** a properly rigged humanoid, the CC0 Quaternius *Universal Animation Library* mannequin (53 bones, fingers). It is recoloured into a shirtless fighter with trousers, sash and wraps; given a face (ears, nose, brow, eyes); cel-shaded; and ink-outlined.
- **Animation:** authored clips (idle, walk, jog, sprint, jump, roll, hit reactions) run through an animation mixer with crossfades.
- **Martial-arts techniques from motion capture:** 14 strikes and kicks (punches, front, side, roundhouse, spinning and flying kicks) come from the CMU motion-capture database, retargeted onto the 53-bone skeleton and stored with mirrored copies for either side. Each one replaces the procedural pose for its technique and is retimed so its impact frame matches the hit and the element effect. See `assets/animations/README.md` for the takes and `tools/retarget/` for the pipeline. Add `?mocap=0` to the URL to compare against the old procedural techniques.
- **Still procedural:** stances, guards, sustained bending poses, the earth stomp, the specials, and the arms over the running legs.
- **Effects:** solid cel-shaded flame blobs (yellow to orange to red to smoke), faceted light-blue water chunks, and ribbon trails for air and water (all ribbons in one draw call).
- **Look:** cel shading across the arena, flat bright lighting without filmic tone mapping, the reference palette, and closer camera framing (the fighter fills about 40% of the screen height).

| Element | Martial art | Character |
|---|---|---|
| Earth | Hung Gar | low, wide, rooted stance; forceful hip-driven punches; short grounded kicks; stomps |
| Fire | Northern Shaolin | long bow stance with a light bounce; fully extended punches; high, spinning and flying kicks |
| Water | Tai Chi Chuan | upright, rounded arms that never stop circling; weight shifting; crescent and turning kicks |
| Air | Baguazhang | toe-in circle-walking stance; open palms; constant spinning kicks; fastest movement |

## Launching
- **Phone:** open the live link in Chrome and tap FIGHT. To install it like an app, open Chrome's menu and choose *Add to Home screen*.
- **Locally:** `cd elemental-forge && python3 -m http.server 8765`, then open http://localhost:8765/. Opening `index.html` directly from disk won't work.

## Controls (touch, landscape)
- **Left thumb:** move. Light push walks, full push runs, holding the stick at its rim sprints (not while locked on).
- **Right-half drag:** aim and camera. **LOCK:** frame the rival.
- **Elements (top left):** instant switch, even mid-run. The dots show the objects you are holding for each element.
- **Action star (bottom right):** JUMP top, GUARD upper-left, DODGE upper-right, HAND lower-left, LEG lower-right, SPECIAL centre. Size and spacing can be adjusted in the pause menu.

| | Earth | Fire | Water | Air |
|---|---|---|---|---|
| HAND tap | stone punch (bursts a rock from the ground, or launches a held rock) | fire fist / fireball (or launches a flame orb) | water palm (or launches a held globe) | air palm gust (or launches a vortex) |
| HAND hold | boulder lift: up to 3 orbiting rocks, taking loose stones first | sustained fire stream (burns the ground) | draw water from a pool (or condense it slowly) into 3 globes; with 3 held it becomes a water whip | sustained wind push (shoves fighters and projectiles) |
| LEG tap (×2) | earth kick, then a low sweep firing 3 stones | flame kick arc, then a spinning flame kick ring | crescent water arc (spends a globe), then a turning wave | crescent air blade, then a jumping whirlwind (3 blades) |
| LEG hold, release | seismic stomp: shockwave plus a line of rising spikes | flying dragon kick | tidal sweep (bigger with held water) | cyclone |
| GUARD | stone wall (blocks everything) | fire wall (burns fire and air; rocks get through at half force) | water shield (douses fire, slows rocks) | air deflection (turns projectiles aside) |
| Perfect GUARD (just before impact) | sends rocks back | sends fire and rocks back | redirects any projectile | sends any projectile back |
| SPECIAL | stone pillar (stand on it; erupts under a locked rival) | flame orb (the 4th press fires a volley of 3) | water sphere that traps | vortex (the 4th press merges 3 into a large pulling vortex) |
| DODGE | roll (sidestep or backstep while locked on) | flame dash | water slide | air dash |
| JUMP | — | flame-boosted | double jump, plus hold to glide | — |

**Keyboard:** WASD to move, C sprint, mouse to aim, left click HAND, right click LEG, Q guard, E special, Space jump, Shift dodge, 1–4 elements, Tab lock.

## Architecture
| File | Role |
|---|---|
| `js/pose.js` | Shared pose primitives: 17-joint pose array, arm/leg setters, two-bone leg IK, stance helper |
| `js/styles.js` | The four martial-arts styles as data: stance, locomotion profile, dodge, jump, and keyframed techniques (hand, two leg variants, charged, sustained hold pose, guard pose, special) with timing, events, melee windows, spins and jumps |
| `js/fighter.js` | One technique runner for every element: input model (tap, hold, charge, buffer, cancel), movement, stamina, dodges, reactions, pose layering and smoothing (with a joint-velocity cap) |
| `js/elements.js` | Bending system: controlled orbiting objects, projectiles with per-element physics, sustained techniques, defences with collision rules, element-vs-element clash rules, burning ground, seismic spikes, pillars, restraint |
| `js/character.js` | Skinned character on a `THREE.Skeleton`; the sash recolours to the element |
| `js/combat.js` | Lunge, melee checks, damage, front blocking and perfect guard, slam shockwave |
| `js/arena.js` | Arena, ramps, ledge, water pools, loose stones, walkable boulders, collision and ground queries |
| `js/camera.js` | Follow camera: lock-on framing, collision, rises over low obstructions so platform edges don't hide the fighter |
| `js/main.js`, `js/controls.js` | Loop, star layout, HUD, multi-touch input, settings |

**Element interactions (rules in `elements.js`):**
- water puts out fireballs, fire walls and burning ground
- rocks smother fire and push through fire walls at half force
- water slows rocks
- wind nudges rocks and blows fire and water back at their caster
- the same element meeting itself cancels out
- held objects act as a defensive formation and intercept projectiles

## Testing
    cd elemental-forge && python3 -m http.server 8765 &
    node tests/play-test.mjs http://localhost:8765/ ./test-shots        # 86 automated checks
    node tests/style-gallery.mjs http://localhost:8765/ ./style-shots   # every pose of every style
    node tests/record-styles.mjs http://localhost:8765/ ./style-videos  # one clip per element, same input
    node tests/record-gameplay.mjs http://localhost:8765/ ./gameplay.mp4
    node tests/record-mocap-demo.mjs http://localhost:8765/ ./mocap-demo.mp4   # procedural vs motion capture, side by side

The play test drives the real on-screen controls with DevTools multi-touch events. It steps the game in exact 1/30 s frames, so timing-sensitive mechanics are checked deterministically. It covers 16 areas:
1. star layout geometry and overlap, at default and maximum size
2. walk, run and sprint
3. two-finger camera control while moving
4. strafing
5. jump and air double jump
6. slopes
7. distinct stances, speeds and dodges per style
8. element switching mid-run
9. HAND, LEG, sustained hold, multiple held objects, defence, perfect guard and charged technique for every element
10. full-body kick mechanics: kicking hip raised, supporting foot planted, torso engaged
11. movement during bending
12. element interactions
13. pillars, boulders and loose stones
14. combination flow without pose snapping
15. camera over platform edges and during spins
16. live AI, NaN regression and the portrait prompt

**Not verified on a physical Samsung device:** frame rate, touch feel and audio. The tests use a software renderer.

## Known limitations
- The motion-capture techniques come from karate, general kicking and acrobatics takes. The CMU database has no Hung Gar, Northern Shaolin or Baguazhang recordings, and its tai chi take is too slow and small for game strikes. The styles are therefore told apart by take choice, speed and effects rather than authentic forms. Clips from Rokoko, Mixamo or ActorCore can be fed through the same pipeline once downloaded as FBX or BVH.
- The character is a recoloured mannequin. It has added facial features but no textured clothing.
- Not built yet: breakable wooden cover, ice slabs you can ride, climbing (all seen in the references); advanced disciplines; the campaign.
- Frame rate on the S25 Ultra for this build is not yet measured. The previous build ran at about 60 fps on the device, measured from your screen recording.
