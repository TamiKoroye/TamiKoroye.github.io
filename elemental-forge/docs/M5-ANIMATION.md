# M5: natural movement from the new Drive animations

Everything here was checked in the game in headless Chromium, with the stepped simulation and the keyboard controls (the same commands as the touch buttons). Nothing has been tested on a phone.

## What the recordings showed

Your five screen recordings of 17 Nov (the dev build r10) show four problems:

- **Falls.**
  - The knockdown clip (UAL2 Hit_Knockback) ended face down.
  - The get-up clip (Mixamo Getting Up) starts sitting on the back.
  - The 0.1 s blend between them turned the body over through the floor. This is the sprawl at 1:42 and the crumple at 2:02 of the 001419 recording.
- **Hit reactions.** These were played at 1.5 times their captured speed and cut off after 0.3 s, with a 0.05 s blend in and out.
- **Hits counted twice.** A punch and its fireball (or a whip's two lashes) arrived 0.1 s apart. Each one switched the clip, so the body jerked between two reactions.
- **Fingers.** The hand-shape layer forced 85 % of a fixed hand shape onto every clip, including clips that carry captured finger motion. This made the hands puppet-like.

## AI and player parity

- The rival AI gets no stat advantage: it has the same energy, damage and cooldowns, and uses the same moves through the same input struct.
- It did have two control advantages:
  - It always faced the player.
  - It aimed with lead.
- The player now gets the same:
  - Within 7 m, the player squares up to the rival while moving (unless sprinting away).
  - Aim assist covers about 10 degrees around the reticle (it was 4) and uses the same lead.

## Clips added (Drive folder, Mixamo FBX)

| Game clip | Source file | Used for |
|---|---|---|
| `knockback` | Knocked Down, 0.25 to 1.3 s | Knocked off the feet: falls back onto the back, legs forward, which matches the first frame of the get-up |
| `getup` | Getting Up (already in the game) | Recovery from the back |
| `ko` | Knocked Out (1), 1.0 to 4.2 s | Knockout: twists and drops |
| `ko_b` | Death, 0.15 to 2.4 s | Knockout: sinks backward, legs rise as the back lands |
| `ko_c` | Standing Death Left 02 | Knockout from a side blow: spun round, face down |
| `hit_big` (+ mirror) | Big Side Hit | Stagger from a side blow, mirrored to the side it came from |
| `hit_body` | Receive Stomach Uppercut | Stagger from a blow straight on |
| `run_loop` | Run | Running (2.4 to 7 m/s) |
| `sprint_loop` | Sprint | Sprinting |
| `run_stop` | Run To Stop | Halting from a run |
| `strafe` (+ mirror) | Jog Strafe Left | Side-stepping while facing the rival (it was Standing Aim Walk Left) |
| `walk_back` | Walking Backwards | Slow backpedal |
| `jog_back` (+ mirror) | Jog Backward Diagonal | Backpedal (it was the forward walk played in reverse) |
| `water_cast` | Magic Spell Casting | Water SPECIAL (Drowning Sphere) |
| `water_spell` | Spell Casting (1) | Water sustained bending (HAND held) |
| `wall_run` (+ mirror) | Wall Run | Fire, Earth and Air: running along a wall |
| `wall_flip` | Diagonal Wall Run (1) | Fire, Earth and Air: up a wall, then off it in a back somersault |
| `mma_kick` | Mma Kick | Earth Kick, fourth take |
| `round_kick2` | Roundhouse Kick (1) | Fire Flame Kick, alternating with the first roundhouse |
| `sweep_spin` | Leg Sweep (2) | Earth Sweep, alternating |
| `hurricane` | Hurricane Kick | Air's kick in the air |
| `fall_roll` | Falling To Roll | Baked and kept; not used by a move yet |

The pack is now 133 clips and 3.97 MB (it was 108 clips and 3.3 MB).

## Kept for later (in `.anim-src/drive3`, not in the pack)

- Shoulder Throw Aggressor, Thrust Slash, Heavy Weapon Swing, Combo Punch.
- Rockin' Shackle B, Being Electrocuted, Laying, Pick Up Item.
- Stand To Cover, Standing Cover To Cover, Left Pivot, Running Turn 180, Running Arc.
- Running Slide, Crouched To Sprinting, Left Strafing Jump, Jumping, Jumping Down (1).
- Fight Idle (1), Idle (1), Standing, Standing Up.
- Death From Front Headshot, Death From Right, Knocked Out, Getting Up (1) (rising from face down), Roll Kicking.
- Human Basic Motions FREE (walks and runs in eight directions).
- Duplicates of clips already in the game: Backflip, Run To Flip, Dodging Right, Kicking, Stomp, Punching, Uppercut Jab, Leg Sweep (1), Running Dive Roll, Strafe.

To use one of these, add it to `tools/retarget/martial-spec.json`, then bake, merge and pack it.

## Not usable yet

Seven kicks use a rig named EEJANAIBot:
- webster side kick
- webster axe kick
- spinning axe kick
- side-back kick
- jumping side kick
- double side kick
- guyver kick

The retargeter now reads their bones, but the body turns upside down mid-kick. Their rest pose does not match their animation. "double side kick" is the mid-air double kick asked for in M4, so it is the first one worth fixing.

## Blending and hands (`js/hero.js`)

- **Blend into a reaction:** 0.1 s (it was 0.05 s).
- **Blend out of a reaction, fall or get-up into the stance:** 0.3 s.
- **Multi-hit blows:** within 0.3 s, a second hit continues the reaction already playing. It does not switch or restart it.
- **Fighter timings** (`js/fighter.js`):

  | Action | Duration |
  |---|---|
  | Hit | 0.36 s |
  | Stagger | 0.72 s |
  | Knockdown | 1.0 s |
  | Get-up | 1.1 s |

  Reactions now play at 1.15 to 1.35 times their captured speed, and the get-up at 1.8 times.
- **Fingers.**
  - Each clip is measured when the game loads: its largest finger-joint rotation from its first frame.
  - A clip whose fingers move by more than 0.25 rad keeps its captured fingers. For reactions, falls, get-ups and locomotion the hand-shape layer is 0 %; for strikes it is 30 %.
  - A clip whose fingers are frozen (many Mixamo strikes hold one hand pose) takes the style's hand shape at 85 %.
  - The layer weight eases between clips; it does not jump.
- **Movement speeds.** Facing the rival, backing away is 45 % slower and side-stepping 20 % slower, so the backpedal and strafe clips play near their captured pace instead of skating.

## Wall run (`js/fighter.js`: `wallNear`, `wallStart`, `wallTick`, `wallOff`)

- **Where:** Fire, Earth and Air. Press JUMP within about 0.5 m of a wall while moving faster than 3 m/s. Walls are the arena walls, or any box or rock at least 1.8 m taller than the feet.
- **Running alongside the wall:** a 0.9 s run along it.
  - The body tips 54 degrees toward the wall, so the feet meet it.
  - JUMP again kicks off the wall.
- **Running straight at the wall:** a 0.5 s run up it, then a back somersault off it.
- **Footfalls:** Fire leaves flame, Earth knocks rock grit from the wall, Air leaves gusts.

## Second pass (your message of 17 Nov, later)

- **Water droplets:** removed. The droplet spray behind whips, kicks, surfing, guards and specials is gone (`fx.splash` is now a no-op).
  - What is left of Water is the whips, the balls, the streams, the waves and the Drowning Sphere.
- **Water HAND:** whips and punches alternate:
  - right-to-left whip;
  - jab, throwing a ball of water;
  - overhead whip;
  - cross, throwing a ball of ice;
  - diagonal whip;
  - hook, throwing a ball of water.

  The fists close for the punches and the palms open for the whips.
- **Ice:**
  - **Colour:** pale, almost white blue and translucent, with a faint cold glow (`js/defence-fx.js`, `iceMat`). The old blue was 0xbfe8ff; the new ice is 0xe6f7ff.
  - **Ice surf:** the bender rides a thick ice floe on a ridge of ice. The feet are held 1 m off the floor (it was 0.45 m), and the ice trail stays on the floor behind.
- **Earth rock slide:** the slab rides on a column of rock, 1 m up (it was 0.6 m).
- **Air DODGE:** a 2-second glide inside the whirlwind, about 0.7 m off the floor.
  - It goes in the stick's direction, or back and to the side away from the rival if the stick is centred, and the stick steers it.
  - It starts fast and eases (13 m/s down to 4 m/s). It protects for the first 0.6 s and costs 16 energy.
  - The body plays the airborne gliding pose (UAL2 NinjaJump idle, as in flight). The old move was a 0.34 s sideways dash.
- **Caught in the air:** caught fighters (Tornado, Drowning Sphere, whip capture) thrash in a struggle loop (Mixamo Being Electrocuted, 1.0 to 4.0 s). They used to hold the guard pose at 0.6 speed.
  - The Tornado now marks its victim as caught for as long as it holds them.
- **Thrown high:** the knockdown fall is slowed to match the time left in the air, so the back lands when the body reaches the floor. It no longer finishes early and hangs lying in mid-air.
- **Procedural motion:** none. Every technique for every element names an authored clip. The procedural tumble and pose layers stay at 0 throughout every traced scenario.

## Trace (from `tests/record-m5-closeups.mjs`)

Each line lists every clip change with the time it started. A "|U" or "|L" suffix means the upper body or legs only. Procedural weight is 0 throughout every scenario.

| Scenario | Clips in order |
|---|---|
| Run, release the stick, back away, step left | Walk_Loop, run_loop, run_stop, fire_idle, jog_back (legs) under fire_idle (arms), strafe |
| Fire roundhouse, from the start of the kick through recovery | fire_idle, fire_round_M (or round_kick2 on the next press), fire_idle. The rival goes into hit_body |
| Jab, cross, hook | fire_jab, fire_punch_M, earth_punch_M (UAL walk under the arms while lunging), fire_idle |
| Rival flinch, stagger, side stagger | hit_b or hit_a, hit_body, hit_big, earth_idle |
| Knockdown, a blow while getting up, recovery | knockback, getup, knockback (held, lying), getup, fire_idle |
| Knockout | ko_b, held |
| Wall run (Fire, Earth, Air) | run_loop, sprint_loop, wall_run, air_loop, fall_loop, land_high, stance |
| Wall flip | wall_flip, dodge_back, fire_idle |
| Water whips, sustained bending, SPECIAL | whip_d, whip_h_M, water_spell, water_flow2, water_cast_M, water_flow2 |

## Remaining problems

- The Fire fist's fireball and the roundhouse flame arc are still large at close range.
- At the normal camera distance, the wall run is seen from behind. It reads best from the side.
- The arena is mostly open floor, so walls for wall running are at its edges and on the tall rocks.
- The AI does not use the wall run yet.
- The new run clips are used only when moving forward. Fast backpedalling still uses the jog-backward clip at up to 1.9 times its captured speed.

## Results

These are local runs in headless Chromium, not on a phone.

| Suite | Result |
|---|---|
| M3 effects | 46/46 |
| Overhaul | 52/52 |
| Milestone | 22/22 |
| Play | 86/86 |
| Acceptance | 15/15 |

Tests changed, with the reason given in each:
- `m3-effects-test.mjs`: Water's second and fourth strikes are punches. Those strikes are checked for a water or ice ball leaving the fist, and ball hits count toward the strikes that land.
- `overhaul-test.mjs`: Water's HAND chain needs six presses to show the three whips.
- `milestone-test.mjs`: Air's DODGE is a two-second glide.
  - The sideways check is the direction of travel, within 25 degrees of the stick.
  - The second glide is pressed after the first has ended, and is measured from where the first one stopped.

The development build r12 (commit 5f672be) is live at https://tamikoroye.github.io/elemental-forge-dev/. The public game is unchanged.

Captures: `tests/evidence/m5/m5-all-moves.mp4` (55 s, every scenario, with clip names and blend weights on each frame) and `tests/evidence/m5/m5-clip-sequence.json` (the clip sequence per scenario).
