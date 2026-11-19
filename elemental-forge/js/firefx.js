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
