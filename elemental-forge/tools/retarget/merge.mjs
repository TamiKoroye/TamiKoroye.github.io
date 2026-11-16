// Merges freshly baked clips into the game's pack by name (new names are added, existing ones replaced).
// Usage: node tools/retarget/merge.mjs <baked.json> [pack=assets/animations/martial.json]
import fs from 'node:fs';
const [SRC, PACK = new URL('../../assets/animations/martial.json', import.meta.url).pathname] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(PACK, 'utf8')), n = JSON.parse(fs.readFileSync(SRC, 'utf8'));
for (const c of n.clips) { const i = p.clips.findIndex(x => x.name === c.name); if (i >= 0) p.clips[i] = c; else p.clips.push(c); console.log(i >= 0 ? 'replaced' : 'added', c.name); }
fs.writeFileSync(PACK, JSON.stringify(p));
console.log(p.clips.length, 'clips');
