# M6: downloaded assets, movement and elemental refinements

Everything below was checked in the game in headless Chromium, with stepped simulation, the keyboard controls (the same commands as the touch buttons), and close-up captures; the clip names come from the animation mixer. Nothing has been tested on a phone.

## 1. Inventory of the new downloads (Drive folder, 17 Nov)

| File | What it actually contains | Licence | Used for |
|---|---|---|---|
| `Fire_01.rar` | 101 OpenVDB volume frames from JangaFX EmberGen (flames and temperature channels; Z-up). Volumes, not images: Three.js cannot draw them directly | CC0 (LICENSE.txt in the archive) | Rendered offline to a 36-frame flame flipbook (`assets/fx/fire_flames.webp`, made by `tools/vdb-flipbook.py`). Every flame in the game now uses it: stomp wave, guard wall, kick arcs, fist streams, rocket jets, sweep, burning ground |
| `Gasoline_Explosion_01.rar` | 131 EmberGen OpenVDB frames (density, flames and temperature): a fireball that rises into a mushroom of smoke | CC0 | Rendered to a 36-frame explosion flipbook (`assets/fx/fire_explosion.webp`): the fireball at the stomping foot |
| `water_impact_01.zip` | KanaWorks flipbook: 45 frames, 8x8 grid, a water splash with a ground ripple (anime "sakuga" style) | KanaWorks_AI VFX Asset License 1.0: free under USD 1M annual revenue, credit required | Splash on water ball and push hits, whip slam impact, the water sweep |
| `water_column_01.zip` | KanaWorks flipbook: 56 frames, a column of water | same | Loaded (`assets/fx/water_column_01.webp`), not yet attached to a move |
| `ice_projectile_01.zip` | KanaWorks flipbook: 40 frames, a spinning ice shard | same | Loaded, not yet attached to a move |
| `thunder_strike_01.zip`, `thunder_impact_01.zip` | KanaWorks lightning flipbooks | same | Not used. The game has no lightning bender; kept for a later phase |
| `ice_cluster_free.glb` | A static crystal cluster model (2,227 vertices, PBR material with clearcoat, 2 textures, no animation) | CC-BY-4.0, chrismartin1337 (Sketchfab), credit required | Ice spikes (each with its own height, width and lean), crystals growing at the base of the ice-surf crest, the frozen trail the surfer leaves (`assets/fx/ice-cluster.glb.js`) |
| `icicle 3d model.fbx` | A row of roof-edge icicles, 516,006 vertices, no textures | none given | Not used: far too heavy for a phone, and the shape (icicles hanging from a beam) fits no move |
| `ember-vfx-3d-vol2-lite_v1.0.0_godot4.3.zip` | Godot 4 scenes and shaders: fire wall, ice spikes eruption, stone pillar rise, fireworks, divine ray. No textures or models; everything is shader code and particle settings | Inkharbor licence: free in games, no redistribution as an asset | Inspected. Its shaders are Godot shading language and would need porting to GLSL. They were not ported this round: the fire wall and ice spikes were built from the EmberGen and ice-cluster assets instead |
| `Run And Swing.fbx`, `Death (1).fbx` | Mixamo: a running weapon swing; a duplicate of Death | Mixamo | Not used (no weapon; duplicate) |

The credits required by the KanaWorks and CC-BY licences are in the game's menu, under "Credits". Original downloads are kept unmodified in `.anim-src/drive4` (not committed).

## 2. Character animation used (new in M6)

| Game clip | Source | Used for |
|---|---|---|
| `water_stance` | Qi Gong take 1, 0.3 to 5.3 s: standing, hands resting at the dantian, breathing | Water idle |
| `earth_stance` | Mixamo Idle (1): low rooted stance, fists up | Earth idle (Hung Gar) |
| `air_stance` | Mixamo Fight Idle (1): light stance, open palms forward | Air idle (Baguazhang palm) |
| `fire_front` | Motifect taekwondo high front kick | Fire: High Front Kick |
| `fire_body` | Motifect Muay Thai body kick | Fire: Body Kick |
| `fire_jumpfront` | Motifect taekwondo jumping front kick | Fire: Jumping Front Kick |
| `fire_heel` | Motifect taekwondo spinning heel kick | Fire: Spinning Heel Kick |
| `fire_backkick`, `fire_mtround` | Motifect taekwondo back kick, Muay Thai roundhouse | Baked and kept |
| `earth_teep` | Motifect Muay Thai teep (push kick) | Earth: Rock Push Kick |
| `hurricane` | Mixamo Hurricane Kick | Fire: Hurricane Kick (grounded, with a jump); Air's kick in the air |
| `sweep_spin` | Mixamo Leg Sweep (2) | Fire: Flaming Sweep |
| `earth_sweep` | Mixamo Leg Sweep | Water: Water Sweep |
| `earth_stomp` | Mixamo Sword And Shield Casting (raise both arms, slam down) | Water: Whip Slam |
| `fire_punch2` | Mixamo Uppercut Jab | Earth: Rising Uppercut |
| `water_palm` | Rokoko Tai Chi push | Water: Tai Chi Push (seventh HAND strike) |
| `surf_stance` | Qi Gong take 16 | Fire's rocket dodge (held, braced), Earth's wall surf, both surfs |

