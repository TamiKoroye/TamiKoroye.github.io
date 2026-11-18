// Flipbook effects: camera-facing sprites that play the downloaded / pre-rendered effect sheets.
//   fire_flames    : JangaFX EmberGen "Fire_01" (CC0), rendered to a 6x6 toon sheet by tools/vdb-flipbook.py (toon=1:
//                    flat bands of pale yellow, yellow, golden orange and a red-orange rim, as in the reference footage)
//   fire_explosion : JangaFX EmberGen "Gasoline_Explosion_01" (CC0), rendered the same way (fireball, then smoke)
//   water_impact_01, water_column_01, ice_projectile_01 : KanaWorks SAKUGA VFX (credit: VFX: KanaWorks_AI (@KanaWorks_AI))
// Each sheet is drawn by one instanced mesh (one draw call), so hundreds of flame sprites stay cheap on a phone.
// Sprites can be free particles (velocity, rise, growth) or be placed every frame by a controller (rolling wave,
// fire wall), which sets their position directly.
import * as THREE from 'three';
import { rand } from './util.js';

const SHEETS = {
  fire_flames:    { file: 'fire_flames.webp',    grid: [6, 6], frames: 36, blend: 'fire' },
  fire_explosion: { file: 'fire_explosion.webp', grid: [6, 6], frames: 36, blend: 'fire' },
  water_impact:   { file: 'water_impact_01.webp', grid: [8, 8], frames: 45, blend: 'normal' },
  water_column:   { file: 'water_column_01.webp', grid: [8, 7], frames: 56, blend: 'normal' },
  ice_projectile: { file: 'ice_projectile_01.webp', grid: [8, 5], frames: 40, blend: 'normal' },
};
const MAX = 320;

