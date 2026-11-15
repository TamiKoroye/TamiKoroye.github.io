# Elemental Forge: quality gap analysis (15 Nov 2026)

## Videos analysed
| ID | File | Length | What it shows |
|---|---|---|---|
| ref1 | VID_20261114_182812_788.mp4 | 88 s | Water vs earth duel (@whoiscobraa) |
| ref2 | VID_20261114_182942_000.mp4 | 47 s | Air vs fire duel (@nico_neilson_cr) |
| ref3 | VID_20261114_183033_221.mp4 | 50 s | Fire vs water/earth duel (@nico_neilson_cr) |
| ref4 | VID_20261114_183406_535.mp4 | 97 s | Earth vs fire duel (@whoiscobraa) |
| game | Screen_Recording_20261115_022727_Chrome.mp4 | 225 s | Elemental Forge (Stage A–D build) on the Galaxy S25 Ultra |

All four references come from the same third-party PC game, filmed in portrait for social media. The game area is the middle band of each frame. Every video was decoded, and I reviewed them through timestamped contact sheets, 10 fps motion sequences and full-resolution crops.

## What the references contain, and how the game compared

### Characters and animation
**References**
- Realistically proportioned male fighters, bald and shirtless or in a tank top, wearing baggy trousers and barefoot or in boots. The clothing is textured, for example the folds on the shorts in ref2 0:00–0:01.
- Cel shading with two or three hard light bands and dark ink outlines. In ref2 0:24 the outline is clearly visible along the arm.
- **Motion-captured animation:**
  - ref2 0:00–0:02 starts from idle into a run with a forward lean, heel strikes and pelvis rotation
  - ref1 0:17–0:19 shows a full backflip
  - ref4 0:09, 0:24 and 0:48 show vaulting onto and climbing boulders and walls
  - ref1 0:18 shows a forward roll
- Transitions between these are continuous.

**Game (before this work)**
- A procedurally generated mesh: lofted tubes and ellipsoids with no texture, no outline and smooth realistic shading.
- Every motion was procedural: sine-driven run cycles and keyframed poses. In game 2:15–2:30 the run has no heel strike, no pelvic drop and uniform limb arcs.
- The fighter filled about 20% of the screen height; the references show about 40% (compare game 0:15 with ref2 0:03).

### Bending effects
| | References | Game before |
|---|---|---|
| Fire | Opaque, puffy cel-shaded blobs in yellow, orange and red with dark scorch flecks. Streams are chains of large blobs (ref3 0:21–0:27, ref4 0:33); fireballs are small blob clusters (ref3 0:03). | Hundreds of additive glow sprites that clip to a white rectangle (game 1:07–1:15, 1:30–1:37). The fire reads as glare rather than flame. |
| Water | Faceted light-blue chunk clusters (ref1 0:03), ribbons wrapping the arms (ref1 0:03), huge translucent ice slabs and ramps with a star-sparkle texture that the bender rides (ref1 0:00, 0:15–0:21, 1:03), and a ring around the feet (ref1 1:15). | Smooth glossy spheres and a bubble shield (game 0:45). No ice structures and no water traversal. |
| Air | Thin white and lavender ribbon trails curving around the body and along attacks (ref2 0:18, 0:24, ref1 0:09). | Rigid white torus rings (game 2:30, 3:07) and faint sprites. |
| Earth | Large jagged grey cel rocks: walls of spires (ref4 0:06, 0:21), a moving line of rock spikes (ref1 0:48), raised discs (ref1 0:12), boulders the bender stands and climbs on (ref4 0:12, 1:12), and dust bursts on stomps (ref1 0:57). | Similar shapes (spires, pillars, orbiting rocks) but darker, smaller and PBR-shaded. |

### Environment, camera and pacing
- **Environment:** the arena layout is the same template, but the references are lit flat and bright (light mauve walls, saturated orange and blue floors) and cel-shaded. The game used filmic tone mapping (ACES) and darker walls, which muddied the colours.
- **Breakable cover:** the references have wooden walls and crates that break into planks (ref1 0:24, ref4 0:18 and 1:03). The game has nothing breakable.
- **Camera:** both games use the same over-shoulder follow camera, but the references sit closer and lower.

## Main causes of the gap, in priority order
1. **Authored motion.** The references use motion-captured or hand-keyed clips, while the game used only procedural animation. This is the largest single difference.
2. **Character modelling.** The references have properly modelled, textured, outlined characters; the game's body was generated in code.
3. **Effects rendering.** Additive glow and particles versus solid cel-shaded effect geometry: blobs, faceted chunks and ribbons.
4. **Shading and lighting.** Realistic shading plus ACES versus flat cel shading with outlines.
5. **Camera framing.** The fighter was half the reference size on screen.
6. **Missing environment interaction:** breakable wood, ice structures you can ride, climbing.

