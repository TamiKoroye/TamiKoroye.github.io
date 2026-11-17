# 17 Nov (evening): new Drive files, the whip slam fall, water burst

## New files in the Drive folder

| File | What it is | Used? |
|---|---|---|
| `ElementalForge_Water_Animation_Prototypes.zip` / `ElementalForge_Water_PrototypeAnimations.glb` | 15 keyframed water motions made by GPT (README: "original keyframed prototype actions ... not 3D motion capture ... not production-quality"), as one GLB and 15 BVH files, with event timings | **Not in the game.** The skeleton was added to the retargeting tool (`humanoid` rig) and all 15 were baked onto our character. In nearly every frame the arms stay held out in a neutral pose with little body movement; the source preview shows the same. They would look stiffer than the motion-capture clips Water already uses. (Our conversion also left the arms higher than the source's 45 degrees, a shoulder offset to fix if they are ever used.) Their move list (ring spin, geyser launch, wave-wall push, ice wall raise, crest vault) is kept as design input |
| `Water_Skeleton_Motion_Preview.mp4` | the GPT preview of those 15 motions | reviewed |
| `Skeleton_Motion_Preview.mp4` | a GPT preview of a **Fire** set: jet launch, hover loop, jet dodge left / right, fireball, wall guard, aerial kick, hurricane kick, flame sweep, stomp shockwave | **Only the video is on Drive; the animation data (GLB / BVH) for this Fire set is not.** Needed to replace the fire dodge as asked |
| `jordan_lapis.mp4`, `redjar.mp4` | stylised water-bending animations (silhouette / stick figure) | style reference: water erupting higher than the bender, waves, rings, ice walls, ice spikes, a huge water ball |
| `flowbound.mp4`, `sinofanime.mp4`, `nico_neilson.mp4`, `pcnastyx.mp4` | gameplay reels of other bending games | style and scale reference only; nothing copied |

## Changes

- **Whip slam:** the rival now crashes onto the back. The slam drops them from 2.6 m in about 0.1 s, too quick for the knockback fall to get past its kneeling stage, so they landed on their knees and then fell. The fall is now joined at 60 % (the body already tipping back) and plays fast enough to finish as the body reaches the floor (`js/hero.js`, `slamFall`). A ring of water bursts out of the floor at the impact.
- **Water burst:**
  - **Eruption:** releasing a wave first sends a fan of water sheets bursting up out of the floor in front of the bender, higher than their head, staggered from the middle outwards.
  - **Breaking wave:** the wave itself is now a curling breaker (back slope, crest, a lip hanging over the front, foam along the crest) that rears up as it travels.
  - **Sizes:** the Tidal Wave (LEG held) is 3.8 m tall and 6.5 m wide (from 1.8 m by 5.5 m); the spinning kick's wave is 2.4 m.
  - **Look:** the water is solid, with no droplets or splash sprites.
