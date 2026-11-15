# Supplied animation inventory (Google Drive folder, 15 Nov 2026)

## What was supplied
- **56 FBX files from Mixamo**, downloaded individually.
- **`MARTIAL-ARTS-MOCAP.zip`**, containing 6 FBX files exported by Rokoko (the files carry the "Rokoko FBX Export" tag). The zip also holds `__MACOSX` resource-fork files, which were ignored.
- No BVH, glTF or other formats were supplied. Every file is binary FBX.

## How it was checked
1. `tools/retarget/audit-fbx.mjs` loads every file with three.js's FBX loader and records:
   - clip length and key rate
   - joint count and naming
   - whether a mesh is included
   - finger tracks
   - how far the hips travel (root motion)
   - the exporter tag
2. Every clip was then retargeted onto the game's mannequin and rendered next to its source skeleton (`tools/retarget/preview.mjs`), and each strip was reviewed by eye.
3. `tools/retarget/measure.mjs` measured hand reach, foot height, hip height and hip rotation on the mannequin to find impact frames.

## Skeletons found
| Rig | Files | Joints | Notes |
|---|---|---|---|
| Mixamo (`mixamorig*`) | 56 Mixamo + 5 Rokoko exports named `*_MIXAMO_769` | 65 (52 in the Rokoko exports) | T-pose rest. Three finger joints plus a tip on every finger. Centimetres. Six Mixamo files also include the Mixamo character mesh (129 joints counting the mesh skeleton); the mesh is ignored. |
| Rokoko default (`Hips`, `Spine1..4`, `LeftThigh`, `LeftShin`, `Finger1..5`) | `thaichitake-12_DEFAULT_QUP.fbx` | 62 | Arms-down rest pose, about 98 keys per second, five-finger hands. |
| Game mannequin (Quaternius UAL, CC0) | – | 53 | T-pose, `DEF-*` names, 3 spine bones, thumb, index, middle, ring and pinky with 3 joints each. Metres. |

All three map onto the mannequin, fingers included. The pipeline aligns each bone's rest direction, so the Rokoko take's arms-down rest pose is handled without editing it.

## Root motion and frame rate
- **Root motion.** 23 clips move the hips more than 0.3 m across the floor, for example Au To Role (5.1 m), Running Dive Roll (4.9 m), Kicking (3.1 m) and Flying Kick (2.2 m). The bake removes this horizontal travel from the pose, because the game moves the fighter itself. The travel is stored per clip (`travel`) so dodges and dashes can follow it.
- **Frame rate.** All Mixamo clips are 30 fps with reduced keys; that's why the key rate reads 40–130 per second on some files. Everything is resampled to 30 fps.

## Licensing
- **Mixamo.** Adobe's terms let you use Mixamo characters and animations royalty-free in your own projects, including commercial games. You may not redistribute the raw files on their own.
- **Rokoko.** Rokoko's free motion library is offered for use in your projects under Rokoko's licence on rokoko.com; I could not read their legal page from here, so please check it.

To stay inside both, the downloaded FBX files are **not** committed to the public repository; they live in a git-ignored `.anim-src/` folder. Only the retargeted, game-specific clip data ships with the game. This is my reading of the terms, not legal advice.

## Duplicates and unusable files
- **Duplicate:** `BattleTaunts_WithSword_face_P_jgbZmX.fbx` is the same take as `BattleTaunts_WithSword_MIXAMO_769.fbx` plus facial blendshapes, and it fails to parse in three.js's FBX loader.
- **Overlapping:**
  - Uppercut and Uppercut Jab
  - Getting Up and GetUp_WipeBloodfromMouth
  - Standing Block Idle and Body Block
  - Left Turn and Sword And Shield Turn
- **Weapon takes:** Great Sword Slash, Sword And Shield Attack, Standing Melee Combo Attack, BattleTaunts_WithSword and Samurai_DrawSword assume a held weapon; the arm paths look wrong empty-handed. Sword And Shield Casting and Sword And Shield Crouch Block Idle are exceptions: neither needs the weapon to read correctly, so both are used.
- **Better covered elsewhere:** Kicking, Standing Aim Walk Left and Standing Run Forward are locomotion or travelling moves that other clips already cover.

