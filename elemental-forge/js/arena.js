// Arena: floor, walls, stands, crowd, rocks, platforms and collision queries.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

export const HALF = 30;           // playable half-size (metres)

export function jaggedRockGeometry(rng, detail = 1, rough = 0.28, stretchY = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const seen = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 1 - rough + rng() * rough * 2; seen.set(key, k); }
    v.multiplyScalar(k);
    v.y *= stretchY;
    if (v.y < -0.35 * stretchY) v.y = -0.35 * stretchY; // flatten base
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function floorTexture(renderer) {
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const ppm = S / 64; // pixels per metre
  const rng = mulberry32(7);
  const M = (m) => (m + 32) * ppm;
  // base tiles: lavender-blue stone
  for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) {
    const l = 0.93 + rng() * 0.1;
    x.fillStyle = `rgb(${Math.round(132 * l)},${Math.round(145 * l)},${Math.round(182 * l)})`;
    x.fillRect(i * 2 * ppm, j * 2 * ppm, 2 * ppm, 2 * ppm);
  }
  // warm orange court (central and one wing like the reference hall)
  const orange = (x0, z0, x1, z1) => {
    for (let i = Math.floor(x0 / 2); i < Math.ceil(x1 / 2); i++) for (let j = Math.floor(z0 / 2); j < Math.ceil(z1 / 2); j++) {
      const l = 0.93 + rng() * 0.09;
      x.fillStyle = `rgb(${Math.round(226 * l)},${Math.round(139 * l)},${Math.round(60 * l)})`;
      x.fillRect(M(i * 2), M(j * 2), 2 * ppm, 2 * ppm);
    }
  };
  orange(-16, -16, 16, 16);
  orange(16, -6, 30, 6);
  orange(-30, 8, -16, 30);
  // grout lines
  x.strokeStyle = 'rgba(40,40,60,0.28)'; x.lineWidth = 2;
  for (let i = 0; i <= 32; i++) {
    x.beginPath(); x.moveTo(i * 2 * ppm, 0); x.lineTo(i * 2 * ppm, S); x.stroke();
    x.beginPath(); x.moveTo(0, i * 2 * ppm); x.lineTo(S, i * 2 * ppm); x.stroke();
  }
  // court markings
  x.strokeStyle = '#f2d36b'; x.lineWidth = 7;
  x.strokeRect(M(-16), M(-16), 32 * ppm, 32 * ppm);
  x.strokeStyle = 'rgba(255,240,210,0.75)'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(M(-16), M(0)); x.lineTo(M(-7.5), M(0)); x.moveTo(M(7.5), M(0)); x.lineTo(M(16), M(0)); x.stroke();
  x.strokeRect(M(-4), M(-16), 8 * ppm, 4 * ppm); x.strokeRect(M(-4), M(12), 8 * ppm, 4 * ppm);
  // scuffs
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(30,20,20,${0.03 + rng() * 0.05})`;
    x.beginPath(); x.ellipse(rng() * S, rng() * S, 6 + rng() * 40, 3 + rng() * 14, rng() * 3, 0, Math.PI * 2); x.fill();
  }
  // outer border
  x.fillStyle = 'rgba(30,26,40,0.55)';
  x.fillRect(0, 0, S, ppm * 1.5); x.fillRect(0, S - ppm * 1.5, S, ppm * 1.5); x.fillRect(0, 0, ppm * 1.5, S); x.fillRect(S - ppm * 1.5, 0, ppm * 1.5, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

function yinYangTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = S / 2;
  x.fillStyle = '#e9c45a'; x.fillRect(0, 0, S, S);
  x.translate(R, R);
  const r = R * 0.94;
  x.fillStyle = '#efe6d2'; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#231a17';
  x.beginPath(); x.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); x.arc(0, -r / 2, r / 2, Math.PI * 1.5, Math.PI / 2, true); x.arc(0, r / 2, r / 2, Math.PI * 1.5, Math.PI / 2, false); x.fill();
  x.beginPath(); x.arc(0, -r / 2, r * 0.13, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#efe6d2'; x.beginPath(); x.arc(0, r / 2, r * 0.13, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#b8902f'; x.lineWidth = 10; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function bannerTexture(kind) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 320;
  const x = c.getContext('2d');
  const cols = { fire: ['#a8262b', '#f3d8a0'], water: ['#1f3f8f', '#dfe8f5'], earth: ['#2f6a35', '#e8dcb0'], air: ['#d8c27a', '#4a3a22'] }[kind];
  x.fillStyle = cols[0]; x.fillRect(0, 0, 128, 320);
  x.strokeStyle = '#e1b955'; x.lineWidth = 8; x.strokeRect(6, 6, 116, 308);
  x.fillStyle = cols[1]; x.strokeStyle = cols[1]; x.lineWidth = 9; x.lineCap = 'round';
  x.translate(64, 150);
  if (kind === 'fire') { x.beginPath(); x.moveTo(0, -55); x.quadraticCurveTo(38, 0, 18, 45); x.quadraticCurveTo(0, 60, -18, 45); x.quadraticCurveTo(-30, 10, 0, -55); x.fill(); }
  if (kind === 'water') { for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(-40, i * 30); x.bezierCurveTo(-20, i * 30 - 20, 0, i * 30 + 20, 40, i * 30 - 6); x.stroke(); } }
  if (kind === 'earth') { x.beginPath(); x.moveTo(-40, 40); x.lineTo(-8, -40); x.lineTo(8, -10); x.lineTo(22, -30); x.lineTo(42, 40); x.closePath(); x.fill(); }
  if (kind === 'air') { x.beginPath(); x.arc(0, 0, 36, 0.3, Math.PI * 1.8); x.stroke(); x.beginPath(); x.arc(4, 4, 18, Math.PI, Math.PI * 2.6); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Arena {
  constructor(scene, renderer) {
    this.scene = scene;
    this.colliders = [];
    this.cameraBlockers = [];
    this.venue = 'courtyard';
    this.group = new THREE.Group(); scene.add(this.group);
    const rng = mulberry32(1234);
    this.rng = rng;

    // ---- floor
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(renderer), roughness: 0.82, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.group.add(floor);
    this.floor = floor;

    // ---- yin-yang dais
    const yy = yinYangTexture();
    const rim = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.5, metalness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ map: yy, roughness: 0.7 });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.8, 0.16, 72), [rim, top, rim]);
    dais.position.y = 0.08; dais.rotation.y = 0.6; dais.receiveShadow = true; this.group.add(dais);
    this.colliders.push({ kind: 'c', x: 0, z: 0, r: 6.7, top: 0.16, walk: true, mesh: dais });

    // ---- stepped stone platforms (terrain variation)
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f6a72, roughness: 0.9, flatShading: true });
    const stoneTop = new THREE.MeshStandardMaterial({ color: 0x8c8790, roughness: 0.85 });
    const platform = (cx, cz, w1, h1, w2, h2) => {
      for (const [w, h] of [[w1, h1], [w2, h2]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), [stoneMat, stoneMat, stoneTop, stoneMat, stoneMat, stoneMat]);
        m.position.set(cx, h / 2, cz); m.castShadow = m.receiveShadow = true; this.group.add(m);
        this.colliders.push({ kind: 'b', x: cx, z: cz, hx: w / 2, hz: w / 2, top: h, walk: true, mesh: m });
        this.cameraBlockers.push(m);
      }
    };
    platform(-20, -19, 8, 0.45, 5, 0.9);
    platform(21, 19, 8, 0.45, 5, 0.9);

    // ---- wooden training crates / low walls (cover)
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.8 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x5a3e27, roughness: 0.85 });
    const crate = (x, z, sx, sy, sz, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wood);
      m.position.set(x, sy / 2, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; this.group.add(m);
      const e = new THREE.Mesh(new THREE.BoxGeometry(sx * 1.02, 0.08, sz * 1.02), woodDark);
      e.position.y = sy / 2 - 0.04; m.add(e);
      const e2 = e.clone(); e2.position.y = -sy / 2 + 0.06; m.add(e2);
      const hx = Math.abs(Math.cos(ry)) * sx / 2 + Math.abs(Math.sin(ry)) * sz / 2;
      const hz = Math.abs(Math.sin(ry)) * sx / 2 + Math.abs(Math.cos(ry)) * sz / 2;
      this.colliders.push({ kind: 'b', x, z, hx, hz, top: sy, walk: true, mesh: m });
      this.cameraBlockers.push(m);
    };
    crate(9, -20, 1.3, 1.1, 1.3, 0.2); crate(10.5, -21, 1.1, 0.8, 1.1, 0.5);
    crate(-24, 3, 3.2, 1.0, 0.5, 0); crate(24, -12, 0.5, 1.0, 3.2, 0);
    crate(-6, 22, 1.2, 1.0, 1.2, 0.8); crate(16, 4.5, 1.2, 1.2, 1.2, 0.3);

    // ---- slopes: ramps up to the platforms and a raised stone ledge (terrain variation)
    const ramp = (x0, x1, z0, z1, h0, h1, mat) => {
      // height varies linearly along x from h0 (at x0) to h1 (at x1)
      const w = Math.abs(x1 - x0), d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const g = new THREE.BoxGeometry(w, 1, d, 6, 1, 1);
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const lx = pa.getX(i) + cx, top = h0 + (h1 - h0) * ((lx - x0) / (x1 - x0));
        pa.setY(i, pa.getY(i) > 0 ? Math.max(0.02, top) : 0);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.position.set(cx, 0, cz); m.castShadow = m.receiveShadow = true; this.group.add(m);
      this.colliders.push({ kind: 'b', x: cx, z: cz, hx: w / 2, hz: d / 2, top: Math.max(h0, h1), walk: true, mesh: m, slope: { x0, x1, h0, h1 } });
    };
    ramp(-16, -12.5, -21, -17, 0.45, 0, stoneMat);
    ramp(13.5, 17, 17, 21, 0, 0.45, stoneMat);
    {
      // flush against the west wall (x = -30) so there is no gap to fall into behind it
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.6, 8), [stoneMat, stoneMat, stoneTop, stoneMat, stoneMat, stoneMat]);
      ledge.position.set(-26.8, 0.8, 16); ledge.castShadow = ledge.receiveShadow = true; this.group.add(ledge);
      this.colliders.push({ kind: 'b', x: -26.8, z: 16, hx: 3.8, hz: 4, top: 1.6, walk: true, mesh: ledge });
      this.cameraBlockers.push(ledge);
      ramp(-23, -16, 13, 19, 1.6, 0, stoneMat);
    }

    // ---- rocks and spires
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5c63, roughness: 0.95, flatShading: true });
    this.rockMat = rockMat;
    const place = [];
    const okSpot = (x, z, r) => {
      if (Math.hypot(x, z) < 7.8 + r) return false;
      if (Math.hypot(x, z + 13) < 4 || Math.hypot(x, z - 13) < 4) return false;
      if (Math.abs(x + 20) < 5.5 + r && Math.abs(z + 19) < 5.5 + r) return false;
      if (Math.abs(x - 21) < 5.5 + r && Math.abs(z - 19) < 5.5 + r) return false;
      for (const c of this.colliders) if (c.kind === 'b' && Math.abs(x - c.x) < c.hx + r + 1 && Math.abs(z - c.z) < c.hz + r + 1) return false;
      for (const p of place) if (Math.hypot(x - p[0], z - p[1]) < p[2] + r + 1.6) return false;
      return Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2;
    };
    const rock = (x, z, r, h, spire) => {
      const g = jaggedRockGeometry(rng, spire ? 1 : 1, spire ? 0.22 : 0.3, 1);
      const m = new THREE.Mesh(g, rockMat);
      m.scale.set(r, h, r * (0.8 + rng() * 0.4));
      if (spire) { m.scale.set(r * 0.9, h, r * 0.9); }
      m.position.set(x, h * 0.3, z); m.rotation.y = rng() * 6.28;
      m.castShadow = m.receiveShadow = true; this.group.add(m);
      g.computeBoundingBox();
      const top = m.position.y + g.boundingBox.max.y * h;
      // low, broad boulders can be jumped onto and fought from; tall spires stay solid cover
      const walk = !spire && top < 1.75;
      const col = { kind: 'c', x, z, r: r * 0.92, top: walk ? top - 0.05 : h * 1.2, walk, mesh: m, rock: true };
      this.colliders.push(col); this.cameraBlockers.push(m);
      place.push([x, z, r]);
      return col;
    };
    // water sources for waterbending: shallow pools with a stone rim
    this.waterSources = [];
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f7fc8, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.82, emissive: 0x08223c });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x8c8790, roughness: 0.85 });
    for (const [px, pz] of [[15, -9], [-14, 9]]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.22, 8, 40), rimMat); rim.rotation.x = Math.PI / 2; rim.position.set(px, 0.16, pz); rim.castShadow = rim.receiveShadow = true; this.group.add(rim);
      const surf = new THREE.Mesh(new THREE.CircleGeometry(2.25, 40), waterMat); surf.rotation.x = -Math.PI / 2; surf.position.set(px, 0.12, pz); this.group.add(surf);
      this.waterSources.push({ x: px, y: 0.12, z: pz, mesh: surf });
      this.colliders.push({ kind: 'c', x: px, z: pz, r: 2.45, top: 0.3, walk: true, mesh: rim, pool: true });
      place.push([px, pz, 2.6]);
    }
    // spire cluster near the dais (like the reference) + scattered boulders
    const spires = [[-8.5, 4, 0.9, 2.6], [-9.6, 5.8, 0.7, 1.9], [-8.4, 6.9, 0.55, 1.4], [8.8, -5, 1.0, 2.9], [10.2, -3.6, 0.7, 2.0], [9.6, -6.8, 0.6, 1.5]];
    for (const s of spires) rock(s[0], s[1], s[2], s[3], true);
    let tries = 0, n = 0;
    while (n < 16 && tries < 600) {
      tries++;
      const ang = rng() * Math.PI * 2, d = 10 + rng() * 17;
      const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
      const big = rng() < 0.35;
      const r = big ? 1.2 + rng() * 0.6 : 0.55 + rng() * 0.45;
      if (!okSpot(x, z, r)) continue;
      rock(x, z, r, big ? 1.4 + rng() * 1.2 : 0.7 + rng() * 0.6, false);
      n++;
    }
    // loose stones: earthbenders can lift these (and stand on them); they re-form after being thrown
    this.looseStones = [];
    const looseGeo = jaggedRockGeometry(rng, 1, 0.25, 0.85);
    tries = 0;
    while (this.looseStones.length < 8 && tries < 800) {
      tries++;
      const ang = rng() * Math.PI * 2, d = 8.5 + rng() * 15;
      const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
      if (!okSpot(x, z, 0.6)) continue;
      const m = new THREE.Mesh(looseGeo, rockMat); m.scale.setScalar(0.52); m.position.set(x, 0.28, z); m.rotation.y = rng() * 6.28;
      m.castShadow = m.receiveShadow = true; this.group.add(m);
      const col = { kind: 'c', x, z, r: 0.55, top: 0.72, walk: true, mesh: m, loose: true };
      this.colliders.push(col); place.push([x, z, 0.6]);
      this.looseStones.push({ mesh: m, col, home: new THREE.Vector3(x, 0.28, z), respawnT: 0, taken: false });
    }

    // ---- walls, banners, panels, stands and crowd
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7a83, roughness: 0.92 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x4c3f49, roughness: 0.9 });
    const W = HALF + 1.5, WH = 8;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 2, WH, 1), wallMat);
      wall.position.set(Math.sin(a) * (W + 0.5), WH / 2, Math.cos(a) * (W + 0.5)); wall.rotation.y = a;
      wall.receiveShadow = true; this.group.add(wall);
      const base = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 2, 0.6, 0.3), trimMat);
      base.position.set(Math.sin(a) * W, 0.3, Math.cos(a) * W); base.rotation.y = a; this.group.add(base);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 3, 0.4, 1.6), trimMat);
      cap.position.set(Math.sin(a) * (W + 0.5), WH, Math.cos(a) * (W + 0.5)); cap.rotation.y = a; this.group.add(cap);
      // banners
      const kinds = ['fire', 'water', 'earth', 'air'];
      for (let b = -2; b <= 2; b++) {
        const k = kinds[(b + 2 + i) % 4];
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.5), new THREE.MeshStandardMaterial({ map: bannerTexture(k), roughness: 0.9, side: THREE.DoubleSide }));
        const along = b * 11;
        const nx = -Math.sin(a), nz = -Math.cos(a); // inward normal
        const tx = Math.cos(a), tz = -Math.sin(a);
        ban.position.set(Math.sin(a) * (W - 0.02) + tx * along, 5.3, Math.cos(a) * (W - 0.02) + tz * along);
        ban.lookAt(ban.position.x + nx, 5.3, ban.position.z + nz);
        this.group.add(ban);
      }
      // framed panel
      const pcol = [0x9c1f24, 0x1d3f8a, 0x9c1f24, 0x1d3f8a][i];
      const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 0.2), trimMat);
      const nx = -Math.sin(a), nz = -Math.cos(a);
      const tx = Math.cos(a), tz = -Math.sin(a);
      frame.position.set(Math.sin(a) * (W - 0.1) + tx * 5.5, 2.4, Math.cos(a) * (W - 0.1) + tz * 5.5);
      frame.lookAt(frame.position.x + nx, 2.4, frame.position.z + nz);
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2.2), new THREE.MeshStandardMaterial({ color: pcol, roughness: 0.6 }));
      inner.position.z = 0.11; frame.add(inner);
      this.group.add(frame);
      // stands
      const stand = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 12, 1, 7), new THREE.MeshStandardMaterial({ color: 0xc9c0b8, roughness: 0.95 }));
      stand.position.set(Math.sin(a) * (W + 4.5), WH + 1.6, Math.cos(a) * (W + 4.5)); stand.rotation.set(0, a, 0);
      stand.rotateX(-0.42);
      this.group.add(stand);
    }
    // jade decorative blocks along one wall (like the reference)
    const jade = new THREE.MeshStandardMaterial({ color: 0x3f8a76, roughness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const h = 1 + (i % 3) * 0.8;
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), jade);
      m.position.set(-12 + i * 1.6, h / 2, HALF + 0.9); m.castShadow = true; this.group.add(m);
    }
    // crowd (instanced)
    const crowdN = 900;
    const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.35, 2, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowdN);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const palette = [0xb23a3a, 0x2e5fae, 0x3c8a4f, 0xd8b04a, 0xe6dccc, 0x6a4c8a, 0x2b2b2b, 0xc06d2b];
    for (let i = 0; i < crowdN; i++) {
      const side = i % 4, a = side * Math.PI / 2;
      const along = (rng() * 2 - 1) * (W + 4), row = Math.floor(rng() * 5);
      const out = W + 1.8 + row * 1.3;
      const tx = Math.cos(a), tz = -Math.sin(a);
      const x = Math.sin(a) * out + tx * along, z = Math.cos(a) * out + tz * along;
      const y = WH + 0.9 + row * 0.55 + 0.4;
      m4.makeTranslation(x, y, z); crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i, col.setHex(palette[Math.floor(rng() * palette.length)]));
    }
    this.group.add(crowd);
    this.crowd = crowd;
  }

  // ---- venues: 'courtyard' (the original arena) or 'barn' (the brick-arch barn ruin scan in the middle of the
  // courtyard; the courtyard props inside its footprint are put away). The scan and its colliders are loaded on demand.
  async setVenue(name) {
    if (name === this.venue) return;
    if (name === 'barn' && !this.barn) {
      const mod = await import('../assets/venue/barn-ruin.glb.js');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const bin = atob(mod.default), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const g = await new GLTFLoader().parseAsync(buf.buffer, '');
      const mesh = g.scene; mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = 4; } });
      const C = mod.COLLIDERS, [fx, fz] = C.footprint;
      // walls and piers: boxes the fighters collide with and can stand on; an invisible merged copy blocks the camera
      const cols = C.boxes.map(b => ({ kind: 'b', x: b.x, z: b.z, hx: b.hx, hz: b.hz, top: b.top, walk: true, venue: true }));
      const boxGeo = new THREE.BoxGeometry(1, 1, 1), geos = [];
      for (const b of C.boxes) { const q = boxGeo.clone(); q.scale(b.hx * 2, b.top, b.hz * 2); q.translate(b.x, b.top / 2, b.z); geos.push(q); }
      const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
      const blocker = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial()); blocker.visible = false;
      // the scanned ground inside the footprint (centimetres above the arena floor)
      let ground = null;
      if (C.ground) { const G = C.ground, b = atob(G.cm), a = new Int16Array(b.length / 2); for (let i = 0; i < a.length; i++) a[i] = (b.charCodeAt(i * 2) | (b.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16; ground = { ...G, h: Float32Array.from(a, v => v / 100) }; }
      this.barn = { mesh, cols, blocker, half: [fx / 2 + 1.2, fz / 2 + 1.2], ground };
    }
    const B = this.barn, on = name === 'barn';
    // courtyard props inside the ruin's footprint are put away while it stands
    const inside = (x, z, r = 0) => B && Math.abs(x) < B.half[0] + r && Math.abs(z) < B.half[1] + r;
    for (const c of this.colliders) if (!c.venue && c.mesh && inside(c.x, c.z, c.r || Math.max(c.hx || 0, c.hz || 0))) {
      if (on && !c.hidden) { c.wasBlocker = this.cameraBlockers.includes(c.mesh); this.cameraBlockers = this.cameraBlockers.filter(m => m !== c.mesh); }
      if (!on && c.hidden && c.wasBlocker) this.cameraBlockers.push(c.mesh);
      c.dead = on; c.mesh.visible = !on; c.hidden = on;
    }
    for (const s of this.waterSources) if (inside(s.x, s.z, 2.4)) { s.off = on; s.mesh.visible = !on; }
    for (const s of this.looseStones) if (inside(s.home.x, s.home.z, 0.6)) s.off = on;
    if (B) {
      if (on) { this.group.add(B.mesh); this.colliders.push(...B.cols); this.cameraBlockers.push(B.blocker); }
      else { this.group.remove(B.mesh); this.colliders = this.colliders.filter(c => !c.venue); this.cameraBlockers = this.cameraBlockers.filter(m => m !== B.blocker); }
    }
    this.vground = on && B ? B.ground : null;
    this.venue = name;
  }
  // venue terrain height at (x, z), bilinear over the grid (0 outside it)
  venueGround(x, z) {
    const G = this.vground; if (!G) return 0;
    const fx = (x - G.x0) / G.cell - 0.5, fz = (z - G.z0) / G.cell - 0.5;
    if (fx < 0 || fz < 0 || fx >= G.nx - 1 || fz >= G.nz - 1) return 0;
    const i = Math.floor(fx), k = Math.floor(fz), u = fx - i, v = fz - k, h = G.h, n = G.nx;
    return (h[k * n + i] * (1 - u) + h[k * n + i + 1] * u) * (1 - v) + (h[(k + 1) * n + i] * (1 - u) + h[(k + 1) * n + i + 1] * u) * v;
  }

  // Height of walkable ground under (x, z) reachable from height y.
  nearestLooseStone(p, maxD) {
    let best = null, bd = maxD;
    for (const s of this.looseStones) { if (s.taken || s.off) continue; const d = Math.hypot(s.home.x - p.x, s.home.z - p.z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  nearestWaterSource(p, maxD) {
    let best = null, bd = maxD;
    for (const s of this.waterSources) { if (s.off) continue; const d = Math.hypot(s.x - p.x, s.z - p.z) - 2.2; if (d < bd) { bd = d; best = s; } }
    return best;
  }
  updateLoose(dt, fx) {
    for (const s of this.looseStones) {
      if (s.respawnT > 0) {
        s.respawnT -= dt;
        if (s.respawnT <= 0) { s.taken = false; s.col.dead = false; s.mesh.visible = true; s.rise = 0; if (fx) { fx.debrisBurst(s.home.clone().setY(0.1), 8, 2, 0.08, 0x7a7068); fx.dust(s.home, 6, 1.5); } }
      }
      if (s.rise !== undefined && s.rise < 1) { s.rise = Math.min(1, s.rise + dt * 3); s.mesh.position.y = s.home.y - (1 - s.rise) * 0.7; }
    }
    // gentle ripple on the pools
    const t = performance.now() * 0.001;
    for (const w of this.waterSources) w.mesh.position.y = w.y + Math.sin(t * 2 + w.x) * 0.012;
  }
  resetLoose() { for (const s of this.looseStones) { s.taken = false; s.respawnT = 0; s.col.dead = !!s.off; s.mesh.visible = !s.off; s.mesh.position.copy(s.home); } }

  // top surface height of a collider at (x, z); ramps interpolate
  topAt(c, x, z) {
    if (!c.slope) return c.top;
    const s = c.slope, t = clamp((x - s.x0) / (s.x1 - s.x0), 0, 1);
    return s.h0 + (s.h1 - s.h0) * t;
  }
  groundAt(x, z, y) {
    let h = 0;
    if (this.vground) { const g = this.venueGround(x, z); if (g > 0 && g <= y + 0.6) h = g; }
    for (const c of this.colliders) {
      if (!c.walk || c.dead) continue;
      if (c.kind === 'c') { if (c.top <= y + 0.5 && (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) h = Math.max(h, c.top); }
      else if (Math.abs(x - c.x) < c.hx && Math.abs(z - c.z) < c.hz) { const t = this.topAt(c, x, z); if (t <= y + 0.5) h = Math.max(h, t); }
    }
    return h;
  }

  // Push a body (anything with pos and radius) out of solid geometry.
  collide(f) {
    const p = f.pos, r = f.radius;
    for (const c of this.colliders) {
      if (c.dead) continue;
      if (c.walk && p.y >= this.topAt(c, clamp(p.x, c.x - c.hx, c.x + c.hx), clamp(p.z, c.z - (c.hz || 0), c.z + (c.hz || 0))) - 0.5) continue; // standing on / stepping onto it
      if (!c.walk && p.y >= c.top) continue;
      if (c.kind === 'c') {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-5) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; this.slide(f, dx / d, dz / d); }
      } else {
        const cx = clamp(p.x, c.x - c.hx, c.x + c.hx), cz = clamp(p.z, c.z - c.hz, c.z + c.hz);
        let dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d < r) {
          if (d < 1e-5) { // centre inside box: push out along the shallowest axis
            const px = c.hx - Math.abs(p.x - c.x), pz = c.hz - Math.abs(p.z - c.z);
            if (px < pz) { dx = Math.sign(p.x - c.x) || 1; dz = 0; p.x = c.x + dx * (c.hx + r); }
            else { dz = Math.sign(p.z - c.z) || 1; dx = 0; p.z = c.z + dz * (c.hz + r); }
            this.slide(f, dx, dz);
          } else { p.x = cx + dx / d * r; p.z = cz + dz / d * r; this.slide(f, dx / d, dz / d); }
        }
      }
    }
    const lim = HALF - r;
    if (p.x > lim) { p.x = lim; f.vel.x = Math.min(0, f.vel.x); } if (p.x < -lim) { p.x = -lim; f.vel.x = Math.max(0, f.vel.x); }
    if (p.z > lim) { p.z = lim; f.vel.z = Math.min(0, f.vel.z); } if (p.z < -lim) { p.z = -lim; f.vel.z = Math.max(0, f.vel.z); }
  }
  slide(f, nx, nz) {
    if (!f.vel) return;
    const vn = f.vel.x * nx + f.vel.z * nz;
    if (vn < 0) { f.vel.x -= vn * nx; f.vel.z -= vn * nz; }
  }

  // Which solid collider (if any) contains point p (used by projectiles).
  solidAt(p, pad = 0) {
    for (const c of this.colliders) {
      if (c.dead || p.y > (c.slope ? this.topAt(c, p.x, p.z) : c.top) + pad) continue;
      if (c.kind === 'c') { if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.r + pad) ** 2) return c; }
      else if (Math.abs(p.x - c.x) < c.hx + pad && Math.abs(p.z - c.z) < c.hz + pad) return c;
    }
    return null;
  }
}
