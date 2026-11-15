# Master specification audit (15 Nov 2026)

This audit compares the development build with the master development specification. The starting point was build r5, commit 042214e. The first section covers the eight animation files uploaded with the specification. The second section rates each area of the specification:

- **Present:** works in gameplay and is covered by a test.
- **Partial:** exists, but not to the standard the specification asks for.
- **Missing:** does not exist.

Items marked **(M1)** were added in this milestone. The tests that check them are in `tests/milestone-test.mjs`.

## 1. The uploaded animation files

All eight use the same Unreal-style skeleton: pelvis, spine_01 to spine_03, clavicle, upperarm, lowerarm, hand, thigh, calf, foot and ball, plus three-joint fingers. Six are Verge3D GLB files and two are FBX files. The retargeting tool did not know this skeleton, so it now has a `ue` mapping.

The GLB files store each bone at the animation's first frame, not at its rest pose. That made the Water take's scale wrong by a factor of about 50. The bake now resets each GLB to the skin's bind pose before measuring.

Each file was baked onto the game character and reviewed frame by frame next to its source skeleton. The review sheets are produced by `tools/retarget/preview.mjs`.

| File | Content | Decision |
|---|---|---|
| Kick_-_spinning_back_kick.glb (2.7 s) | Clean spinning back kick; the left foot reaches 1.13 m at 1.2 s | **Used:** `fire_spinback`, alternating with the earlier spin kick in Fire's Spinning Flame Kick |
| Kick_-_back_kick.glb (2.2 s) | Clean turning back kick; the right foot reaches 1.14 m at 1.0 s | **Used:** `earth_backkick`, alternating with the side kick in Earth Kick |
| Does_a_kick_while_moving_forward.fbx (5.0 s) | Walking steps, then a front kick while stepping forward (foot at 1.23 m at 2.2 s) | **Used:** `move_kick`, trimmed to the kick. It drives the new Running Kick for all four elements |
| Water.glb (60 s) | Acrobatic freestyle: flips, a layout, jumping kicks, crouches. Several airborne phases last over a second, with the hips 2 to 3 m up | **Not used.** It contains no Tai Chi or waterbending form. The airborne phases are not physically plausible for a grounded fighter |
| 390850.glb (28 s) | Freestyle tricking: flips, handstands, floor rolls | **Not used**, for the same reasons |
| 390492.glb (99 s) | Freestyle tricking and floor work; the hips reach 4 to 6 m in places, which suggests capture errors | **Not used** |
| Break_dance.glb and .fbx (5.8 s) | Breaking floor work on the hands, legs circling | **Not used** in combat. It might suit a later Air acrobatic flourish |

The specification asks for credible speed and grounded feet. To keep the new kicks responsive, the bake trims only their idle lead-in; it does not raise playback speed. The playback multipliers stay at the earlier values (1.45 to 1.75). Their impact frames are measured with `tools/retarget/measure.mjs`.

## 2. Specification areas

### Loading fix (r5)
**Present.**
- Character OK and every clip decoded: now 74/74, previously 68/68.
- FIGHT is blocked if anything is missing, and `?debug=anim` shows the overlay.
- The deployed results are in the report for this milestone.

### Combat flow
**Partial.**
- **Present:** combinations and input buffering (0.35 s); cancelling a strike once its impact has landed; heavy techniques committing the fighter; attacks while moving (upper-body clips layered over stepping legs).
- **Added (M1):** the Running Kick, which keeps the run's momentum (4.6 m/s through the kick).
- **Missing:** a rhythm system, meaning deliberate tempo changes and feints.

### Martial-arts styles
**Partial.**
- **Present:** each element has its own stance and its own authored clips.
- **Missing:** the Water clips include no Tai Chi forms with circular arm work. None of the supplied files contain one; the closest is the slow Rokoko take used for Water Palm.

