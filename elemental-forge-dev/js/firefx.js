// Connected fire bodies (19 Nov, Fire restructuring phase one). One flame material drawn on the same moving tube as the
// water (defence-fx makeWaterTube): the middle of the tube, where it faces the camera, is a white-yellow core; the
// edges go orange then red and break up in moving noise, so a stream, a whip, Dragon's Breath and the Comet's trail read
// as one connected body of fire rather than a cluster of separate puffs. Alpha-blended (additive washed out to white on
// the bright arena floor), no depth write.
import * as THREE from 'three';
import { makeWaterTube } from './defence-fx.js';

const VS = `
uniform float uTime;
varying vec2 vUv; varying float vFacing;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz);
  vFacing = abs(dot(n, v));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = `
uniform float uTime, uOpacity, uFlow, uHeat, uTipFade;
uniform vec3 uCore, uMid, uEdge;
varying vec2 vUv; varying float vFacing;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  // flowing turbulence: two octaves scrolling along the body (v runs from the head to the tail)
  vec2 q = vec2(vUv.x * 6.0, vUv.y * 9.0 - uTime * uFlow);
  float n = noise(q) * 0.65 + noise(q * 2.3 + 3.1) * 0.35;
  float core = smoothstep(0.35, 0.95, vFacing) * uHeat;
  float body = smoothstep(0.05, 0.55, vFacing + (n - 0.5) * 0.55);
  vec3 col = mix(uEdge, uMid, smoothstep(0.1, 0.6, vFacing + n * 0.25));
  col = mix(col, uCore, core);
  // the tip (head end) thins into licks of flame
  float tip = smoothstep(0.0, uTipFade, vUv.y + (n - 0.5) * 0.12);
  float a = body * tip * uOpacity * (0.55 + 0.45 * n);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * (1.0 + core * 0.25), a);
}`;

export function fireMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uRise: { value: 1 }, uOpacity: { value: o.opacity ?? 0.95 }, uFlow: { value: o.flow ?? 7 }, uHeat: { value: o.heat ?? 1 },
      uTipFade: { value: o.tipFade ?? 0.12 },
      uCore: { value: new THREE.Color(o.core ?? 0xfff3c4) }, uMid: { value: new THREE.Color(o.mid ?? 0xff9a1f) }, uEdge: { value: new THREE.Color(o.edge ?? 0xd8350c) },
    },
  });
}

// a flame body along points (head first); returns { mesh, mat, set(points, radius(t), time) } like the water tube
export function makeFireTube(scene, segs = 24, radial = 9, o = {}) {
  const mat = fireMaterial(o), t = makeWaterTube(segs, radial, mat);
  t.mesh.renderOrder = 4; scene.add(t.mesh);
  t.dispose = () => { scene.remove(t.mesh); t.mesh.geometry.dispose(); mat.dispose(); };
  return t;
}

// ---------------------------------------------------------------- the Fire Comet's head: a small sun
// (19 Nov, after review: "like the sun, yellow, orange, red; a defined ball with a tail ... comets are not smooth")
// The surface is pushed in and out by moving noise, so the outline is never a clean circle; the colour runs from a
// white-yellow centre (facing the camera) through orange to a deep red rim, with dark-and-bright granulation boiling
// across it. The corona is a larger shell drawn only at its rim, flickering.
const NOISE3 = `
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { return n3(p) * 0.55 + n3(p * 2.1 + 7.0) * 0.3 + n3(p * 4.3 + 3.0) * 0.15; }`;
const SUN_VS = `uniform float uTime, uRough; varying float vFacing; varying vec3 vP;` + NOISE3 + `
void main() {
  vec3 n = normalize(normal); float d = fbm(n * 2.6 + vec3(0.0, uTime * 1.7, uTime * 1.1));
  vec3 p = position * (1.0 + (d - 0.5) * uRough);
  vec4 wp = modelMatrix * vec4(p, 1.0); vP = n;
  vFacing = abs(dot(normalize(mat3(modelMatrix) * normal), normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SUN_FS = `uniform float uTime; varying float vFacing; varying vec3 vP;` + NOISE3 + `
void main() {
  float g = fbm(vP * 5.0 + vec3(uTime * 2.3, -uTime * 1.6, uTime));
  vec3 core = vec3(1.0, 0.97, 0.78), yel = vec3(1.0, 0.82, 0.25), ora = vec3(1.0, 0.45, 0.06), red = vec3(0.72, 0.1, 0.02);
  float f = vFacing + (g - 0.5) * 0.35;
  vec3 col = mix(red, ora, smoothstep(0.05, 0.4, f)); col = mix(col, yel, smoothstep(0.4, 0.7, f)); col = mix(col, core, smoothstep(0.75, 0.98, f));
  col *= 0.85 + 0.35 * g;
  gl_FragColor = vec4(col, 1.0);
}`;
const CORONA_FS = `uniform float uTime; varying float vFacing; varying vec3 vP;` + NOISE3 + `
void main() {
  float g = fbm(vP * 3.0 + vec3(0.0, uTime * 3.0, uTime * 2.0));
  float rim = pow(1.0 - vFacing, 1.6) * (0.55 + 0.6 * g);
  if (rim < 0.03) discard;
  gl_FragColor = vec4(mix(vec3(0.75, 0.1, 0.02), vec3(1.0, 0.5, 0.06), g), min(1.0, rim * 1.05));
}`;
export function sunMaterial(rough = 0.28) {
  return new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: { uTime: { value: 0 }, uRough: { value: rough } } });
}
export function coronaMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: CORONA_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uRough: { value: 0.65 } } });
}

