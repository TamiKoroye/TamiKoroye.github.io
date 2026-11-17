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

# 18 Nov: Fire dodge, ice surf, Water moves from Tai Chi video

## GPT Fire and Water prototype packs

- **A conversion bug, now fixed.** For skeletons that face -Z (both GPT packs), `tools/retarget/retarget.js` turned the clip round in a way that moved the arms to the wrong side of their rest pose: the source hangs its arms 40 to 85 degrees down, our result held them out wide. That was the stiffness reported on 17 Nov, so that verdict on the Water pack was wrong. After the fix, a Mixamo clip still converts exactly as before, and the GPT clips match their source to within a degree.
- **Fire jet dodges: rejected.** Converted correctly, `Fire_Jet_Dodge_Left` / `_Right` keep the legs still, but the head drops towards the floor and both arms hang limp, so the dodge reads as toppling sideways, not a fighting posture.
- **Water prototypes:** not used. The Tai Chi capture below gives better motion for the same moves.

## Fire rocket dodge (rebuilt to the requirement)

- **Posture:** Fire's own fighting stance (fists up, knees bent), held nearly still: no steps, no running legs.
- **Lean:** the body leans about 14 degrees away from the direction of travel, in and out with the thrust.
- **Lift:** the bender rises 0.45 m off the floor.
- **Jets:** tight streams of flame from both soles, driven against the direction of travel, plus a flame held under each foot.

## Water ice surf

- **Phone controls:** surfing used to need DODGE held throughout. On a phone DODGE, HAND and LEG share the right thumb, so no attack could be pressed while surfing. Now DODGE held briefly starts the surf, it keeps going when DODGE is let go, and a DODGE tap steps off. It also ends after 8 s, when energy runs out, or when the bender is hit hard.
- **Ride height:** 3 m (from 1.5 m). The ice crest lengthens with its height.
- **AI:** the opponent taps DODGE to end its surf.

## Water moves captured from the Tai Chi 24 Form video

- **Capture pipeline (`tools/vidcap/`):** MediaPipe Pose Landmarker (heavy, Apache-2.0) tracks the performer in every frame (9,798 frames, 72 missed). `to_bvh.py` turns the 3D points into a skeleton animation (bone rotations from joint positions, twist from the elbow / knee bend plane and the hip / shoulder / ear lines, smoothing, feet on the floor). The retargeting tool bakes it onto our character. The clip list is `tools/retarget/taichi-spec.json`; the BVH files are in `.anim-src/vidcap` (not committed).
- **Kept (9):** Parting the Wild Horse's Mane, Brush Knee, Grasp the Bird's Tail push, Single Whip, Deflect Parry and Punch, Heel Kick, Golden Rooster, Snake Creeps Down, Cloud Hands.
- **Rejected (2):** Repulse Monkey and Fan Through Back (depth errors tip the body far backwards).
- **In the game:**
  - **HAND chain:** Wild Horse whip, Brush Knee palm (water ball), overhead whip (grabs for the slam), Parry and Punch (ice ball), Single Whip, two-palm push (wave).
  - **LEG chain:** the Heel Kick is added before the sweep; the Rising Water Kick now plays Golden Rooster's rising knee.
  - **Tidal Wave:** Snake Creeps Down.
  - **Guard:** Cloud Hands, looping.
- **Limits:** video capture estimates depth, so some poses lean more than the performer; hands and head are the roughest parts. Clips are sped up 2 to 2.8 times for combat.
- **Baguazhang video:** downloaded for Air, not yet used.
