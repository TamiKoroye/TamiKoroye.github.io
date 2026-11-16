# M4: move changes from the 17 November brief

All moves below use the downloaded martial-arts clips, retargeted to the game's skeleton. Each was checked in the game with the on-screen touch controls; `tests/record-m4-demo.mjs` records them. Nothing has been tested on a phone.

## Clip for every changed move

| Element | Move | Control | Clip (source file) |
|---|---|---|---|
| Fire | Roundhouse | LEG | `fire_round` (Mixamo Roundhouse Kick) |
| Fire | Spinning kick | LEG, 2nd | `fire_spinback` (KinemIQ Kick - spinning back kick). The CMU 88_06 butterfly kick it used to alternate with retargets with splayed limbs and caused the limp, ragdoll-like kick; it is no longer used |
| Fire | Knee | LEG, 3rd | `knee_strike` (KinemIQ Kick - knee strike) |
| Fire | Flip kick, flames from both feet | LEG, 4th | `flip_kick` (Mixamo Ginga Sideways To Au, a capoeira cartwheel) |
| Fire | Jab / cross / hook, each with a fireball from the fist | HAND taps | `fire_jab` (Mixamo Jab To Elbow Punch), `fire_punch` (Mixamo Punching), `earth_punch` (Mixamo Hook Punch) |
| Fire | Flame stream | HAND held | `fire_stream` (unchanged) |
| Fire | Stomp, ignited on the foot plant, fire ring round the rival | LEG held | `stomp` (Mixamo Stomp); the fire starts on the clip's foot-contact frame |
| Fire | Kick right, then left, in the air | JUMP, then LEG, LEG | `jump_kick`, then its mirror (Mixamo Kicking) |
| Fire | Dragon Descent | SPECIAL | `fire_fly` (Mixamo Flying Kick) |
| Fire | Flame run and flame jump | DODGE held | unchanged |
| Earth | Ground thrust launch | JUMP | `jump_high` (Mixamo Jumping Up) |
| Earth | Raised rock slide | DODGE (tap to start, tap to end) | `surf_stance` (Qi Gong take 16) for the legs; strikes play over it |
| Earth | Jagged rock guard | GUARD | `earth_guard` (unchanged clip) |
| Earth | Punch the guard rocks into shards | GUARD + HAND | `earth_punch` / `earth_punch2` (Mixamo Hook Punch, CMU 135_09) |
| Earth | Kicks that throw rock from the foot | LEG | `earth_kick` (Side Kick), `fire_round` (Roundhouse Kick), `earth_backkick` (KinemIQ back kick), `earth_sweep` (Leg Sweep), `axe_kick` (KinemIQ axe kick) |
| Earth | Rock gathering | HAND held | `Fixing_Kneeling` (UAL) |
| Water | Twin whips | HAND | `whip_h`, `whip_v`, `whip_d` (Mixamo Right Hook, Standing Melee Combo, Great Sword Slash) |
| Water | Kicks; wave on the spinning kick; ice daggers on every third | LEG | `water_kick` (Standing Melee Kick), `water_turn` (Armada), `axe_kick` |
| Water | Drowning Sphere | SPECIAL | `water_redirect` (Tai Chi take) |
| Water | Ice surfing, raised | DODGE held | `surf_stance` |
| Air | Flight | JUMP | `air_loop` (UAL2 NinjaJump_Idle_Loop) |
| Air | Whirlwind dash | DODGE | `dodge_side` (Mixamo Dodging Right, mirrored for the left) |
| Air | Whirlwind guard, arms circling | GUARD | `water_flow` (Qi Gong cloud hands) |
| Air | Air-cannon cross punch | HAND, 3rd | `fire_punch` (Mixamo Punching) |
| Air | Tornado | SPECIAL | `turn_spin` (KinemIQ spin) |
| All | Somersault forward / backward | DODGE in the air | `flip_front` (Mixamo Run To Flip), `dodge_back` (Mixamo Backflip) |
| All | Roll | GUARD + DODGE | `roll_dive` (Mixamo Running Dive Roll) |
| All | Kick in the air | LEG while airborne | `jump_kick` and mirror (Mixamo Kicking) |
| All | Knocked down, then getting up | (hit hard) | `knockback` (UAL2 Hit_Knockback), then `getup` (Mixamo Getting Up) |

## Moves with no suitable downloaded clip

- **A mid-air double kick** (the right foot, then the left, in one jump). There is no scissor or double kick in the files. The game plays the jumping kick and then its mirror image, which gives the right-then-left sequence.
- **Baguazhang circle walking.** There is no circle-walking clip. Air's stance is a held Tai Chi palm posture; its footwork is the standard walk and strafe.
- **A dedicated flip kick that fires from the feet in a backflip.** The cartwheel kick (Ginga Sideways To Au) is used: its legs pass overhead, and both feet throw flame along their path.

## What Earth's SPECIAL does (Ground Rupture)

1. The bender crouches with both hands driven down toward the ground (kata clip `earth_gather`), and grit is drawn up to the hands.
2. On the impact frame, a line of fracture bursts and clusters of rock spikes races out to the opponent, up to 10 m away, one burst every 0.08 s.
3. The last burst is the largest, with nine spikes.
4. Anyone caught takes 17 damage and is thrown about 1.7 m up.

The rupture runs along the ground and can be dodged sideways. Its frames are in `tests/evidence/m3-deployed/special-earth.jpg`.
