# Earth, phase one (from 20 Nov)

The user's brief: Earth as a physically capable Hung Gar fighter in every state (attack, defence, rock surfing, jumping,
falling, dodging, being hit, recovering); eight core families; Earth Launch; Block; Armour; Earthquake, Fissure and
Ground Shift; four control moves (Earth Sinking, Quicksand, Slab Shackles, Earth Hand); the rock-surfing posture; an
original ultimate (Earthbreaker); Dust Cloud as a damaging attack; and hit reactions, falls and get-ups for every
fighter. References: the user's three earthbending gameplay clips (Drive: Earth, Earth 2, Earth 3), used for the
weight and scale of the rock only (jagged spire clusters and walls, square rock blocks rising under the bender, dust
and fragments on every impact).

## What exists and what is missing (audit, 20 Nov)

| Brief item | Before this phase |
|---|---|
| Rock projectile | HAND bursts a stone from the floor and punches it out; HAND hold lifts a boulder (Boulder Lift) |
| Earth Compression | missing: no hands-together compression, no quick/charged size difference |
| Earth Gauntlet | missing: no rock on the fist or forearm |
| Punch variations | jab, lunge punch, rising uppercut (column under the rival); no hammer strike, no punch-to-kick |
| Pillar | raisePillar (column under the rival on the uppercut; pillars from GUARD) |
| Earth Launch | JUMP throws the bender up at 15.5 m/s on a column at once: no crouch, no leg drive, no landing sequence |
| Earth Block | GUARD raises a wall; GUARD + HAND punches a rock out of it |
| Earth Armour | missing |
| Earthquake | Seismic Stomp (LEG charged) and Earth Stomp (stomp clip) |
| Fissure | SPECIAL: Ground Rupture (three fanning fracture lines) |
| Ground Shift, Earth Sinking, Quicksand, Slab Shackles, Earth Hand | missing |
| Rock surfing | DODGE: slab surf in the surf stance |
| Earthbreaker (ultimate) | missing |
| Dust Cloud | missing |
| Hit reactions | light flinches (hit_a / hit_b / head), staggers (Big Side Hit, stomach hits), knockdowns (Knocked Down, Fall Flat, Falling Flat Impact, Hit To The Legs, Soccer Trip), get-ups (Getting Up, Kip Up, Corkscrew Kip Up). Missing: falls to the side, falls forwards from the front, landing on a knee, a hand catch, a roll after a big blow, corrective steps |

## Control map (no new touchscreen buttons)

| Input | Earth |
|---|---|
| HAND tap | gauntlet punch chain: quick stone jab, heavy lunge punch, rising uppercut, hammer strike |
| HAND then LEG within the chain | punch-to-kick |
| HAND held | Earth Compression: the hands draw fragments together; release thrusts the stone out (bigger the longer it is held) |
| HAND with the stick pulled away from the rival | Dust Cloud (held 0.3 s: the charged, wider blast) |
| LEG | kick chain (unchanged) |
| LEG charged | Earthquake (horse stance stomp, shockwave) |
| LEG with the stick pulled away | Ground Shift |
| GUARD tap | Earth Block: a compact slab toward the incoming attack |
| GUARD held | the wall (unchanged) |
| GUARD + LEG | Earth Sinking |
| GUARD held + SPECIAL | Earth Armour |
| SPECIAL tap | Fissure |
| SPECIAL with the stick toward the rival | Earth Hand |
| SPECIAL with the stick away | Slab Shackles |
| SPECIAL with the stick sideways | Quicksand |
| SPECIAL held 0.3 s | Earthbreaker |
| JUMP | Earth Launch (crouch, column, leg drive, flight, landing) |
| DODGE | rock surf (posture rebuilt) |

## Stages
1. Hit reactions, falls and get-ups for every fighter (strength and direction aware).
2. Gauntlet punches, compression projectile, Dust Cloud.
3. Earth Launch and landing, Earth Block, pillar.
4. Earthquake, Fissure, Ground Shift.
5. Earth Sinking, Quicksand, Slab Shackles, Earth Hand.
6. Rock-surf posture, Earth Armour, Earthbreaker.
Each stage: tests, captures, deploy to the dev URL, report.

## Built (20 Nov, second round): four new skills (js/earth.js)
| Skill | Input | What it does |
|---|---|---|
| Dust Cloud | HAND with the stick pulled away from the rival (6 s cooldown, 14 energy) | Brush Knee and Push: weight onto the supporting leg, the lead arm sweeps, the palm thrusts at 0.5 s. A low storm of grit and small stones, then thick rolling dust, runs 9 m: 9 damage, a push back into a recoil or stagger (no knockdown), the rival blinded 1.6 s (a dust veil on screen for the player; the computer opponent loses its aim). A dust cloud then hangs 4.5 s where it ran out or struck; a fighter inside it is hidden from the computer opponent. HAND kept held: the charged storm (11 m, wider, 14 damage, harder push, 2.4 s blind, bigger cloud for 6 s). |
| Earth Sinking | SPECIAL with the stick toward the rival (5 s cooldown, 22 energy) | Sinks and drives both palms down; at 0.65 s the ground under the rival opens into a dark pit ringed with broken stones and pulls them in to the shins (6 damage). They cannot step out and struggle (bent knees, torso working) for up to 2.2 s; each JUMP or DODGE press tears free 0.35 s sooner. |
| Quicksand | SPECIAL with the stick to the side (7 s cooldown, 20 energy) | A horse stance, the hands circling down; a 3.2 m circle of swirling sand opens under the rival for 4.5 s. Anyone but the bender in it moves at a third of their speed, sinks a little and cannot jump high. A trap only. |
| Rock Armour | SPECIAL with the stick pulled away (14 s cooldown, 30 energy) | A stamp; stone plates climb from the feet to the head and lock onto every bone (48 plates: feet, shins, thighs, hips, torso, shoulders, upper arms, forearms, fists, neck, head), a rock man whose joints still bend. Blows do 40 % damage and each reaction drops a step (a knockdown becomes a stagger; light hits no flinch); 80 % speed. It breaks after soaking 70 damage or after 10 s. |
The computer opponent uses all four when it plays Earth.

## Controls simplified (20 Nov, after review: "too complex / hidden ... this is a phone game")
| Input | Earth |
|---|---|
| SPECIAL tap | Dust Storm: the stamp and palm thrust drive a storm of grit at the rival (14 damage, a stagger, no knockdown), then the dust floods the whole arena for 8 s. The rival is blinded throughout (a computer rival loses track of the bender; a human rival sees a dust wall about 9 m off plus a veil). The bender feels the rival through the ground: gold tremor rings pulse under the rival's feet, drawn through the dust. 12 s cooldown, 30 energy. |
| SPECIAL held 0.3 s | Quicksand under the rival: drawn in and swallowed towards the head; JUMP struggles up; at the chin it crushes (20) and throws them out. 7 s cooldown. |
| LEG held | Earth Sinking: the rock trap under the rival, legs held 2.2 s, no dodge or jump out. |
| GUARD held 0.6 s | Rock Man: the stone armour, the close-quarters form (stone fists and feet hit 40 % harder and push further; blows do 40 % damage and one reaction step less). 14 s cooldown, 30 energy. |
| HAND with the stick pulled away | Ground Rupture (the fissure), moved here from SPECIAL. |
The earlier stick-direction SPECIAL moves and the Dust Cloud on HAND are replaced by these.
