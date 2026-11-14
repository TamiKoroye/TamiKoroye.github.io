# Elemental Forge

A browser-playable third-person elemental combat game for Android phones, played in landscape in Chrome on a Samsung Galaxy S25 Ultra. It uses Three.js r170, vendored locally, with no build step and no external downloads at runtime.

Live build: https://tamikoroye.github.io/elemental-forge/

**Current build: Stage A (architecture and combat foundation).** Earth is the only playable element. Fire, Water and Air are Stage B.

## Launching
- **Phone:** open the live link in Chrome and tap FIGHT. To install it like an app, open Chrome's menu and choose *Add to Home screen*.
- **Locally:** `cd elemental-forge && python3 -m http.server 8765`, then open http://localhost:8765/. ES modules don't load from `file://`, so opening `index.html` directly won't work.

## Controls (touch)
- **Move:** left thumb on the left half. Partial push walks, full push runs. Holding the stick at its rim sprints, when not locked on.
- **Aim / camera:** drag on the right half. LOCK picks the rival nearest the centre of your view.
- **STRIKE:**
  - tap: jab, cross, spinning kick
  - short hold: heavy palm strike (staggers, breaks guards)
  - long hold, until the fists glow: charged axe-kick slam with a ground shockwave that knocks down
- **GUARD (hold):** stone shield. Raised just before impact it becomes a perfect guard:
  - a rock is deflected back at its thrower
  - a melee attacker is staggered
  - the next STRIKE becomes a spinning counter
- **DODGE:** roll toward the stick. While locked on: sidestep or backstep.
- **Cancels and buffering:** dodge and jump cancel attack recovery, and inputs pressed slightly early are buffered.
- **BEND:** tap to raise and throw a rock at the reticle; hold to keep it suspended.
- **Keyboard:** WASD, C (sprint), mouse, left/right click, Q, Space, Shift, Tab, Esc.

## Code layout
| File | Role |
|---|---|
| `js/main.js` | Renderer, lighting, game loop, player input mapping, aiming, lock-on target selection, HUD, rounds, menus, test hooks |
| `js/character.js` | Skinned character generator: one continuous weighted mesh on a `THREE.Skeleton` (17 bones), vertex-coloured clothing |
| `js/fighter.js` | Fighter state machine: movement, stamina, actions with phases (startup, active, cancel, recovery), input buffer, dodges, hit levels, layered procedural animation |
| `js/combat.js` | Rocks, stone shields, melee resolution, perfect guard and deflection, charged slam shockwave, damage |
| `js/camera.js` | Over-the-shoulder follow camera: auto-follow, lock-on framing, collision pull-in, shake, FOV kick |
| `js/controls.js` | Multi-touch floating stick, aim drag, buttons, keyboard/mouse |
| `js/arena.js` | Arena geometry, ramps and ledges (slopes), colliders, ground and collision queries |
| `js/ai.js` | Opponent decision-making (Milestone 1 level; Stage C rebuilds this) |
| `js/fx.js`, `js/audio.js` | Pooled particles and decals; synthesised sound (no audio files) |
| `tests/` | Automated play test, pose gallery, deterministic gameplay recorder |

## Stage A audit (summary)
Findings that drove the work:

1. **Bodies were about 40 rigid primitives per fighter.** Segments pivoted visibly apart at joints, and each fighter cost about 40 draw calls (80 with shadows).
   **Fix:** one generated skinned mesh per fighter. Lofted tubes are weight-blended across the shoulders, elbows, waist, hips, knees and ankles, and clothing is vertex-coloured, so each body is a single draw call.
2. **Locomotion had a single run cycle.** There was no walk or sprint, no banking or acceleration lean, and no footsteps.
   **Fix:** a speed-scaled walk/run/sprint cycle (stride, knee lift, arm pump, lean), banking into turns, leaning with acceleration, settling when stopping, and footstep sounds.
3. **Combat was gated by long fixed animations.** There was no input buffering and no cancelling, and every hit produced the same flinch.
   **Fix:** actions now have explicit active and cancel phases, a 0.15 to 0.25 s input buffer, and dodge/jump/attack cancels. Moves: heavy and charged attacks, a perfect guard with counter, directional dodges (roll, sidestep, backstep). Hits are graded: flinch, stagger, or knockdown with get-up.
4. **Terrain was flat apart from steps.**
   **Fix:** ramps up to the platforms and a 1.6 m stone ledge, with slope-aware ground, collision and projectile queries.
5. **Camera:** lock-on now picks the best target (view angle plus distance), with an FOV kick when sprinting. Sprint no longer overrides strafing while locked on (a bug found in testing).
6. **Kept unchanged**, because they worked: the renderer, arena, rock and shield systems, aiming and reticle, touch controls, and the round flow.

**Rigged asset evaluation.** No suitable authorised rigged martial-artist model or animation set was reachable from the build environment. The CC0 KayKit characters are chibi-proportioned. The three.js example `Xbot` is a Mixamo-derived mannequin with unclear redistribution terms and no martial-arts clips. Mixamo, Quaternius and similar sources were not reachable. So the characters are generated in code, and the animation is procedural on a real skeleton. If you can supply licensed rigged GLB characters and animations, the skeleton layout in `character.js` is the integration point.

## Status
**Implemented and verified (automated, 42/42 checks; see `tests/evidence/results.json`):**
- walk, run and sprint by stick deflection
- slope climbing
- heavy and charged attacks
- knockdown and get-up
- dodge cancel
- input buffering
- sidestep and backstep
- perfect guard deflecting a rock back into its thrower, followed by a counter attack
- the single-mesh skinned characters
- all Milestone 1 checks:
  - movement and camera
  - multi-touch
  - aiming and reticle accuracy
  - shield blocking
  - combo
  - AI round
  - portrait prompt

**Implemented, not verified on device:** performance, touch feel and audio on the Galaxy S25 Ultra. Tests use a software renderer at about 20 fps, so they say nothing about real frame rate.

**Planned:**
- Stage B: fire, water and air, plus element interactions
- Stage C: enemy archetypes and AI
- Stage D: the Stone Highlands chapter
- Stages E to G: advanced disciplines, campaign and polish

## Testing
    cd elemental-forge && python3 -m http.server 8765 &
    node tests/play-test.mjs http://localhost:8765/ ./test-shots          # 42 automated checks with real CDP multi-touch
    node tests/pose-gallery.mjs http://localhost:8765/ ./poses           # close-up stills of every pose
    node tests/record-gameplay.mjs http://localhost:8765/ ./gameplay.mp4  # deterministic 30 fps gameplay capture

The recorder advances the game in exact 1/30 s steps and screenshots each frame. The footage therefore plays at true game speed, even though the headless browser renders far slower than a phone.

## Known limitations
- The characters are generated in code. They are a large step up from the primitives, but not equal to artist-made models; facial detail is minimal and there are no fingers.
- The AI is still the Milestone 1 brain. It reacts to the new hit levels but doesn't yet use heavy, charged or counter moves.
- The free-aim rock impact point can land up to about 1 m short on very shallow floor shots, because of the rock's radius.