Retargeting fixes: the Human Basic Motions skeleton ("B-" bones, two spine bones) is now supported by `tools/retarget/retarget.js`.

## 3. Movement

- **No running legs under attacks.** A strike on the ground is the whole authored clip with the feet planted. Moving during a strike is limited to a 1 m/s shuffle, and the step-in before a strike is one step (at most 1 m; 1.8 m for a whip reaching a distant rival). Only on the ice, on the rock slab and in flight do the arms strike over a riding pose.
- **No Ninja run.** The Mixamo "Run" clip (arms swept back) is no longer used. Forward running is the character's own jog, then the Mixamo Sprint.
- **Idle stances** for Water, Earth and Air, as above. Fire's idle is unchanged.

## 4. Fire

| Move | Control | How it works |
|---|---|---|
| Stomp | LEG held (0.3 s) | Mixamo Stomp. On the foot plant, one wave of fire rolls out of the stamping foot in a full circle: three overlapping rows of EmberGen flame sprites ride the expanding front, so the front reads as one rolling wall. A gasoline-explosion fireball rises from the foot. It knocks the rival down; a wall in between holds it back |
| Kick chain | LEG taps | Nine kicks: Flame Kick (two roundhouse takes), High Front Kick, Spinning Flame Kick, Body Kick, Flaming Sweep, Hurricane Kick, Jumping Front Kick, Spinning Heel Kick, Flip Kick. Each throws an arc of flame shaped by the kicking foot's own path |
| Hurricane Kick | 6th LEG | A jump with three spins; each spin throws a flame arc from the extended leg, feet alternating |
| Flaming Sweep | 5th LEG | The sweeping foot drags a wave of fire low along the ground round the bender; it sweeps the rival down |
| Rocket dodge | DODGE | The legs hold a braced stance a little off the floor; flame jets from both feet, against the direction of travel, carry the bender 0.36 s to the side (or in the stick's direction). No steps |
| Fire guard | GUARD | Two jets shoot up from the feet and spread into a wall of fire 4 m wide and 4.6 m tall (two rows of looping EmberGen flame columns) |
| Attacks from the guard | GUARD + HAND / LEG | Punches drive a long stream of flame and a fire orb out through the wall; kicks throw their flame arcs. The wall stays up |
| Jump | JUMP | Higher (9.6 m/s launch, from 7.9). Air still flies |
| Air kicks | LEG in the air | Up to four quick alternating kicks per jump (bicycle style), each throwing flame from its own foot |

## 5. Earth

| Move | Control | How it works |
|---|---|---|
| Jump | JUMP | The rock launch is higher (15.5 m/s, from 13.5); the plain jump too (8.4, from 7.2) |
| Wall surfing | DODGE (the slab), then JUMP beside a wall, or slide into it | The slab goes onto the wall. The bender rides it sideways along the face, about 1.4 m up, body perpendicular to the wall. The stick along the wall speeds it up or slows it; JUMP kicks off (back somersault), DODGE drops off |
| Rock punched from the guard | GUARD + HAND | Each punch drives one rock of the three out of the guard formation at the rival, from where it stands. The others stay up; the guard drops when the last is thrown |
| Rock Push Kick (new kick) | 4th LEG | The push kick drives a slab of rock out of the ground in front of the foot |
| Rising Uppercut (new move) | 3rd HAND (the chain opens with the quick jab, then the heavy lunge punch) | A rock column erupts under the rival and throws them up |

## 6. Water

| Move | Control | How it works |
|---|---|---|
| Ice surfing | DODGE held | A sculpted crest of ice (a swept wave profile, flat under the feet, curling at the front) holds the bender 1.5 m up. Crystals from the ice-cluster model grow at its base, and the track leaves a frozen path of crystals that melts after 3 s |
| Attacks while surfing | HAND / LEG on the ice | The arms strike (whips, water and ice balls, kicks) over the surfing legs; the ice stays under the bender. The surf ends only when DODGE is released, energy runs out, or the bender is hit hard |
| Whip grab and slam | Overhead whip (3rd HAND) on a grounded rival, or any whip on an airborne one | The whip wraps the rival: a rope of water from the hand to the chest. The bender plays the raise-and-slam clip; the rival, thrashing (not limp), is lifted to about 2.6 m and carried over, then driven into the floor on the slam frame (16 damage, knockdown, splash, crater) |
| More combinations | HAND / LEG | HAND: whip, jab (water ball), overhead whip (grab), cross (ice ball), diagonal whip, hook (water ball), Tai Chi push (a wide wave from both palms). LEG: Crescent Kick, Turning Wave Kick, Rising Water Kick, Water Sweep |
| Guard | GUARD | Bigger wall of water: 3.1 m tall, wider arc |
| Ice | Tidal sweep, ice balls | Ice spikes are the ice-cluster model, each with its own height, width and lean; ice-ball hits shatter into pale fragments |

## 7. What is still missing or needs your files

- **A bicycle-kick (scissor kick) animation.** None of the downloads has one. Fire's air kicks alternate Mixamo Kicking and its mirror. A Mixamo "Bicycle Kick" or similar mid-air alternating kick would replace it.
- **A held / hanging reaction.** A fighter caught by the whip, the tornado or the drowning sphere thrashes in Mixamo Being Electrocuted. Mixamo "Hanging Idle" or "Treading Water" would read better while held in the air.
- **A sideways hover / dodge pose for Fire's rocket dodge.** The rocket dodge holds the Qi Gong surfing stance. A braced crouch pose (for example Mixamo "Crouch Idle" or "Hover") would be closer.
- **More Tai Chi form clips for Water.** Only one Tai Chi take and the Qi Gong takes are available; Water's combinations reuse boxing and sword clips for the whips.
- **The seven EEJANAIBot kicks** (webster side kick, webster axe kick, spinning axe kick, side-back kick, jumping side kick, double side kick, guyver kick) still turn upside down mid-kick when retargeted.
- **3D water assets.** The water downloads are 2D anime-style flipbooks. They are used for impacts; the whips, waves and guard are the game's own shader water. A water-surface or wave flipbook in a less cel-shaded style would match the reference footage better.
- **The Ember Godot shaders** were inspected but not ported.

## 8. Tests and evidence (dev build r13, commit 0af9684)

All five suites pass against the local build: overhaul 52/52, play 86/86, milestone 22/22, M3 effects 49/49, acceptance 15/15. They run in headless Chromium with a software renderer; none of this was run on a phone.

Game changes made because of what the suites found:
- A raised guard facing the whip now stops Water's grab and slam (it used to wrap a guarding rival).
- Earth's eruption, when LEG is held, waits until the rival is out of a hit reaction; letting go of LEG still stamps at once. Before, the opening kick's rock could stagger the rival through the whole warning.
- The AI looks again at marked ground once it can act, and the roll is quicker (0.62 s from 0.83 s).
- Strike chains start again from the first strike once the bender has been back in stance for 0.9 s.

Test changes (each explained in a comment beside it):
- The charged LEG check waits for the stomp, which can now start while LEG is held.
- Acceptance check 6 and check 8 press again when the live rival knocked the player down or caught them in the whip slam.
- Check 7 now checks that moving strikes never use running legs, instead of requiring every element to strike while moving, which the planted strikes rule out.

Video: `tests/evidence/m6/m6-priority-moves.mp4` (43 s), in this order: fire_stomp_wave, fire_kick_chain (includes the hurricane kick), fire_rocket_dodge, fire_guard_wall, earth_wall_surf, earth_guard_rock_punch, earth_new_moves, water_surf_attacks, water_whip_grab_slam, water_ice_spikes. Each frame's caption names the clips playing. `m6-clip-sequence.json` lists the clip sequence per scenario.

Seen in the video and not yet fixed:
- At the end of earth_wall_surf the recording camera, placed close to the body, ends up inside the arena wall after the dismount. This is the capture script's camera, not the game camera.
- The rocket dodge's flame jets read as low flames trailing on the floor more than as jets from the feet.
- The ice-surf crest is translucent and its inner faces show through.
