# Combat overhaul (brief of 16 Nov 2026): assets, mechanics and controls

## 1. Assets inspected

The Google Drive folder was listed in full: about 100 files across three pages of results. Files over 10 MB were downloaded directly, because the Drive connector's limit is 10 MB. Everything was downloaded into a git-ignored folder (`.anim-src/`), and no raw source file is in the repository.

| Asset | Contents | Used |
|---|---|---|
| `Elemental_Forge_Animations.zip` | Quaternius Universal Animation Library 1 and 2 (Standard, CC0), with GLB and FBX copies including root-motion variants. Also the KinemIQ `spin.glb` (CC0), a manifest of 87 entries and per-element clip guides | See below |
| UAL1 Standard (43 clips) | The same library the game's character already comes from | No: duplicates of the existing clips |
| UAL2 Standard (43 clips) | 42 clips the game did not have (one is a T-pose) | `NinjaJump_Idle_Loop` (air / flight loop), `NinjaJump_Land` (landing from a height), `Hit_Knockback` (knocked off the feet), `LayToIdle` (getting up). Reviewed but not used: `Slide_*` is a lying-back slide, not a surfing stance; `Shield_*` and `Sword_*` are weapon clips; the farming, zombie and sitting clips are irrelevant |
| `spin.glb` (KinemIQ) | A turning spin | Baked as `turn_spin` |
| `Stomp.fbx` (Mixamo) | Weight shift, raised foot, stamp | Earth Stomp and Fire Stomp (contact at 0.75 s) |
| `Jumping Up.fbx`, `Fall B Loop.fbx`, `Falling Idle.fbx`, `Fall A Land To Standing Idle 01.fbx` | High-jump take-off, falling, landing | Take-off and fall loop are used (`jump_high`, `fall_loop`); the UAL2 landing is used instead of the Mixamo one |
| `Kick_-_axe_kick.glb`, `Kick_-_knee_strike.glb` (KinemIQ) | Axe kick (foot up to 1.6 m), knee strike | Third kick for Earth, Water and Air; Fire's knee strike |
| `qi_gong_animations_motion_cast_free02_fbx_ue5_10.zip` | 22 Qi Gong takes on the full Unreal 5 skeleton (11 to 78 s each, about 20 minutes in total) | Five segments: `water_flow` (take 11, cloud-hands turning, used for sustained whips), `water_flow2` (take 10, used for Water's stance), `water_gather`, `water_wave`, `surf_stance` (take 16, arms out in a wide side stance). The archive has no licence file |
| `motifect_martial_arts_v1_0_fbx.zip` | 40 AI-generated clips (taekwondo, Muay Thai, judo, weapons). The licence allows use in games but not redistribution of the raw files | Not yet: with the mapping added, the kicks still retarget with the hands pinned at the head and very little leg lift. Needs more work |
| `brick-arcs-barn-ruin.zip` | Photogrammetry scan of a roofless brick barn with arches: 1.48 million triangles and four 8K atlases. No licence file | The new venue (see below) |
| `ext_fbx.zip`, `ext_stl.zip`, `textures.zip` | 56 "Victor" scans of about 17 MB each, with texture maps | Inspected from their file listings only, not downloaded or opened (2.6 GB in total); I don't know what they depict |
| `bomb-crack-ground-00-free.zip` | A 3.3 s ground-fracture simulation (tyFlow): 1416 animated fragments, 27,500 triangles, 5 m across | **Earth's ground reaction.** `tools/venue/build-crack.mjs` keeps the 600 largest moving fragments and bakes their motion at 12 fps into one mesh and a table (0.95 MB). `js/crack.js` plays it with one draw call. It fires on the stomp eruption, rising pillars and slab launches, boulders striking the ground, and heavy earth landings. The 41 pieces that never move (unbroken ground) are dropped; the game's crater decal marks the hole |
| Breakdance pack, earlier kick and freestyle files | Reviewed last milestone | No change |

**Retargeting tool:** it gained four capabilities for these files:
- the full Unreal 5 skeleton and the Motifect skeleton;
- Z-up sources turned upright;
- one named clip taken from a multi-clip GLB;
- unskinned node hierarchies (`spin.glb`).

It also now resets cached sources to their rest pose before each bake.

## 2. Controls

The star layout is unchanged.

**Hold DODGE** for about 0.3 s to start the element's mobility. A tap is still the dodge.

| | Water | Air | Earth | Fire |
|---|---|---|---|---|
| HAND | Water whip: right-to-left, left-to-right, overhead, diagonal | Air whip: fast lash and sweeping strikes. In flight, a downward palm blast | Stone punch / launch held rock | Fireball; every third strike is a flame whip |
| HAND held | Twin water whips, one per hand, swept by the stick. SPECIAL during them freezes them into ice blades | Twin air streams over a pushing current | Lift up to three rocks | Fire stream |
| LEG 1 / 2 / 3 | Low crescent arc / spinning whip round the body / rising kick: a water column under the opponent | Air blade / whirlwind sweep along the ground / rising kick: an air column | Kick / sweep / axe kick: a ground wave of spikes | Flame kick / spinning kick / knee strike: a close burst |
| LEG while running | Water lance | Air blade | Rock | Flame arc |
| LEG held | Tidal wave: an advancing wall that freezes into ice spikes | Air compression: a broad pressure wave | **Earth Stomp**: the ground is marked under the opponent, then erupts | **Fire Stomp**: a ring of fire expands along the ground |
| SPECIAL | Spiral streams. Each HAND press sends one stream | Vortex | Pillar | Flame orbs |
| GUARD + HAND / LEG | Ice spear / capture (water only) | | | |
| DODGE held | **Ice surfing**: steer with the stick, pull back to brake. JUMP launches off a rising ice pillar | **Flight**: JUMP held climbs, steer with the stick, about 6 s, up to 14 m | **Rock surfing**: heavier and slower to turn. JUMP launches off a rising slab | **Flame run**. JUMP gives a flame-powered high jump |
| JUMP held after take-off | Water column under the feet | Glide (falling slower) | | Flame jets |

All tuning values live in `MOBILITY` in `js/fighter.js`:
- flight: duration, take-off, ascent, sink, maximum altitude, speed, acceleration, drain, recovery;
- surfing: top speed, acceleration, turn rate, brake, cruise speed, launch strength.

## 3. Venue

**Barn ruin** is chosen in the menu (Venue > Barn ruin) or with `?venue=barn`. The courtyard stays the default.

**Build** (`tools/venue/build-venue.mjs`):
- The scan is reduced to 40,000 triangles and its atlases to 1024 px.
- It is levelled: the scanned ground was tilted 7.8°.
- Walls, piers and debris at body height are merged into 77 box colliders.
- The scanned ground becomes a height grid the fighters walk on.

**Behaviour in game:**
- The walls stop fighters, projectiles and the fire ring, and can be stood on. The camera treats them as obstacles.
- Courtyard props inside the footprint are put away.
- The module is 3.4 MB and loads only when the venue is chosen.
