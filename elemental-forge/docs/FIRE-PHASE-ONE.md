# Fire restructuring: phase one (19 Nov)

## Sources inspected before any change
- The reference "21 Firebending Abilities" (10 min 21 s). Each section's title card was located automatically (bright
  sky-blue frames) and the eight phase-one sections were sampled at 1.2 to 3.5 frames a second:
  Blazing Rings 0:29, Blocking Fire 0:49, Fire Blade 1:02, Fire Bomb 1:22, Fire Circle 1:48, Fire Daggers 2:05,
  Fire Streams 2:45, Fire Whip 3:04, Fire Lashes 3:34, Jet Propulsion 3:50, Jet-Stepping 5:16, Fireballs/Jabs 5:37,
  Flame Redirection 5:52, Shield of Fire 6:16, The Dancing Dragon 6:30, Charged Attacks 7:14, Fire Augmentation 8:08,
  Fire Comet 9:06, Fire Missiles 9:21, Fire Pinwheel 9:36, Intertwined Fire Stream 9:47.
  The video is cartoon footage: it gives the choreography and how each technique reads, not skeletal data. Every body
  motion below comes from a baked motion-capture clip already in the game's pack (209 clips).
- The current Fire fighter (read from the running game): HAND chain fire_jab / fire_punch / earth_punch (0.56 s each),
  nine kicks on LEG (0.67 to 1.2 s), LEG held on the floor = stomp, HAND held = stream, GUARD = fire wall, DODGE = jet
  glide, JUMP = flame jump, SPECIAL = Dragon's Breath standing / Dragon Descent at a run or in the air.
- Controls (controls.js, main.js): stick, HAND, LEG, GUARD, DODGE, JUMP, SPECIAL. Held state was passed to the
  fighter for HAND, LEG, DODGE, JUMP; SPECIAL's held state was read but not passed (now passed as specialHeld).

