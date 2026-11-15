# "NO martial-arts clips": root cause and fix (15 Nov 2026)

## What the user saw
- **Recording:** `Screen_Recording_20261115_152636_Claude.mp4`, taken in the Claude app on a Galaxy S25 Ultra.
- **Build stamp at 0:30:** `dev 2026-11-15 r4 · commit 9e0612a · NO martial-arts clips`.
- **Character:** the old procedural body, performing the old procedural techniques.

## What the stamp meant
In commit 9e0612a, `js/main.js` loaded assets in this order:
1. `loadHeroAssets()`: the rigged character, `assets/characters/ual-mannequin.json`. A failure was caught and only written to the console.
2. Only if the character had loaded, `loadMocap()`: the clip pack, `assets/animations/martial.json`. A failure set `window.__mocapError`, which the stamp printed in brackets.

The stamp showed "NO martial-arts clips" with nothing in brackets. So `loadMocap()` never ran, which means step 1 had already failed. When the character fails, every fighter is built with the procedural body. That is the figure in the recording.

## Why the character failed
- **Two network requests.** The character was loaded with `GLTFLoader.loadAsync()`, which made two fetch requests: one for `ual-mannequin.json`, and one for the `data:` URI holding its embedded mesh and animation buffer. The clip pack was a third fetch.
- **The viewer blocks them.** In the Claude app's artifact viewer the game's scripts loaded (the game ran), but these fetch requests did not.
- **Reproduced.** Serving the same build with a Content-Security-Policy of `connect-src 'none'` (fetch and XHR blocked, scripts allowed) gives exactly the user's result: the stamp reads `NO martial-arts clips` with nothing in brackets, there is no rigged character, and the console shows `Fetch API cannot load .../ual-mannequin.json. Refused to connect because it violates the document's Content Security Policy`. Without the policy, the same build reports 68 clips.
- **What can't be confirmed from here.** I could not read the Claude app's internal policy directly, and the old build sent the real error only to the console, which isn't visible on a phone. The diagnosis therefore rests on the code path the stamp proves, plus the exact reproduction.

## Why the tests missed it
- Every test ran against a plain local web server, where fetch always works.
- The stamp printed an expected clip count, not a verified one, and the game fell back silently.

## Fix (development commit 042214e)
- **No fetch or XHR anywhere.** `tools/pack-assets.mjs` packages the character as a binary glTF (GLB) inside an ES module (`assets/characters/ual-mannequin.glb.js`), parsed in memory with `GLTFLoader.parseAsync`. It packages the clip pack as an ES module too (`assets/animations/martial.js`). Both load the way the game's own code loads.
- **Every clip is checked.** Each clip is decoded and validated: it must have tracks, a duration and finite values. The game also checks that every clip it refers to exists.
- **Loading gate.** If the character or any required clip is missing, FIGHT is disabled and the exact failure is shown in red on the menu. There is no silent fallback.
- **The stamp reports what actually decoded,** for example `character OK · 68/68 martial-arts clips decoded`.
- **No procedural body in any game state.** Being trapped, the counterattack, and any state without its own clip now use authored clips.

## Tests added
`tests/acceptance-test.mjs` runs against any URL, including the deployed build. It checks that the pack loads, that it still loads with fetch blocked, and that a missing pack blocks the start. It then plays punches, kicks, sustained bending, guard and counter, attacks while moving, repeated attacks without refilling energy, every special and all four elements, using the touch controls only. It fails if any frame shows the procedural body.

**Result against https://tamikoroye.github.io/elemental-forge-dev/:** 15/15 passed.
