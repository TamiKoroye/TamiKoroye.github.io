// Ice assets: the downloaded "Ice Cluster (free)" model (chrismartin1337, Sketchfab, CC-BY-4.0) for crystals that
// erupt, grow under the ice surfer and are left behind, and a sculpted crest of ice (a swept wave profile, flat on
// top where the feet stand, curling over at the front) that carries the surfer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { iceMat } from './defence-fx.js';

export const ICE = { cluster: null, clusterMat: null, crestGeo: null };

export async function loadIce() {
  try {
    const mod = await import('../assets/fx/ice-cluster.glb.js');
    const bin = atob(mod.default), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const g = await new GLTFLoader().parseAsync(bytes.buffer, '');
    let mesh = null; g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (mesh) {
      // normalise: base on y = 0, about 1 m tall, centred
      const geo = mesh.geometry.clone(); mesh.updateWorldMatrix(true, false); geo.applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox(); const b = geo.boundingBox, s = 1 / (b.max.y - b.min.y);
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); geo.scale(s, s, s); geo.computeVertexNormals();
      ICE.cluster = geo;
      // the model's own clearcoated material, made a little paler and more see-through so it reads as ice in the arena light
      const m = mesh.material.clone(); m.transparent = true; m.opacity = 0.88; m.depthWrite = true; m.side = THREE.FrontSide;
      if (m.color) m.color.multiplyScalar(1.25); if ('emissive' in m) { m.emissive = new THREE.Color(0x1d3a4a); m.emissiveIntensity = 0.5; }
      ICE.clusterMat = m;
    }
  } catch (e) { console.warn('ice cluster model did not load; procedural ice is used', e); }
  ICE.crestGeo = crestGeometry();
  return ICE;
}

// a crest of ice 1 m tall (scaled to the lift), about 2.6 m long and 1.3 m wide: the back rises in a concave sweep
// from the floor, the top is flat for 0.7 m under the feet, the front curls over and down
function crestGeometry() {
  const sh = new THREE.Shape();
  sh.moveTo(-2.1, 0);
  sh.bezierCurveTo(-1.2, 0.05, -0.75, 0.55, -0.45, 0.97);
  sh.lineTo(0.3, 1.0);
  sh.bezierCurveTo(0.62, 1.0, 0.82, 0.86, 0.78, 0.6);
  sh.bezierCurveTo(0.74, 0.42, 0.55, 0.3, 0.5, 0.0);
  sh.lineTo(-2.1, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1.3, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 10, steps: 1 });
  g.translate(0, 0, -0.65);
  g.rotateY(Math.PI / 2);   // the profile now runs along +z (forward), the width along x
  // a little irregularity, so it reads as sculpted ice rather than a moulded block
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.05 && y < 0.95) p.setXYZ(i, p.getX(i) * (1 + Math.sin(i * 1.7) * 0.06), y, p.getZ(i) + Math.cos(i * 2.3) * 0.04); }
  g.computeVertexNormals();
  return g;
}

// a crystal cluster mesh (the downloaded model, or a faceted cone if it failed to load)
export function iceClusterMesh(h = 1, w = 1) {
  const m = ICE.cluster ? new THREE.Mesh(ICE.cluster, ICE.clusterMat) : new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 6), iceMat);
  if (!ICE.cluster) m.geometry.translate(0, 0.5, 0);
  m.scale.set(w, h, w); m.castShadow = true; return m;
}