## Per-file inventory
| File | Source | Format | Length | Key rate | Skeleton | Hip travel | Fingers | Assigned to | Use |
|---|---|---|---|---|---|---|---|---|---|
| Armada.fbx | Mixamo | FBX binary | 1.63 s | 30 (keys reduced) | Mixamo rig, 65 joints | 1.9 m | yes | Water | Turning Wave Kick (capoeira outside-crescent spin kick, 345 deg turn) |
| Au To Role.fbx | Mixamo | FBX binary | 4.00 s | 30 (keys reduced) | Mixamo rig, 65 joints | 5.1 m | yes | Air | dodge option: cartwheel into roll (travels 4.8 m; long) |
| Back Flip To Uppercut.fbx | Mixamo | FBX binary | 5.83 s | 30 (keys reduced) | Mixamo rig, 129 joints, +mesh | 0.5 m | yes | Fire | candidate counter: backflip then uppercut (5.8 s, contains two meshes) |
| Backflip.fbx | Mixamo | FBX binary | 2.17 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Air | backward evasive flip (air jump/dodge) |
| Blocking.fbx | Mixamo | FBX binary | 1.33 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | short arm block; perfect-guard reaction |
| Body Block.fbx | Mixamo | FBX binary | 3.43 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Fire | high boxing guard (fire guard hold) |
| Bouncing Fight Idle.fbx | Mixamo | FBX binary | 2.97 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Fire | combat stance loop (bouncing on the balls of the feet) |
| Casting Spell.fbx | Mixamo | FBX binary | 7.70 s | 30 | Mixamo rig, 129 joints, +mesh | 0.0 m | yes | Earth | low stance, both arms sweep up and thrust (Stone Pillar special) |
| Chapa-Giratoria.fbx | Mixamo | FBX binary | 3.00 s | 30 (keys reduced) | Mixamo rig, 65 joints | 2.0 m | yes | Air | Whirlwind Kick (spinning back kick) |
| Death From The Front.fbx | Mixamo | FBX binary | 3.43 s | 30 (keys reduced) | Mixamo rig, 65 joints | 1.1 m | yes | All | KO fall |
| Diagonal Wall Run.fbx | Mixamo | FBX binary | 1.13 s | 30 | Mixamo rig, 65 joints | 2.4 m | yes | Stage 5 | wall run / climbing traversal |
| Dodging Right.fbx | Mixamo | FBX binary | 1.43 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | side dodge (mirrored for left) |
| Ducking.fbx | Mixamo | FBX binary | 1.53 s | 30 | Mixamo rig, 65 joints | 0.4 m | yes | All | duck under a high attack |
| Fireball.fbx | Mixamo | FBX binary | 3.37 s | 30 (keys reduced) | Mixamo rig, 65 joints | 0.0 m | yes | Fire | Flame Orb special (two-handed throw) |
| Fist Fight A.fbx | Mixamo | FBX binary | 4.67 s | 30 (keys reduced) | Mixamo rig, 65 joints | 0.9 m | yes | Earth | punch-punch-knee combination (segments used as alternates) |
| Flying Kick.fbx | Mixamo | FBX binary | 1.50 s | 30 (keys reduced) | Mixamo rig, 65 joints | 2.2 m | yes | Fire | Flying Dragon Kick (charged), travels 2.2 m |
| Getting Up.fbx | Mixamo | FBX binary | 2.70 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | get up after knockdown |
| Ginga Sideways To Au.fbx | Mixamo | FBX binary | 3.77 s | 30 (keys reduced) | Mixamo rig, 65 joints | 1.6 m | yes | Air | capoeira ginga footwork into cartwheel (air dash candidate) |
| Great Sword Slash.fbx | Mixamo | FBX binary | 3.53 s | 30 (keys reduced) | Mixamo rig, 65 joints | 3.2 m | yes | Unused | weapon swing; arm path assumes a sword grip |
| Hard Landing.fbx | Mixamo | FBX binary | 2.50 s | 30 | Mixamo rig, 65 joints | 1.0 m | yes | All | landing from a high drop |
| Hook Punch.fbx | Mixamo | FBX binary | 2.17 s | 30 (keys reduced) | Mixamo rig, 65 joints | 0.0 m | yes | Earth | Stone Punch alternate (big hip rotation) |
| Jab To Elbow Punch.fbx | Mixamo | FBX binary | 3.27 s | 30 | Mixamo rig, 129 joints, +mesh | 0.0 m | yes | Fire | jab-elbow combination (contains mesh) |
| Jumping Down.fbx | Mixamo | FBX binary | 0.37 s | 30 | Mixamo rig, 65 joints | 0.1 m | yes | All | short hop down (0.37 s) |
| Kicking.fbx | Mixamo | FBX binary | 2.67 s | 30 (keys reduced) | Mixamo rig, 65 joints | 3.1 m | yes | Unused | travels 3 m forward while kicking; covered by other kicks |
| Left Turn.fbx | Mixamo | FBX binary | 1.03 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | turn in place 77 deg |
| Leg Sweep.fbx | Mixamo | FBX binary | 2.23 s | 30 (keys reduced) | Mixamo rig, 65 joints | 1.2 m | yes | Earth | Earth Sweep (low spinning sweep) |
| Macaco Side.fbx | Mixamo | FBX binary | 3.30 s | 30 (keys reduced) | Mixamo rig, 65 joints | 1.2 m | yes | Air | acrobatic back handspring (special/escape candidate) |
| Martelo 2.fbx | Mixamo | FBX binary | 1.30 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Air | Crescent Air Kick (whipping capoeira roundhouse) |
| Ninja Idle.fbx | Mixamo | FBX binary | 9.17 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Air | combat stance loop (light, shifting, open hands) |
| Outward Block.fbx | Mixamo | FBX binary | 2.53 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Water | redirecting sweep block (perfect-guard redirect) |
| Pivot.fbx | Mixamo | FBX binary | 4.50 s | 30 (keys reduced) | Mixamo rig, 65 joints | 0.0 m | yes | Air | pivoting guard step (air guard / evasive turn) |
| Punching.fbx | Mixamo | FBX binary | 1.27 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Fire | Fire Fist (straight extended punch) |
| Reaction.fbx | Mixamo | FBX binary | 1.67 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | hit reaction (body) |
| Right Hook.fbx | Mixamo | FBX binary | 1.10 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Earth | Stone Punch alternate |
| Roundhouse Kick.fbx | Mixamo | FBX binary | 2.13 s | 30 (keys reduced) | Mixamo rig, 65 joints | 0.7 m | yes | Fire | Flame Kick |
| Run To Flip.fbx | Mixamo | FBX binary | 2.23 s | 30 | Mixamo rig, 65 joints | 0.3 m | yes | Stage 5 | run into front flip (traversal) |
| Running Dive Roll.fbx | Mixamo | FBX binary | 2.07 s | 30 (keys reduced) | Mixamo rig, 65 joints | 4.9 m | yes | Earth | dive roll dodge candidate (travels 4.9 m) |
| Side Kick.fbx | Mixamo | FBX binary | 2.00 s | 30 | Mixamo rig, 129 joints, +mesh | 0.0 m | yes | Earth | Earth Kick (driving side kick, contains mesh) |
| Spell Casting.fbx | Mixamo | FBX binary | 4.20 s | 30 | Mixamo rig, 129 joints, +mesh | 0.0 m | yes | Earth | Boulder Lift hold (low wide stance, arms raise and push) |
| Standing 2H Magic Attack 02.fbx | Mixamo | FBX binary | 2.63 s | 30 (keys reduced) | Mixamo rig, 65 joints | 0.0 m | yes | Fire | Fire Stream hold (two-palm thrust) |
| Standing Aim Walk Left.fbx | Mixamo | FBX binary | 1.20 s | 30 | Mixamo rig, 65 joints | 1.8 m | yes | Unused | aiming strafe walk (travels) |
| Standing Block End.fbx | Mixamo | FBX binary | 1.30 s | 30 | Mixamo rig, 65 joints | 0.1 m | yes | All | lowering a guard |
| Standing Block Idle.fbx | Mixamo | FBX binary | 2.77 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Water | guard hold (forearms up) |
| Standing Jump.fbx | Mixamo | FBX binary | 1.47 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | jump take-off and landing in place |
| Standing Melee Combo Attack Ver. 1.fbx | Mixamo | FBX binary | 4.67 s | 30 (keys reduced) | Mixamo rig, 65 joints | 1.6 m | yes | Unused | weapon combo travelling 1.6 m |
| Standing Melee Kick.fbx | Mixamo | FBX binary | 1.43 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Water | Crescent Water Kick (high front/crescent kick) |
| Standing Run Forward.fbx | Mixamo | FBX binary | 0.73 s | 30 | Mixamo rig, 65 joints | 1.9 m | yes | Unused | single run cycle start (travels) |
| Sword And Shield Attack.fbx | Mixamo | FBX binary | 2.33 s | 30 | Mixamo rig, 65 joints | 3.6 m | yes | Unused | jumping weapon slam (travels 3.6 m) |
| Sword And Shield Casting.fbx | Mixamo | FBX binary | 2.97 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Earth | Seismic Stomp (raise arm, drop to one knee and slam) |
| Sword And Shield Crouch Block Idle.fbx | Mixamo | FBX binary | 0.50 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Earth | low rooted guard hold (stone wall) |
| Sword And Shield Turn.fbx | Mixamo | FBX binary | 0.93 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | quick 96 deg turn |
| Taking Punch.fbx | Mixamo | FBX binary | 5.67 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | All | longer hit sequence (5.7 s) |
| Two Hand Spell Casting.fbx | Mixamo | FBX binary | 3.43 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Water/Air | two open palms pushing out (palm strike / Water Sphere / Vortex) |
| Uppercut Jab.fbx | Mixamo | FBX binary | 3.60 s | 30 | Mixamo rig, 129 joints, +mesh | 0.0 m | yes | Fire | uppercut-jab combination (contains mesh) |
| Uppercut.fbx | Mixamo | FBX binary | 1.33 s | 30 | Mixamo rig, 65 joints | 0.0 m | yes | Fire | uppercut (combo alternate) |
| Vault Over Box.fbx | Mixamo | FBX binary | 3.53 s | 30 (keys reduced) | Mixamo rig, 65 joints | 3.2 m | yes | Stage 5 | vault over an obstacle (boulder traversal) |
| BattleTaunts_WithSword_MIXAMO_769.fbx | Rokoko | FBX binary | 30.40 s | 30 | Mixamo rig, 52 joints, +mesh | 0.2 m | yes | Unused | 30 s of sword taunts; held weapon pose |
| BattleTaunts_WithSword_face_P_jgbZmX.fbx | Rokoko | FBX | – | – | not loadable (TypeError: Cannot read properties of und) | – | – | Duplicate | same take with face blendshapes; does not parse in the browser FBX loader |
| GetUp_WipeBloodfromMouth_MIXAMO_769.fbx | Rokoko | FBX binary | 21.73 s | 30 | Mixamo rig, 52 joints, +mesh | 0.2 m | yes | All | alternate get-up (21.7 s take; segment) |
| MartialArtsKata_MIXAMO_769.fbx | Rokoko | FBX binary | 25.37 s | 30 | Mixamo rig, 52 joints, +mesh | 0.2 m | yes | Earth | kata with deep horse stance and blocks (Hung Gar stance and guard segments) |
| Samurai_DrawSword_MIXAMO_769.fbx | Rokoko | FBX binary | 34.33 s | 30 | Mixamo rig, 52 joints, +mesh | 0.3 m | yes | Unused | sword draw; weapon pose |
| thaichitake-12_DEFAULT_QUP.fbx | Rokoko | FBX binary | 32.13 s | 98 | Rokoko rig, 62 joints, +mesh | 0.6 m | yes | Water | tai chi form: stance loop, pushes, sustained draw |

