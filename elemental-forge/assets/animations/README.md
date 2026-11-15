# Martial-arts animation pack (`martial.json`)

Fourteen techniques, each stored as captured and mirrored (`_M`), retargeted onto the game's 53-bone mannequin.

**Source:** the CMU Graphics Lab Motion Capture Database, http://mocap.cs.cmu.edu (BVH conversion with MotionBuilder joint names). The database states: "This data is free for use in research projects. You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form." Credit: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."

**How it was made:** `tools/retarget/bake.mjs` runs `tools/retarget/retarget.js` in headless Chromium with three.js. For each clip in `tools/retarget/martial-spec.json` it:
1. aligns every source bone's T-pose direction with the matching mannequin bone
2. transfers each joint's world rotation frame by frame and converts it back to mannequin-local rotations
3. turns the clip to face +Z, keeps the hips' height relative to the take's floor, and removes horizontal travel (the game moves the fighter)
4. bakes it at 30 fps, then writes a mirrored copy

| Technique | Clip | CMU take | Seconds | Motion |
|---|---|---|---|---|
| Earth: Stone Punch | earth_punch | 135_09 | 2.20–3.00 | karate lunge punch (oi-zuki) |
| Earth: Earth Kick | earth_kick | 135_04 | 2.60–3.80 | front kick (mae-geri) |
| Earth: Earth Sweep | earth_side | 135_11 | 2.40–3.60 | side kick (yoko-geri) |
| Fire: Fire Fist | fire_punch | 135_09 | 4.10–4.90 | reverse punch |
| Fire: Flame Kick | fire_round | 135_07 | 5.95–7.15 | roundhouse (mawashi-geri) |
| Fire: Spinning Flame Kick | fire_spin | 88_06 | 0.15–1.40 | jumping spin kick |
| Fire: Flying Dragon Kick | fire_fly | 90_05 | 1.75–3.20 | flying jump kick |
| Water: Water Palm | water_palm | 135_10 | 1.60–2.50 | knife-hand (shuto-uke) |
| Water: Crescent Water Kick | water_kick | 144_09 | 4.95–6.00 | slow controlled front kick |
| Water: Turning Wave Kick | water_turn | 135_07 | 3.20–4.40 | roundhouse, other leg |
| Air: Air Palm | air_palm | 78_13 | 0.20–1.35 | spinning strike |
| Air: Crescent Air Kick | air_crescent | 135_07 | 8.95–10.10 | roundhouse |
| Air: Whirlwind Kick | air_whirl | 87_01 | 1.65–2.95 | jump spin kick |
| Air: Cyclone | air_cyclone | 88_04 | 7.60–8.90 | aerial double spin kick |

To rebake after editing the spec (the BVH files are not stored in this repository; download the listed takes from the CMU database):

    python3 -m http.server 8765 &
    node tools/retarget/bake.mjs http://localhost:8765/ tools/retarget/martial-spec.json <bvh folder> assets/animations/martial.json
    node tools/retarget/preview.mjs http://localhost:8765/ assets/animations/martial.json <bvh folder>/135_07.bvh ./preview 5.95 12 34 fire_round

`preview.mjs` renders the mannequin next to the source skeleton; with `OVERLAY=1` and `--keep-heading` on the bake, it draws the skeleton over the mannequin so you can check the retarget joint by joint.
