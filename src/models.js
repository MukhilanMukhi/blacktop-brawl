// Procedural models: sport bike + rider, traffic cars. All facing +z, origin on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collapse a group's direct meshes into one mesh per material. Cuts draw calls by roughly two thirds.
export function mergeMeshes(group) {
  const by = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    g.applyMatrix4(c.matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!by.has(c.material)) by.set(c.material, []);
    by.get(c.material).push(g);
    group.remove(c); c.geometry.dispose();
  }
  for (const [mat, list] of by) group.add(new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat));
}

const UP = new THREE.Vector3(0, 1, 0);

function limb(a, b, r, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, vb.clone().sub(va).normalize());
  return m;
}

// Side profile given as [forward, up] points, extruded across the vehicle's width.
function extrudeProfile(points, width, bevel) {
  const s = new THREE.Shape();
  points.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 });
const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, metalness: 0.6, roughness: 0.45 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xd0d4d9, metalness: 1, roughness: 0.16 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1014, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.82 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2.5 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 2 });
const leatherDark = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.6 });
const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 });

// Normalise a loaded model: longest side along z at the given length, centred, wheels on the ground.
export function fitModel(object, { length, rotateY = 0 }) {
  const g = new THREE.Group(); object.rotation.y = rotateY; g.add(object); g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g), size = b.getSize(new THREE.Vector3());
  const k = length / Math.max(size.z, 0.001);
  object.scale.multiplyScalar(k);
  object.position.set(-(b.min.x + b.max.x) / 2 * k, -b.min.y * k, -(b.min.z + b.max.z) / 2 * k);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const CAR_TYPES = {
  sedan: {
    body: [[-2.2, 0.3], [-2.25, 0.85], [-1.5, 0.95], [-1.0, 1.42], [0.35, 1.45], [1.0, 0.98], [2.1, 0.85], [2.25, 0.6], [2.2, 0.3]],
    side: [[-0.98, 1.0], [-0.72, 1.36], [0.3, 1.38], [0.82, 1.0]],
    panes: [[[0.38, 1.43], [0.98, 1.0]], [[-1.47, 0.98], [-1.03, 1.4]]],
    width: 1.6, wheelZ: 1.35, lightY: 0.72,
  },
  van: {
    body: [[-2.3, 0.35], [-2.35, 1.8], [1.15, 1.85], [1.7, 1.15], [2.3, 1.0], [2.35, 0.35]],
    side: [[0.2, 1.2], [0.2, 1.7], [1.1, 1.7], [1.5, 1.2]],
    panes: [[[1.18, 1.82], [1.68, 1.18]]],
    width: 1.75, wheelZ: 1.45, lightY: 0.8,
  },
};

export function createCar(color, type = 'sedan', custom) {
  const t = CAR_TYPES[type];
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  if (custom) { root.add(custom.object.clone(true)); return { root, halfLen: custom.length / 2 }; }
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const full = t.width + 0.16;
  root.add(new THREE.Mesh(extrudeProfile(t.body, t.width, 0.08), paint));
  root.add(new THREE.Mesh(extrudeProfile(t.side, full + 0.02, 0), glass));
  for (const [a, b] of t.panes) {
    const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy), th = Math.atan2(-dy, dz);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(t.width - 0.1, 0.03, len * 0.86), glass);
    pane.position.set(0, (a[1] + b[1]) / 2 + 0.085 * Math.cos(th), (a[0] + b[0]) / 2 + 0.085 * Math.sin(th));
    pane.rotation.x = th;
    root.add(pane);
  }
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18).rotateZ(Math.PI / 2), rubber);
    w.position.set(sx * (full / 2 - 0.1), 0.34, sz * t.wheelZ); root.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 14).rotateZ(Math.PI / 2), chrome);
    hub.position.copy(w.position); root.add(hub);
  }
  const front = t.body.reduce((m, p) => Math.max(m, p[0]), 0), rear = t.body.reduce((m, p) => Math.min(m, p[0]), 0);
  for (const sx of [1, -1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), headMat); h.position.set(sx * 0.58, t.lightY, front + 0.05); root.add(h);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tailMat); r.position.set(sx * 0.58, t.lightY + 0.08, rear - 0.05); root.add(r);
  }
  mergeMeshes(root);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, halfLen: front + 0.1 };
}
