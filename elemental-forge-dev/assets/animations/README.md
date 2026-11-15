# Martial-arts animation pack (`martial.json`)

41 clips retargeted onto the game's 53-bone mannequin. 25 of them (the strikes and other one-sided moves) are also stored mirrored (`_M`) for the other side, which makes 66 clips in all. 38 come from the Mixamo and Rokoko files supplied for this project; three techniques use CMU motion capture where the supplied files had no equivalent (a second Earth punch, the Fire butterfly kick and the Air aerial double kick).

**Format:**
- `ef-anim-1`: every track is sampled at 30 fps
- quaternions are stored as int16 × 32767 and positions as millimetres, base64-encoded
- size is 1.9 MB, or about 1 MB gzipped as GitHub Pages serves it
- `js/mocap.js` decodes it

**Licensing:**
- **Mixamo and Rokoko:** the raw FBX files are not in this repository; they sit in the git-ignored `.anim-src/` folder. Only the retargeted, game-specific data ships. See `docs/ANIMATION-INVENTORY.md`.
- **CMU:** the database states "free for use in research projects. You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form." It asks for this credit: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."

**Pipeline** (`tools/retarget/`):
- `audit-fbx.mjs` takes the inventory
- `retarget.js` handles Mixamo, Rokoko and CMU skeletons, with fingers. It aligns rest directions, uses the take's floor, faces each strike at the opponent at its impact frame (stances use the head direction) and records root travel.
- `bake.mjs` builds the pack, blends loop seams and mirrors strikes
- `preview.mjs` draws the source skeleton over the mannequin for checking
- `measure.mjs` finds impact frames

To rebake, put the supplied files in `.anim-src/mixamo/` and `.anim-src/rokoko/` and the CMU BVH takes in a folder, then run:

    python3 -m http.server 8765 &
    node tools/retarget/bake.mjs http://localhost:8765/ tools/retarget/martial-spec.json <cmu bvh folder> assets/animations/martial.json

| Clip | Library | File | Window | Use |
|---|---|---|---|---|
| earth_idle | Rokoko | MartialArtsKata_MIXAMO_769.fbx | 9.5-10.9 s | kata horse stance |
| earth_punch | Mixamo | Hook Punch.fbx | 0.35-1.65 s | hook with full hip turn |
| earth_punch2 | CMU | CMU 135_09.bvh | 2.2-3.0 s | CMU karate lunge punch |
| earth_kick | Mixamo | Side Kick.fbx | 0.35-1.5 s | driving side kick |
| earth_sweep | Mixamo | Leg Sweep.fbx | 0.4-1.9 s | low spinning sweep |
| earth_stomp | Mixamo | Sword And Shield Casting.fbx | 1.05-2.75 s | raise and slam the ground |
| earth_pillar | Mixamo | Casting Spell.fbx | 5.3-7.1 s | low stance, sweep up and thrust |
| earth_lift | Mixamo | Spell Casting.fbx | 1.2-3.0 s | low wide stance lifting |
| earth_guard | Mixamo | Sword And Shield Crouch Block Idle.fbx | 0-end s | low rooted guard |
| fire_idle | Mixamo | Bouncing Fight Idle.fbx | 0-end s | bouncing stance |
| fire_punch | Mixamo | Punching.fbx | 0.25-1.05 s | straight punch |
| fire_punch2 | Mixamo | Uppercut Jab.fbx | 1.1-1.65 s | rising cross |
| fire_round | Mixamo | Roundhouse Kick.fbx | 0.45-1.6 s | roundhouse |
| fire_spin | CMU | CMU 88_06.bvh | 0.15-1.4 s | CMU jumping spin (butterfly) kick |
| fire_fly | Mixamo | Flying Kick.fbx | 0.0-1.2 s | flying kick |
| fire_orb | Mixamo | Fireball.fbx | 1.9-2.95 s | two-handed throw |
| fire_stream | Mixamo | Standing 2H Magic Attack 02.fbx | 1.4-1.95 s | two palms held out |
| fire_guard | Mixamo | Body Block.fbx | 0.5-2.5 s | high guard |
| water_idle | Rokoko | thaichitake-12_DEFAULT_QUP.fbx | 18.5-21.5 s | tai chi |
| water_palm | Rokoko | thaichitake-12_DEFAULT_QUP.fbx | 15.4-17.2 s | tai chi turning push |
| water_kick | Mixamo | Standing Melee Kick.fbx | 0.15-1.2 s | high crescent/front kick |
| water_turn | Mixamo | Armada.fbx | 0.2-1.6 s | armada spinning crescent kick |
| water_tidal | Rokoko | thaichitake-12_DEFAULT_QUP.fbx | 22.0-24.6 s | tai chi turning sweep |
| water_sphere | Mixamo | Two Hand Spell Casting.fbx | 1.3-2.6 s | two-palm push |
| water_draw | Rokoko | thaichitake-12_DEFAULT_QUP.fbx | 6.0-10.0 s | tai chi raise and lower |
| water_guard | Mixamo | Standing Block Idle.fbx | 0-end s | forearm guard |
| water_redirect | Mixamo | Outward Block.fbx | 0.4-1.9 s | outward redirecting block |
| air_idle | Mixamo | Ninja Idle.fbx | 0-end s | light shifting stance |
| air_palm | Mixamo | Two Hand Spell Casting.fbx | 0.3-1.2 s | open-palm thrust |
| air_crescent | Mixamo | Martelo 2.fbx | 0.0-1.1 s | whipping martelo kick |
| air_whirl | Mixamo | Chapa-Giratoria.fbx | 1.0-2.9 s | spinning back kick |
| air_cyclone | CMU | CMU 88_04.bvh | 7.6-8.9 s | CMU aerial double spin kick |
| air_vortex | Mixamo | Standing 2H Magic Attack 02.fbx | 0.95-2.2 s | wind-up turn then double palm |
| air_push | Mixamo | Two Hand Spell Casting.fbx | 1.6-2.3 s | palms held out |
| air_guard | Mixamo | Pivot.fbx | 1.0-2.6 s | turned guard |
| hit_a | Mixamo | Reaction.fbx | 0.0-1.1 s | hit reaction |
| hit_b | Mixamo | Taking Punch.fbx | 0.0-1.2 s | hit reaction |
| ko | Mixamo | Death From The Front.fbx | 0-end s | knockout fall |
| getup | Mixamo | Getting Up.fbx | 0-end s | get up |
| dodge_side | Mixamo | Dodging Right.fbx | 0.1-1.1 s | side dodge (mirror = left) |
| dodge_back | Mixamo | Backflip.fbx | 0-end s | back flip |
| block_hit | Mixamo | Blocking.fbx | 0-end s | blocking impact |
