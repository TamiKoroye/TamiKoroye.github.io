// Earth ground-burst: the baked fracture simulation (assets/fx/ground-burst.js) played where rock erupts or lands
// heavily. One merged mesh per burst; the vertex shader places every fragment from the per-frame table (position,
// scale, rotation), so a burst costs one draw call. A small pool is reused; the oldest burst gives way.
import * as THREE from 'three';
import { TOON_RAMP } from './hero.js';

export class GroundBurst {
  constructor(world) {
    this.world = world; this.pool = []; this.ready = false;
    import('../assets/fx/ground-burst.js').then(m => this.build(m.default)).catch(e => console.warn('ground burst not loaded', e));
  }
  build(D) {
    const dec = (b64, T) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); };
    const P16 = dec(D.pos, Int16Array), frag = dec(D.frag, Uint16Array), top = dec(D.top, Uint8Array), tab = dec(D.table, Int16Array);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(P16, v => v / 10000), 3));
    g.setAttribute('frag', new THREE.BufferAttribute(Float32Array.from(frag), 1));
    g.setAttribute('top', new THREE.BufferAttribute(Float32Array.from(top), 1));
    g.computeVertexNormals();   // unindexed: one normal per triangle (faceted rock)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 6);
    // table texture: width = fragments, height = frames x 2 (row 2f: position xyz + scale, row 2f+1: rotation)
    const W = D.frags, H = D.frames * 2, data = new Float32Array(W * H * 4);
    for (let f = 0; f < D.frames; f++) for (let c = 0; c < W; c++) {
      const s = (f * W + c) * 8, a = ((f * 2) * W + c) * 4, b = ((f * 2 + 1) * W + c) * 4;
      data[a] = tab[s] / 1000; data[a + 1] = tab[s + 1] / 1000; data[a + 2] = tab[s + 2] / 1000; data[a + 3] = tab[s + 3] / 10000;
      for (let k = 0; k < 4; k++) data[b + k] = tab[s + 4 + k] / 32767;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
    this.D = D; this.geo = g; this.tex = tex;
    // one material for every burst; each burst sets its own frame and colours just before it is drawn
    this.U = { uTab: { value: this.tex }, uFrame: { value: 0 }, uFrames: { value: D.frames }, uFrags: { value: D.frags }, uTop: { value: new THREE.Color(0xc97a3a) }, uSide: { value: new THREE.Color(0x5e4c3a) } };
    this.mat = this.makeMaterial();
    for (let i = 0; i < 4; i++) this.pool.push(this.makeMesh());
    this.ready = true;
  }
  makeMaterial() {
    const mat = new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, color: 0xffffff, side: THREE.DoubleSide }), U = this.U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float frag; attribute float top; varying float vTop;
uniform sampler2D uTab; uniform float uFrame, uFrames, uFrags;
vec4 tabAt(float col, float row) { return texture2D(uTab, vec2((col + 0.5) / uFrags, (row + 0.5) / (uFrames * 2.0))); }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }`)
        .replace('#include <beginnormal_vertex>', `float f0 = floor(uFrame), f1 = min(f0 + 1.0, uFrames - 1.0), fa = uFrame - f0;
vec4 A0 = tabAt(frag, f0 * 2.0), A1 = tabAt(frag, f1 * 2.0), Q0 = tabAt(frag, f0 * 2.0 + 1.0), Q1 = tabAt(frag, f1 * 2.0 + 1.0);
vec4 PS = mix(A0, A1, fa); vec4 Q = normalize(mix(Q0, Q1 * sign(dot(Q0, Q1) + 1e-6), fa));
vec3 objectNormal = qrot(Q, normal);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = PS.xyz + qrot(Q, position * PS.w); vTop = top;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTop; uniform vec3 uTop, uSide;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uSide, uTop, vTop);');
    };
    return mat;
  }
  makeMesh() {
    const m = new THREE.Mesh(this.geo, this.mat); m.frustumCulled = false; m.castShadow = true; m.visible = false;
    m.userData = { t: 0, active: false, born: 0, frame: 0, top: new THREE.Color(0xc97a3a) };
    m.onBeforeRender = () => { this.U.uFrame.value = m.userData.frame; this.U.uTop.value.copy(m.userData.top); this.mat.uniformsNeedUpdate = true; };
    this.world.scene.add(m);
    return m;
  }
  // a burst at (x, z) on the ground; size 1 = the simulation's 5 m footprint
  spawn(x, y, z, size = 0.5) {
    if (!this.ready) return;
    let m = this.pool.find(p => !p.userData.active) || this.pool.reduce((a, b) => (a.userData.born < b.userData.born ? a : b));
    const A = this.world.arena, onBarn = A.vground && A.venueGround(x, z) !== 0;
    m.userData.top.set(onBarn || A.venue === 'barn' && Math.abs(x) < 14 && Math.abs(z) < 7 ? 0x6b5a45 : 0xc97a3a);
    m.position.set(x, y + 0.02, z); m.rotation.y = Math.random() * Math.PI * 2; m.scale.setScalar(size);
    Object.assign(m.userData, { t: 0, active: true, born: performance.now(), y0: y + 0.02 });
    m.userData.frame = 0; m.visible = true;
  }
  update(dt) {
    if (!this.ready) return;
    const D = this.D, end = (D.frames - 1) / D.fps;
    for (const m of this.pool) {
      const u = m.userData; if (!u.active) continue;
      u.t += dt * 1.4;   // the simulation plays a little faster than captured: a stamp, not a slow explosion
      u.frame = Math.min(D.frames - 1, u.t * D.fps);
      // once the pieces have settled they sink back into the ground
      if (u.t > end) { m.position.y = u.y0 - (u.t - end) * 0.9 * m.scale.x; if (u.t > end + 0.7) { u.active = false; m.visible = false; } }
    }
  }
  clear() { for (const m of this.pool) { m.userData.active = false; m.visible = false; } }
}