// ---------------------------------------------------------------- rocket-exhaust jets (Fire's jump, dodge and glide)
// (20 Nov, after review: "they look weak now, as short knives ... powerful and cohesive") A jet is one connected plume
// out of the heel: tight and white-yellow at the nozzle, swelling fast into a thick orange body wrapped in a turbulent
// red outer layer, and ending in a ragged billow rather than a point. Its points bend with a moving wobble, so the
// plume rolls like real exhaust. jets.fire(key, from, dir, len, r) each frame a jet burns; jets.update(dt) shrinks away
// and removes any that were not fired this frame.
export class JetSet {
  constructor(scene) { this.scene = scene; this.map = new Map(); this.t = 0; }
  fire(key, from, dir, len = 2.4, r = 0.24) {
    let J = this.map.get(key);
    if (!J) {
      J = {
        outer: makeFireTube(this.scene, 16, 10, { flow: 16, heat: 0.5, tipFade: 0.35, opacity: 0.6, core: 0xffa02a, mid: 0xf06414, edge: 0xc8280a }),
        body: makeFireTube(this.scene, 16, 9, { flow: 22, heat: 1, tipFade: 0.3, core: 0xffe85a, mid: 0xffa21c, edge: 0xf0500e }),
        core: makeFireTube(this.scene, 10, 7, { flow: 30, heat: 1, tipFade: 0.4, core: 0xfffbe0, mid: 0xffe680, edge: 0xffb02a }),
        k: 0, seed: Math.random() * 10,
      };
      this.map.set(key, J);
    }
    J.seen = true; J.from = (J.from || from.clone()).copy(from); J.dir = (J.dir || dir.clone()).copy(dir).normalize(); J.len = len; J.r = r;
  }
  update(dt) {
    this.t += dt;
    for (const [key, J] of this.map) {
      J.k = J.seen ? Math.min(1, J.k + dt * 12) : J.k - dt * 6;
      if (J.k <= 0) { J.outer.dispose(); J.body.dispose(); J.core.dispose(); this.map.delete(key); continue; }
      J.seen = false;
      const t = this.t, s = J.seed;
      const L = J.len * J.k * (0.9 + 0.1 * Math.sin(t * 41 + s) + 0.05 * Math.sin(t * 89 + s * 2));
      // a side axis to bend the plume along
      const sx = Math.abs(J.dir.y) > 0.9 ? 1 : 0, side = { x: sx ? 1 : -J.dir.z, y: 0, z: sx ? 0 : J.dir.x };
      const n = 10, pts = [];
      for (let i = 0; i <= n; i++) {
        const x = 1 - i / n, d = L * x, w = J.r * 1.6 * x * x;   // head (far end) first
        const p = J.from.clone().addScaledVector(J.dir, d);
        p.x += side.x * Math.sin(t * 13 + x * 6 + s) * w; p.z += side.z * Math.sin(t * 13 + x * 6 + s) * w;
        p.y += Math.cos(t * 11 + x * 5 + s) * w * 0.7 + 0.25 * J.r * x * x;   // hot gas curls up a little at the end
        pts.push(p);
      }
      // q = 0 at the far end, 1 at the nozzle: a narrow nozzle swelling quickly, widest about two thirds out, a ragged end
      // (20 Nov: the first 15% stays heel-thin, so the flame plainly starts AT the heel and does not wrap the foot or shin)
      const shape = (q) => { const x = 1 - q, e = Math.max(0, (x - 0.12) / 0.6); return (0.22 + 1.4 * Math.pow(Math.min(1, e), 1.1)) * (x > 0.85 ? 1 - (x - 0.85) / 0.15 * 0.55 : 1); };
      J.outer.set(pts, (q) => J.r * 1.3 * shape(q), t * 3);
      J.body.set(pts, (q) => J.r * 0.85 * shape(q), t * 4);
      J.core.set(pts.slice(4), (q) => J.r * 0.5 * Math.max(0.35, shape(q * 0.6 + 0.4)), t * 5);
    }
  }
  dispose() { for (const J of this.map.values()) { J.outer.dispose(); J.body.dispose(); J.core.dispose(); } this.map.clear(); }
}