const VERT = `
  attribute vec3 iPos; attribute vec2 iSize; attribute float iFrame; attribute float iAlpha; attribute float iRot; attribute float iPivot;
  uniform vec2 uGrid; varying vec2 vUv; varying float vAlpha;
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    // pivot 1: the sprite stands on its point (flames rising from the ground); 0: centred
    vec2 p = vec2(position.x, position.y + 0.5 * iPivot);
    float c = cos(iRot), s = sin(iRot);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec3 wp = iPos + right * p.x * iSize.x + up * p.y * iSize.y;
    float f = floor(iFrame);
    vec2 cell = vec2(mod(f, uGrid.x), uGrid.y - 1.0 - floor(f / uGrid.x));
    vUv = (cell + uv) / uGrid; vAlpha = iAlpha;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const FRAG = `
  uniform sampler2D uMap; uniform float uBright; uniform float uToon; uniform vec3 uTint; varying vec2 vUv; varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vAlpha;
    if (uToon > 0.5) {
      // toon fire: the sheet's alpha is a soft coverage; cut a crisp edge at 0.2 and raise the cut as the flame fades,
      // so a dying flame shrinks and breaks up from its edges and stays solid inside
      float cut = 0.2 + (1.0 - vAlpha) * 0.75;
      a = smoothstep(cut, cut + 0.035, t.a);
    }
    if (a < 0.01) discard;
    gl_FragColor = vec4(t.rgb * uTint * uBright, a);
    #include <colorspace_fragment>
  }`;

class Sheet {
  constructor(scene, key, def) {
    this.def = def; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos = mk(3)); g.setAttribute('iSize', this.aSize = mk(2)); g.setAttribute('iFrame', this.aFrame = mk(1));
    g.setAttribute('iAlpha', this.aAlpha = mk(1)); g.setAttribute('iRot', this.aRot = mk(1)); g.setAttribute('iPivot', this.aPivot = mk(1));
    g.instanceCount = 0;
    const tex = new THREE.TextureLoader().load('assets/fx/' + def.file);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uGrid: { value: new THREE.Vector2(...def.grid) }, uBright: { value: 1.0 }, uToon: { value: def.blend === 'fire' ? 1 : 0 },
        // fire a little redder (M9, after review: more natural): green and blue pulled down, red kept
        uTint: { value: def.blend === 'fire' ? new THREE.Vector3(1.0, 0.8, 0.68) : new THREE.Vector3(1, 1, 1) } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: def.blend === 'fire' ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (def.blend === 'fire') {
      // flames: "screen-like" (src*alpha added, destination dimmed only by half the alpha) so overlapping flames
      // build bright cores without turning the smoke edges into flat white
      this.mat.blendSrc = THREE.SrcAlphaFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor; this.mat.blendEquation = THREE.AddEquation;
    }
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh); this.g = g;
  }
}

export class FlipFX {
  constructor(scene) {
    this.sheets = {}; for (const [k, d] of Object.entries(SHEETS)) this.sheets[k] = new Sheet(scene, k, d);
    this.parts = []; this.ctrls = [];
  }
  // a free sprite. o: { pos, vel, size:[w,h] | number, grow (size multiplier per second), life, f0, f1 (frame range),
  //   fps (frames per second; default: the range over the life), rise (upward acceleration), drag, alpha, fadeIn,
  //   pivot (1 = stands on its base point), rot, spin }
  spawn(sheet, o) {
    if (this.parts.length > 900) return null;
    const S = this.sheets[sheet], d = S.def;
    const p = { sheet, pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new THREE.Vector3(), w: Array.isArray(o.size) ? o.size[0] : (o.size || 1), h: Array.isArray(o.size) ? o.size[1] : (o.size || 1),
      grow: o.grow ?? 0, life: o.life ?? 0.8, t: 0, f0: o.f0 ?? 0, f1: o.f1 ?? d.frames - 1, rise: o.rise ?? 0, drag: o.drag ?? 0, alpha: o.alpha ?? 1,
      fadeIn: o.fadeIn ?? 0.06, pivot: o.pivot ?? 0, rot: o.rot ?? rand(-0.15, 0.15), spin: o.spin ?? 0, loop: !!o.loop, fps: o.fps };
    this.parts.push(p); return p;
  }
  // a controller places a group of sprites every frame: fn(dt, put) calls put(sheet, pos, w, h, frame, alpha, pivot, rot)
  // and returns false when finished
  control(fn) { this.ctrls.push({ fn, t: 0 }); }
  clear() { this.parts.length = 0; this.ctrls.length = 0; }

  update(dt) {
    for (const S of Object.values(this.sheets)) S.n = 0;
    const put = (sheet, pos, w, h, frame, alpha, pivot = 0, rot = 0) => {
      const S = this.sheets[sheet]; if (S.n >= MAX || alpha <= 0.003) return;
      const i = S.n++;
      S.aPos.setXYZ(i, pos.x, pos.y, pos.z); S.aSize.setXY(i, w, h); S.aFrame.setX(i, Math.min(S.def.frames - 1, Math.max(0, frame)));
      S.aAlpha.setX(i, Math.min(1, alpha)); S.aRot.setX(i, rot); S.aPivot.setX(i, pivot);
    };
    this.put = put;
    for (const C of this.ctrls) { C.t += dt; if (C.fn(dt, put, C.t) === false) C.dead = true; }
    this.ctrls = this.ctrls.filter(c => !c.dead);
    for (const p of this.parts) {
      p.t += dt; if (p.t >= p.life) { p.dead = true; continue; }
      p.vel.y += p.rise * dt; if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt); p.rot += p.spin * dt;
      const g = 1 + p.grow * p.t, u = p.t / p.life;
      const fr = p.fps ? (p.loop ? p.f0 + ((p.t * p.fps) % (p.f1 - p.f0 + 1)) : Math.min(p.f1, p.f0 + p.t * p.fps)) : p.f0 + (p.f1 - p.f0) * u;
      const a = p.alpha * Math.min(1, p.t / Math.max(0.001, p.fadeIn)) * (u > 0.75 ? (1 - u) / 0.25 : 1);
      put(p.sheet, p.pos, p.w * g, p.h * g, fr, a, p.pivot, p.rot);
    }
    this.parts = this.parts.filter(p => !p.dead);
    for (const S of Object.values(this.sheets)) {
      S.g.instanceCount = S.n;
      for (const a of [S.aPos, S.aSize, S.aFrame, S.aAlpha, S.aRot, S.aPivot]) a.needsUpdate = true;
    }
  }
}
