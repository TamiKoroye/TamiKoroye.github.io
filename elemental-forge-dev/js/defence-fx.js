// Visuals for water and ice defences: a curved, flowing curtain of water; streams of water circling the body at
// waist and chest height (the head stays clear); and a wall of angular ice shards. The water uses one animated
// shader: the surface ripples, bright streaks run upward, foam gathers along the top and edges, and the light is
// quantised into the same few bands as the cel-shaded characters.
import * as THREE from 'three';

const waterVS = /* glsl */`
  uniform float uTime, uRise, uWobble;
  varying vec2 vUv; varying vec3 vN; varying vec3 vView;
  void main() {
    vUv = uv;
    vec3 p = position;
    // surface ripples travelling upward and sideways; stronger near the top edge
    float w = sin(uv.y * 9.0 - uTime * 5.0 + uv.x * 6.0) * 0.045 + sin(uv.x * 23.0 + uTime * 3.0) * 0.02;
    p += normal * w * (0.4 + uv.y) * uWobble;
    p.y *= uRise;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const waterFS = /* glsl */`
  uniform float uTime, uOpacity, uFlow, uHit, uFoamFrom;
  uniform vec3 uDeep, uLight, uFoam;
  varying vec2 vUv; varying vec3 vN; varying vec3 vView;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 uv = vUv;
    // flowing streaks: stretched noise scrolling along the flow direction
    float n = noise(vec2(uv.x * 14.0, uv.y * 3.0 - uTime * uFlow));
    float n2 = noise(vec2(uv.x * 30.0 + 3.0, uv.y * 6.0 - uTime * uFlow * 1.7));
    float streak = smoothstep(0.62, 0.8, n * 0.65 + n2 * 0.45);
    // light bands (cel style): facing ratio quantised
    float facing = abs(dot(normalize(vN), normalize(vView)));
    float band = facing > 0.75 ? 0.0 : facing > 0.4 ? 0.5 : 1.0;
    vec3 col = mix(uDeep, uLight, 0.35 + band * 0.45);
    col = mix(col, uFoam, streak * 0.7);
    // foam along the top edge and the sides
    float edge = max(smoothstep(uFoamFrom, uFoamFrom + 0.12, uv.y + n * 0.08), max(smoothstep(0.93, 1.0, uv.x), smoothstep(0.07, 0.0, uv.x)));
    col = mix(col, uFoam, edge);
    col += uHit * 0.35;
    float a = uOpacity * (0.62 + band * 0.25 + streak * 0.2 + edge * 0.3);
    // ragged, dripping top edge
    if (uv.y > 0.93 + (n - 0.5) * 0.12) discard;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }`;

export function waterMaterial(flow = 1.6) {
  return new THREE.ShaderMaterial({
    vertexShader: waterVS, fragmentShader: waterFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uRise: { value: 0 }, uWobble: { value: 1 }, uOpacity: { value: 0.85 }, uFlow: { value: flow }, uHit: { value: 0 }, uFoamFrom: { value: 0.86 },
      uDeep: { value: new THREE.Color(0x2f7fd0) }, uLight: { value: new THREE.Color(0x8fd2ff) }, uFoam: { value: new THREE.Color(0xeef9ff) } },
  });
}

// Flowing water wall: an upright curved curtain (arc of `half` radians either side of the front) at radius r.
export function makeWaterWall(r = 1.2, half = 1.15, h = 2.3) {
  const geo = new THREE.CylinderGeometry(r, r * 1.08, h, 28, 10, true, -half, half * 2);
  geo.translate(0, h / 2, 0);
  const mat = waterMaterial(1.8);
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; mesh.frustumCulled = false;
  return { mesh, mat, update(t, rise, hit) { mat.uniforms.uTime.value = t; mat.uniforms.uRise.value = rise; mat.uniforms.uHit.value = hit; } };
}

// Rotating water defence: two streams circling the body at waist and chest height, tilted against each other.
export function makeWaterRing() {
  const group = new THREE.Group(), mat = waterMaterial(-3.2);
  const rings = [];
  for (const [y, r, tilt] of [[0.75, 0.95, 0.22], [1.25, 0.85, -0.3]]) {
    // a partial torus (about 300 degrees) reads as a moving stream rather than a solid hoop
    const g = new THREE.TorusGeometry(r, 0.11, 8, 48, Math.PI * 1.7);
    const m = new THREE.Mesh(g, mat); m.rotation.x = Math.PI / 2 + tilt; m.position.y = y; m.renderOrder = 3;
    group.add(m); rings.push(m);
  }
  return { mesh: group, mat, update(t, rise, hit) {
    mat.uniforms.uTime.value = t; mat.uniforms.uRise.value = 1; mat.uniforms.uHit.value = hit;
    rings.forEach((m, i) => { m.rotation.z = t * (i ? -5.5 : 4.5); m.scale.setScalar(Math.max(0.01, rise)); });
  } };
}

// Ice wall: angular shards along an arc; real colliders are created by the caller.
// ice: pale, nearly white blue, translucent, with a faint cold glow (frozen water, not blue plastic)
export const iceMat = new THREE.MeshToonMaterial({ color: 0xe6f7ff, emissive: 0x9ccfe6, emissiveIntensity: 0.22, transparent: true, opacity: 0.8, flatShading: true });
export function makeIceWall(r = 1.25, half = 0.95, n = 7) {
  const group = new THREE.Group(), shards = [];
  for (let i = 0; i < n; i++) {
    const a = -half + (2 * half * i) / (n - 1), h = 1.6 + Math.random() * 0.9 - Math.abs(a) * 0.35;
    const g = new THREE.OctahedronGeometry(0.5, 0); g.scale(0.75 + Math.random() * 0.3, h, 0.5 + Math.random() * 0.25);
    const m = new THREE.Mesh(g, iceMat); m.castShadow = true;
    m.position.set(Math.sin(a) * r, h * 0.42, Math.cos(a) * r); m.rotation.set(rand(-0.15, 0.15), a + rand(-0.2, 0.2), rand(-0.12, 0.12));
    m.userData.h = h; group.add(m); shards.push(m);
  }
  return { mesh: group, shards, update(t, rise) { group.scale.y = Math.max(0.01, rise); } };
}
function rand(a, b) { return a + Math.random() * (b - a); }

// A deformable tube of water along a moving polyline (projectile tails, the water whip). The topology is fixed and
// the vertices are rewritten each frame, so there is no per-frame allocation.
export function makeWaterTube(segs = 18, radial = 8, mat = waterMaterial(-4)) {
  const n = (segs + 1) * (radial + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let i = 0; i <= segs; i++) for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; uv[k * 2] = j / radial; uv[k * 2 + 1] = i / segs; }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 3;
  mat.uniforms.uRise.value = 1;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3();
  // points: array of Vector3 (head first); radius(t) with t = 0 at the head, 1 at the tail
  function set(points, radius, time = 0) {
    const m = points.length; if (m < 2) { mesh.visible = false; return; }
    mesh.visible = true;
    for (let i = 0; i <= segs; i++) {
      const f = (i / segs) * (m - 1), a = Math.min(m - 2, Math.floor(f)), u = f - a;
      P.lerpVectors(points[a], points[a + 1], u); T.subVectors(points[a + 1], points[a]); if (T.lengthSq() < 1e-8) T.set(0, 0, 1); T.normalize();
      N.crossVectors(T, Math.abs(T.y) > 0.95 ? B.set(1, 0, 0) : up).normalize(); B.crossVectors(T, N);
      const t = i / segs, r = radius(t) * (1 + Math.sin(time * 14 + t * 11) * 0.12);
      for (let j = 0; j <= radial; j++) {
        const ang = (j / radial) * Math.PI * 2, c = Math.cos(ang), s2 = Math.sin(ang), k = (i * (radial + 1) + j) * 3;
        const nx = N.x * c + B.x * s2, ny = N.y * c + B.y * s2, nz = N.z * c + B.z * s2;
        pos[k] = P.x + nx * r; pos[k + 1] = P.y + ny * r; pos[k + 2] = P.z + nz * r; nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    mat.uniforms.uTime.value = time;
  }
  return { mesh, mat, set };
}
