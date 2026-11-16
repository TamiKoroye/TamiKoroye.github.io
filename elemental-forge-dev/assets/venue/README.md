# Venue: barn ruin

`barn-ruin.glb.js` is the "Barn ruin" venue (menu: Venue > Barn ruin, or `?venue=barn`).

- **Source:** `brick-arcs-barn-ruin.zip` (a photogrammetry scan of a roofless brick barn with arched walls). It was supplied in the project's Google Drive folder on 16 Nov 2026. The original archive contains an FBX (1.48 million triangles) and four 8192 x 8192 texture atlases.
- **Licence:** the archive contains no licence or attribution file, so I could not verify the scan's licence or author. That needs confirming before the venue goes into the public game.
- **Build:** `tools/venue/build-venue.mjs`.
  - It reduces the scan to about 40,000 triangles (meshoptimizer) and downscales the atlases to 1024 x 1024.
  - It measures the walls, piers and debris at body height (0.35 to 1.8 m above the floor) on a 0.4 m grid, then merges them into box colliders.
- **In game:** fighters collide with the boxes and can stand on top of them, the camera keeps them in view, and projectiles and the fire ring stop at them. Courtyard props inside the footprint are put away while the barn stands.