## Technical assessment
1. **Was the procedural body a fundamental limitation?** Yes. It can't carry textures, folds or a convincing silhouette. **Replaced** with a rigged glTF character.
2. **Rigged GLB/glTF characters?** Yes. The game now loads the CC0 Quaternius *Universal Animation Library* mannequin: 53 bones with fingers, a T-pose bind, 13.7k triangles.
3. **Authored martial-arts clips?** Needed for parity. The CC0 library supplies idle, walk, jog, sprint, jump (start, loop, land), roll, hit reactions and death. It has **no kicks and no style-specific forms**. Those still come from the procedural system, now retargeted onto the rigged skeleton. Closing that gap needs a licensed martial-arts animation pack or Mixamo clips (see below).
4. **Blending, IK and root motion:** done. The animation mixer crossfades between clips, the procedural poses are retargeted bone by bone, upper and lower body blend separately, and the clips are made in-place so gameplay controls movement.
5. **Effects pipeline:** it was the limiting factor, and it has been rebuilt: instanced cel-shaded fire blobs, faceted water chunks, and ribbon trails merged into one draw call.
6. **Arena and lighting:** they contributed. They have been converted to cel shading, flat lighting and the reference palette.
7. **Can Three.js on the S25 Ultra reach the reference quality?** Yes, for this art style. The references are a stylised cel-shaded game with low-poly environments; nothing in them needs a native engine. The recording of the previous build runs at about 60 fps on the device (measured from the screen recording: almost no duplicate frames in three 20-second windows).
8. **Can the codebase absorb these changes without a rewrite?** Yes. The character, animation and effects layers were replaced behind the existing `Fighter`, `Bending` and `FX` interfaces, and combat, controls, AI and tests are unchanged.

## Engine recommendation
| | A. Keep Three.js and improve pipelines | B. Rebuild subsystems (chosen) | C. Godot or Unity on Android |
|---|---|---|---|
| Visual quality | Limited by the old character and effects | Matches the reference art style | Same art style is achievable; better tools |
| Animation | Procedural only | Clip mixer plus retargeted procedural moves | Strongest (state machines, retargeting editors) |
| Effects | Sprite-based | Mesh-based toon effects | Shader graph and particle editors |
| Effort | Low | Moderate | High: rewrite everything, new deployment |
| Code reuse | Full | High (combat, controls, AI, tests kept) | Near zero |
| Mobile performance | ~60 fps measured | To be measured on device | Native, generally better headroom |
| Deployment | GitHub Pages link | GitHub Pages link | APK, sideload or Play Store |

**Recommendation: B.** The reference look is reachable in WebGL, and you prefer the web game. Migration (C) only becomes worth it if the project later needs native-only features, such as heavy fluid simulation or very large open worlds, or if device profiling shows WebGL can't hold frame rate.

## Asset evaluation
| Source | Licence | What it provides | Status |
|---|---|---|---|
| Quaternius Universal Animation Library (Standard) | CC0 | Rigged mannequin and 46 clips: locomotion, jump, roll, punches, hits | **Integrated** (mannequin recoloured and cel-shaded) |
| Mixamo (Adobe) | Free for use in projects; no standalone redistribution | Large martial-arts set: kicks, spins, crescent and hurricane kicks, fighting idles; human characters | Needs your Adobe login to download. If you export FBX/GLB clips, I can integrate them: same humanoid structure, retargeted by bone mapping. |
| Quaternius UAL Pro, Synty, Kevin Iglesias martial-arts packs | Paid licences | More combat clips and stylised characters | Your purchase decision |
| KayKit, Vuena low-poly characters | CC0 | Chibi or low-poly bodies | Rejected: proportions don't match the references |

The mannequin has no face (a smooth head), which still sets it apart from the references' faces. That is the next art-asset gap.

## Acceptance criteria for the combat demo
- [x] A rigged character with authored locomotion, jump and roll, and cel shading with outlines
- [x] All four elements: hand, leg and defence techniques plus sustained control, rendered with the new effects
- [x] Camera framing matched to the references (fighter about 40% of screen height)
- [x] Functional test suite passes (mechanics unchanged)
- [ ] Authored kicks and style forms (needs Mixamo or a purchased pack)
- [ ] A character with a face and clothing texture
- [ ] Breakable wooden cover, ice slabs you can ride, climbing
- [ ] Frame rate on the S25 Ultra checked again for this build
