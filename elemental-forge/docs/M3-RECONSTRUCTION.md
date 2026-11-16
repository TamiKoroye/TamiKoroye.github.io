# M3: combat, animation and bending reconstruction

Everything below was checked in the game, using local and deployed browser runs with stepped simulation and touch input. Nothing has been tested on a Samsung Galaxy S25 Ultra.

## 1. Skeleton, hands, mapping and blending

| Problem | Fix | Where |
|---|---|---|
| Hands were mitten-like: the fingers never moved | A hand-shape layer blends every finger joint (index, middle, ring, pinky and thumb, three joints each) toward a per-style shape over whatever the clip does. Shapes: fist (Earth, Fire), claw (Earth gathering and Ground Rupture), open palm (Air, Water strikes, guards), relaxed flowing hand (Water stance), relaxed (hit reactions) | `js/hero.js`: `HANDS`, `chooseHands`, `applyHands` |
| Core clips lost their hip height | The character's root bone is Z-up, so the hips track carries height in Z. The loader pinned X and Z as if they were horizontal, flattening every core clip's vertical hip motion: a kneel floated at standing height and a roll stayed tall. It now pins X and Y. Measured afterwards: during a roll the hips drop to 0.09 m above the root; in idle, jump and KO the feet stay 0.06 to 0.10 m above the ground | `js/hero.js`: clip preparation in `loadCharacter` |
| Earth stance was an over-wide, deep squat | The standing idle's legs are mixed into the horse stance at weight 0.75 (0.6 for the guard), so the stance sits at mid height with the arms and footing unchanged | `js/mocap.js`: `STANCE_MIX`; `js/hero.js`: `drive` |
| Air stance swung its arms about (Ninja Idle) | Air's idle is a held Tai Chi posture with both open palms extended toward the centre and the torso turned. It is the closest Baguazhang posture in the supplied takes | `air_idle`: Tai Chi take, 26.8 to 29.2 s |
| Get-up started from a crumpled pose | Recovery uses the Mixamo get-up (on the back, roll to a crouch, stand), which matches how the knockdown ends. Its duration rose from 0.45 s to 0.85 s, so it plays at about 2.4 times the captured speed instead of 4.5 | `js/hero.js`: `drive`; `js/fighter.js`: `ACTIONS.getup` |

## 2. Clips added (from the existing library, nothing new downloaded)

| Clip | Source | Used for |
|---|---|---|
| `whip_h` (+ mirror) | Mixamo Right Hook, 0.1 to 1.1 s | Whip across the body (Water, Air) |
| `whip_v` (+ mirror) | Mixamo Standing Melee Combo Attack, 0.9 to 2.3 s | Overhead whip, arm raised then driven down and forward |
| `whip_d` (+ mirror) | Mixamo Great Sword Slash, 0.25 to 1.5 s | Diagonal whip, high behind to low in front |
| `earth_gather` | Rokoko kata, 12.6 to 15.2 s | Earth SPECIAL: the arms cross, then sink with both hands to the ground |
| `earth_raise` | Rokoko kata, 16.4 to 19.2 s | Baked and kept in the pack for the Earth raise; not used by any move yet |
| `air_idle` (replaced) | Rokoko Tai Chi, 26.8 to 29.2 s | Air stance |
| `Fixing_Kneeling` | UAL character library | Earth rock lift: kneeling with the hands on the ground |
| `turn_spin` (impact time added) | KinemIQ spin | Air SPECIAL |

The rebaking tools are `tools/retarget/martial-spec.json` (entries), `tools/retarget/bake.mjs --only` and `tools/retarget/merge.mjs` (a new tool that merges clips into the pack by name). Run `tools/pack-assets.mjs` afterwards.

## 3. Bending effects tied to the body

