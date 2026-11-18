# M9: new Drive animations, lingering guards, Fire glide, Water ice arch (18 Nov)

## Source files
All from the Drive folder uploaded on 18 Nov (Mixamo exports, studio motion capture): 29 FBX files plus
Action Adventure Pack.zip (basic locomotion: idles, walk, run, turns, cover moves, falls; not used yet, the game
already has these). Baked by `tools/retarget/m9-spec.json` into 38 clips (with mirrors), merged into
`assets/animations/martial.json`; the pack now holds 207 clips.

| Drive file | Clip | Used for |
|---|---|---|
| Skateboarding | skate_ride | Fire glide legs (the riding crouch; the push-off kick cut out) |
| Male Action Pose | fire_action | Fire glide upper body |
| Male Dynamic Pose | fire_air_pose | Fire in the air |
| Male Locomotion Pose | loco_pose | first stride of a run from standing (everyone) |
| Wave Hip Hop Dance | water_ripple | Water HAND chain: whip thrown on an arm wave |
| Butterfly Twirl | water_twirl | Water LEG chain: Butterfly Twirl Kick |
| Spinning | water_spin | Water LEG chain: Spinning Water Ring |
| Grab And Slam | water_grabslam | Water whip grab, lift and slam (the whip holds the rival) |
| Falling Into Pool | water_pool | Water lifted by its column |
| Corkscrew Evade | air_cork | Air: every second dodge (alternating with the Cartwheel) |
| Cartwheel | cartwheel | Air: every second dodge |
| Corkscrew Kip Up | getup_cork | Air get-up |
| Flying | air_fly | Air flight at speed |
| Floating | air_float | anyone lifted by wind (tornado, wind column) |
| Zombie Scream | fire_breath | Fire: Dragon's Breath (GUARD + SPECIAL) |
| Flair | earth_flair | Earth LEG chain: Flair Sweep |
| Running Jump | run_jump | jumping off a run (everyone) |
| Standing Jump (1) | stand_jump | jumping off the spot |
| Change Direction | turn_back | reversing at a run: the braking plant |
| Soccer Trip | trip | hit while dodging |
| Fall Flat | fall_flat | knockdowns (alternating with Knocked Down) |
| Falling Flat Impact | fall_impact | knocked down while in the air |
| Hit To Head | hit_head_down | knocked down by a punch |
| Head Hit | hit_head | light punch: the head snaps back |
| Hit To The Legs | hit_legs | knocked down by a sweep |
| Kip Up | kip_up | Water get-up |
| Inverted Double Kick To Kip Up | kip_kick | Fire get-up |
| Standing 2H Magic Attack 01 | magic_2h | baked, not placed yet |
| House Dancing | (none) | 21 s of footwork; not placed yet |

## Guards stay up after GUARD is let go
2 s after release, and every use buys at least another second (a three-punch chain is never cut off).
- Earth: the three rocks stay; HAND punches them out one by one, as while guarding. Unused rocks crumble.
- Water: the shield freezes into ice; each HAND breaks a spike off it and drives it at the rival (four spikes).
- Fire: the wall stays; a HAND throws it forward as three big flame orbs.
- Air: unchanged (the whirlwind drops on release).

## Fire glide (DODGE)
About 1 s, half a metre off the floor, the stick steers it. Legs: Skateboarding's riding crouch, locked
(measured foot movement relative to the hips under 0.1 m). Upper body: Male Action Pose. Jets of flame from both
soles. HAND punches and LEG throws a Jet Blast without ending the glide. DODGE again just off the floor glides again.

## Water
- DODGE: an arch of ice rises under the feet and slides the bender up (1.6 m) and sideways; the ice track is left
  behind as a ribbon tilted to the slope. Strikes and the Ice Volley (LEG) while riding. In the air (on the
  column) DODGE always makes the arch, down to the floor.
- JUMP held: the water wraps round the body as well as under the feet and lifts about 5.5 m, in the Falling Into
  Pool pose. A quick tap of JUMP stays an ordinary jump.

## Reviews
- Gameplay jitter gate (`tests/jitter-play-test.mjs`): seeded (two runs of a build now match exactly), calibrated
  on r18 (fails) and r19 (baseline). This build is above the r19 numbers on seven sequences, all involving new
  moves (Water kicks and dodges, Earth's Flair, Fire and Air dodges). Each was rendered at 60 fps and checked frame by
  frame (`JSHOT=element:sequence:dir`). Found and fixed: the Flair was cut by the next kick while upside down (now
  plays to the end, slower blend in and out); the Corkscrew could be interrupted while on the floor (strikes now
  only once on the feet); a dodge at the end of the Fire glide or the Water arch gave a back somersault (now glides /
  arches again). Re-filmed after the fixes: the Flair plays to its end and the next kick blends in over about 0.3 s;
  no pops or twitching seen in these sequences. The remaining excess over r19 is fast motion that the moves are made
  of (flips, spins, the breakdance sweep). One thing still open: the Corkscrew Evade ends on hands and knees on our
  rig, and the next strike lifts him back up over about 6 frames (smooth, but low).
- Older suites on r20: play 86/86, overhaul 52/52, milestone 22/22, effects 49/49, acceptance 15/15 (a first run
  of acceptance gave 11/15 with empty rows while the live rival interrupted the round; a rerun passed). Fixed on the
  way: holding DODGE as Water goes from the arch into the ice surf; Air flips go the stick's way; the whip slam comes
  about 0.7 s in; Water's arm-wave whip is fifth in the HAND chain.
- Live dev URL (r20): pack decodes 207/207; fire glide, ice arch, ice shield spikes and Dragon's Breath checks pass.
- `tests/m9-test.mjs`: 20 checks, played through the keyboard controls.

## r21 (18 Nov, after the user's phone recordings of r20)
- Air flight: the reclined Mixamo Flying pose did not face the rival; flight is back on the upright airborne pose.
  `air_fly` stays in the pack for a later unlockable character or stage.
- Fire glide: held DODGE no longer starts the flame run (that put the legs back to running after a moment). The glide
  lasts as long as DODGE is held (energy 9/s), rides about 1.2 m up, and the stick steers it. JUMP from the glide is the
  flame jump.
- Get-ups: the flip get-ups are Air's only (Corkscrew Kip Up). Fire's double-kick kip-up took about 6 s on the phone;
  Fire, Water and Earth now get up with the plain get-up (about 1.1 s).
- Dragon's Breath (Fire, GUARD + SPECIAL): read as nothing on the phone. Now a 0.7 s torrent of flame from the mouth
  that burns everything in a 7 m cone, plus the fireball aimed at the rival; anyone caught is engulfed.
- Earth stance: Mixamo Bouncing Fight Idle (guard up, weight shifting), slowed to 0.8 so it reads heavy. Compared on the
  rig with Ninja Idle (turns and steps too much for a stance), Standing Block Idle and the Action Adventure idles.
- Tests: all suites pass (play 86, overhaul 52, milestone 22, effects 49, acceptance 15, m9). Jitter gate: four
  sequences above r19, all with the moves reviewed frame by frame (Water kicks and arch, Earth Flair).