## Coverage against the four styles
- **Earth (Hung Gar):**
  - covered: rooted stances (kata horse stance, crouch block), hook punches with strong hip rotation, a driving side kick, a low spinning sweep, a ground slam (Sword And Shield Casting) and a lifting gesture (Spell Casting)
  - missing: authentic Hung Gar hand forms (tiger claw, crane beak), so the hand techniques are boxing and karate punches
- **Fire (Northern Shaolin):**
  - covered: an extended straight punch, a roundhouse, a flying kick, a two-handed throw (Fireball) and a bouncing stance
  - missing: a jumping spin kick and a butterfly kick (the CMU butterfly kick from the previous milestone stays in use), and long-range Shaolin stances
- **Water (Tai Chi):**
  - covered: the Rokoko tai chi take (stance loop, pushes, sustained draw), redirecting blocks (Outward Block), two-palm pushes, and a turning crescent kick (Armada)
  - missing: slow tai chi kicks (separate-foot, heel kick)
- **Air (Baguazhang):**
  - covered: a light shifting stance (Ninja Idle), a whipping kick (Martelo), a spinning back kick (Chapa-Giratoria), evasive flips and cartwheels, and pivots
  - missing: circle walking with toe-in steps and Baguazhang palm changes; there is no clip of either

The Air and Water styles therefore lean on capoeira and tai chi movement. Mixamo search terms that may add some of the missing material: "circle walk", "palm strike", "crane", "kung fu", "tai chi kick".