- **Whips (Water, Air, and Fire's third strike)** (`js/weapons.js`: `whipStrike`, `stepWhip`, `releaseWhip`, `drawWhip`, `whipHits`):
  - A rope of 14 points whose root is the hand bone.
  - The forearm direction and the hand's velocity lay the rope, so each arm clip gives its own whip path.
  - The points carry momentum, so the far end lags, coils and catches up.
  - On the impact frame the rope is thrown at the target. Hits are tested only from that point, along the path each point travelled.
  - When the technique ends, the rope draws back into the hand.
  - Reach is at most 4.6 m (it was 9 m). The strike steps in when the rival is up to about 1.5 m beyond its reach (`js/combat.js`: `lunge`, `reach`).
  - The physics scale with frame time, so 30 fps and 60 fps behave the same.
- **Held twin whips:** the same rope on each hand, lashing in turn, swung by the stick. A rival beyond reach is closed on at a walk.
- **Kicks** (`js/weapons.js`: `limbArc`, `updateArcs`; `js/fighter.js`: `recLimbs`, `limbPath`):
  - Every fighter records the last 0.3 s of both hands and both feet.
  - A Water, Fire or Air kick throws an arc shaped from the last 0.2 s of the kicking foot's path. It then flies at the target, widening, and strikes along its length.
  - Water's crescent kick throws a crescent of water, Fire's roundhouse a rising flame arc and the spinning kick a wide flat one, Air's kick a wind blade.
- **Water look:** whips and arcs are thick tubes that taper toward the far end. Drops are rounded and stretched along their flight, not tumbling blocks (`js/fxstyle.js`: `WaterChunks`).
- **Air look:** whips and arcs have a translucent body as well as streaks.

## 4. SPECIALs (`js/specials.js`, new)

| Element | Move | Body | Effect |
|---|---|---|---|
| Fire | Dragon Descent | Flying Kick | Flames pour from both feet through the leap. The kicking foot explodes where it lands: three expanding fire shells, a ground ring and a crater. Within 3.2 m it knocks the rival down and leaves burning ground. The flame orbs are removed, and held LEG becomes the spinning back kick |
| Earth | Ground Rupture | `earth_gather` | Grit and pebbles are drawn up to the hands as they sink to the ground. Then a line of fracture bursts (the baked Bomb Crack Ground simulation) and rock spike clusters races to the rival and throws them up. The last burst is the largest |
| Water | Dragon Stream | Water redirect, then the Tai Chi push | Water rises from the ground into both hands. One stream then circulates through both hands and round the body, catching projectiles and shoving attackers out. HAND plays the two-handed push that throws it at the rival; it releases on its own after 4.6 s |
| Air | Tornado | Spin | A full turn winds a funnel up around the bender. The end of the turn sends it out. It drags in whoever it reaches, lifts and spins them for up to 1.4 s, then throws them out |

## 5. Earth gathering

Holding HAND as Earth kneels with both hands on the ground (`Fixing_Kneeling`) for each rock. The lowest hand is measured at 0.35 m above the ground. Each rock breaks out of the ground with a small fracture burst, one every 0.5 s.

## 6. Camera (`js/camera.js`)

- **Closer framing:** 3.1 m, or 3.4 m locked on (was 3.5 and 3.8).
- **Widened view:** up to 2.2 m further back during a SPECIAL, flight or a propelled high jump, and fast surfing or flame running.
- **Aerial tracking:** height follows faster in flight and on high jumps, so the bender stays in frame.

## 7. Cleanup

`Bending.clear` now also removes the stream mesh drawn behind water projectiles; these used to stay in the arena after a reset. Whips, arcs and every SPECIAL remove their meshes when they end and on reset. Each SPECIAL check in `tests/m3-effects-test.mjs` confirms nothing is left behind.

## 8. Tests

`tests/m3-effects-test.mjs` (new) measures the effects against the limbs, frame by frame, and writes close-up and normal-distance frames:
- **Whips:** the rope root's distance from the hand bone; the angle between the hand's motion and the rope's motion before release (17° to 37° measured); reach; different arm paths; hits on a rival 4 m away. The rival is put back at 4 m before each strike, because a hit knocks them out of reach.
- **Kicks:** the arc's distance from the kicking foot on its first frame (0.26 to 0.54 m measured); the arc's direction against the foot's motion; hits.
- **SPECIALs:**
  - Fire: the explosion is 0.2 m from the kicking foot, and it knocks the rival down.
  - Earth: the rupture runs toward the rival and throws them up (1.7 m).
  - Water: the stream passes through both hands while circulating, HAND throws it, and it hits.
  - Air: the tornado forms on the bender and lifts the rival (3.4 m).
  - All four: nothing is left behind.
- **Earth gathering and recovery:** the kneel reaches the ground; the get-up clip plays.

Two checks are close to automatic and are kept only as guards: the rope root is the hand by construction, and the kick arc is built from the foot's path.

Existing tests changed, with the reason:
- `acceptance-test.mjs`: an "authored" frame is now any clip the character plays (the retargeted pack or its own UAL library). The Earth kneel comes from the UAL library. Procedural blending is still caught by the wU / wL weights, which must be under 0.05.
- `play-test.mjs`:
  - **Whips:** tested at 6 m (reach 4.6 m plus the step-in) instead of 8 m.
  - **Fire and Air SPECIAL:** the orb checks are replaced by Dragon Descent (the rival is knocked down) and the Tornado (the rival is lifted).
  - **Earth SPECIAL:** the pillar check is replaced by the Ground Rupture. Standing on a pillar is still tested, with the pillar raised by the same function the rock-surf launch uses.
  - **Helpers:** the file gained a damage hook so each hit is credited to the move that made it.
- `milestone-test.mjs`: the three-ring spiral checks are replaced by Dragon Stream checks:
  - the stream runs through both hands;
  - it stays below the head;
  - it catches a fireball;
  - HAND throws it and it hits.

## 9. Results on the deployed dev build (r8, commit 6b27d7d)

https://tamikoroye.github.io/elemental-forge-dev/, tested in headless Chromium through the network proxy (not on a phone):

| Suite | Result |
|---|---|
| M3 effects | 54/54 |
| Milestone | 23/23 |
| Overhaul | 52/52 |
| Play | 86/86 |
| Acceptance | 13/15 on the first run; 15/15 on two reruns |

The acceptance failures were check 6 (the strike that follows a guard) and check 8 (six quick attacks). The rival AI is live in that test, and the same build failed once and passed twice.

Bugs found and fixed while making these pass:
- Whips missed a rival who had been knocked back past their reach. The strike now steps in.
- The overhead and diagonal whips laid the rope about 9 degrees off the aim. The rope now follows the aim alone through the lash.
- Dragon Descent leapt in place. The leap now carries the fighter to the rival and stops where the kicking foot lands.
- The thrown Dragon Stream kept flying after it struck. It now splashes out 0.15 s after impact.
- Two buffered strikes started in the same frame, so the HAND strike was replaced by the LEG strike. One starts per frame now, the earlier press first.
- A press made during a kick's recovery expired too early. The input buffer rose from 0.35 s to 0.45 s.

Evidence is in `tests/evidence/m3-deployed/`:
- close-up sheets of the whips, kicks, all four SPECIALs, Earth gathering and the get-up;
- normal-camera frames;
- every suite log;
- four unscripted encounters in the barn ruin (`encounter-<element>.mp4`) with a step log. The rival is the game's own AI on Normal.

## 10. Remaining problems

- Acceptance checks 6 and 8 depend on the live AI rival. They failed in one of three deployed runs.
- At the normal camera distance, the whips and kick arcs are small on screen. They read clearly in the close-ups.
- Air's stance is a held Tai Chi posture. There is no circle-walking (Baguazhang stepping) clip in the supplied files, so Air's footwork is the standard walk and strafe.
- The Tai Chi based clips (`water_redirect`, `water_palm`) are played at 1.4 to 2.3 times the captured speed and still read as slow.
- The whip clips come from boxing and sword takes. Their arm paths are correct, but the legs step the way those takes do.
- The two-handed `whip_d` clip ends bent low, the Great Sword Slash follow-through.
- The fire-blast shells are plain additive spheres. They read as a fireball, but they have no internal flame structure.
