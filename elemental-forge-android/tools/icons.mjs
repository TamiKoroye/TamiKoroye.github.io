// Renders the game's icon.svg to the Android launcher icon PNGs (mipmap-*/ic_launcher.png)
// Usage: node tools/icons.mjs <icon.svg> <res dir>
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const [svgPath, res] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, 'utf8');
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const b = await chromium.launch(); const p = await b.newPage();
for (const [d, s] of Object.entries(sizes)) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg', `<svg width="${s}" height="${s}"`)}</body></html>`);
  const dir = path.join(res, 'mipmap-' + d); fs.mkdirSync(dir, { recursive: true });
  await p.screenshot({ path: path.join(dir, 'ic_launcher.png'), omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await b.close(); console.log('icons written');