## Critique of the Fire fighter before this round
- Every fire effect was the same orange puff sprite in clusters: fireballs, the stream, the stomp and Dragon's Breath
  all looked alike, so the eye could not tell one technique from another. Dragon's Breath was a torrent of puffs plus a
  big fireball; at that intensity it was unreadable (the user's point).
- The Fire Stream was a cloud of puffs at the far end with nothing joining it to the hands.
- The stomp's wave was three rows of flames 1.5 to 3 m tall plus a 4.6 m burst: it filled the camera.
- Punches took 0.56 s (target 0.20 to 0.35); several kicks run 0.9 to 1.2 s (heavy target 0.45 to 0.85).
- Four of the eight core families were missing: Fire Blade/Daggers, Fire Whip, Fire Bomb, Fire Comet.
- The kicks are a single nine-step chain; the stick direction plays no part in which kick comes out.

## Control map (phase one)
| Input | Technique | Notes |
|---|---|---|
| HAND tap | Fire Jabs (fireball from the fist), left-right | about 0.3 s each |
| HAND tap, rival within 2.3 m | Fire Daggers, Fire Daggers, Fire Blade | the melee family; the third tap is the finisher |
| HAND with the stick pulled away from the rival | Fire Whip | draw back and lash |
| HAND held | Fire Stream | unchanged input |
| LEG taps | kick chain (unchanged) | |
| LEG held on the floor | Fire Stomp | unchanged input |
| LEG held in the air | Fire Bomb | new |
| GUARD | Fire Shield (wall) | unchanged |
| DODGE (+ stick) | jet propulsion | unchanged |
| SPECIAL tap | Dragon's Breath | |
| SPECIAL held 0.3 s, released | Fire Comet | 40 energy, 8 s cooldown; without them it breathes |
| SPECIAL at a run or in the air | Dragon Descent | unchanged |
Conflicts checked: the whip needs the stick pulled more than 120 degrees away from the rival, so walking sideways or
in does not trigger it; the melee family only replaces the jab within 2.3 m on the floor; a held SPECIAL delays the
breath by at most 0.3 s. The AI never holds SPECIAL, so it keeps breathing on a tap.

## The moves
### Dragon's Breath (reworked)
- Asset: Mixamo Zombie Scream (fire_breath). Body: draws in, leans and roars; head turns to the rival.
- Fire: firefx.js flame body from the mouth (head bone + 0.2 m along the aim). 0.2 s: a 3.5 cm white-hot line runs to
  the rival. Then it swells into a flamethrower cone along that line, 8 cm at the lips to about 1.1 m at the far end,
  for about 0.75 s; it follows the head as the rival moves. No fireball, no puff torrent.
- Timing: 1.38 s technique; the line starts at 0.66 s.
- Collision: anyone inside the cone (distance from the axis under the cone's radius at that point) takes 3 every
  0.15 s and is set on fire (engulf, 1.8 s).
### Fire Jabs / Fireballs
- Assets: fire_jab and fire_punch (the jab and the cross), each mirrored, so taps alternate left and right: 0.33 s and
  0.30 s. The lunging hook (earth_punch) is out of the jab chain: it turns the whole body a quarter turn, which at jab
  speed read as a jerk.
- Fire: the fireball leaves the punching fist at the impact frame. It is now a compact bright ball with a short
  connected flame tail (it was a long trail of large puffs that hid the fighter); its burst on impact is half the size.
- Collision: projectile, 7 damage.
### Fire Stream
- Asset: the held pose (unchanged). Fire: one firefx flame body from between the palms along the aim, 15 cm wide at the
  hands to 65 cm at the end, grows out in 0.15 s, follows the hands; walls and guards cut it short (unchanged rules).
- Collision: unchanged (2 damage every 0.15 s in the stream, the floor at its end catches fire).
### Fire Daggers and Fire Blade
- Assets: whip_h and whip_d at speed (daggers: short slashes, elbows bent, both hands), whip_d_single (the blade: the
  torso turns into a downward diagonal cut). 0.31 s, 0.30 s, 0.56 s.
- Fire: a firefx flame on each hand along the forearm's line, 0.5 m past the fist for the daggers, 1.3 m for the blade;
  it grows from the fist in the first fifth of the cut and dies with the follow-through, licks trailing off the tip.
- Collision: at the impact frame, anyone in front within 2.2 m (dagger, 5 damage, no knockdown) or 2.9 m (blade, 12
  damage, knockdown, the floor under them catches fire).
### Fire Whip
- Assets: whip_v (overhead) / whip_h (across), 0.54 / 0.38 s. The rope physics of the water whip (it hangs from the
  striking hand, the arm's swing lays it, the lash is thrown on the impact frame) with a firefx flame body on it.
- Collision: along the rope's path, 10 damage; reaches 3 to 6.5 m.
### Fire Bomb
- Asset: fire_fly (the diving pose), then the landing. In the air, LEG held 0.18 s: the fighter drives down at 24 m/s
  towards the rival (within 9 m) and explodes on landing: a burst at the feet, a crater, and the stomp's rolling wave.
- Collision: 14 damage and knockdown within 2.4 m of the landing, then the wave (11 to 14).
### Fire Comet
- Asset: Standing 2H Magic Attack (magic_2h, 1.2 s). Both hands draw a ball of fire in front of the chest (grows from
  15 to 55 cm), then drive it out at 17 m/s; it homes gently on the rival and trails a flame tail.
- Collision: on contact (or the floor, or after 2.4 s): the dome explosion, up to 26 damage within 3.8 m, knockdown,
  the rival set on fire; projectiles near its path are destroyed.
### Fire Stomp (restored as a rolling wave)
- Asset: stomp (unchanged). Fire: the wave's rows are now 0.7 to 1.4 m tall (were 1.5 to 3 m) and the burst at the
  foot 2.8 m (was 4.6 m): it rolls out along the floor.
### Fire Shield, Jet Propulsion
- Unchanged this round: the wall from the feet on GUARD, the jet glide on DODGE (legs held in the board crouch, no
  running). Reviewed again in phase two.

## Readability pass
Frames filmed at full rate (the jitter gate's frame capture) showed the fighter buried in fire during a fast exchange:
the fist flare, the fireballs' puff trails, their impact bursts and the burning ground (licks 1.4 m tall, six patches)
added up to a wall of flame. Now: fireballs as above, the fist flare about 40% smaller, burning ground in low licks
(about 0.5 m), impact bursts halved. Damage is unchanged.

## Tests completed
- Scripted round (local and on the dev URL): jabs 0.33 / 0.30 s, each fireball hits (7); daggers 0.31 / 0.30 s and
  the blade 0.56 s land (5 and 12); the whip lands (10) with the stick pulled back at 5 m; the bomb dives from a jump
  and its wave hits (11); the Comet charges, flies and explodes (17 at that range); the breath burns in ticks of 3.
- Frame sheets of every move reviewed (breath, stream, daggers and blade, whip, bomb, comet, jabs).
- All suites: see the build notes in M9-MOVES-AND-GUARDS.md.
- Jitter gate: the Fire hand sequences are above the r19 numbers in snaps per second. Reviewed frame by frame: the
  motion is continuous (no pops); the count comes from the speed asked for in the brief (jabs 0.3 s, dagger slashes
  0.3 s), which turns the arm much further per frame than the old 0.56 s punches.

## Limitations and what is missing
- No dedicated motion capture for the dagger slashes or the blade: they are whip clips played fast. They read as cuts,
  but a true two-handed knife pattern would need a new clip.
- The Comet's charge plays the 2H magic attack at a fixed speed: holding SPECIAL longer does not charge it more.
- Damage is still decided on each client from the effect positions; for multiplayer the hit tests (cone, rope, radius)
  need to move to an authoritative tick. Not done in this round.
- Not tested on the Samsung Galaxy S25 Ultra.