### Bending as manipulation
**Partial.**
- **Present:**
  - **Held objects:** held rocks, globes and vortices are aimed one at a time.
  - **Sustained techniques:** the fire stream, water whip and wind push can be steered while moving.
- **Missing:**
  - Steering an object after it has been released.
  - Redirecting an opponent's stream.

### Water
**Partial.**
- **Present:**
  - **Guard:** a curtain wall, circulating streams and perfect-timing redirection, with no bubble.
  - **Ice wall:** SPECIAL during GUARD freezes the guard into an ice wall.
  - **Whip:** a water whip.
- **Added (M1):**
  - **SPECIAL redesign:** three streams spiral around the body below head height. They catch incoming projectiles, push attackers out, and are released one after another (HAND releases them early).
  - **Tidal Sweep:** the charged LEG technique now leaves a line of ice spikes.
  - **Ice interactions:** fire melts the spikes (steam) and rocks shatter them.
- **Missing:** ice spear, ice ramp or platform, and climbable ice.

### Air
**Partial.**
- **Present:**
  - **Wind push:** with a real external push the target cannot cancel.
  - **Vortices and blades.**
  - **Glide:** hold JUMP after the peak.
- **Added (M1):** a sideways dodge near the opponent walks a fast arc around them, about 110 degrees, facing them the whole time. It ends in a counter window.
- **Missing:** pressure waves, and dust picked up by the wind.

### Fire
**Partial.**
- **Present:** flame-tongue shader; fist, kicks, spin ring, stream, orbs and dragon kick.
- **Added (M1):** flame-jet jumping.
  - Holding JUMP after take-off thrusts upward from both feet for up to 0.8 s, reaching about 3.5 m against about 1.7 m for a plain jump.
  - It costs energy, steers in the air, and scorches anyone underneath.
  - Landing bursts flame outward.
- **Missing:** a fire whip, and fire defensive formations beyond the wall.

### Earth
**Partial.**
- **Present:**
  - **Arena rocks:** lifting existing loose arena rocks, with up to three orbiting.
  - **Launching:** sending held rocks with punch or kick.
  - **Structures:** pillars to stand on, seismic spikes and the wall.
- **Fixed (M1):** a rock thrown while it overlapped a boulder was destroyed on the spot. It now leaves from the chest.
- **Missing:**
  - A defensive rock ring that intercepts.
  - Rock waves.
  - Redirecting a rock already in flight.

### Shared interactions
**Partial.**
- **Present:**
  - Water puts out fire.
  - Ice reacts to fire and rock.
  - Projectiles clash with each other.
  - Defences have element rules.
- **Missing:** a single interaction table covering every pair.

### Defence, evasion and counters
**Present.**
- Guard, partial guard, guard break and perfect guard; a dodge per element.
- **Added (M1):** the circling dodge counter.

### Impacts
**Present.** Flinch, stagger, knockdown and get-up are directional, using the authored hit, KO and get-up clips.

### AI
**Partial.**
- **Present:** spacing, strafing, avoiding obstacles, dodging or guarding projectiles, and three difficulty tiers.
- **Added (M1):**
  - **Reading wind-ups:** it reads the player's strike wind-ups and guards or evades. In the test, Master reacted to 7 of 10 close strikes and Training to 1 of 10.
  - **Combinations:** two- and three-strike sequences.
  - **Counters and punishes:** a counter after a guard, and a punish after an evasion.
  - **New movement:** it uses running kicks and flame jets.
- **Missing:**
  - Using arena obstacles as cover.
  - Choosing techniques based on the opponent's element.

### Arena
**Partial.**
- **Present:** loose rocks, water pools, burnable ground, and pillars to stand on.
- **Missing:** lasting destruction.

### Camera, mobile controls and performance
**Present.** The star layout, multi-touch, landscape and stepped tests are unchanged. None of it has been tested on a Samsung device.

### Sound
**Partial.** Synthesised effects only; no licensed layered sound. The specification sets this as lower priority.
